import type { TypedJobProcessor } from "../jobs.worker.js";

import { ALL_TOOL_CAPABILITIES } from "@portalai/core/registries";
import type { BulkGeocodeResult } from "@portalai/core/models";

import { CostGateService } from "../../services/cost-gate.service.js";
import { wideTableRepo } from "../../db/repositories/wide-table.repository.js";
import { MapboxGeocodingProvider } from "../../services/geocoding/mapbox.js";
import type { GeocodingProvider } from "../../services/geocoding/provider.js";
import { cacheGet, cacheSet } from "../../services/geocoding/cache.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import { environment } from "../../environment.js";
import { createLogger } from "../../utils/logger.util.js";

const logger = createLogger({ module: "bulk-geocode.processor" });

/** Cap the persisted per-row failure list so the result row stays bounded. */
const MAX_PARTIAL_FAILURES = 50;

interface RunArgs {
  jobId: string;
  connectorEntityId: string;
  sourceColumnKey: string;
  targetColumnKey: string;
  organizationId: string;
}

interface RunDeps {
  /** Rows to geocode: `{ recordId, address }` per entity record. */
  fetchAddresses: (
    connectorEntityId: string,
    sourceColumnKey: string,
    organizationId: string
  ) => Promise<Array<{ recordId: string; address: unknown }>>;
  /** Write a GeoJSON Point into the target geometry column of one record. */
  writeGeometry: (
    connectorEntityId: string,
    recordId: string,
    targetColumnKey: string,
    point: { type: "Point"; coordinates: [number, number] }
  ) => Promise<void>;
  provider: GeocodingProvider;
  /** Cache read/write, keyed by the provider name. */
  cacheGet: (address: string) => Promise<{ lat: number; lng: number } | null>;
  cacheSet: (
    address: string,
    hit: {
      lat: number;
      lng: number;
      formattedAddress: string;
      confidence: number;
    }
  ) => Promise<void>;
  /** Charge `units` on success (bill-on-success). */
  commitCharge: (units: number) => Promise<void>;
  onProgress?: (done: number, total: number) => Promise<void> | void;
}

/**
 * Core bulk-geocode loop (#315), extracted so the billing + counting +
 * partial-failure logic unit-tests without a live DB, provider, or Redis.
 *
 * Every address is geocoded cache-aware: a cache hit is free (`cached`), a
 * live provider success is billable (`geocoded`) and cached for next time, and
 * an unresolved/failed address is counted (`failed`) with the row identifiable.
 * The charge is committed **once**, for the uncached successes only — cache
 * hits and failures are free. A retried job re-charges under the same
 * `job:<jobId>` id, so `commitCharge`'s idempotency prevents a double-ledger.
 */
export async function runBulkGeocode(
  args: RunArgs,
  deps: RunDeps
): Promise<BulkGeocodeResult> {
  const start = Date.now();
  const rows = await deps.fetchAddresses(
    args.connectorEntityId,
    args.sourceColumnKey,
    args.organizationId
  );

  let geocoded = 0;
  let cached = 0;
  let failed = 0;
  const partialFailures: BulkGeocodeResult["partialFailures"] = [];

  for (let i = 0; i < rows.length; i++) {
    const { recordId, address } = rows[i];
    try {
      if (typeof address !== "string" || address.trim() === "") {
        throw Object.assign(new Error("Row has no address to geocode."), {
          code: ApiCode.GEOCODE_ADDRESS_UNRESOLVED,
        });
      }
      const cachedHit = await deps.cacheGet(address);
      let lat: number;
      let lng: number;
      if (cachedHit) {
        cached++;
        lat = cachedHit.lat;
        lng = cachedHit.lng;
      } else {
        const hit = await deps.provider.geocode(address);
        await deps.cacheSet(address, hit);
        geocoded++;
        lat = hit.lat;
        lng = hit.lng;
      }
      await deps.writeGeometry(
        args.connectorEntityId,
        recordId,
        args.targetColumnKey,
        {
          type: "Point",
          coordinates: [lng, lat],
        }
      );
    } catch (err) {
      failed++;
      if (partialFailures.length < MAX_PARTIAL_FAILURES) {
        const e = err as { code?: string; message?: string };
        partialFailures.push({
          sourceKey: recordId,
          error: {
            success: false,
            code: (e.code as string) ?? ApiCode.GEOCODE_PROVIDER_UNAVAILABLE,
            message: e.message ?? "Geocode failed.",
          },
        });
      }
    }
    await deps.onProgress?.(i + 1, rows.length);
  }

  // Bill-on-success: only the uncached provider hits cost units. A job that
  // throws out of the loop (infra failure) never reaches here → free.
  await deps.commitCharge(geocoded);

  const result: BulkGeocodeResult = {
    geocoded,
    cached,
    failed,
    durationMs: Date.now() - start,
  };
  if (partialFailures.length > 0) {
    result.partialFailures = partialFailures;
    if (failed > partialFailures.length) {
      result.partialFailuresOmitted = failed - partialFailures.length;
    }
  }
  return result;
}

/**
 * BullMQ processor for `bulk_geocode` — wires {@link runBulkGeocode} to the
 * real wide-table, Mapbox provider, address cache, and cost gate.
 */
export const bulkGeocodeProcessor: TypedJobProcessor<"bulk_geocode"> = async (
  bullJob
) => {
  const { jobId, connectorEntityId, sourceColumnKey, targetColumnKey } =
    bullJob.data;
  const data = bullJob.data as unknown as {
    organizationId: string;
    userId?: string;
    stationId?: string;
    portalId?: string;
  };
  const organizationId = data.organizationId;

  const provider = new MapboxGeocodingProvider(
    environment.GEOCODING_API_KEY as string
  );

  logger.info(
    { jobId, connectorEntityId, sourceColumnKey, targetColumnKey },
    "bulk_geocode started"
  );

  const result = await runBulkGeocode(
    {
      jobId,
      connectorEntityId,
      sourceColumnKey,
      targetColumnKey,
      organizationId,
    },
    {
      fetchAddresses: async (entityId, sourceKey, orgId) => {
        const rows = await wideTableRepo.fetchProjectedRows(
          entityId,
          [sourceKey],
          { organizationId: orgId }
        );
        return rows.map((r) => ({
          recordId: r._record_id as string,
          address: r[sourceKey],
        }));
      },
      writeGeometry: (entityId, recordId, targetKey, point) =>
        wideTableRepo.updatePartial(entityId, recordId, {
          [targetKey]: point,
        }),
      provider,
      cacheGet: (address) => cacheGet(provider.name, address),
      cacheSet: (address, hit) => cacheSet(provider.name, address, hit),
      commitCharge: (units) =>
        CostGateService.commitCharge({
          organizationId,
          costClass: ALL_TOOL_CAPABILITIES.bulk_geocode_records.costHint,
          units,
          actor: { userId: data.userId ?? "SYSTEM" },
          toolName: "bulk_geocode_records",
          toolCallId: `job:${jobId}`,
          stationId: data.stationId ?? "",
          portalId: data.portalId ?? null,
        }),
      onProgress: async (done, total) => {
        await bullJob.updateProgress(
          total > 0 ? Math.round((done / total) * 100) : 100
        );
      },
    }
  );

  logger.info({ jobId, ...result }, "bulk_geocode completed");
  return result;
};
