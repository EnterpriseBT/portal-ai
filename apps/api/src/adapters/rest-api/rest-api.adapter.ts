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
  ApiEndpointConfig,
  ConnectorInstance,
  PaginationConfig,
} from "@portalai/core/models";
import { probeInputHash } from "@portalai/core/utils";
import type {
  DiscoverColumnsResult,
  ProbeEndpointDraftRequestBody,
} from "@portalai/core/contracts";

import { ApiCode } from "../../constants/api-codes.constants.js";
import {
  ConnectorAdapter,
  DiscoveredColumn,
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
import type {
  ApiClassifierCandidate,
  ColumnDefinitionCatalogEntry,
  ColumnDefinitionClassifier,
} from "./classifier.types.js";
import { loadCredentials } from "./credentials.util.js";
import {
  fetchFirstPage,
  fetchOnePage,
} from "./fetch-first-page.util.js";
import {
  inferColumns,
  MAX_RECORDS_SCANNED,
  MAX_SAMPLES_PER_COLUMN,
} from "./inference.util.js";
import {
  resolveIterator,
  reconstructPagination,
} from "./pagination/index.js";
import { ProbeCache } from "./probe-cache.util.js";
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
  const pagination = reconstructPagination(
    endpoint.config.pagination,
    (endpoint.config.paginationConfig as Record<string, unknown> | null) ?? null
  );
  const iterator = resolveIterator(pagination);

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  // Global across all pages so synthetic source ids stay unique for an
  // endpoint that paginates without an `idField`.
  let recordIndex = 0;

  let next = await iterator.next();
  while (!next.done) {
    const fetched = await fetchOnePage(
      endpoint,
      baseUrl,
      auth,
      credentials,
      pagination,
      next.value
    );

    for (const record of fetched.records) {
      if (record === null || typeof record !== "object") {
        recordIndex++;
        continue;
      }
      const recordObj = record as Record<string, unknown>;
      const sourceId = deriveSourceId(
        recordObj,
        endpoint.config.idField,
        runStartedAt,
        recordIndex
      );
      recordIndex++;
      const checksum = checksumRecord(recordObj);

      const existing =
        await DbService.repository.entityRecords.findBySourceIds(
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

    next = await iterator.next(fetched);
  }

  // Watermark reap runs once per endpoint, AFTER all pages have synced.
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
    const pagination = reconstructPagination(
      endpoint.config.pagination,
      (endpoint.config.paginationConfig as Record<string, unknown> | null) ?? null
    );

    // testConnection is page-1-only by design. `fetchFirstPage` drives
    // the iterator exactly once so per-strategy response inspection
    // still runs (cursor extraction, Link header parsing, etc.) and
    // any config errors surface — but no follow-up fetch fires.
    const fetched = await fetchFirstPage(
      endpoint,
      baseUrl,
      auth,
      credentials,
      pagination
    );

    return { ok: true, sample: fetched.records.slice(0, 5) };
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

/**
 * REST API connectors have no account identity for the non-OAuth auth
 * modes (none / apiKey / bearer / basic) — surface the configured
 * baseUrl as the card-chip label so the user can tell instances apart.
 * Falls back to a generic label when the config is malformed.
 */
function toPublicAccountInfo(
  _credentials: Record<string, unknown> | null,
  instance?: ConnectorInstance
) {
  const cfg = instance?.config as { baseUrl?: unknown } | null | undefined;
  const baseUrl =
    typeof cfg?.baseUrl === "string" && cfg.baseUrl.length > 0
      ? cfg.baseUrl
      : "REST API";
  return { identity: baseUrl, metadata: {} };
}

// ── Probe pipeline (slice 5) ─────────────────────────────────────────
//
// `RestApiAdapter` carries two process-singletons injected at register
// time via `configureRestApiAdapterDeps`: a `ProbeCache` (per-process,
// 60s TTL) holding the merged heuristic + AI-assist result, and an
// optional `ColumnDefinitionClassifier` (Haiku 4.5 by default).
//
// Both are mutable so tests can swap them per-suite.

let probeCache: ProbeCache<DiscoverColumnsResult> | null = null;
let columnClassifier: ColumnDefinitionClassifier | null = null;

export interface RestApiAdapterDeps {
  cache?: ProbeCache<DiscoverColumnsResult>;
  /** Pass `null` explicitly to disable AI-assist; omit to leave unchanged. */
  classifier?: ColumnDefinitionClassifier | null;
}

export function configureRestApiAdapterDeps(deps: RestApiAdapterDeps): void {
  if (deps.cache !== undefined) probeCache = deps.cache;
  if ("classifier" in deps) columnClassifier = deps.classifier ?? null;
}

/** Test-only — wipes both deps so suites start from a clean slate. */
export function __resetRestApiAdapterDepsForTests(): void {
  probeCache = null;
  columnClassifier = null;
}

async function loadColumnDefinitionCatalog(
  organizationId: string
): Promise<ColumnDefinitionCatalogEntry[]> {
  const rows = await DbService.repository.columnDefinitions.findByOrganizationId(
    organizationId
  );
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    normalizedKey: row.key,
    description: row.description ?? undefined,
    type: row.type,
  }));
}

