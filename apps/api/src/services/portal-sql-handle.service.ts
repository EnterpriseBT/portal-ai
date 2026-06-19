/**
 * PortalSqlHandleService (#85 Phase 3 slice 0).
 *
 * Producer for the query-handle read path: runs an LLM-issued SELECT,
 * stages the result rows in Redis under a fresh `queryHandle`, and
 * broadcasts the rows to a per-handle Pub/Sub channel so the SSE route
 * (slice 1) can forward them to the UI.
 *
 * The agent's tool result carries the QueryHandleEnvelope from
 * `@portalai/core/contracts` (rowCount, schema, sampled, samplePeek).
 * The rows themselves never enter the agent's context window — the
 * UI fetches them via the SSE stream (live) or the snapshot endpoint
 * (re-open).
 *
 * Phase 3 slice 0 implementation: runs the SQL once via
 * `PortalSqlService.runSqlQuery` with the row cap lifted, then chunks
 * the result in memory. Cursor-driven streaming is a follow-up; this
 * shape exercises the surrounding pipeline (SSE + snapshot + cache
 * eviction) end-to-end.
 */

import { randomUUID } from "crypto";
import {
  READ_HANDLE_TTL_MS,
  SAMPLING_THRESHOLD,
  HANDLE_ROW_CAP,
} from "@portalai/core/constants";
// Inline the QueryHandleEnvelope type — the core barrel doesn't yet
// export portal-sql.contract directly. Shape mirrors Phase 1 spec.
export interface QueryHandleEnvelope {
  queryHandle: string;
  rowCount: number;
  schema: Array<{ name: string; type: string }>;
  sampled: boolean;
  sampleSize?: number;
  truncated: boolean;
  samplePeek: Array<Record<string, unknown>>;
  /** #129: the query retained for cursor-tier re-execution past the snapshot.
   *  Streamability is decided at read time (`streamHandle` branches on
   *  `rowCount > HANDLE_ROW_CAP`; the tool declares its order — decision B),
   *  so the envelope carries no precomputed sort key / cursor flag. **Null**
   *  for an externally-supplied-rows handle (`produceFromRows`, #124): no query
   *  to re-execute, so it is always fully staged (≤ cap, snapshot only). */
  sql: string | null;
}

import { ApiCode } from "../constants/api-codes.constants.js";
import { ApiError } from "./http.service.js";
import { getRedisClient } from "../utils/redis.util.js";
import { createLogger } from "../utils/logger.util.js";
import { PortalSqlService } from "./portal-sql.service.js";

const logger = createLogger({ module: "portal-sql-handle" });

const HANDLE_PREFIX = "portal-sql:handle:";
const STREAM_CHANNEL_PREFIX = "portal-sql:stream:";
const BATCH_SIZE = 1_000;
const SAMPLE_PEEK_SIZE = 10;

export interface ProduceOptions {
  stationId: string;
  organizationId: string;
  sql: string;
}

export interface SnapshotResult {
  rows: Array<Record<string, unknown>>;
  total: number;
  offset: number;
  limit: number;
}

/** The Redis meta record: the public envelope plus the station/org the
 *  cursor tier (#129) needs to re-execute `sql`. The underscore-prefixed
 *  fields are internal and never returned to the agent. */
export interface StoredHandleMeta extends QueryHandleEnvelope {
  _stationId: string;
  _organizationId: string;
}

/**
 * Channel + key derivation. Exposed so the route layer (slice 1) can
 * subscribe to the same channel the producer publishes to.
 */
export function streamChannelKey(handleId: string): string {
  return `${STREAM_CHANNEL_PREFIX}${handleId}`;
}
function metaKey(handleId: string): string {
  return `${HANDLE_PREFIX}${handleId}:meta`;
}
function batchKey(handleId: string, batchIndex: number): string {
  return `${HANDLE_PREFIX}${handleId}:batches:${batchIndex}`;
}

