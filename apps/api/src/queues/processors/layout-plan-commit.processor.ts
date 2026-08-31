import type { LayoutPlanCommitJobResult } from "@portalai/core/models";

import type { TypedJobProcessor } from "../jobs.worker.js";
import { LayoutPlanDraftService } from "../../services/layout-plan-draft.service.js";
import {
  SyncLockService,
  SyncLockWaitTimeoutError,
} from "../../services/sync-lock.service.js";
import { DbService } from "../../services/db.service.js";
import { environment } from "../../environment.js";
import { createLogger } from "../../utils/logger.util.js";

const logger = createLogger({ module: "layout-plan-commit-processor" });

/**
 * Processor for `layout_plan_commit` jobs.
 *
 * Both HTTP commit endpoints (`POST /api/layout-plans/commit` for draft
 * commit, `POST /api/connector-instances/:id/layout-plan/:planId/commit`
 * for recommit) enqueue this processor after synchronous validation
 * and (draft only) UUID minting. Dispatches by `metadata.kind`:
 *
 *   - `draft`    — `LayoutPlanDraftService.runCommitDraft` owns every
 *                  DB write: creates the connector_instance row (when
 *                  not `isExistingInstance`), creates the plan row,
 *                  runs the records-write pipeline, and rolls back
 *                  on failure so a half-created connector is never
 *                  visible.
 *   - `recommit` — `LayoutPlanDraftService.runRecommit` resolves the
 *                  cached workbook and re-runs the existing commit
 *                  pipeline against the existing instance + plan.
 *
 * The worker's job lifecycle (active/completed/failed transitions and
 * progress events) is owned by `jobs.worker.ts`; on success the
 * returned `LayoutPlanCommitJobResult` is stored on the job row and
 * broadcast via Redis Pub/Sub → SSE to the awaiting frontend.
 */
export const layoutPlanCommitProcessor: TypedJobProcessor<
  "layout_plan_commit"
> = async (bullJob) => {
  const metadata = bullJob.data;
  const { jobId, kind, connectorInstanceId, planId, organizationId } = metadata;

  logger.info(
    { jobId, kind, connectorInstanceId, planId, organizationId },
    "layout_plan_commit started"
  );

  // Forward write-phase progress to Bull so the SSE stream (and the
  // job list + detail views) advance mid-flight. The service throttles
  // to 5-point buckets so a ~400-chunk write fires ~15 events.
  const onProgress = (percent: number) => {
    void bullJob.updateProgress(percent);
  };

  try {
    // #461: both commit kinds reap by watermark, so a BullMQ stall
    // re-delivery — a second pass of THIS job while the first still writes —
    // would let the later pass's reap delete the earlier's in-flight rows
    // (#460's mechanism). Unlike a sync, a user is blocked in a live wizard,
    // so this pass WAITS for the instance lock rather than aborting: a
    // delayed commit beats a skipped one, and a "superseded" result would
    // terminate the shared job row with a false payload. The lock is kept
    // even for a draft minting a fresh instance (`isExistingInstance: false`):
    // no other job can contend on a new UUID, but the re-delivered second
    // pass of this job is exactly the contender being locked out.
    const result = await SyncLockService.withInstanceLockWait(
      connectorInstanceId,
      async () => {
        // Having waited out another execution of this same job, its work may
        // already be done: echo the persisted result rather than re-running
        // the commit (re-running would re-import and re-reap). Any other
        // status — `active` from a holder that died without transitioning
        // (#464), `pending`, `failed` with budget — means no live pass
        // finished the work, so this pass is the legitimate executor.
        const row = await DbService.repository.jobs.findById(jobId);
        if (row?.status === "completed" && row.result) {
          logger.info(
            { jobId, kind, connectorInstanceId, planId },
            "Another pass of this job already completed the commit — echoing its result"
          );
          return row.result as unknown as LayoutPlanCommitJobResult;
        }
        return metadata.kind === "draft"
          ? await LayoutPlanDraftService.runCommitDraft(metadata, onProgress)
          : await LayoutPlanDraftService.runRecommit(metadata, onProgress);
      },
      { timeoutMs: environment.LAYOUT_PLAN_COMMIT_LOCK_WAIT_MS }
    );

    logger.info(
      {
        jobId,
        kind,
        connectorInstanceId,
        planId,
        connectorEntityCount: result.connectorEntityIds.length,
        recordCounts: result.recordCounts,
      },
      "layout_plan_commit completed"
    );

    return result;
  } catch (err) {
    // BullMQ retries this processor up to `attempts` times. The draft
    // rollback (hard-delete plan + freshly-created instance) must only
    // run on the FINAL attempt — running it per-attempt deletes the
    // plan row that subsequent retries depend on and turns every retry
    // into a deterministic `LAYOUT_PLAN_NOT_FOUND`.
    const attemptsMade = bullJob.attemptsMade ?? 0;
    const maxAttempts = bullJob.opts?.attempts ?? 1;
    const isFinalAttempt = attemptsMade >= maxAttempts - 1;
    // A lock-wait timeout means another execution still HOLDS the lock — it
    // is alive and writing the very plan/instance rows the rollback would
    // hard-delete. "I never owned the work" is not a failure of the work
    // (#461); rethrow so BullMQ handles the attempt, but never clean up.
    const neverOwnedTheWork = err instanceof SyncLockWaitTimeoutError;
    if (isFinalAttempt && metadata.kind === "draft" && !neverOwnedTheWork) {
      try {
        await LayoutPlanDraftService.rollbackFailedDraftCommit(
          metadata,
          err instanceof Error ? err.message : String(err)
        );
      } catch (cleanupErr) {
        logger.error(
          {
            jobId,
            cleanupErr:
              cleanupErr instanceof Error ? cleanupErr.message : cleanupErr,
          },
          "Failed to rollback after final draft-commit failure (non-fatal)"
        );
      }
    }
    throw err;
  }
};
