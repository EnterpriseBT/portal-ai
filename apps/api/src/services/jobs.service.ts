import { JobModelFactory, TERMINAL_JOB_STATUSES } from "@portalai/core/models";
import type { JobCreateRequestBody } from "@portalai/core/contracts";

import { jobsQueue } from "../queues/jobs.queue.js";
import { DbService } from "./db.service.js";
import { JobEventsService } from "./job-events.service.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { createLogger } from "../utils/logger.util.js";

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
   * Create a new job record in PostgreSQL and enqueue it via BullMQ.
   */
  static async create(userId: string, params: JobCreateRequestBody) {
    const maxAttempts = resolveMaxAttempts(params.type);
    const factory = new JobModelFactory();
    const model = factory.create(userId);
    model.update({
      organizationId: params.organizationId,
      type: params.type,
      status: "pending",
      progress: 0,
      metadata: params.metadata ?? {},
      result: null,
      error: null,
      startedAt: null,
      completedAt: null,
      bullJobId: null,
      attempts: 0,
      maxAttempts,
    });

    // 1. Create DB record
    const job = await DbService.repository.jobs.create(model.parse());

    // 2. Enqueue BullMQ job
    try {
      const bullJob = await jobsQueue.add(
        params.type,
        {
          jobId: job.id,
          type: params.type,
          ...params.metadata,
        },
        { attempts: maxAttempts }
      );

      // 3. Store BullMQ reference
      await DbService.repository.jobs.update(job.id, {
        bullJobId: bullJob.id,
      });

      logger.info(
        { jobId: job.id, type: params.type },
        "Job created and enqueued"
      );
      return { ...job, bullJobId: bullJob.id ?? null };
    } catch (err) {
      // If enqueue fails, mark the job as failed
      await DbService.repository.jobs.update(job.id, {
        status: "failed",
        error: err instanceof Error ? err.message : "Failed to enqueue job",
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
        const bullJob = await jobsQueue.getJob(job.bullJobId);
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
