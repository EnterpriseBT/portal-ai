import { eq, and, type SQL, type Column } from "drizzle-orm";
import { JobModelFactory } from "@mcp-ui/core/models";
import type { JobCreateRequestBody, JobListRequestQuery } from "@mcp-ui/core/contracts";

import { jobsQueue } from "../queues/jobs.queue.js";
import { DbService } from "./db.service.js";
import { JobEventsService } from "./job-events.service.js";
import { ApplicationService } from "./application.service.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { createLogger } from "../utils/logger.util.js";
import { jobs } from "../db/schema/index.js";

const logger = createLogger({ module: "jobs-service" });

/** Map of sortable field names to their Drizzle columns. */
const SORTABLE_COLUMNS: Record<string, Column> = {
  created: jobs.created,
  status: jobs.status,
  type: jobs.type,
};

export class JobsService {
  /**
   * Create a new job record in PostgreSQL and enqueue it via BullMQ.
   */
  static async create(userId: string, params: JobCreateRequestBody) {
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
      maxAttempts: 3,
    });

    // 1. Create DB record
    const job = await DbService.repository.jobs.create(model.parse());

    // 2. Enqueue BullMQ job
    try {
      const bullJob = await jobsQueue.add(params.type, {
        jobId: job.id,
        type: params.type,
        ...params.metadata,
      });

      // 3. Store BullMQ reference
      await DbService.repository.jobs.update(job.id, {
        bullJobId: bullJob.id,
      });

      logger.info({ jobId: job.id, type: params.type }, "Job created and enqueued");
      return { ...job, bullJobId: bullJob.id ?? null };
    } catch (err) {
      // If enqueue fails, mark the job as failed
      await DbService.repository.jobs.update(job.id, {
        status: "failed",
        error: err instanceof Error ? err.message : "Failed to enqueue job",
      });
      throw new ApiError(500, ApiCode.JOB_ENQUEUE_FAILED, "Failed to enqueue job");
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
   * List jobs for the current user's organization with pagination and filters.
   */
  static async listForUser(
    userId: string,
    query: JobListRequestQuery
  ) {
    const orgResult = await ApplicationService.getCurrentOrganization(userId);
    if (!orgResult) {
      throw new ApiError(404, ApiCode.ORGANIZATION_NOT_FOUND, "No organization found for user");
    }

    const { limit, offset, sortBy, sortOrder, status, type } = query;

    const filters: SQL[] = [];
    if (status) {
      filters.push(eq(jobs.status, status));
    }
    if (type) {
      filters.push(eq(jobs.type, type));
    }

    const where = filters.length > 0 ? and(...filters) : undefined;
    const column = SORTABLE_COLUMNS[sortBy] ?? SORTABLE_COLUMNS.created;

    const [data, total] = await Promise.all([
      DbService.repository.jobs.findMany(where, {
        limit,
        offset,
        organizationId: orgResult.organization.id,
        orderBy: { column, direction: sortOrder },
      }),
      DbService.repository.jobs.count(where),
    ]);

    return { jobs: data, total, limit, offset };
  }

  /**
   * Cancel a running or pending job.
   * Removes it from the BullMQ queue and transitions to 'cancelled'.
   */
  static async cancel(jobId: string) {
    const job = await this.findById(jobId);

    if (["completed", "failed", "cancelled"].includes(job.status)) {
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
        logger.warn({ jobId, err }, "Failed to remove BullMQ job (may already be processed)");
      }
    }

    await JobEventsService.transition(jobId, "cancelled");
    return this.findById(jobId);
  }
}