export class PortalSqlHandleService {
  /**
   * Run a SELECT and stage its rows in Redis under a fresh handle.
   * Returns the envelope synchronously; the broadcast loop fires
   * batches on the per-handle stream channel as it walks.
   *
   * Errors from the underlying SQL surface via the existing
   * PortalSqlService.runSqlQuery error envelope; this service
   * re-throws as ApiError so callers can branch.
   */
  static async produce(
    opts: ProduceOptions
  ): Promise<{ envelope: QueryHandleEnvelope }> {
    const handleId = `qh-${randomUUID()}`;

    // Run the query through the existing pipeline. The handle path
    // uses a higher row cap; sampling for >SAMPLING_THRESHOLD rows is
    // applied to the envelope.
    //
    // The default `cellCap` (500 bytes/cell) and `payloadCap` (100KB)
    // exist to protect the agent's context window from being flooded
    // by large response bodies — they make sense for the inline path
    // where the JSON envelope IS what the agent sees. The handle path
    // stages rows to Redis instead; the agent only ever sees the
    // small envelope `{queryHandle, rowCount, schema, samplePeek}`,
    // so those caps would only damage the user-visible rendering for
    // no benefit. Lift them here.
    const result = await PortalSqlService.runSqlQuery({
      stationId: opts.stationId,
      organizationId: opts.organizationId,
      sql: opts.sql,
      rowCap: HANDLE_ROW_CAP,
      cellCap: Number.MAX_SAFE_INTEGER,
      payloadCap: Number.MAX_SAFE_INTEGER,
    });

    // The three response shapes:
    //   1. { rows }                          → normal
    //   2. { rows, truncated, totalCount }   → row cap hit
    //   3. { sample, truncated, totalCount } → payload-too-large collapse
    // Phase 3's handle path lifts the row cap, so shape 2 only fires
    // for queries past HANDLE_ROW_CAP rows. Shape 3 is preserved by
    // PortalSqlService; we surface it as a typed error here since the
    // handle is supposed to remove the payload-cap pressure.
    let rowsRaw: Array<Record<string, unknown>>;
    let totalCount: number;
    if ("sample" in result) {
      // PortalSqlService collapsed the result past the payload cap.
      // Phase 3's handle path is meant to dodge this; if we still trip,
      // the SQL needs to aggregate further.
      throw new ApiError(
        413,
        ApiCode.REQUEST_PAYLOAD_TOO_LARGE,
        "Result exceeded the payload cap before handle staging"
      );
    }
    rowsRaw = result.rows;
    totalCount =
      "totalCount" in result ? result.totalCount ?? rowsRaw.length : rowsRaw.length;

    const sampled = totalCount > SAMPLING_THRESHOLD;
    const sampleSize = sampled
      ? Math.min(rowsRaw.length, SAMPLING_THRESHOLD)
      : undefined;

    // Schema: derive from the first row's keys + value types.
    const firstRow = rowsRaw[0] as Record<string, unknown> | undefined;
    const schema = firstRow
      ? Object.keys(firstRow).map((name) => ({
          name,
          type: detectPgType(firstRow[name]),
        }))
      : [];

    const samplePeek = rowsRaw.slice(0, SAMPLE_PEEK_SIZE) as Array<
      Record<string, unknown>
    >;

    // #129: retain the query so the cursor tier can re-execute it past the
    // snapshot. Streamability isn't precomputed here — `streamHandle` branches
    // on `rowCount > HANDLE_ROW_CAP` and the streaming tool supplies its order
    // column at read time (decision B).
    const envelope: QueryHandleEnvelope = {
      queryHandle: handleId,
      rowCount: totalCount,
      schema,
      sampled,
      ...(sampleSize ? { sampleSize } : {}),
      truncated: rowsRaw.length < totalCount,
      samplePeek,
      sql: opts.sql,
    };

    return this.stage(
      handleId,
      rowsRaw,
      envelope,
      opts.stationId,
      opts.organizationId
    );
  }

