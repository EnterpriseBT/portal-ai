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
  PreviewEndpointPageRequestBody,
  PreviewEndpointPageResponse,
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
  streamFetchOnePage,
} from "./fetch-first-page.util.js";
import {
  inferColumns,
  MAX_RECORDS_SCANNED,
  MAX_SAMPLES_PER_COLUMN,
} from "./inference.util.js";
import { resolveIterator, reconstructPagination } from "./pagination/index.js";
import { ProbeCache } from "./probe-cache.util.js";
import type { ApiEndpoint } from "../../db/repositories/api-endpoints.repository.js";
import { SystemUtilities } from "../../utils/system.util.js";
import { NormalizationService } from "../../services/normalization.service.js";
import { wideTableStatementCache } from "../../services/wide-table-statement.cache.js";
import {
  projectToWideRow,
  buildMappingsForProjection,
} from "../../services/wide-table-projection.util.js";
import { eq } from "drizzle-orm";
import { fieldMappings } from "../../db/schema/index.js";

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
    for (const [k, v] of Object.entries(queryParams))
      url.searchParams.set(k, v);
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
  return endpoints.map(({ entity }) => ({
    key: entity.key,
    label: entity.label,
  }));
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

  // The 0-90% band is split evenly across endpoints. For each
  // endpoint we hand `syncOneEndpoint` a per-page reporter that ticks
  // an asymptotic curve toward the endpoint's slice without ever
  // reaching it — so on a single-endpoint paginated sync the meter
  // visibly advances during pagination instead of sitting at 0%
  // (issue #94). We don't know the total page count upfront for
  // cursor/link-paginated APIs, so the curve doesn't claim a real ETA.
  const slicePct = 90 / endpoints.length;
  for (let i = 0; i < endpoints.length; i++) {
    const endpoint = endpoints[i];
    const basePct = (i / endpoints.length) * 90;
    progress?.(Math.round(basePct));

    const counts = await syncOneEndpoint(
      endpoint,
      instance,
      baseUrl,
      auth,
      credentials,
      userId,
      runStartedAt,
      progress
        ? (pagesEmitted: number) => {
            const intra = 1 - Math.exp(-pagesEmitted / 20);
            progress(Math.round(basePct + intra * slicePct));
          }
        : undefined
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
  runStartedAt: number,
  // Per-page progress reporter. Called with the running count of
  // "pages" emitted for this endpoint (1, 2, …). Caller maps that
  // count onto the meter via an asymptotic curve so the bar advances
  // visibly during pagination without claiming a false ETA.
  // Streaming-eligible endpoints emit one page at stream start and
  // another after the stream drains — enough motion to signal liveness.
  reportPage?: (pagesEmitted: number) => void
): Promise<{
  created: number;
  updated: number;
  unchanged: number;
  deleted: number;
}> {
  const pagination = reconstructPagination(
    endpoint.config.pagination,
    (endpoint.config.paginationConfig as Record<string, unknown> | null) ?? null
  );
  const iterator = resolveIterator(pagination);

  // `counts` is a mutable bag so the extracted `upsertRecord` helper
  // (shared with the slice-4 streaming branch) can mutate counters
  // through the same reference instead of returning + accumulating.
  // `recordIndex` is global across all pages so synthetic source ids
  // stay unique for an endpoint that paginates without an `idField`.
  const counts = { created: 0, updated: 0, unchanged: 0, recordIndex: 0 };

  // Pre-fetch field mappings + the wide-table statement once per
  // endpoint so the inner loop can normalize + project each record
  // into the matching `er__<id>` row without hitting the DB twice.
  // When `stmt.columns.length === 0` the entity has no live wide-table
  // columns yet (workflow committed without column drafts) — skip the
  // wide-table writes; the field-mapping route's reconciler picks
  // them up later.
  //
  // Setup is wrapped so a failure here (bad join, stale statement
  // cache, etc.) degrades to a sync that still writes entity_records
  // but skips the wide-table mirror. Without this guard, a setup
  // error would fail the whole connector_sync job before the upstream
  // fetch even happens — historically the source of an opaque
  // "Cannot read properties of null (reading 'constructor')" failure
  // when the field-mappings leftJoin returned a hollow columnDefinition.
  let mappingsForNormalize: unknown = [];
  let wideProjection: ReadonlyMap<string, string> | null = null;
  try {
    mappingsForNormalize = await DbService.repository.fieldMappings.findMany(
      eq(fieldMappings.connectorEntityId, endpoint.entity.id),
      { include: ["columnDefinition"] }
    );
    const wideStmt = await wideTableStatementCache.get(endpoint.entity.id);
    wideProjection =
      wideStmt.columns.length > 0
        ? buildMappingsForProjection(wideStmt.columns)
        : null;
  } catch (err) {
    logger.error(
      {
        event: "rest-api.sync.wide-table-setup-failed",
        connectorEntityId: endpoint.entity.id,
        cause: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
      "Wide-table mirror setup failed — sync continues but the mirror is skipped"
    );
    mappingsForNormalize = [];
    wideProjection = null;
  }

  const ctx: UpsertContext = {
    endpoint,
    instance,
    runStartedAt,
    userId,
    mappingsForNormalize,
    wideProjection,
    counts,
  };

  let pagesEmitted = 0;
  if (isStreamingEligible(endpoint)) {
    const streamStartedAt = Date.now();
    const page = await streamFetchOnePage(endpoint, baseUrl, auth, credentials);
    pagesEmitted++;
    reportPage?.(pagesEmitted);
    try {
      for await (const record of page.recordsStream) {
        await upsertRecord(record, ctx);
      }
    } finally {
      logger.info(
        {
          event: "rest-api.sync.stream-page",
          connectorInstanceId: instance.id,
          connectorEntityId: endpoint.entity.id,
          recordsEmitted: counts.recordIndex,
          bytesObserved: page.recordsStream.getBytesObserved(),
          durationMs: Date.now() - streamStartedAt,
        },
        "Streaming page drained"
      );
    }
    pagesEmitted++;
    reportPage?.(pagesEmitted);
  } else {
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
        await upsertRecord(record, ctx);
      }

      pagesEmitted++;
      reportPage?.(pagesEmitted);
      next = await iterator.next(fetched);
    }
  }

  // Watermark reap runs once per endpoint, AFTER all pages have synced.
  const reaped =
    await DbService.repository.entityRecords.softDeleteBeforeWatermark(
      endpoint.entity.id,
      runStartedAt,
      userId
    );

  return {
    created: counts.created,
    updated: counts.updated,
    unchanged: counts.unchanged,
    deleted: reaped.length,
  };
}

