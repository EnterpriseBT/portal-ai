/**
 * Result sink — delivery-aware staging of a tool's output (#161), the output
 * mirror of `record-source.ts`.
 *
 * A tool hands its output (a scalar value, a one-shot row stream, or a
 * re-foldable transform of a source handle) plus its declared `production`;
 * this resolves the agent-facing result by observed N + the declaration:
 * inline value/rows when small, a handle past the inline threshold. It is the
 * single place the inline-vs-handle decision lives — the four hand-coded
 * `countRows() > INLINE_ROWS_THRESHOLD → produce()` checks collapse into it.
 *
 * Two handle mechanisms, picked by re-foldability:
 *   - `{ rows }`      → `produceFromStream`     (one-shot, snapshot-capped)
 *   - `{ transform }` → `produceFromTransform`  (re-foldable, unbounded)
 */

import { INLINE_ROWS_THRESHOLD } from "@portalai/core/constants";
import type { Production } from "@portalai/core/models";

import { PortalSqlHandleService } from "../services/portal-sql-handle.service.js";
import type { QueryHandleEnvelope } from "../services/portal-sql-handle.service.js";
import { AnalyticsService } from "../services/analytics.service.js";
import {
  applyTransformFold,
  type TransformDescriptor,
} from "../services/transform-fold.js";
import { ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";

type Row = Record<string, unknown>;

/** What a tool hands the resolver. Exactly one shape per call. */
export type ResultSink =
  | { value: unknown }
  | { rows: AsyncIterable<Row[]> }
  | { transform: TransformDescriptor }
  | { sql: string };

export interface ResultSinkContext {
  stationId: string;
  organizationId: string;
}

/** Rows in a `sqlQuery` response, across its three shapes. */
function sqlRowCount(
  response: Awaited<ReturnType<typeof AnalyticsService.sqlQuery>>
): number {
  if ("sample" in response) return response.totalCount;
  if ("truncated" in response && response.truncated) return response.totalCount;
  return response.rows.length;
}

export type SqlDelivery =
  | { kind: "inline"; result: Awaited<ReturnType<typeof AnalyticsService.sqlQuery>> }
  | { kind: "handle"; envelope: QueryHandleEnvelope };

/**
 * The inline-vs-handle decision for a SQL-backed output (#161/#164). Runs the
 * query inline; ≤ threshold returns the inline result, else stages a
 * **cursor-backed** SQL handle via `produce(sql)` (re-executable past the
 * snapshot — not `produceFromStream`). The lower-level half of the resolver:
 * `resolveResultSink({ sql })` returns the terminal result for pure-data
 * tools (sql_query), while chart tools call this directly and wrap each
 * branch (rows-into-spec vs handle + rewritten spec).
 */
export async function resolveSqlDelivery(
  opts: { sql: string; inlineThreshold?: number },
  ctx: ResultSinkContext
): Promise<SqlDelivery> {
  const result = await AnalyticsService.sqlQuery({
    sql: opts.sql,
    stationId: ctx.stationId,
    organizationId: ctx.organizationId,
  });
  const threshold = opts.inlineThreshold ?? INLINE_ROWS_THRESHOLD;
  if (sqlRowCount(result) <= threshold) return { kind: "inline", result };
  const { envelope } = await PortalSqlHandleService.produce({
    sql: opts.sql,
    stationId: ctx.stationId,
    organizationId: ctx.organizationId,
  });
  return { kind: "handle", envelope };
}

/** A staged handle, tagged so `resolveDisplayBlock` routes it as a data-table. */
interface HandleResult {
  type: "data-table";
  [k: string]: unknown;
}

function inlineThresholdOf(production: Production): number {
  return production.kind === "rows" && production.inlineThreshold != null
    ? production.inlineThreshold
    : INLINE_ROWS_THRESHOLD;
}

function tooLargeError(count: number, threshold: number): ApiError {
  return new ApiError(
    400,
    ApiCode.COMPUTE_OUTPUT_TOO_LARGE,
    `The tool produced more than ${threshold} rows (≥ ${count}) and is declared ` +
      `production.onLarge: "error". Narrow the result (aggregate or filter the source) ` +
      `so it fits inline.`
  );
}

/** Reservoir sample of `k` rows over a stream of unknown length — bounded
 *  memory, representative. Used for `onLarge: "sample"`. */
async function reservoirSample(
  rest: AsyncIterator<Row[]>,
  seed: Row[],
  k: number
): Promise<Row[]> {
  const reservoir = seed.slice(0, k);
  let seen = seed.length;
  const consider = (row: Row) => {
    seen += 1;
    if (reservoir.length < k) {
      reservoir.push(row);
      return;
    }
    const j = Math.floor(Math.random() * seen);
    if (j < k) reservoir[j] = row;
  };
  for (let i = k; i < seed.length; i++) consider(seed[i]);
  for (;;) {
    const { value, done } = await rest.next();
    if (done) break;
    for (const row of value) consider(row);
  }
  return reservoir;
}

/** Re-yield buffered rows as one batch, then the rest of the stream. */
async function* concatStream(
  buffered: Row[],
  rest: AsyncIterator<Row[]>
): AsyncGenerator<Row[]> {
  if (buffered.length > 0) yield buffered;
  for (;;) {
    const { value, done } = await rest.next();
    if (done) break;
    yield value;
  }
}

/**
 * Resolve a tool's output to its agent-facing result — inline, or a handle
 * envelope `{ type: "data-table", ...envelope }`.
 */
export async function resolveResultSink(
  production: Production,
  sink: ResultSink,
  ctx: ResultSinkContext
): Promise<unknown> {
  // value — always inline (cardinality 1).
  if ("value" in sink) {
    return sink.value;
  }

  // sql — a cursor-backed SQL handle past the threshold (terminal result).
  if ("sql" in sink) {
    const delivery = await resolveSqlDelivery(
      { sql: sink.sql, inlineThreshold: inlineThresholdOf(production) },
      ctx
    );
    return delivery.kind === "inline"
      ? delivery.result
      : { type: "data-table", ...delivery.envelope };
  }

  const threshold = inlineThresholdOf(production);
  const onLarge = production.kind === "rows" ? production.onLarge : "handle";

  // transform — re-foldable: peek the source size to decide inline vs the
  // unbounded transform handle. Small source folds inline; large re-folds
  // via the cursor (`produceFromTransform`).
  if ("transform" in sink) {
    const t = sink.transform;
    const meta = await PortalSqlHandleService.getMeta(t.sourceHandle);
    if (meta.rowCount > threshold && onLarge === "handle") {
      const { envelope } = await PortalSqlHandleService.produceFromTransform({
        transform: t,
        stationId: ctx.stationId,
        organizationId: ctx.organizationId,
      });
      return { type: "data-table", ...envelope } satisfies HandleResult;
    }
    // Inline (or non-handle onLarge): fold the source in memory.
    const source = PortalSqlHandleService.streamHandle(
      t.sourceHandle,
      t.dateColumn
    );
    const rows: Row[] = [];
    for await (const batch of applyTransformFold(t, source)) rows.push(...batch);
    if (rows.length <= threshold) return { rows };
    if (onLarge === "error") throw tooLargeError(rows.length, threshold);
    // onLarge "sample" over an already-materialized set → systematic slice.
    const stride = Math.ceil(rows.length / threshold);
    const sampled = rows.filter((_, i) => i % stride === 0).slice(0, threshold);
    return { rows: sampled, sampled: true };
  }

  // rows — one-shot stream: buffer up to threshold+1 to decide inline vs large.
  const it = sink.rows[Symbol.asyncIterator]();
  const buffered: Row[] = [];
  while (buffered.length <= threshold) {
    const { value, done } = await it.next();
    if (done) break;
    buffered.push(...value);
  }
  if (buffered.length <= threshold) {
    return { rows: buffered };
  }
  switch (onLarge) {
    case "error":
      throw tooLargeError(buffered.length, threshold);
    case "sample": {
      const sampled = await reservoirSample(it, buffered, threshold);
      return { rows: sampled, sampled: true };
    }
    case "handle":
    default: {
      const { envelope } = await PortalSqlHandleService.produceFromStream({
        rows: concatStream(buffered, it),
        stationId: ctx.stationId,
        organizationId: ctx.organizationId,
      });
      return { type: "data-table", ...envelope } satisfies HandleResult;
    }
  }
}