  /**
   * Stage a **caller-supplied** row set under a fresh handle (#124) — the
   * outbound producer for a webhook that returns a large result. Mirrors
   * `produce` but the rows come from the caller, not a query, so the handle
   * has no `sql` (it can't be re-executed) and is therefore always fully
   * staged: rows past `HANDLE_ROW_CAP` are truncated (the snapshot is all
   * there is — no cursor tier). Reads back exactly like any other handle.
   */
  static async produceFromRows(opts: {
    rows: Array<Record<string, unknown>>;
    schema?: Array<{ name: string; type: string }>;
    stationId: string;
    organizationId: string;
  }): Promise<{ envelope: QueryHandleEnvelope }> {
    const handleId = `qh-${randomUUID()}`;
    const truncated = opts.rows.length > HANDLE_ROW_CAP;
    const rowsRaw = truncated ? opts.rows.slice(0, HANDLE_ROW_CAP) : opts.rows;
    // No query to re-execute beyond the snapshot, so the staged set IS the
    // total — rowCount always equals what's persisted (keeps getSnapshot exact).
    const totalCount = rowsRaw.length;

    const sampled = totalCount > SAMPLING_THRESHOLD;
    const sampleSize = sampled
      ? Math.min(rowsRaw.length, SAMPLING_THRESHOLD)
      : undefined;

    const firstRow = rowsRaw[0] as Record<string, unknown> | undefined;
    const schema =
      opts.schema ??
      (firstRow
        ? Object.keys(firstRow).map((name) => ({
            name,
            type: detectPgType(firstRow[name]),
          }))
        : []);

    const samplePeek = rowsRaw.slice(0, SAMPLE_PEEK_SIZE) as Array<
      Record<string, unknown>
    >;

    const envelope: QueryHandleEnvelope = {
      queryHandle: handleId,
      rowCount: totalCount,
      schema,
      sampled,
      ...(sampleSize ? { sampleSize } : {}),
      truncated,
      samplePeek,
      sql: null, // rows supplied externally — no originating query
    };

    return this.stage(
      handleId,
      rowsRaw,
      envelope,
      opts.stationId,
      opts.organizationId
    );
  }

  /**
   * Persist a handle's rows + meta in Redis and broadcast the batch stream.
   * Shared by `produce` (query rows) and `produceFromRows` (#124, supplied
   * rows). The stored meta carries the station/org alongside the public
   * envelope (#129): the cursor tier re-executes `sql` via PortalSqlService,
   * which needs them to rebuild the entity views. They are internal (omitted
   * from the agent-facing envelope), under the same handle scope + 24h TTL.
   */
  private static async stage(
    handleId: string,
    rowsRaw: Array<Record<string, unknown>>,
    envelope: QueryHandleEnvelope,
    stationId: string,
    organizationId: string
  ): Promise<{ envelope: QueryHandleEnvelope }> {
    const redis = getRedisClient();
    const channel = streamChannelKey(handleId);
    const ttlSeconds = Math.ceil(READ_HANDLE_TTL_MS / 1000);
    const storedMeta: StoredHandleMeta = {
      ...envelope,
      _stationId: stationId,
      _organizationId: organizationId,
    };
    await redis.set(
      metaKey(handleId),
      JSON.stringify(storedMeta),
      "EX",
      ttlSeconds
    );

    for (let i = 0; i < rowsRaw.length; i += BATCH_SIZE) {
      const batchIndex = Math.floor(i / BATCH_SIZE);
      const batch = rowsRaw.slice(i, i + BATCH_SIZE) as Array<
        Record<string, unknown>
      >;
      await redis.set(
        batchKey(handleId, batchIndex),
        JSON.stringify(batch),
        "EX",
        ttlSeconds
      );
      await redis.publish(
        channel,
        JSON.stringify({
          type: "data",
          batchIndex,
          rows: batch,
        })
      );
    }

    await redis.publish(channel, JSON.stringify({ type: "complete" }));

    logger.info(
      {
        handleId,
        stationId,
        rowCount: envelope.rowCount,
        batches: Math.ceil(rowsRaw.length / BATCH_SIZE),
      },
      "portal-sql handle produced"
    );

    return { envelope };
  }

