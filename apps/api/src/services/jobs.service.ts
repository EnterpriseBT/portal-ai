import {
  JobModelFactory,
  TERMINAL_JOB_STATUSES,
  jobLockScopes,
  lockScopeKey,
} from "@portalai/core/models";
import type { JobCreateRequestBody } from "@portalai/core/contracts";

import { db } from "../db/client.js";
import type { DbClient } from "../db/repositories/base.repository.js";
import type { JobSelect } from "../db/schema/zod.js";
import { getJobsQueue } from "../queues/jobs.queue.js";
import { DbService } from "./db.service.js";
import { JobEventsService } from "./job-events.service.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { createLogger } from "../utils/logger.util.js";
import { jobErrorText } from "../utils/job-error-text.util.js";

const logger = createLogger({ module: "jobs-service" });

/**
 * Per-type override for BullMQ `attempts`. Defaults to the queue's
 * `defaultJobOptions.attempts` (3) for any type not listed here.
 *
 * `layout_plan_commit` is pinned to 1 because its failures are
 * deterministic — drift gates, blocker warnings, validation errors —
 * none of which are transient. Retrying just delays the inevitable
 * failure, and the rollback (which flips the connector instance to
 * `error`) only runs on the FINAL attempt. Anything > 1 means the
 * client sees a `failed` SSE event for the first attempt, treats it
 * as terminal, and refetches the connector instance while it is
 * still `pending` — the rollback hasn't fired yet. By the time the
 * Nth attempt actually rolls back, no client is listening, so the
 * status chip stays stuck on `pending` until the user reloads.
 */
const MAX_ATTEMPTS_BY_TYPE: Partial<Record<string, number>> = {
  layout_plan_commit: 1,
};

const DEFAULT_MAX_ATTEMPTS = 3;

function resolveMaxAttempts(type: string): number {
  return MAX_ATTEMPTS_BY_TYPE[type] ?? DEFAULT_MAX_ATTEMPTS;
}

export class JobsService {
  /**
   * Create a new job record in PostgreSQL and enqueue it via BullMQ:
   * `insertRow` + `dispatch`.
   */
  static async create(userId: string, params: JobCreateRequestBody) {
    // #769: a job that locks scopes starts only through
    // JobLockService.enqueueExclusive, which checks for a conflicting job
    // under the scopes' advisory locks. Creating one here would skip that.
    if (jobLockScopes(params.type, params.metadata).length > 0) {
      throw new Error(
        `JobsService.create: "${params.type}" locks scopes; start it with JobLockService.enqueueExclusive`
      );
    }
    return JobsService.dispatch(await JobsService.insertRow(userId, params));
  }

  /**
   * Insert a job row (status `pending`) on `client`, without queueing it.
   * Stores the scopes the job locks while non-terminal (#769), so a caller
   * holding the scopes' advisory locks can insert the row in its own
   * transaction and `dispatch` after commit.
   */
  static async insertRow(
    userId: string,
    params: JobCreateRequestBody,
    client: DbClient = db
  ) {
    const maxAttempts = resolveMaxAttempts(params.type);
    const factory = new JobModelFactory();
    const model = factory.create(userId);
    model.update({
      organizationId: params.organizationId,
      type: params.type,
      status: "pending",
      progress: 0,
      // A new job has reported no structured progress. The DB column is
      // nullable, but this model is validated against the full JobSchema
      // before the insert, so the field must be set here too (#458).
      progressDetail: null,
      metadata: params.metadata ?? {},
      result: null,
      error: null,
      startedAt: null,
      completedAt: null,
      bullJobId: null,
      attempts: 0,
      // A newly created job has lost no executions. The DB column defaults to
      // 0, but this model is validated against the full JobSchema (#464) before
      // the insert, so the field must be set here too (#464).
      lostExecutions: 0,
      lockScopes: jobLockScopes(params.type, params.metadata).map(lockScopeKey),
      maxAttempts,
    });

    return DbService.repository.jobs.create(model.parse(), client);
  }

  /**
   * Queue an inserted job on BullMQ and record its `bullJobId`. A failure
   * marks the row `failed` and throws `JOB_ENQUEUE_FAILED`.
   */
  static async dispatch(job: JobSelect) {
    try {
      const bullJob = await getJobsQueue().add(
        job.type,
        {
          jobId: job.id,
          type: job.type,
          ...(job.metadata as Record<string, unknown>),
        },
        { attempts: job.maxAttempts }
      );

      // 3. Store BullMQ reference
      await DbService.repository.jobs.update(job.id, {
        bullJobId: bullJob.id,
      });

      logger.info(
        { jobId: job.id, type: job.type },
        "Job created and enqueued"
      );
      return { ...job, bullJobId: bullJob.id ?? null };
    } catch (err) {
      logger.error({ jobId: job.id, err }, "Failed to enqueue job");
      // If enqueue fails, mark the job as failed
      await DbService.repository.jobs.update(job.id, {
        status: "failed",
        // #719: every org member reads `jobs.error`; a DB failure here (the
        // bullJobId update) records no SQL or params. Logged in full above.
        error:
          err instanceof Error ? jobErrorText(err) : "Failed to enqueue job",
      });
      throw new ApiError(
        500,
        ApiCode.JOB_ENQUEUE_FAILED,
        "Failed to enqueue job"
      );
    }
  }

  /**
   * Find a single job by ID.
   * Throws JOB_NOT_FOUND if not found.
   */
  static async findById(jobId: string) {
    const job = await DbService.repository.jobs.findById(jobId);
    if (!job) {
      throw new ApiError(404, ApiCode.JOB_NOT_FOUND, "Job not found");
    }
    return job;
  }

  /**
   * Cancel a running or pending job.
   * Removes it from the BullMQ queue and transitions to 'cancelled'.
   */
  static async cancel(jobId: string) {
    const job = await this.findById(jobId);

    if (TERMINAL_JOB_STATUSES.includes(job.status)) {
      throw new ApiError(
        400,
        ApiCode.JOB_ALREADY_TERMINAL,
        "Job is already in a terminal state"
      );
    }

    // Remove from BullMQ if still queued
    if (job.bullJobId) {
      try {
        const bullJob = await getJobsQueue().getJob(job.bullJobId);
        if (bullJob) await bullJob.remove();
      } catch (err) {
        logger.warn(
          { jobId, err },
          "Failed to remove BullMQ job (may already be processed)"
        );
      }
    }

    await JobEventsService.transition(jobId, "cancelled");
    return this.findById(jobId);
  }
}
