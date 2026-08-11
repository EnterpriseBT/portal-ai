import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { ApiError } from "../services/http.service.js";
import {
  ApiCode,
  ApiCodeDefaultRecommendation,
} from "../constants/api-codes.constants.js";
import {
  CostAcknowledgementService,
  computeJobSignature,
} from "../services/cost-acknowledgement.service.js";
import { JobLockService } from "../services/job-lock.service.js";
import { BulkTransformService } from "../services/bulk-transform.service.js";
import { JobsService } from "../services/jobs.service.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "bulk-geocode-records.tool" });

/** Fixed batch size for the geocode signature (the processor paces itself). */
const BULK_GEOCODE_BATCH = 500;

const InputSchema = z.object({
  connectorEntityId: z
    .string()
    .min(1)
    .describe("The entity whose address column is geocoded."),
  sourceColumnKey: z.string().min(1).describe("The address column to read."),
  targetColumnKey: z
    .string()
    .min(1)
    .describe("The geometry-role column to write GeoJSON Points into."),
  acknowledgeCost: z
    .boolean()
    .optional()
    .describe(
      "Set true ONLY after surfacing the metered cost to the user and receiving a reply."
    ),
});

/** DB/queue seams, injected so the ack/lock/enqueue path unit-tests without a
 *  live database or worker. */
export interface BulkGeocodeToolDeps {
  countRecords?: (entityId: string, organizationId: string) => Promise<number>;
  assertUnlocked?: (ids: string[], organizationId: string) => Promise<void>;
  createJob?: (
    userId: string,
    params: {
      organizationId: string;
      type: "bulk_geocode";
      metadata: Record<string, unknown>;
    }
  ) => Promise<{ id: string }>;
  recordRejection?: (
    portalId: string,
    signature: string,
    rejectedAt: number
  ) => Promise<void>;
  validateAck?: (
    portalId: string,
    signature: string
  ) => Promise<{ ok: true } | { ok: false; reason: "missing" | "stale" }>;
}

function toEnvelope(err: unknown): Record<string, unknown> {
  if (err instanceof ApiError) {
    return {
      success: false,
      message: err.message,
      code: err.code,
      ...(err.recommendation ? { recommendation: err.recommendation } : {}),
      ...(err.details ? { details: err.details } : {}),
    };
  }
  const e = err as Error;
  return {
    success: false,
    message: e?.message ?? "Unknown failure during bulk_geocode pre-flight.",
    code: "BULK_JOB_PREFLIGHT_FAILED",
  };
}

/**
 * `bulk_geocode_records` (#315) — geocode an entire address column as an
 * async, `expensive` queue job. Server-enforced two-step cost acknowledgement
 * (the `transform_entity_records` gate); the target entity is locked while the
 * job runs (mutations 409); the processor (slice 4) writes GeoJSON Points and
 * bills on success. Returns immediately with a progress block.
 */
export class BulkGeocodeRecordsTool extends Tool<typeof InputSchema> {
  slug = "bulk_geocode_records";
  name = "Bulk Geocode Records";
  description =
    "Geocode every address in an entity column into GeoJSON Point geometry, as an asynchronous job. " +
    "Use for high-cardinality columns (≥100 rows) instead of calling geocode in a loop. The job runs " +
    "in the background: this tool returns immediately with a jobId and a live progress widget, and the " +
    "target entity is locked from edits until it completes.\n\n" +
    "**Metered-cost confirmation gate.** Geocoding bills per uncached address. The first call is rejected " +
    "with an estimate; surface the cost to the user, and only after they reply retry with " +
    "`acknowledgeCost: true`. Cached addresses are free.";

  get schema() {
    return InputSchema;
  }