  /**
   * Read a paged window of cached rows from Redis. Returns
   * READ_HANDLE_EXPIRED via ApiError when the handle's meta key is
   * missing (TTL expired or never produced).
   */
  static async getSnapshot(
    handleId: string,
    range: { offset?: number; limit?: number }
  ): Promise<SnapshotResult> {
    const redis = getRedisClient();
    const metaRaw = await redis.get(metaKey(handleId));
    if (!metaRaw) {
      throw new ApiError(
        404,
        ApiCode.READ_HANDLE_EXPIRED,
        "Query handle has expired or does not exist"
      );
    }
    const envelope = JSON.parse(metaRaw) as QueryHandleEnvelope;
    const offset = range.offset ?? 0;
    const limit = Math.min(range.limit ?? BATCH_SIZE, 5_000);

    const out: Array<Record<string, unknown>> = [];
    const startBatch = Math.floor(offset / BATCH_SIZE);
    for (
      let batchIndex = startBatch;
      out.length < limit && batchIndex * BATCH_SIZE < envelope.rowCount;
      batchIndex++
    ) {
      const batchRaw = await redis.get(batchKey(handleId, batchIndex));
      if (!batchRaw) break;
      const batch = JSON.parse(batchRaw) as Array<Record<string, unknown>>;
      const startInBatch =
        batchIndex === startBatch ? offset - startBatch * BATCH_SIZE : 0;
      for (let i = startInBatch; i < batch.length && out.length < limit; i++) {
        out.push(batch[i]);
      }
    }

    return { rows: out, total: envelope.rowCount, offset, limit };
  }

  /** Read the stored meta (envelope + station/org), or throw
   *  READ_HANDLE_EXPIRED. Exposed so the streaming consumer can decide
   *  cursor-vs-bounded before iterating. */
  static async getMeta(handleId: string): Promise<StoredHandleMeta> {
    const redis = getRedisClient();
    const raw = await redis.get(metaKey(handleId));
    if (!raw) {
      throw new ApiError(
        404,
        ApiCode.READ_HANDLE_EXPIRED,
        "Query handle has expired or does not exist"
      );
    }
    return JSON.parse(raw) as StoredHandleMeta;
  }

