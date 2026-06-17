/**
 * Compute-tool input contract (#114).
 *
 * Built-in compute tools (statistics / regression / financial) are pure
 * functions over data handed to them — they do not read the backend.
 * This module is the shared seam:
 *
 *  - `withComputeInput(shape)` wraps a tool's scalar-param shape with the
 *    standard data source: exactly one of `queryHandle` (from sql_query /
 *    display_entity_records) or `rows` (inline).
 *  - `resolveComputeRecords(input)` materializes the rows the pure compute
 *    method runs over — reading a handle server-side (never through the
 *    model context) or passing inline rows through — bounded by
 *    COMPUTE_MAX_ROWS.
 *
 * See docs/COMPUTE_TOOL_PURITY.spec.md.
 */

import { z } from "zod";

import { COMPUTE_MAX_ROWS } from "@portalai/core/constants";

import { resolveRecordSource } from "./record-source.js";

/** A resolved compute row, keyed by SQL alias / column name. */
export type ComputeRecord = Record<string, unknown>;

/**
 * Wrap a compute tool's scalar-param `shape` with the standard data-source
 * fields. The agent SELECTs the columns it will analyze (via sql_query),
 * then passes the resulting `queryHandle`; the tool's scalar params (e.g.
 * `column`, `columns`, `x`, `y`) name keys within those rows. Exactly one
 * of `queryHandle` / `rows` must be provided.
 */
export function withComputeInput<T extends z.ZodRawShape>(shape: T) {
  return z
    .object({
      queryHandle: z
        .string()
        .optional()
        .describe(
          "A queryHandle returned by sql_query or display_entity_records; " +
            "the rows it staged are the dataset to compute over. Provide " +
            "this OR `rows`, never both."
        ),
      rows: z
        .array(z.record(z.string(), z.unknown()))
        .optional()
        .describe(
          "Inline rows to compute over, keyed by column name. Use only for " +
            "small datasets already in hand; otherwise pass a `queryHandle`."
        ),
      ...shape,
    })
    .refine(
      (v) => {
        // Cast through a narrow view: the generic `shape` merge widens the
        // inferred output so TS loses the two known keys on `v`.
        const view = v as { queryHandle?: unknown; rows?: unknown };
        return (view.queryHandle == null) !== (view.rows == null);
      },
      { message: "Provide exactly one of `queryHandle` or `rows`." }
    );
}

/**
 * Materialize the records a pure compute tool runs over.
 *
 * Thin wrapper over the consumption-aware `resolveRecordSource` (#121 child
 * C) pinned to the #114 contract: `bounded(COMPUTE_MAX_ROWS)` with
 * `onOverflow: "error"`. Past the cap the dataset can't be faithfully
 * materialized in memory, so it throws COMPUTE_INPUT_TOO_LARGE rather than
 * compute on a truncated set; expired/missing handles surface as
 * READ_HANDLE_EXPIRED (from `getSnapshot`). Tools that declare a different
 * `consumption` (sampling, streaming) call `resolveRecordSource` directly.
 *
 * Input is expected to have passed `withComputeInput` validation, so exactly
 * one of `queryHandle` / `rows` is set.
 */
export async function resolveComputeRecords(input: {
  queryHandle?: string;
  rows?: ComputeRecord[];
}): Promise<ComputeRecord[]> {
  const { rows } = await resolveRecordSource(input, {
    mode: "bounded",
    maxRows: COMPUTE_MAX_ROWS,
    onOverflow: "error",
  });
  return rows;
}
