/**
 * Waiting on a layout-plan commit job from inside a workflow (#887).
 *
 * A file upload's commit creates its connector instance, and when the job
 * fails the worker's rollback deletes that instance again. So the workflow
 * can't navigate on the 202 the way a cloud connector's does: it waits here,
 * and a failure becomes an error the Review step shows in its `FormAlert`.
 */

import { ApiError } from "./api.util";
import { awaitJobCompletion, JobFailedError } from "./job-stream.util";

/** The job event carries the failure's text but no code, so the dialog shows
 *  the job's message under this one. */
export const COMMIT_FAILED_CODE = "LAYOUT_PLAN_COMMIT_FAILED";

/** Resolves when the commit job completes. Throws an `ApiError` with the job's
 *  own message when it fails or is cancelled; a dropped stream or abort is
 *  rethrown as is, since the job's outcome is then unknown. */
export async function awaitCommitJob(
  connect: (path: string) => Promise<EventSource>,
  jobId: string,
  options: { onProgress?: (percent: number) => void } = {}
): Promise<void> {
  try {
    await awaitJobCompletion(connect, jobId, {
      onProgress: options.onProgress,
    });
  } catch (err) {
    if (err instanceof JobFailedError) {
      throw new ApiError(err.message, COMMIT_FAILED_CODE);
    }
    throw err;
  }
}
