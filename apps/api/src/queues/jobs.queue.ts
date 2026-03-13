import { Queue } from "bullmq";

import { environment } from "../environment.js";

export const JOBS_QUEUE_NAME = "async-jobs";

export const jobsQueue = new Queue(JOBS_QUEUE_NAME, {
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
