import { z } from "zod";

/**
 * Query-handle response envelope for the reads track (issue #85).
 *
 * Returned by `sql_query` / `visualize` / `visualize_tree` when the
 * result row count exceeds `INLINE_ROWS_THRESHOLD`. The agent sees row
 * count + schema + a small peek; the actual rows flow from the API to
 * the web client via the handle's SSE / snapshot endpoints, never
 * through the agent's context window.
 *
 * `samplePeek` is intentionally capped at 10 rows — enough for the
 * agent to summarize the shape, not enough for it to think it has
 * the data.
 */
/**
 * The bare envelope field object, exported separately so other contracts
 * can compose it via `.extend()` (#268 — `D3HandleContentSchema` rides
 * these fields on a `d3` block's content). `.superRefine()` below makes
 * `QueryHandleEnvelopeSchema` a `ZodEffects`, which cannot be extended —
 * hence the split. Behavior of the refined schema is unchanged.
 */
export const QueryHandleEnvelopeFieldsSchema = z.object({
  queryHandle: z.string(),
  /** Number of rows the handle represents. **Exact when `truncated` is
   *  false; a LOWER BOUND when `truncated` is true** — staging stops at
   *  `HANDLE_ROW_CAP` and the producer counts via a `cap+1` probe rather
   *  than a full `COUNT(*)`, so the true total is `≥ rowCount`. Consumers
   *  must read `rowCount` together with `truncated` and present it as
   *  "N+" / "≥N" when truncated (#147). The #129 cursor still folds the
   *  true full set regardless. */
  rowCount: z.number().int().nonnegative(),
  schema: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
    })
  ),
  sampled: z.boolean(),
  sampleSize: z.number().int().positive().optional(),
  /** True when the staged result hit `HANDLE_ROW_CAP` — `rowCount` is then
   *  a lower bound, not the exact total (see `rowCount`). */
  truncated: z.boolean(),
  samplePeek: z.array(z.record(z.string(), z.unknown())).max(10),
  /** The query that produced this handle, retained so the cursor tier can
   *  re-execute it past the ≤HANDLE_ROW_CAP snapshot (#129 mechanism A).
   *  Whether a handle streams is decided at read time — `streamHandle`
   *  branches on `rowCount > HANDLE_ROW_CAP` and the streaming tool declares
   *  its order column (decision B) — so the envelope carries no precomputed
   *  sort key / cursor flag. **Null** when the rows were supplied externally
   *  rather than by a query (`produceFromRows`, #124): there is no query to
   *  re-execute, so such a handle is always fully staged (≤ cap, snapshot
   *  only — never the cursor tier). */
  sql: z.string().nullable(),
});

export const QueryHandleEnvelopeSchema =
  QueryHandleEnvelopeFieldsSchema.superRefine((env, ctx) => {
    if (env.sampled && env.sampleSize === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["sampleSize"],
        message: "sampleSize is required when sampled is true",
      });
    }
  });

export type QueryHandleEnvelope = z.infer<typeof QueryHandleEnvelopeSchema>;
