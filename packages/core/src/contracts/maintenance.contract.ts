import { z } from "zod";

/**
 * Maintenance-queue observability contract (#179 D5) — the response for
 * `GET /api/admin/maintenance`: registered repeatable-job schedulers plus
 * the most recent runs, both read straight from BullMQ state (no jobs-table
 * coupling).
 */

/** One registered repeatable-job scheduler. */
export const MaintenanceSchedulerSchema = z.object({
  id: z.string(),
  /** Cron pattern, e.g. "0 4 * * *". */
  pattern: z.string().nullable(),
  /** Next scheduled run (epoch ms). */
  next: z.number().nullable(),
});
export type MaintenanceScheduler = z.infer<typeof MaintenanceSchedulerSchema>;

/** One recent completed/failed maintenance run. */
export const MaintenanceRunSchema = z.object({
  name: z.string(),
  /** Completion time (epoch ms); null while unfinished. */
  finishedOn: z.number().nullable(),
  /** The processor's run summary (e.g. `{ purged, batches, cutoff }`). */
  returnvalue: z.unknown().nullable(),
  failedReason: z.string().optional(),
});
export type MaintenanceRun = z.infer<typeof MaintenanceRunSchema>;

export const MaintenanceStatusResponseSchema = z.object({
  schedulers: z.array(MaintenanceSchedulerSchema),
  recentRuns: z.array(MaintenanceRunSchema),
});
export type MaintenanceStatusResponse = z.infer<
  typeof MaintenanceStatusResponseSchema
>;
