/**
 * #692: a job's `metadata` and `result` are its creator's.
 *
 * Every member may read every job in the org (#630: the Jobs list, lock
 * alerts and job-event streams on shared connectors depend on it). But job
 * payloads embed data that other rules own: a `file_upload_parse` result holds
 * the uploader's preview cells (uploads are the uploader's own, #685), and a
 * `sql_query` result holds sample rows from a per-user portal. So a caller who
 * didn't start the job, and doesn't hold unconditional job control (owner /
 * admin, the same rule as cancel), sees the job's state but not its payload.
 */

import type { PermissionContext } from "./permission.service.js";
import type { PermissionSet } from "./permission-set.js";

interface JobLike {
  createdBy: string;
  metadata: Record<string, unknown>;
  result: Record<string, unknown> | null;
}

export class JobPayloadRedactionService {
  /** The creator, or a caller with unconditional job control, sees payloads. */
  static canSeePayload(
    ctx: PermissionContext,
    set: PermissionSet,
    job: { createdBy: string }
  ): boolean {
    return (
      job.createdBy === ctx.userId ||
      set.can("resource.delete", { type: "job" })
    );
  }

  /** The job with `metadata` emptied and `result` nulled unless visible. */
  static redact<T extends JobLike>(
    ctx: PermissionContext,
    set: PermissionSet,
    job: T
  ): T {
    if (this.canSeePayload(ctx, set, job)) return job;
    return { ...job, metadata: {}, result: null };
  }
}
