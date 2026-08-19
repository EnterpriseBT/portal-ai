import { z } from "zod";

/**
 * Batch job outcome accounting (#410).
 *
 * A "batch" job processes many items independently and can partially fail:
 * `bulk_geocode` and `bulk_transform` today. Both wrap every item in a per-item
 * `try/catch`, so the loop completes even when every item failed — and the
 * worker's terminal status reflected *that*, not the outcome. A `bulk_geocode`
 * run that geocoded **0 of 10** rows reported `Completed`, which is how
 * app-dev's geocoding stayed broken indefinitely with nobody noticing.
 *
 * The accounting lives here so the two result schemas stop duplicating it, and
 * so `classifyBatchOutcome` has one shape to read. The other seven job types
 * are all-or-nothing, carry none of these fields, and are unaffected.
 */
export const BatchOutcomeFieldsSchema = z.object({
  /**
   * Rows the job touched.
   *
   * ⚠️ **The precise meaning is per-job-type and they disagree** —
   * `bulk_geocode` counts rows *attempted* (`geocoded + cached + failed`),
   * `bulk_transform` counts rows *committed* (failures excluded). It is kept
   * here because both declare it, not because it is comparable across types.
   *
   * **Never classify an outcome from this field.** The obvious rule
   * (`recordsFailed === recordsProcessed`) is correct for geocode and can
   * never fire for transform, so it would look right while covering half the
   * callers. `recordsSucceeded` exists to make the outcome unambiguous.
   */
  recordsProcessed: z.number().int().nonnegative(),
  /** Rows that failed. Always the true total, even when `partialFailures` is capped. */
  recordsFailed: z.number().int().nonnegative(),
  /**
   * Rows that succeeded — the field the outcome is derived from.
   *
   * **Optional on purpose.** `jobs.result` rows already exist in dev and
   * production without it, and a required member would fail to parse every
   * historical row on the job-details page. Absence means "cannot tell" and
   * classifies as `completed`, so behavior changes only for jobs created after
   * this shipped and no backfill is needed.
   *
   * The trade-off: a batch processor that forgets to set it silently keeps the
   * old behavior. Each processor's own tests assert it is set, which is where a
   * new batch job type notices.
   */
  recordsSucceeded: z.number().int().nonnegative().optional(),
  /**
   * Count of `partialFailures` entries elided to keep the result row bounded.
   * The head of the array is kept; this carries the dropped tail count.
   */
  partialFailuresOmitted: z.number().int().nonnegative().optional(),
});
export type BatchOutcomeFields = z.infer<typeof BatchOutcomeFieldsSchema>;

/** The terminal statuses this classifier can select between. */
export type ClassifiedOutcome = "completed" | "failed";

/**
 * Decide a batch job's terminal status from the result its processor returned.
 *
 * **`failed` only on total failure** — nothing succeeded *and* something
 * failed. Partial failure stays `completed`, deliberately: an unresolvable
 * address is a legitimate per-row outcome, and failing the job for it would be
 * its own false alarm. The rule is therefore not `recordsFailed > 0`.
 *
 * Keyed on the **shape of the result**, not on a job-type allowlist, so a
 * future batch job type is covered the day it lands rather than the day
 * somebody remembers to register it.
 *
 * Total-function by construction: the worker calls this with whatever a
 * processor returned, at a point where the job's result is already persisted,
 * so anything unrecognized — a non-batch result, `null`, a malformed field —
 * classifies as `completed` rather than throwing.
 */
export function classifyBatchOutcome(result: unknown): ClassifiedOutcome {
  if (typeof result !== "object" || result === null) return "completed";

  const { recordsSucceeded, recordsFailed } = result as {
    recordsSucceeded?: unknown;
    recordsFailed?: unknown;
  };

  // Absent (legacy row) or malformed → not enough information to fail a job.
  if (typeof recordsSucceeded !== "number") return "completed";
  if (typeof recordsFailed !== "number") return "completed";

  return recordsSucceeded === 0 && recordsFailed > 0 ? "failed" : "completed";
}
