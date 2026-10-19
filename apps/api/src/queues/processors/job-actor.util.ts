import { UnrecoverableError } from "bullmq";

import { DbService } from "../../services/db.service.js";

/**
 * #641: the principal a job acts as, for audit columns and cost attribution.
 * The tool forwards the caller's `userId` in the job's metadata; a job
 * enqueued before it did falls back to the job row's `createdBy`, which is
 * that same caller. Never the phantom literal SYSTEM: in prod that is neither a
 * user nor the system principal, and locally it would satisfy
 * `created_by_system`. A job whose row is gone has nothing to act for, and no
 * retry can change that.
 */
export async function resolveJobActor(
  jobId: string,
  metadataUserId: string | undefined
): Promise<string> {
  if (metadataUserId) return metadataUserId;
  const row = await DbService.repository.jobs.findById(jobId);
  if (!row) {
    throw new UnrecoverableError(
      `Job ${jobId} has no userId in its metadata and its row is gone, so it has no actor`
    );
  }
  return row.createdBy;
}
