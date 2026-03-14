import { Worker, Job as BullJob } from "bullmq";

import type { JobType, JobTypeMap } from "@portalai/core/models";

import { environment } from "../environment.js";
import { createLogger } from "../utils/logger.util.js";
import { JOBS_QUEUE_NAME } from "./jobs.queue.js";

const logger = createLogger({ module: "jobs-worker" });

/** Untyped processor — accepts any BullMQ job. Used by the registry map. */
export type JobProcessor = (job: BullJob) => Promise<unknown>;

/** BullMQ job data shape for a given job type (jobId + type + typed metadata). */
export type JobData<T extends JobType = JobType> = {
  jobId: string;
  type: T;
} & JobTypeMap[T]["metadata"];

/** Typed processor — constrains both input data and return type per job type. */
export type TypedJobProcessor<T extends JobType> = (
  job: BullJob<JobData<T>, JobTypeMap[T]["result"]>
) => Promise<JobTypeMap[T]["result"]>;

/**
 * Lazily import JobEventsService to avoid circular dependency
 * and allow the service to be created in a separate step.
 */
const getJobEventsService = async () => {
  const { JobEventsService } = await import(
    "../services/job-events.service.js"
  );
  return JobEventsService;
};

export const createJobsWorker = (
  processors: Record<string, JobProcessor>
): Worker => {
  const worker = new Worker(
    JOBS_QUEUE_NAME,
    async (bullJob) => {
      const { jobId, type } = bullJob.data;
      const processor = processors[type];
      if (!processor) {
        throw new Error(`No processor registered for job type: ${type}`);
      }

      const JobEventsService = await getJobEventsService();

      await JobEventsService.transition(jobId, "active", { progress: 0 });
      try {
        const result = await processor(bullJob);
        await JobEventsService.transition(jobId, "completed", {
          progress: 100,
          result: result as Record<string, unknown>,
        });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await JobEventsService.transition(jobId, "failed", { error: message });
        throw err;
      }
    },
    {
      connection: {
        url: environment.REDIS_URL,
        maxRetriesPerRequest: null,
      },
      concurrency: 5,
    }
  );

  // Forward BullMQ progress events
  worker.on("progress", async (bullJob, progress) => {
    if (typeof progress === "number") {
      const JobEventsService = await getJobEventsService();
      await JobEventsService.updateProgress(bullJob.data.jobId, progress);
    }
  });

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.data?.jobId, err }, "Job failed");
  });

  worker.on("completed", (job) => {
    logger.info({ jobId: job?.data?.jobId }, "Job completed");
  });

  return worker;
};
