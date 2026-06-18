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
export const QueryHandleEnvelopeSchema = z
  .object({
    queryHandle: z.string(),
    rowCount: z.number().int().nonnegative(),
    schema: z.array(
      z.object({
        name: z.string(),
        type: z.string(),
      })
    ),
    sampled: z.boolean(),
    sampleSize: z.number().int().positive().optional(),
    truncated: z.boolean(),
    samplePeek: z.array(z.record(z.string(), z.unknown())).max(10),
    // #129: the retained query + the keyset cursor tier.
    /** The query that produced this handle, retained so the cursor tier
     *  can re-execute it past the snapshot (#129 mechanism A). */
    sql: z.string(),
    /** The resolved deterministic keyset column, or null when the query has
     *  no stable unique total order — then the cursor is unavailable and the
     *  ≤HANDLE_ROW_CAP snapshot is all there is. Resolution lands in the
     *  #129 slice-2 spike; null until then. */
    sortKey: z.string().nullable(),
    /** True iff a sortKey resolved AND rowCount exceeds the snapshot cap —
     *  i.e. the unbounded keyset tier is available for this handle. */
    cursor: z.boolean(),
  })
  .superRefine((env, ctx) => {
    if (env.sampled && env.sampleSize === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["sampleSize"],
        message: "sampleSize is required when sampled is true",
      });
    }
    if (env.cursor && env.sortKey === null) {
      ctx.addIssue({
        code: "custom",
        path: ["cursor"],
        message: "cursor requires a non-null sortKey",
      });
    }
  });

export type QueryHandleEnvelope = z.infer<typeof QueryHandleEnvelopeSchema>;