/**
 * Eligibility predicate for the streaming JSON parse path. True when:
 *   - The endpoint's pagination strategy is `"none"` — paginated
 *     responses already keep memory bounded per page; the streaming
 *     primitive only wraps the single-shot case.
 *   - The endpoint's `transform` is empty — JSONata expressions need
 *     the whole document in memory; the streaming path is records-path
 *     only.
 *
 * Anything that returns `false` here flows through the existing
 * buffered iterator path in `syncOneEndpoint`, unchanged.
 */
export function isStreamingEligible(endpoint: ApiEndpoint): boolean {
  const transform = (endpoint.config.transform ?? "").trim();
  return endpoint.config.pagination === "none" && transform.length === 0;
}

/**
 * Per-record sync state shared by the buffered iterator loop in
 * `syncOneEndpoint` and the slice-4 streaming branch. Counters live
 * in a mutable bag so both call sites mutate through the same
 * reference without threading return values back through hot-path
 * iteration.
 */
export interface UpsertContext {
  endpoint: ApiEndpoint;
  instance: ConnectorInstance;
  runStartedAt: number;
  userId: string;
  /**
   * Field mappings + their column-definition joins, pre-fetched once
   * per endpoint. Passed through `NormalizationService` for wide-table
   * mirroring; the helper doesn't inspect the shape.
   */
  mappingsForNormalize: unknown;
  /**
   * `null` when the entity has no live wide-table columns (workflow
   * committed without column drafts, or the cache lookup failed).
   * In that case the wide-table mirror is skipped — `entity_records`
   * still receives the write.
   */
  wideProjection: ReadonlyMap<string, string> | null;
  counts: {
    created: number;
    updated: number;
    unchanged: number;
    recordIndex: number;
  };
}

/**
 * Upsert a single record into `entity_records` and mirror into the
 * wide table. Mutates `ctx.counts` in place — never returns the
 * counters, and never throws on a non-object record (just bumps
 * `recordIndex` and returns so synthetic source ids stay aligned
 * across the array).
 *
 * Extracted from `syncOneEndpoint`'s inner loop so the slice-4
 * streaming branch can call the same per-record body without
 * duplicating it.
 */
