/**
 * REST API connector adapter.
 *
 * Phase 1: `none` auth + `pagination: 'none'` + manual columns.
 * Single-shot fetch against each configured endpoint; records flow
 * into `entity_records` keyed by `idField` (or a synthetic source-id
 * when unset, which produces a full-replacement diff on every sync).
 *
 * Phases 2/3/4 extend this adapter rather than replacing it: phase 2
 * adds auth + testConnection, phase 3 adds pagination iterators +
 * templating + retry, phase 4 wires the probe-driven column discovery
 * into `discoverColumns`.
 */

import type {
  ApiAuthConfig,
  ApiCredentials,
  ConnectorInstance,
} from "@portalai/core/models";

import { ApiCode } from "../../constants/api-codes.constants.js";
import {
  ConnectorAdapter,
  DiscoveredEntity,
  EntityDataQuery,
  EntityDataResult,
  SyncEligibility,
  SyncInstanceResult,
  TestConnectionParams,
  TestConnectionResult,
} from "../adapter.interface.js";
import { ApiError } from "../../services/http.service.js";
import { DbService } from "../../services/db.service.js";
import { importModeQueryRows } from "../../utils/adapter.util.js";
import { createLogger } from "../../utils/logger.util.js";
import { applyAuth } from "./auth.util.js";
import { loadCredentials } from "./credentials.util.js";
import { fetchJson, type FetchJsonResult } from "./fetch.util.js";
import type { ApiEndpoint } from "../../db/repositories/api-endpoints.repository.js";
import { SystemUtilities } from "../../utils/system.util.js";

const logger = createLogger({ module: "rest-api-adapter" });

// ── Pure helpers (exported for unit testing) ──────────────────────────

/**
 * Resolve a dotted path against a JSON body. Empty string returns the
 * body itself. Throws REST_API_RECORDS_PATH_NOT_FOUND when any segment
 * doesn't exist on its parent.
 */
export function walkRecordsPath(body: unknown, path: string): unknown {
  if (path === "") return body;
  const segments = path.split(".");
  let current: unknown = body;
  for (const seg of segments) {
    if (current == null || typeof current !== "object") {
      throw new ApiError(
        502,
        ApiCode.REST_API_RECORDS_PATH_NOT_FOUND,
        `recordsPath segment "${seg}" of "${path}" doesn't exist on parent`,
        { path, segment: seg }
      );
    }
    current = (current as Record<string, unknown>)[seg];
    if (current === undefined) {
      throw new ApiError(
        502,
        ApiCode.REST_API_RECORDS_PATH_NOT_FOUND,
        `recordsPath segment "${seg}" of "${path}" is undefined`,
        { path, segment: seg }
      );
    }
  }
  return current;
}

/** Throws REST_API_RECORDS_PATH_NOT_ARRAY when the resolved value isn't an array. */
export function assertRecordsArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ApiError(
      502,
      ApiCode.REST_API_RECORDS_PATH_NOT_ARRAY,
      `recordsPath "${path}" resolved to ${typeof value}, expected array`,
      { path, observedType: typeof value }
    );
  }
  return value;
}

/**
 * Join baseUrl + path, append queryParams (preserving any present in
 * the path). Trims trailing slash on baseUrl; ensures leading slash on
 * path; never double-slashes the join.
 */
