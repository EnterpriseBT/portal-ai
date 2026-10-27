/**
 * A file upload's commit, waited on from inside the workflow (#887).
 *
 * A file upload's commit creates its connector instance, and when the job
 * fails the worker's rollback deletes that instance again. So the workflow
 * can't navigate on the 202 the way a cloud connector's does: it waits here.
 *
 * - The job completes: return the connector to navigate to.
 * - The job failed and the connector is gone (the rollback ran): throw the
 *   job's error, which the Review step shows with the user's regions intact
 *   so they can fix them and commit again.
 * - The job failed but the connector survived (a cancel, or a final attempt
 *   that never owned the work): return it. Its page shows what happened, and
 *   a retry from the dialog would create a second connector beside it.
 * - The stream dropped: poll the job's status instead. If even that can't be
 *   read, the outcome is unknown, so return the connector and let its page
 *   tell (the pre-#887 behaviour). Never report a failure that might not be
 *   one: a retry would import the file twice.
 */

import { ApiError } from "./api.util";
import { awaitJobCompletion, JobFailedError } from "./job-stream.util";

/** The alert's code when the job's error carries none of its own. A web-side
 *  label; no API response carries it. */
export const COMMIT_FAILED_CODE = "LAYOUT_PLAN_COMMIT_FAILED";

/**
 * A job's error text is `message[ | detail: …][ | code: X]` (#719's
 * `jobErrorText`). Split off the trailing code so the alert reads "message
 * (X)" rather than carrying two codes. A code that isn't API-shaped stays in
 * the message.
 */
export function splitJobError(text: string): { message: string; code: string } {
  const match = / \| code: ([A-Z][A-Z0-9_]*)$/.exec(text);
  return match
    ? { message: text.slice(0, match.index), code: match[1] }
    : { message: text, code: COMMIT_FAILED_CODE };
}

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

export interface CommitAndAwaitDeps {
  /** POST /api/layout-plans/commit; its 202. */
  enqueue: () => Promise<{ jobId: string; connectorInstanceId: string }>;
  connect: (path: string) => Promise<EventSource>;
  /** GET /api/jobs/:id, for when the stream drops. */
  fetchJob: (
    jobId: string
  ) => Promise<{ status: string; error: string | null }>;
  /** Whether the commit's connector instance still exists. */
  connectorExists: (connectorInstanceId: string) => Promise<boolean>;
  onProgress?: (percent: number) => void;
  /** Runs when the commit leaves a connector to land on (refresh caches). */
  onLanded?: () => void;
  pollIntervalMs?: number;
  /** Consecutive unreadable polls before the outcome counts as unknown. */
  maxPollFailures?: number;
}

type Outcome =
  | { kind: "completed" }
  | { kind: "failed"; message: string }
  | { kind: "unknown" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pollJob(
  jobId: string,
  deps: CommitAndAwaitDeps
): Promise<Outcome> {
  const interval = deps.pollIntervalMs ?? 2000;
  const maxFailures = deps.maxPollFailures ?? 5;
  let failures = 0;
  for (;;) {
    try {
      const job = await deps.fetchJob(jobId);
      failures = 0;
      if (TERMINAL.has(job.status)) {
        return job.status === "completed"
          ? { kind: "completed" }
          : {
              kind: "failed",
              message:
                job.error ??
                (job.status === "cancelled" ? "Job cancelled" : "Job failed"),
            };
      }
    } catch {
      if (++failures >= maxFailures) return { kind: "unknown" };
    }
    await sleep(interval);
  }
}

async function waitForJob(
  jobId: string,
  deps: CommitAndAwaitDeps
): Promise<Outcome> {
  try {
    await awaitJobCompletion(deps.connect, jobId, {
      onProgress: deps.onProgress,
    });
    return { kind: "completed" };
  } catch (err) {
    if (err instanceof JobFailedError) {
      return { kind: "failed", message: err.message };
    }
    return pollJob(jobId, deps);
  }
}

export async function commitAndAwait(
  deps: CommitAndAwaitDeps
): Promise<{ connectorInstanceId: string }> {
  const { jobId, connectorInstanceId } = await deps.enqueue();
  const outcome = await waitForJob(jobId, deps);

  if (outcome.kind === "failed") {
    // An unreadable connector counts as present: landing on its page is
    // safe, and staying would invite a duplicate commit.
    const exists = await deps
      .connectorExists(connectorInstanceId)
      .catch(() => true);
    if (!exists) {
      const { message, code } = splitJobError(outcome.message);
      throw new ApiError(message, code);
    }
  }
  deps.onLanded?.();
  return { connectorInstanceId };
}
