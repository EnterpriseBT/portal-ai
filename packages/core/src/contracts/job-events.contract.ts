import { z } from "zod";

/**
 * SSE event shape for per-batch progress on a `bulk_transform` job
 * (issue #85). Emitted by the bulk-transform processor after each
 * batch commits; consumed by the `bulk-job-progress` display block.
 *
 * Exactly one of these three configurations per event:
 *
 *  1. **Counters only** — both `rows` and `rowIds` omitted. Used when
 *     the consuming widget doesn't need row data this batch.
 *  2. **Inline rows** — `rows` populated; row payload fit within
 *     `BATCH_ROW_PAYLOAD_LIMIT` (256 KB).
 *  3. **Row-id fallback** — `rowIds` populated; row payload exceeded
 *     the cap. The widget fetches by id from the target wide table
 *     on demand (Phase 3 wires the per-entity row-fetch endpoint).
 *
 * The wire shape allows but does not enforce mutual exclusivity of
 * `rows` and `rowIds`; producers select the right shape per batch.
 */
export const JobBatchEventSchema = z.object({
  _eventType: z.literal("batch"),
  recordsProcessed: z.number().int().nonnegative(),
  totalRecords: z.number().int().nonnegative(),
  batchDurationMs: z.number().int().nonnegative(),
  rows: z.array(z.record(z.string(), z.unknown())).optional(),
  rowIds: z.array(z.string()).optional(),
  failureCount: z.number().int().nonnegative().optional(),
});

export type JobBatchEvent = z.infer<typeof JobBatchEventSchema>;