export async function upsertRecord(
  record: unknown,
  ctx: UpsertContext
): Promise<void> {
  if (record === null || typeof record !== "object") {
    ctx.counts.recordIndex++;
    return;
  }

  // Defensively normalize the record's prototype before it touches
  // Drizzle. Drizzle's PgInsertBuilder.values() walks each column
  // value through `is(v, SQL)`, which reaches for
  // `Object.getPrototypeOf(v).constructor` — that throws "Cannot
  // read properties of null (reading 'constructor')" if `v` is a
  // prototypeless object. Some upstreams (NASA's NEO feed when its
  // body parses through certain runtimes; jsonata transform
  // outputs in some cases) deliver `Object.create(null)`-shaped
  // sub-objects, and that null-prototype value flows straight
  // into the `data` jsonb column. Spreading via `{ ...record }`
  // attaches Object.prototype to the top-level wrapper, which is
  // all Drizzle needs to introspect at insert time. Sub-objects
  // keep whatever shape they came in with — jsonb stores them
  // verbatim either way.
  const recordObj = { ...(record as Record<string, unknown>) };
  const sourceId = deriveSourceId(
    recordObj,
    ctx.endpoint.config.idField,
    ctx.runStartedAt,
    ctx.counts.recordIndex
  );
  ctx.counts.recordIndex++;
  const checksum = checksumRecord(recordObj);

  const existing = await DbService.repository.entityRecords.findBySourceIds(
    ctx.endpoint.entity.id,
    [sourceId]
  );
  const prior = existing[0];

  if (prior && prior.checksum === checksum) {
    // Unchanged → bump syncedAt so watermark reaper leaves it alone.
    await DbService.repository.entityRecords.bulkUpdateSyncedAt(
      [prior.id],
      ctx.runStartedAt
    );
    // Wide-table mirror: re-project + upsert (idempotent via
    // ON CONFLICT). Backfills rows that exist in entity_records
    // but are missing from the wide table — common right after
    // landing field mappings on an already-synced entity.
    if (ctx.wideProjection) {
      await mirrorRecordToWideTable(
        ctx.endpoint.entity.id,
        prior.id,
        ctx.instance.organizationId,
        sourceId,
        ctx.runStartedAt,
        recordObj,
        ctx.mappingsForNormalize,
        ctx.wideProjection
      );
    }
    ctx.counts.unchanged++;
    return;
  }

  const rowId = prior?.id ?? SystemUtilities.id.v4.generate();
  const upserted = await DbService.repository.entityRecords.upsertBySourceId({
    id: rowId,
    organizationId: ctx.instance.organizationId,
    connectorEntityId: ctx.endpoint.entity.id,
    sourceId,
    data: recordObj as never,
    checksum,
    syncedAt: ctx.runStartedAt,
    origin: "sync",
    isValid: true,
    validationErrors: null,
    created: prior?.created ?? Date.now(),
    createdBy: prior?.createdBy ?? ctx.userId,
    updated: Date.now(),
    updatedBy: ctx.userId,
    deleted: null,
    deletedBy: null,
  } as never);

  // Mirror into the wide table so the entity detail view sees the
  // columns populated. Skip when the entity has no field_mappings
  // yet (no c_* columns) — the field-mapping create route's
  // reconciler will populate them once mappings land.
  if (ctx.wideProjection) {
    await mirrorRecordToWideTable(
      ctx.endpoint.entity.id,
      upserted.id,
      ctx.instance.organizationId,
      sourceId,
      ctx.runStartedAt,
      recordObj,
      ctx.mappingsForNormalize,
      ctx.wideProjection
    );
  }

  if (prior) ctx.counts.updated++;
  else ctx.counts.created++;
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
 * Mirror a single synced record into the entity's wide table
 * (`er__<id>`). Runs `NormalizationService.normalizeWithMappings` →
 * `projectToWideRow` → `wideTable.upsertMany` for one row.
 *
 * The wide-table write is best-effort: a failure here leaves the
 * record's data in `entity_records` (the source of truth) and the
 * next reconcile / re-sync can backfill the wide row. Logs the
 * underlying error so we can diagnose without breaking the whole
 * sync run.
 */
async function mirrorRecordToWideTable(
  connectorEntityId: string,
  recordId: string,
  organizationId: string,
  sourceId: string,
  syncedAt: number,
  recordObj: Record<string, unknown>,
  mappingsForNormalize: unknown,
  wideProjection: ReadonlyMap<string, string>
): Promise<void> {
  try {
    const normalized = NormalizationService.normalizeWithMappings(
      mappingsForNormalize as never,
      recordObj
    );
    await DbService.repository.wideTable.upsertMany(connectorEntityId, [
      projectToWideRow(
        {
          id: recordId,
          organizationId,
          sourceId,
          syncedAt,
          isValid: normalized.isValid,
          normalizedData: normalized.normalizedData,
        },
        wideProjection
      ),
    ]);
  } catch (err) {
    logger.error(
      {
        event: "rest-api.sync.wide-table-mirror-failed",
        connectorEntityId,
        recordId,
        sourceId,
        cause: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
      "Wide-table mirror failed for record — entity_records row is intact; next reconcile will backfill"
    );
  }
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
    .map(
      (k) =>
        `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`
    )
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

  const endpoint =
    await DbService.repository.apiEndpoints.findByEntityId(endpointEntityId);
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
      (endpoint.config.paginationConfig as Record<string, unknown> | null) ??
        null
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
  const rows =
    await DbService.repository.columnDefinitions.findByOrganizationId(
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
    if (
      err instanceof ApiError &&
      err.code === ApiCode.REST_API_TRANSFORM_FAILED
    ) {
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
      const classifications = await columnClassifier.classify(
        candidates,
        catalog
      );
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
 * Preview the raw first-page response for a draft endpoint. Used by
 * the Add-endpoint form's Preview pane so the user can inspect the
 * upstream's JSON shape before committing + drive client-side
 * records-path / JSONata-transform feedback. Skips inference and
 * classification — strict subset of the probe pipeline.
 *
 * Body is capped at PREVIEW_BODY_BYTE_LIMIT (256 KB JSON-serialized);
 * larger responses are truncated and `truncated: true` is set so the
 * UI can surface the cap.
 */
const PREVIEW_BODY_BYTE_LIMIT = 256 * 1024;

async function previewEndpointPage(
  organizationId: string,
  body: PreviewEndpointPageRequestBody
): Promise<PreviewEndpointPageResponse> {
  // Preview deliberately skips both transform application and
  // recordsPath walking — the user's still configuring those, the
  // response shape may not satisfy either yet, and the client-side
  // PreviewPaneUI applies them locally for feedback. We just want
  // the raw upstream body so the user can see what they're working
  // with.
  const fetched = await fetchFirstPage(
    synthesizeDraftApiEndpoint(body.endpoint, organizationId),
    body.baseUrl,
    body.auth,
    body.credentials,
    body.endpoint.pagination,
    { skipRecordsExtraction: true }
  );

  // Cap the rendered body so a 10 MB upstream response doesn't crash
  // the browser. STRUCTURAL truncation: when the serialized body
  // exceeds the cap, walk the tree and slice arrays — never cut the
  // serialized string mid-token. The earlier "serialize → slice →
  // re-parse" approach almost always failed the re-parse step
  // (truncated JSON is invalid), and the fallback returned the raw
  // string prefix, which the UI then JSON.stringified into an
  // escape-laden mess. Structural truncation keeps the wire payload
  // a valid object/array so the PreviewPane renders it like any
  // other JSON.
  let bodyForWire: unknown = fetched.body;
  let truncated = false;
  if (safeStringify(fetched.body).length > PREVIEW_BODY_BYTE_LIMIT) {
    truncated = true;
    bodyForWire = structurallyTruncate(fetched.body);
  }

  return {
    body: bodyForWire,
    status: fetched.status,
    headers: fetched.headers,
    truncated,
  };
}

/**
 * Walk a JSON-shaped value and slice every array to at most
 * `PREVIEW_ARRAY_KEEP` items, recursing into elements that survive.
 * Appends a literal `"__truncated__"` sentinel when a slice happened
 * so the UI can spot it. Objects pass through with their values
 * recursed; primitives pass through unchanged.
 *
 * Conceptually similar to `truncateForPrompt` (used by the JSONata
 * suggester), but with a higher per-array cap because the goal is
 * "show the user enough rows to understand the response shape," not
 * "keep prompt tokens bounded." 10 is enough to show repeat patterns
 * without exploding wire size on responses with embedded large
 * objects (e.g. ArcGIS polygon rings with millions of coordinates).
 */
const PREVIEW_ARRAY_KEEP = 10;
const PREVIEW_TRUNCATED_SENTINEL = "__truncated__";

function structurallyTruncate(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    const kept = value.slice(0, PREVIEW_ARRAY_KEEP).map(structurallyTruncate);
    if (value.length > PREVIEW_ARRAY_KEEP)
      kept.push(PREVIEW_TRUNCATED_SENTINEL);
    return kept;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      out[key] = structurallyTruncate((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
export {
  buildProbeContextFromInstance,
  runProbePipeline,
  probeEndpointDraft,
  previewEndpointPage,
};

export const restApiAdapter: ConnectorAdapter & {
  discoverColumnsWithSamples: typeof discoverColumnsWithSamples;
  probeEndpointDraft: typeof probeEndpointDraft;
  previewEndpointPage: typeof previewEndpointPage;
} = {
  queryRows: (
    instance: ConnectorInstance,
    query: EntityDataQuery
  ): Promise<EntityDataResult> => importModeQueryRows(instance, query),
  discoverEntities,
  discoverColumns,
  discoverColumnsWithSamples,
  probeEndpointDraft,
  previewEndpointPage,
  toPublicAccountInfo,
  assertSyncEligibility,
  syncInstance,
  testConnection,
};