  build(
    portalId: string,
    stationId: string,
    organizationId: string,
    userId: string,
    deps: BulkGeocodeToolDeps = {}
  ) {
    const countRecords =
      deps.countRecords ??
      ((entityId: string, orgId: string) =>
        BulkTransformService.countSourceRows(entityId, orgId));
    const assertUnlocked =
      deps.assertUnlocked ??
      ((ids: string[], orgId: string) =>
        JobLockService.assertConnectorEntityUnlocked(ids, orgId));
    const createJob =
      deps.createJob ??
      ((uid: string, params) =>
        JobsService.create(uid, params) as Promise<{ id: string }>);
    const recordRejection =
      deps.recordRejection ??
      ((pid: string, sig: string, at: number) =>
        CostAcknowledgementService.recordRejection(pid, sig, at));
    const validateAck =
      deps.validateAck ??
      ((pid: string, sig: string) =>
        CostAcknowledgementService.validate(pid, sig));

    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        try {
          const {
            connectorEntityId,
            sourceColumnKey,
            targetColumnKey,
            acknowledgeCost,
          } = this.validate(input);

          // Server-enforced cost gate (expensive) — record→ack→retry, mirroring
          // transform_entity_records. The agent can't bypass it prompt-side.
          const signature = computeJobSignature({
            sourceConnectorEntityId: connectorEntityId,
            targetConnectorEntityId: connectorEntityId,
            expression: { geocode: { sourceColumnKey, targetColumnKey } },
            keyField: sourceColumnKey,
            batchSize: BULK_GEOCODE_BATCH,
          });

          if (acknowledgeCost !== true) {
            await recordRejection(portalId, signature, Date.now());
            throw new ApiError(
              400,
              ApiCode.BULK_DISPATCH_COST_NOT_ACKNOWLEDGED,
              "Bulk geocoding is metered per uncached address. Surface the cost to the user, then retry with acknowledgeCost: true AFTER they reply.",
              {
                recommendation:
                  ApiCodeDefaultRecommendation[
                    ApiCode.BULK_DISPATCH_COST_NOT_ACKNOWLEDGED
                  ],
              }
            );
          }

          const ack = await validateAck(portalId, signature);
          if (!ack.ok) {
            const message =
              ack.reason === "missing"
                ? "No prior cost rejection on file for this operation. Call without acknowledgeCost first to surface the cost to the user."
                : "User has not replied since the cost rejection. Wait for their next message before retrying with acknowledgeCost: true.";
            throw new ApiError(
              400,
              ApiCode.BULK_DISPATCH_COST_ACKNOWLEDGEMENT_INVALID,
              message,
              {
                recommendation:
                  ApiCodeDefaultRecommendation[
                    ApiCode.BULK_DISPATCH_COST_ACKNOWLEDGEMENT_INVALID
                  ],
                details: { reason: ack.reason },
              }
            );
          }

          // Lock check — a competing job on the same entity refuses here.
          await assertUnlocked([connectorEntityId], organizationId);

          const expectedRecords = await countRecords(
            connectorEntityId,
            organizationId
          );

          const job = await createJob(userId, {
            organizationId,
            type: "bulk_geocode",
            metadata: {
              connectorEntityId,
              sourceColumnKey,
              targetColumnKey,
              targetConnectorEntityIds: [connectorEntityId],
              portalId,
              expectedRecords,
              acknowledgeCost,
              // Threaded through the BullMQ payload (JobData spreads metadata)
              // so the processor can scope SQL + attribute the charge.
              organizationId,
              userId,
              stationId,
            },
          });

          logger.info(
            { jobId: job.id, portalId, connectorEntityId, expectedRecords },
            "bulk_geocode_records enqueued"
          );

          return {
            jobId: job.id,
            expectedRecords,
            message: `Geocoding ${expectedRecords} addresses. Cached addresses are free; only new lookups bill.`,
            blockKind: "bulk-job-progress",
            blockContent: {
              jobId: job.id,
              expectedRecords,
              viewKind: "histogram",
            },
          };
        } catch (err) {
          return toEnvelope(err);
        }
      },
    });
  }
}
