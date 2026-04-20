import { Queue } from "bullmq";

export const REDIS_URL = process.env.REDIS_URL || "redis://redis:6379";

export const connectionOpts = {
  url: REDIS_URL,
  maxRetriesPerRequest: null as null,
};

let testId = 0;

/** Create a unique queue name per test to avoid cross-contamination. */
export function uniqueQueueName(prefix = "test-queue"): string {
  return `${prefix}-${Date.now()}-${++testId}`;
}

/** Wait for a BullMQ job to reach a terminal state. */
export function waitForJobState(
  queue: Queue,
  jobId: string,
  state: "completed" | "failed",
  timeoutMs = 15_000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(new Error(`Timed out waiting for job ${jobId} to be ${state}`)),
      timeoutMs
    );

    const poll = setInterval(async () => {
      const job = await queue.getJob(jobId);
      if (!job) return;
      const currentState = await job.getState();
      if (currentState === state) {
        clearInterval(poll);
        clearTimeout(timer);
        resolve();
      }
    }, 100);
  });
}