  /**
   * Forward-only stream of the handle's full result in `(orderBy, id)`
   * order — the #129 cursor tier. The streaming tool declares `orderBy`
   * (its semantic order, e.g. a date column); `id` is the unique tiebreaker
   * (the `er__` row id). Two paths, both delivering the same order:
   *  - **≤ HANDLE_ROW_CAP**: read the Redis snapshot, sort by `(orderBy, id)`
   *    in memory, yield in batches. No re-execution.
   *  - **> HANDLE_ROW_CAP**: keyset re-execute the retained `sql` —
   *    `SELECT * FROM (<sql>) _cur WHERE (orderBy, id) > (:lastO, :lastI)
   *     ORDER BY orderBy, id LIMIT n` — advancing the cursor per page until a
   *    short page. Keyset stability over re-execution (incl. concurrent
   *    inserts) is proven by `keyset-cursor-stability.integration.test.ts`.
   *
   * Requires the result to project `orderBy` and `id`; the caller
   * (`resolveRecordStream`) checks resolvability and falls back to the
   * bounded tier otherwise — this throws if called without them.
   */
  static async *streamHandle(
    handleId: string,
    orderBy: string
  ): AsyncGenerator<Array<Record<string, unknown>>> {
    const meta = await this.getMeta(handleId);
    const idCol = resolveTiebreaker(meta.schema);
    const hasOrder = meta.schema.some((c) => c.name === orderBy);
    if (!idCol || !hasOrder) {
      throw new ApiError(
        400,
        ApiCode.COMPUTE_INPUT_TOO_LARGE,
        `Streaming requires the result to project '${orderBy}' and a unique key ` +
          `(\`_record_id\` or \`id\`); project them or pre-aggregate.`
      );
    }

    if (meta.rowCount <= HANDLE_ROW_CAP) {
      // Bounded: read the snapshot, sort to (orderBy, id), yield in batches.
      const all: Array<Record<string, unknown>> = [];
      for (let off = 0; off < meta.rowCount; off += 5_000) {
        const snap = await this.getSnapshot(handleId, { offset: off, limit: 5_000 });
        if (snap.rows.length === 0) break;
        all.push(...snap.rows);
      }
      all.sort((a, b) => compareByKey(a, b, orderBy, idCol));
      for (let i = 0; i < all.length; i += BATCH_SIZE) {
        yield all.slice(i, i + BATCH_SIZE);
      }
      return;
    }

    // Unbounded: keyset re-execution in (orderBy, id) order. Requires the
    // originating query — an externally-supplied-rows handle (`produceFromRows`,
    // sql null) is always ≤ cap so never reaches here; guard the invariant.
    if (meta.sql === null) {
      throw new ApiError(
        400,
        ApiCode.READ_HANDLE_EXPIRED,
        "Handle has no query to re-execute past the snapshot"
      );
    }
    let last: { o: unknown; i: unknown } | null = null;
    for (;;) {
      const where = last
        ? `WHERE (${quoteIdent(orderBy)}, ${quoteIdent(idCol)}) > ` +
          `(${sqlLiteral(last.o)}, ${sqlLiteral(last.i)})`
        : "";
      const wrapped =
        `SELECT * FROM (${meta.sql}) "_cur" ${where} ` +
        `ORDER BY ${quoteIdent(orderBy)} ASC, ${quoteIdent(idCol)} ASC ` +
        `LIMIT ${BATCH_SIZE}`;
      const result = await PortalSqlService.runSqlQuery({
        sql: wrapped,
        stationId: meta._stationId,
        organizationId: meta._organizationId,
        rowCap: BATCH_SIZE,
        cellCap: Number.MAX_SAFE_INTEGER,
        payloadCap: Number.MAX_SAFE_INTEGER,
      });
      const rows = "sample" in result ? [] : result.rows;
      if (rows.length === 0) break;
      yield rows;
      const lastRow = rows[rows.length - 1];
      last = { o: lastRow[orderBy], i: lastRow[idCol] };
      if (rows.length < BATCH_SIZE) break;
    }
  }
}

// ── Cursor keyset helpers (#129) ────────────────────────────────────

/** Embed a cursor value as a Postgres SQL literal. Values originate from a
 *  prior page's rows (DB values re-embedded — `runSqlQuery` is string-only,
 *  no bind params), so strings are single-quote-escaped; dates → ISO. */
function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("non-finite cursor value");
    return String(v);
  }
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return `'${v.toISOString()}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** Quote a SQL identifier. The column comes from the result schema (a real
 *  query column, validated by membership before use), but quote defensively. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** The unique keyset tiebreaker in a result: the entity view's synthetic
 *  `_record_id` (the common case), else a projected `id`. `null` when neither
 *  is present — then the cursor is unavailable and the bounded tier owns it. */
export function resolveTiebreaker(
  schema: Array<{ name: string; type: string }>
): string | null {
  const names = new Set(schema.map((c) => c.name));
  if (names.has("_record_id")) return "_record_id";
  if (names.has("id")) return "id";
  return null;
}

function cmpValue(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Total order by (orderBy, id) for the in-memory ≤cap sort. */
function compareByKey(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  orderBy: string,
  idCol: string
): number {
  return cmpValue(a[orderBy], b[orderBy]) || cmpValue(a[idCol], b[idCol]);
}

/**
 * Best-effort PG type detection from a sample value. The agent uses
 * `schema[].type` as a hint, not a strong contract — PG sends raw
 * values without column type info via postgres-js's row format.
 */
function detectPgType(value: unknown): string {
  if (value == null) return "unknown";
  if (typeof value === "number")
    return Number.isInteger(value) ? "integer" : "numeric";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") return "text";
  if (value instanceof Date) return "timestamptz";
  return "jsonb";
}
