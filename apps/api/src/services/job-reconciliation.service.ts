import { environment } from "../environment.js";
import { getJobsQueue } from "../queues/jobs.queue.js";
import { createLogger } from "../utils/logger.util.js";
import { DbService } from "./db.service.js";
import { JobEventsService } from "./job-events.service.js";

const logger = createLogger({ module: "job-reconciliation" });

/** Fixed, greppable reason string written to reaped rows (#391). */
export const STRANDED_JOB_REASON =
  "Stranded: the queue no longer holds this job (Redis data loss); marked failed by the reconciliation sweep.";

export interface StrandedSweepSummary {
  /** Candidates matching the staleness predicate. */
  scanned: number;
  /** Transitioned to `failed` by this pass. */
  reaped: number;
  /** `getJob` threw, or the conditional write lost the race. */
  skipped: number;
}

/**
 * Reconciles `jobs` rows stranded non-terminal by a Redis keyspace loss
 * (#391). Without it, only the worker (which needs the BullMQ entry to
 * exist) and an explicit user cancel ever reach a terminal status — so a
 * FLUSHALL / ElastiCache node replacement leaves rows `active` forever,
 * holding their JOB_LOCK_KEYS entity locks and promising completion that
 * will never come.
 *
 * The stranded predicate is a CONJUNCTION, and both halves are load-bearing:
 *
 *  - **BullMQ absence** (`queue.getJob` → undefined) — precise for the
 *    Redis-loss case, but never sufficient alone: after a keyspace loss the
 *    executor keeps running in-process, so absence alone would release locks
 *    under a live writer (#441's lesson).
 *  - **Heartbeat staleness** (`COALESCE(updated, created)` older than
 *    `JOB_STRANDED_THRESHOLD_MS`) — `jobs.updated` is bumped by every
 *    progress write, so a live pass is either recent or finishes inside the
 *    window. Never sufficient alone either: three job types report no
 *    progress and a long single batch goes quiet.
 *
 * `awaiting_confirmation` is excluded at the query (the finder's contract):
 * its BullMQ entry is legitimately absent while the user decides.
 *
 * Fail-open on every dependency: absence must be POSITIVELY observed — a
 * `getJob` throw skips the row, a finder error skips the pass, and the
 * worst-case degradation is exactly today's behavior (nothing happens).
 * Concurrency safety comes from `transitionIfNonTerminal`: N instances
 * sweeping at once, a zombie completion, and a user cancel all converge on
 * one terminal status. (A zombie that finishes AFTER the reap overwrites
 * `failed` with `completed` + its result via the unconditional worker
 * transition — which is more truthful, and the locks were already free.)
 */
export class JobReconciliationService {
  /** Defensive per-pass cap; strandings are bounded by worker concurrency. */
  static readonly MAX_REAP_PER_PASS = 200;

  static async sweepStrandedJobs(): Promise<StrandedSweepSummary> {
    const olderThan = Date.now() - environment.JOB_STRANDED_THRESHOLD_MS;
    const candidates = await DbService.repository.jobs.findStrandedCandidates(
      olderThan,
      JobReconciliationService.MAX_REAP_PER_PASS
    );

    const summary: StrandedSweepSummary = {
      scanned: candidates.length,
      reaped: 0,
      skipped: 0,
    };

    for (const job of candidates) {
      let stranded: boolean;
      if (job.bullJobId === null) {
        // A row that sat longer than the threshold without ever recording a
        // bullJobId died between insert and enqueue (a milliseconds window).
        stranded = true;
      } else {
        try {
          const bullJob = await getJobsQueue().getJob(job.bullJobId);
          stranded = bullJob === undefined;
        } catch (err) {
          // Absence must be positively observed — an unreachable queue is
          // not evidence the job is gone.
          logger.warn(
            { jobId: job.id, err },
            "Could not check the queue for this job — skipping, not reaping"
          );
          summary.skipped += 1;
          continue;
        }
      }

      if (!stranded) continue;

      const did = await JobEventsService.transitionIfNonTerminal(
        job.id,
        "failed",
        { error: STRANDED_JOB_REASON }
      );
      if (did) {
        summary.reaped += 1;
        logger.warn(
          { jobId: job.id, type: job.type, organizationId: job.organizationId },
          "Reaped a stranded job — its queue entry no longer exists"
        );
      } else {
        summary.skipped += 1;
      }
    }

    logger.info({ ...summary }, "Stranded-job sweep finished");
    return summary;
  }
}
