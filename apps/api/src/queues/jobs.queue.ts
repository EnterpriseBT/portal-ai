import { Queue } from "bullmq";

import { environment } from "../environment.js";

export const JOBS_QUEUE_NAME = "async-jobs";

let _jobsQueue: Queue | null = null;

/**
 * Lazily construct the jobs queue.
 *
 * BullMQ's `new Queue()` eagerly opens an ioredis connection. Constructing at
 * module load meant that merely *importing* any module in this graph (e.g. a
 * tool → `jobs.service` → here) opened a Redis socket as a side effect. In
 * unit tests, where no Redis is running, ioredis then armed a reconnect
 * `setTimeout` that kept the event loop alive, so Jest hung after the suite
 * had already passed (#220 — a `--detectOpenHandles` blind spot, since a
 * pending timer is not a "handle"). Deferring construction to first use keeps
 * imports side-effect-free.
 */
export const getJobsQueue = (): Queue => {
  if (!_jobsQueue) {
    _jobsQueue = new Queue(JOBS_QUEUE_NAME, {
      connection: {
        url: environment.REDIS_URL,
        maxRetriesPerRequest: null,
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: { age: 7 * 24 * 3600 }, // 7 days
        removeOnFail: { age: 30 * 24 * 3600 }, // 30 days
      },
    });
  }
  return _jobsQueue;
};

/** Close the queue's Redis connection, but only if it was ever constructed. */
export const closeJobsQueue = async (): Promise<void> => {
  if (_jobsQueue) {
    await _jobsQueue.close();
    _jobsQueue = null;
  }
};