export function buildUrl(
  baseUrl: string,
  path: string,
  queryParams?: Record<string, string>
): string {
  const base = baseUrl.replace(/\/+$/, "");
  const tail = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${base}${tail}`);
  if (queryParams) {
    for (const [k, v] of Object.entries(queryParams)) url.searchParams.set(k, v);
  }
  return url.toString();
}

/**
 * Compute the per-record `sourceId` for upsert.
 * - `idField` set: coerce record[idField] to string; missing/null
 *   falls back to synthetic to avoid clobbering.
 * - `idField` unset: synthetic `api:<runStartedAt>:<index>`. Every
 *   sync produces fresh synthetics, which yields a full replacement
 *   diff (all prior deleted + all current created) by design.
 */
export function deriveSourceId(
  record: Record<string, unknown>,
  idField: string | null | undefined,
  runStartedAt: number,
  index: number
): string {
  if (idField) {
    const raw = record[idField];
    if (raw !== null && raw !== undefined && raw !== "") return String(raw);
  }
  return `api:${runStartedAt}:${index}`;
}

// ── Adapter implementation ────────────────────────────────────────────

async function discoverEntities(
  instance: ConnectorInstance
): Promise<DiscoveredEntity[]> {
  const endpoints = await DbService.repository.apiEndpoints.findByInstance(
    instance.id
  );
  return endpoints.map(({ entity }) => ({ key: entity.key, label: entity.label }));
}

async function assertSyncEligibility(
  instance: ConnectorInstance
): Promise<SyncEligibility> {
  const endpoints = await DbService.repository.apiEndpoints.findByInstance(
    instance.id
  );
  if (endpoints.length === 0) {
    return {
      ok: false,
      reasonCode: ApiCode.REST_API_NO_ENDPOINTS_CONFIGURED,
      reason: "Add at least one endpoint before syncing",
    };
  }
  const auth = readAuth(instance);
  if (auth.mode !== "none") {
    const credentials = loadCredentials(instance);
    if (credentials === null || credentials.mode === "none") {
      return {
        ok: false,
        reasonCode: ApiCode.REST_API_MISSING_CREDENTIALS,
        reason: `Add ${auth.mode} credentials before syncing`,
      };
    }
  }
  return { ok: true };
}

async function syncInstance(
  instance: ConnectorInstance,
  userId: string,
  progress?: (percent: number) => void
): Promise<SyncInstanceResult> {
  const runStartedAt = Date.now();
  progress?.(0);

  const endpoints = await DbService.repository.apiEndpoints.findByInstance(
    instance.id
  );
  if (endpoints.length === 0) {
    throw new ApiError(
      409,
      ApiCode.REST_API_NO_ENDPOINTS_CONFIGURED,
      `No endpoints configured for instance ${instance.id}`
    );
  }

  const baseUrl = readBaseUrl(instance);
  const auth = readAuth(instance);
  const credentials = loadCredentials(instance);
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalUnchanged = 0;
  let totalDeleted = 0;

  for (let i = 0; i < endpoints.length; i++) {
    const endpoint = endpoints[i];
    progress?.(Math.round((i / endpoints.length) * 90));

    const counts = await syncOneEndpoint(
      endpoint,
      instance,
      baseUrl,
      auth,
      credentials,
      userId,
      runStartedAt
    );
    totalCreated += counts.created;
    totalUpdated += counts.updated;
    totalUnchanged += counts.unchanged;
    totalDeleted += counts.deleted;
  }

  progress?.(95);

  await DbService.repository.connectorInstances.update(instance.id, {
    lastSyncAt: Date.now(),
    lastErrorMessage: null,
    updatedBy: userId,
  });
  progress?.(100);

  logger.info(
    {
      event: "rest-api.sync.completed",
      connectorInstanceId: instance.id,
      runStartedAt,
      recordCounts: {
        created: totalCreated,
        updated: totalUpdated,
        unchanged: totalUnchanged,
        deleted: totalDeleted,
      },
    },
    "REST API sync completed"
  );

  return {
    recordCounts: {
      created: totalCreated,
      updated: totalUpdated,
      unchanged: totalUnchanged,
      deleted: totalDeleted,
    },
  };
}

async function syncOneEndpoint(
  endpoint: ApiEndpoint,
  instance: ConnectorInstance,
  baseUrl: string,
  auth: ApiAuthConfig,
  credentials: ApiCredentials | null,
  userId: string,
  runStartedAt: number
): Promise<{ created: number; updated: number; unchanged: number; deleted: number }> {
  const baseRequestUrl = buildUrl(
    baseUrl,
    endpoint.config.path,
    endpoint.config.queryParams ?? undefined
  );
  const baseInit: RequestInit = {
    method: endpoint.config.method,
    ...(endpoint.config.headers ? { headers: endpoint.config.headers } : {}),
  };

  const { url, init } = applyAuth(baseRequestUrl, baseInit, auth, credentials);

  let page: FetchJsonResult;
  try {
    page = await fetchJson(url, init);
  } catch (err) {
    throw remapAuthFailure(err, url);
  }
  const records = assertRecordsArray(
    walkRecordsPath(page.body, endpoint.config.recordsPath ?? ""),
    endpoint.config.recordsPath ?? ""
  );

  // Phase 1: simple per-record upsert. Phase 3 introduces page iteration
  // + batch upserts; phase 4 wires the probe-driven column mappings.
  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record === null || typeof record !== "object") continue;
    const recordObj = record as Record<string, unknown>;
    const sourceId = deriveSourceId(
      recordObj,
      endpoint.config.idField,
      runStartedAt,
      i
    );
    const checksum = checksumRecord(recordObj);

    const existing = await DbService.repository.entityRecords.findBySourceIds(
      endpoint.entity.id,
      [sourceId]
    );
    const prior = existing[0];

    if (prior && prior.checksum === checksum) {
      // Unchanged → bump syncedAt so watermark reaper leaves it alone.
      await DbService.repository.entityRecords.bulkUpdateSyncedAt(
        [prior.id],
        runStartedAt
      );
      unchanged++;
      continue;
    }

    await DbService.repository.entityRecords.upsertBySourceId({
      id: prior?.id ?? SystemUtilities.id.v4.generate(),
      organizationId: instance.organizationId,
      connectorEntityId: endpoint.entity.id,
      sourceId,
      data: recordObj as never,
      checksum,
      syncedAt: runStartedAt,
      origin: "sync",
      isValid: true,
      validationErrors: null,
      created: prior?.created ?? Date.now(),
      createdBy: prior?.createdBy ?? userId,
      updated: Date.now(),
      updatedBy: userId,
      deleted: null,
      deletedBy: null,
    } as never);

    if (prior) updated++; else created++;
  }

  // Watermark reap: anything not touched by this run is stale.
  const reaped =
    await DbService.repository.entityRecords.softDeleteBeforeWatermark(
      endpoint.entity.id,
      runStartedAt,
      userId
    );

  return { created, updated, unchanged, deleted: reaped.length };
}

function readBaseUrl(instance: ConnectorInstance): string {
  const cfg = instance.config as { baseUrl?: unknown } | null;
  const baseUrl = cfg?.baseUrl;
  if (typeof baseUrl !== "string" || baseUrl.length === 0) {
    throw new ApiError(
      400,
      ApiCode.REST_API_INVALID_CONFIG,
      `Instance ${instance.id} config.baseUrl is missing or invalid`,
      { connectorInstanceId: instance.id }
    );
  }
  return baseUrl;
}

function readAuth(instance: ConnectorInstance): ApiAuthConfig {
  const cfg = instance.config as { auth?: ApiAuthConfig } | null;
  // Defensive default — older instances created before phase 1 may have
  // a null config; treat as `none`. Phase-1 instances always carry a
  // populated auth block.
  return cfg?.auth ?? { mode: "none" };
}

/**
 * Convert a 401/403 from upstream into REST_API_AUTH_FAILED so the
 * frontend can distinguish "credentials are wrong" from "endpoint
 * misbehaved." All other fetch failures pass through unchanged.
 */
function remapAuthFailure(err: unknown, url: string): unknown {
  if (!(err instanceof ApiError)) return err;
  if (err.code !== ApiCode.REST_API_FETCH_FAILED) return err;
  const status = (err.details as { status?: number } | undefined)?.status;
  if (status === 401 || status === 403) {
    return new ApiError(
      502,
      ApiCode.REST_API_AUTH_FAILED,
      `Upstream rejected credentials (HTTP ${status})`,
      { url, status }
    );
  }
  return err;
}

function checksumRecord(record: Record<string, unknown>): string {
  // Stable stringification (sorted keys) → SHA-1-equivalent via simple
  // hash. The existing entity_records.checksum is a string; we mirror
  // the spreadsheet pipeline's "any stable hash" approach.
  const sorted = stableStringify(record);
  let hash = 0x811c9dc5;
  for (let i = 0; i < sorted.length; i++) {
    hash ^= sorted.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

/**
 * Per-endpoint dry run — exercises auth + reachability + recordsPath
 * shape against a single configured endpoint and returns the first 5
 * records as a preview. Read-only: no `entity_records` writes, no
 * `connector_sync` job, no cache invalidation.
 *
 * Returns the structured `TestConnectionResult` for both success and
 * failure. ApiErrors raised in the pipeline (fetch, auth, parse) are
 * caught and projected into `{ ok: false, code, message, details? }`;
 * any other exception bubbles up to the route's generic handler.
 */
async function testConnection(
  instance: ConnectorInstance,
  params: TestConnectionParams
): Promise<TestConnectionResult> {
  const endpointEntityId = params.endpointEntityId;
  if (typeof endpointEntityId !== "string" || endpointEntityId.length === 0) {
    return {
      ok: false,
      code: ApiCode.REST_API_ENDPOINT_NOT_FOUND,
      message: "endpointEntityId is required",
    };
  }

  const endpoint = await DbService.repository.apiEndpoints.findByEntityId(
    endpointEntityId
  );
  if (!endpoint || endpoint.entity.connectorInstanceId !== instance.id) {
    return {
      ok: false,
      code: ApiCode.REST_API_ENDPOINT_NOT_FOUND,
      message: `Endpoint ${endpointEntityId} not configured on instance ${instance.id}`,
    };
  }

  try {
    const baseUrl = readBaseUrl(instance);
    const auth = readAuth(instance);
    const credentials = loadCredentials(instance);

    const baseRequestUrl = buildUrl(
      baseUrl,
      endpoint.config.path,
      endpoint.config.queryParams ?? undefined
    );
    const baseInit: RequestInit = {
      method: endpoint.config.method,
      ...(endpoint.config.headers ? { headers: endpoint.config.headers } : {}),
    };
    const { url, init } = applyAuth(baseRequestUrl, baseInit, auth, credentials);

    let page: FetchJsonResult;
    try {
      page = await fetchJson(url, init);
    } catch (err) {
      throw remapAuthFailure(err, url);
    }

    const records = assertRecordsArray(
      walkRecordsPath(page.body, endpoint.config.recordsPath ?? ""),
      endpoint.config.recordsPath ?? ""
    );

    return { ok: true, sample: records.slice(0, 5) };
  } catch (err) {
    if (err instanceof ApiError) {
      return {
        ok: false,
        code: err.code,
        message: err.message,
        details: err.details,
      };
    }
    throw err;
  }
}

export const restApiAdapter: ConnectorAdapter = {
  queryRows: (instance: ConnectorInstance, query: EntityDataQuery):
    Promise<EntityDataResult> => importModeQueryRows(instance, query),
  discoverEntities,
  async discoverColumns() {
    // Phase 1: no probe. Phase 4 implements probe-driven inference.
    return [];
  },
  assertSyncEligibility,
  syncInstance,
  testConnection,
};
