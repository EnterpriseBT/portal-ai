/**
 * Record source — consumption-aware delivery of a tool's dataset (#121
 * child C, discovery D3).
 *
 * Generalizes #114's `resolveComputeRecords`: given an input (a `queryHandle`
 * or inline `rows`) and the tool's declared `consumption` contract, deliver
 * the records via the cheapest mechanism the data's N requires, bounded
 * above by the contract.
 *
 * `consumption` is a CEILING, not a mandate (spec key decision 2): for any
 * mode, N within the bound is delivered in-memory with zero overhead — so a
 * `streaming` / `engine-pushdown` tool still runs inline on small data. Only
 * when N exceeds the bound does the mode matter:
 *   - `bounded`         → apply the declared `onOverflow`.
 *   - `streaming` / `engine-pushdown` → stream over a cursor.
 *
 * The cursor (the unbounded > HANDLE_ROW_CAP tier) and engine-side
 * representative sampling ship in #129 (child D). Until then, over-bound
 * delivery that needs the cursor surfaces a clear COMPUTE_INPUT_TOO_LARGE
 * pointing at the streaming work. The in-memory tier (inline rows, ≤ cap
 * handle snapshots, and in-memory sampling of inline rows) lands here.
 */

import { COMPUTE_MAX_ROWS } from "@portalai/core/constants";
import type { Consumption } from "@portalai/core/models";

import { PortalSqlHandleService } from "../services/portal-sql-handle.service.js";
import { ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import type { ComputeRecord } from "./compute-input.util.js";

export interface RecordSourceInput {
  queryHandle?: string;
  rows?: ComputeRecord[];
}

export interface ResolvedRecords {
  /** The records to compute over (≤ the effective bound). */
  rows: ComputeRecord[];
  /** True source row count before any overflow handling. */
  total: number;
  /** True when `onOverflow: "sample"` reduced the set — surfaced, never silent. */
  sampled: boolean;
}

/** The in-memory materialization bound for a contract. `bounded` carries its
 *  own `maxRows`; every other mode uses COMPUTE_MAX_ROWS as the snapshot tier
 *  ceiling (the cursor tier beyond it is #129). */
function effectiveCap(consumption: Consumption): number {
  return consumption.mode === "bounded" && consumption.maxRows != null
    ? consumption.maxRows
    : COMPUTE_MAX_ROWS;
}

function tooLarge(total: number, cap: number, detail: string): ApiError {
  return new ApiError(
    400,
    ApiCode.COMPUTE_INPUT_TOO_LARGE,
    `Source has ${total} rows; the in-memory limit is ${cap}. ${detail}`
  );
}

/** Deterministic systematic sample of `rows` down to at most `cap` (every
 *  k-th row). Deterministic so results are reproducible and testable. */
function systematicSample(rows: ComputeRecord[], cap: number): ComputeRecord[] {
  const stride = Math.ceil(rows.length / cap);
  const out: ComputeRecord[] = [];
  for (let i = 0; i < rows.length && out.length < cap; i += stride) {
    out.push(rows[i]);
  }
  return out;
}

/**
 * Resolve a tool's dataset against its declared `consumption` contract.
 * Throws `COMPUTE_INPUT_TOO_LARGE` for the `error` overflow policy and for
 * any over-bound delivery that needs the cursor (until #129).
 */
export async function resolveRecordSource(
  input: RecordSourceInput,
  consumption: Consumption
): Promise<ResolvedRecords> {
  const cap = effectiveCap(consumption);

  // Inline rows — the whole set is already in hand.
  if (input.rows != null) {
    const total = input.rows.length;
    if (total <= cap) return { rows: input.rows, total, sampled: false };
    return overflow(input.rows, total, cap, consumption, /* inMemory */ true);
  }

  // Handle — read the snapshot tier (≤ cap). Past it, only `error` is
  // serviceable in-memory; representative sampling / streaming over a
  // larger-than-cap handle is the cursor work in #129.
  if (input.queryHandle != null) {
    const snapshot = await PortalSqlHandleService.getSnapshot(
      input.queryHandle,
      { offset: 0, limit: cap }
    );
    if (snapshot.total <= cap) {
      return { rows: snapshot.rows, total: snapshot.total, sampled: false };
    }
    return overflow(snapshot.rows, snapshot.total, cap, consumption, false);
  }

  // Unreachable once input has passed `withComputeInput` validation.
  throw new Error(
    "resolveRecordSource requires exactly one of `queryHandle` or `rows`."
  );
}

/**
 * Forward-only stream of a tool's dataset for the `streaming` consumption
 * mode (#129). The tool declares its semantic order via `opts.orderBy`; when
 * the result also projects a unique `id` tiebreaker, the handle's cursor
 * delivers the full set (any N) in `(orderBy, id)` order via keyset
 * re-execution. Otherwise it falls back to the bounded tier (materialize;
 * the tool sorts in-memory) — and a >cap fallback surfaces the contract's
 * `onOverflow` (e.g. `COMPUTE_INPUT_TOO_LARGE`), never a silent truncation.
 *
 * Inline `rows` yield as a single batch (small by the ceiling).
 */
export async function* resolveRecordStream(
  input: RecordSourceInput,
  consumption: Consumption,
  opts: { orderBy?: string } = {}
): AsyncGenerator<ComputeRecord[]> {
  if (input.rows != null) {
    yield input.rows;
    return;
  }
  if (input.queryHandle == null) {
    throw new Error(
      "resolveRecordStream requires exactly one of `queryHandle` or `rows`."
    );
  }

  const meta = await PortalSqlHandleService.getMeta(input.queryHandle);
  const hasId = meta.schema.some((c) => c.name === "id");
  const hasOrder =
    opts.orderBy != null && meta.schema.some((c) => c.name === opts.orderBy);

  if (hasId && hasOrder) {
    yield* PortalSqlHandleService.streamHandle(input.queryHandle, opts.orderBy!);
    return;
  }

  // No resolvable keyset (no declared order, or no `id` tiebreaker): the
  // bounded tier owns it — materialize ≤cap (the tool sorts), >cap → onOverflow.
  const { rows } = await resolveRecordSource(input, consumption);
  yield rows;
}

/** Apply the contract's overflow behavior once N exceeds the bound. */
function overflow(
  rows: ComputeRecord[],
  total: number,
  cap: number,
  consumption: Consumption,
  inMemory: boolean
): ResolvedRecords {
  const policy =
    consumption.mode === "bounded" ? consumption.onOverflow : "stream";

  switch (policy) {
    case "error":
      throw tooLarge(
        total,
        cap,
        "Pre-aggregate or sample in SQL (`… LIMIT n`, a `GROUP BY` rollup) first."
      );
    case "sample":
      // In-memory sampling is faithful only when we hold the whole set
      // (inline rows). Over a larger-than-cap handle, only the first `cap`
      // rows were read — a representative engine-side sample ships in #129.
      if (!inMemory) {
        throw tooLarge(
          total,
          cap,
          "Representative sampling of a query handle ships in #129 (streaming/cursor)."
        );
      }
      return { rows: systematicSample(rows, cap), total, sampled: true };
    case "stream":
    case "decompose":
    default:
      throw tooLarge(
        total,
        cap,
        "Streaming/decomposed delivery for this size ships in #129 (cursor-backed handle)."
      );
  }
}
