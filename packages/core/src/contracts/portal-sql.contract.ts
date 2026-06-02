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
  })
  .superRefine((env, ctx) => {
    if (env.sampled && env.sampleSize === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["sampleSize"],
        message: "sampleSize is required when sampled is true",
      });
    }
  });

export type QueryHandleEnvelope = z.infer<typeof QueryHandleEnvelopeSchema>;