/**
 * The probe pipeline's rich entry point. Used by the discoverColumns
 * route (slice 6) so the response carries samples + source +
 * recordsScanned + degradation alongside the per-column suggestions.
 *
 * Flow:
 *   1. resolve endpoint by entity key (404 if missing)
 *   2. cache hit → return early with `source: "cache"`
 *   3. cache miss → drive `fetchFirstPage`, slice to MAX_RECORDS_SCANNED
 *   4. heuristic layer (`inferColumns`) always runs
 *   5. AI-assist layer (optional): build candidates + load catalog +
 *      call classifier; silent degradation on any throw
 *   6. merge classifications by `sourceField` into the heuristic
 *      columns; cache the merged result; return.
 */
/**
 * Inputs to the probe pipeline. Built by `buildProbeContextFromInstance`
 * for the post-commit detail-view route and (in slice 6) synthesized
 * from the request body for the pre-commit workflow route. Once the
 * context is built, `runProbePipeline` is the single inner pipeline.
 */
interface ProbeContext {
  organizationId: string;
  endpointKey: string;
  /** Persisted instance id when known (post-commit path); used for logging only. */
  connectorInstanceId?: string;
  baseUrl: string;
  auth: ApiAuthConfig;
  credentials: ApiCredentials | null;
  endpoint: ApiEndpoint;
  pagination: PaginationConfig;
}

async function buildProbeContextFromInstance(
  instance: ConnectorInstance,
  endpointKey: string
): Promise<ProbeContext> {
  const endpoints = await DbService.repository.apiEndpoints.findByInstance(
    instance.id
  );
  const endpoint = endpoints.find((e) => e.entity.key === endpointKey);
  if (!endpoint) {
    throw new ApiError(
      404,
      ApiCode.REST_API_ENDPOINT_NOT_FOUND,
      `No endpoint configured on instance ${instance.id} for entity key "${endpointKey}"`
    );
  }

  return {
    organizationId: instance.organizationId,
    endpointKey,
    connectorInstanceId: instance.id,
    baseUrl: readBaseUrl(instance),
    auth: readAuth(instance),
    credentials: loadCredentials(instance),
    endpoint,
    pagination: reconstructPagination(
      endpoint.config.pagination,
      (endpoint.config.paginationConfig as Record<string, unknown> | null) ??
        null
    ),
  };
}

async function runProbePipeline(
  ctx: ProbeContext,
  opts: { forceRefresh?: boolean; cacheKey: string }
): Promise<DiscoverColumnsResult> {
  if (!probeCache) {
    throw new ApiError(
      500,
      ApiCode.REST_API_OPERATION_FAILED,
      "RestApiAdapter probe cache not configured — register adapters before invoking discoverColumns"
    );
  }

  if (opts.forceRefresh) {
    probeCache.invalidate(opts.cacheKey);
  } else {
    const cached = probeCache.get(opts.cacheKey);
    if (cached) {
      return { ...cached, source: "cache" };
    }
  }

  // Live probe. Transform failures here are advisory (degradation),
  // not fatal — the user is mid-edit and needs to see the error to
  // fix their expression. Sync uses the same fetch path but lets the
  // error propagate normally.
  let fetched: Awaited<ReturnType<typeof fetchFirstPage>>;
  try {
    fetched = await fetchFirstPage(
      ctx.endpoint,
      ctx.baseUrl,
      ctx.auth,
      ctx.credentials,
      ctx.pagination
    );
  } catch (err) {
    if (err instanceof ApiError && err.code === ApiCode.REST_API_TRANSFORM_FAILED) {
      const result: DiscoverColumnsResult = {
        columns: [],
        source: "live",
        cachedAt: Date.now(),
        recordsScanned: 0,
        degradation: "transform-failed",
        transformError: {
          kind: (err.details?.kind as "parse" | "runtime") ?? "runtime",
          message: (err.details?.message as string) ?? err.message,
        },
      };
      probeCache.set(opts.cacheKey, result);
      return result;
    }
    throw err;
  }
  const scanned = fetched.records.slice(0, MAX_RECORDS_SCANNED);
  const inference = inferColumns(scanned);

  // AI-assist layer.
  let degradation: DiscoverColumnsResult["degradation"] = null;
  const suggestionsByField = new Map<
    string,
    {
      columnDefinitionId: string | null;
      suggestedNormalizedKey: string;
      suggestedSemanticType: DiscoveredColumn["type"];
      confidence: number;
      rationale: string;
    }
  >();

  if (inference.columns.length === 0) {
    // No candidates — skip the classifier; degradation stays null.
  } else if (!columnClassifier) {
    degradation = "llm-disabled";
  } else {
    try {
      const candidates: ApiClassifierCandidate[] = inference.columns.map(
        (col) => ({
          sourceField: col.key,
          inferredType: col.type,
          samples: (inference.samples[col.key] ?? []).slice(
            0,
            MAX_SAMPLES_PER_COLUMN
          ),
        })
      );
      const catalog = await loadColumnDefinitionCatalog(ctx.organizationId);
      const classifications = await columnClassifier.classify(candidates, catalog);
      for (const c of classifications) {
        suggestionsByField.set(c.sourceField, {
          columnDefinitionId: c.columnDefinitionId,
          suggestedNormalizedKey: c.suggestedNormalizedKey,
          suggestedSemanticType: c.suggestedSemanticType,
          confidence: c.confidence,
          rationale: c.rationale,
        });
      }
    } catch (err) {
      logger.error(
        {
          event: "rest-api.probe.classifier-failed",
          connectorInstanceId: ctx.connectorInstanceId,
          organizationId: ctx.organizationId,
          endpointKey: ctx.endpointKey,
          cause: (err as Error).message,
        },
        "classifier failed; degrading to heuristic-only"
      );
      degradation = "llm-failed";
    }
  }

  const columns = inference.columns.map((col) => {
    const sugg = suggestionsByField.get(col.key);
    return {
      key: col.key,
      label: col.label,
      type: col.type,
      required: col.required,
      sourceField: col.key,
      samples: inference.samples[col.key] ?? [],
      ...(sugg ? { suggestion: sugg } : {}),
    };
  });

  const result: DiscoverColumnsResult = {
    columns,
    source: "live",
    cachedAt: Date.now(),
    recordsScanned: scanned.length,
    degradation,
  };

  probeCache.set(opts.cacheKey, result);
  return result;
}

async function discoverColumnsWithSamples(
  instance: ConnectorInstance,
  entityKey: string,
  options: { forceRefresh?: boolean } = {}
): Promise<DiscoverColumnsResult> {
  const ctx = await buildProbeContextFromInstance(instance, entityKey);
  return runProbePipeline(ctx, {
    forceRefresh: options.forceRefresh,
    cacheKey: ctx.endpoint.entity.id,
  });
}

/**
 * Pre-commit probe — slice 6. Synthesizes a ProbeContext from a request
 * body (no DB lookup, no persisted ConnectorInstance / ApiEndpoint) and
 * delegates to the shared `runProbePipeline`. Cache key is the canonical
 * `probeInputHash` so the 60-second probe-cache is shared with the
 * client's cache-staleness check (decision 16). Credentials live for
 * the request duration only — they are never persisted (decision 5).
 */
async function probeEndpointDraft(
  organizationId: string,
  body: ProbeEndpointDraftRequestBody
): Promise<DiscoverColumnsResult> {
  const cacheKey = await probeInputHash({
    organizationId,
    baseUrl: body.baseUrl,
    auth: body.auth,
    credentials: body.credentials,
    endpoint: body.endpoint,
  });
  const ctx: ProbeContext = {
    organizationId,
    endpointKey: "<draft>",
    baseUrl: body.baseUrl,
    auth: body.auth,
    credentials: body.credentials,
    endpoint: synthesizeDraftApiEndpoint(body.endpoint, organizationId),
    pagination: body.endpoint.pagination,
  };
  return runProbePipeline(ctx, {
    forceRefresh: body.forceRefresh,
    cacheKey,
  });
}

/**
 * Build a minimal `ApiEndpoint` shape from a workflow-draft config.
 * `fetchOnePage` only reads `endpoint.config.*` fields at runtime, so
 * the synthesized `entity` is a structural stub — never persisted,
 * never used beyond signature compatibility with the post-commit path.
 */
function synthesizeDraftApiEndpoint(
  config: ApiEndpointConfig,
  organizationId: string
): ApiEndpoint {
  return {
    entity: {
      id: "<draft-probe>",
      organizationId,
      connectorInstanceId: "<draft-probe>",
      key: "<draft>",
      label: "<draft>",
    } as unknown as ApiEndpoint["entity"],
    config: config as unknown as ApiEndpoint["config"],
  };
}

async function discoverColumns(
  instance: ConnectorInstance,
  entityKey: string
): Promise<DiscoveredColumn[]> {
  const result = await discoverColumnsWithSamples(instance, entityKey);
  return result.columns.map((c) => ({
    key: c.key,
    label: c.label,
    type: c.type,
    required: c.required,
  }));
}

// Exposed for slice 6 — pre-commit probe-draft route synthesizes its
// own ProbeContext from the request body and feeds it to runProbePipeline.
export type { ProbeContext };
export { buildProbeContextFromInstance, runProbePipeline, probeEndpointDraft };

export const restApiAdapter: ConnectorAdapter & {
  discoverColumnsWithSamples: typeof discoverColumnsWithSamples;
  probeEndpointDraft: typeof probeEndpointDraft;
} = {
  queryRows: (instance: ConnectorInstance, query: EntityDataQuery):
    Promise<EntityDataResult> => importModeQueryRows(instance, query),
  discoverEntities,
  discoverColumns,
  discoverColumnsWithSamples,
  probeEndpointDraft,
  toPublicAccountInfo,
  assertSyncEligibility,
  syncInstance,
  testConnection,
};
