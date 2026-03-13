/**
 * Integration tests for the jobs queue layer.
 *
 * Runs against the real Redis container from docker-compose.
 * Tests queue enqueue/dequeue, worker processing, processor registry,
 * and lifecycle event forwarding.
 */

import {
  describe,
  it,
  expect,
  afterEach,
  jest,
} from "@jest/globals";
import { Queue, Worker, Job as BullJob } from "bullmq";

import { connectionOpts, uniqueQueueName, waitForJobState } from "./queue.util.js";

// ── Tests ────────────────────────────────────────────────────────────────

describe("Jobs Queue Integration Tests", () => {
  let queue: Queue;
  let worker: Worker;
  const cleanupQueues: Queue[] = [];
  const cleanupWorkers: Worker[] = [];

  afterEach(async () => {
    // Close all workers first, then queues
    for (const w of cleanupWorkers) {
      await w.close();
    }
    for (const q of cleanupQueues) {
      await q.obliterate({ force: true });
      await q.close();
    }
    cleanupQueues.length = 0;
    cleanupWorkers.length = 0;
  });

  function createQueue(name?: string): Queue {
    const q = new Queue(name ?? uniqueQueueName(), {
      connection: connectionOpts,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 500 },
        removeOnComplete: { age: 60 },
        removeOnFail: { age: 60 },
      },
    });
    cleanupQueues.push(q);
    return q;
  }

  function createWorker(
    queueName: string,
    processor: (job: BullJob) => Promise<unknown>
  ): Worker {
    const w = new Worker(queueName, processor, {
      connection: connectionOpts,
      concurrency: 2,
    });
    cleanupWorkers.push(w);
    return w;
  }

  // ── Queue basics ────────────────────────────────────────────────────

  describe("Queue", () => {
    it("should add a job and retrieve it by ID", async () => {
      queue = createQueue();

      const added = await queue.add("connector_sync", {
        jobId: "job-001",
        type: "connector_sync",
      });

      const retrieved = await queue.getJob(added.id!);
      expect(retrieved).toBeDefined();
      expect(retrieved!.data.jobId).toBe("job-001");
      expect(retrieved!.data.type).toBe("connector_sync");
    });

    it("should apply default job options (attempts)", async () => {
      queue = createQueue();

      const added = await queue.add("data_import", {
        jobId: "job-002",
        type: "data_import",
      });

      expect(added.opts.attempts).toBe(3);
    });

    it("should enqueue multiple jobs in order", async () => {
      queue = createQueue();

      await queue.add("type_a", { jobId: "a" });
      await queue.add("type_b", { jobId: "b" });
      await queue.add("type_c", { jobId: "c" });

      const waiting = await queue.getWaiting();
      const jobIds = waiting.map((j) => j.data.jobId);

      expect(jobIds).toContain("a");
      expect(jobIds).toContain("b");
      expect(jobIds).toContain("c");
    });

    it("should remove a job from the queue", async () => {
      queue = createQueue();

      const added = await queue.add("removable", { jobId: "to-remove" });
      const job = await queue.getJob(added.id!);
      await job!.remove();

      const retrieved = await queue.getJob(added.id!);
      expect(retrieved).toBeUndefined();
    });
  });

  // ── Worker processing ──────────────────────────────────────────────

  describe("Worker", () => {
    it("should process a job and mark it completed", async () => {
      const queueName = uniqueQueueName();
      queue = createQueue(queueName);

      const processorFn = jest.fn(async (job: BullJob) => {
        return { processed: true, jobId: job.data.jobId };
      });

      worker = createWorker(queueName, processorFn);

      const added = await queue.add("test_type", {
        jobId: "job-process-1",
        type: "test_type",
      });

      await waitForJobState(queue, added.id!, "completed");

      expect(processorFn).toHaveBeenCalledTimes(1);
      const state = await added.getState();
      expect(state).toBe("completed");
    });

    it("should pass job data to the processor function", async () => {
      const queueName = uniqueQueueName();
      queue = createQueue(queueName);

      let receivedData: Record<string, unknown> | null = null;

      worker = createWorker(queueName, async (job: BullJob) => {
        receivedData = job.data;
        return {};
      });

      const added = await queue.add("test_type", {
        jobId: "job-data-1",
        type: "connector_sync",
        connectorInstanceId: "ci-123",
      });

      await waitForJobState(queue, added.id!, "completed");

      expect(receivedData).toEqual({
        jobId: "job-data-1",
        type: "connector_sync",
        connectorInstanceId: "ci-123",
      });
    });

    it("should mark a job as failed when the processor throws", async () => {
      const queueName = uniqueQueueName();
      queue = createQueue(queueName);

      worker = createWorker(queueName, async () => {
        throw new Error("Processing failed");
      });

      const added = await queue.add(
        "fail_type",
        { jobId: "job-fail-1", type: "fail_type" },
        { attempts: 1 } // override to fail immediately
      );

      await waitForJobState(queue, added.id!, "failed");

      const state = await added.getState();
      expect(state).toBe("failed");
    });

    it("should retry a failed job up to the configured attempts", async () => {
      const queueName = uniqueQueueName();
      queue = createQueue(queueName);

      let attemptCount = 0;

      worker = createWorker(queueName, async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error(`Attempt ${attemptCount} failed`);
        }
        return { success: true };
      });

      const added = await queue.add(
        "retry_type",
        { jobId: "job-retry-1", type: "retry_type" },
        { attempts: 3, backoff: { type: "fixed", delay: 100 } }
      );

      await waitForJobState(queue, added.id!, "completed");

      expect(attemptCount).toBe(3);
      const state = await added.getState();
      expect(state).toBe("completed");
    });

    it("should support progress updates from the processor", async () => {
      const queueName = uniqueQueueName();
      queue = createQueue(queueName);

      const progressValues: number[] = [];

      worker = createWorker(queueName, async (job: BullJob) => {
        await job.updateProgress(25);
        await job.updateProgress(50);
        await job.updateProgress(100);
        return {};
      });

      worker.on("progress", (_job, progress) => {
        if (typeof progress === "number") {
          progressValues.push(progress);
        }
      });

      const added = await queue.add("progress_type", {
        jobId: "job-progress-1",
        type: "progress_type",
      });

      await waitForJobState(queue, added.id!, "completed");

      // Wait briefly for progress events to propagate
      await new Promise((r) => setTimeout(r, 200));

      expect(progressValues).toContain(25);
      expect(progressValues).toContain(50);
      expect(progressValues).toContain(100);
    });
  });

  // ── Processor registry pattern ─────────────────────────────────────

  describe("Processor registry pattern", () => {
    it("should dispatch to the correct processor based on job type", async () => {
      const queueName = uniqueQueueName();
      queue = createQueue(queueName);

      const processors: Record<string, (job: BullJob) => Promise<unknown>> = {};
      const callLog: string[] = [];

      processors["type_a"] = async () => {
        callLog.push("type_a");
        return {};
      };
      processors["type_b"] = async () => {
        callLog.push("type_b");
        return {};
      };

      worker = createWorker(queueName, async (bullJob: BullJob) => {
        const { type } = bullJob.data;
        const processor = processors[type];
        if (!processor) {
          throw new Error(`No processor registered for type: ${type}`);
        }
        return processor(bullJob);
      });

      const jobA = await queue.add("type_a", {
        jobId: "dispatch-a",
        type: "type_a",
      });
      await waitForJobState(queue, jobA.id!, "completed");

      const jobB = await queue.add("type_b", {
        jobId: "dispatch-b",
        type: "type_b",
      });
      await waitForJobState(queue, jobB.id!, "completed");

      expect(callLog).toContain("type_a");
      expect(callLog).toContain("type_b");
    });

    it("should fail when no processor is registered for the job type", async () => {
      const queueName = uniqueQueueName();
      queue = createQueue(queueName);

      const processors: Record<string, (job: BullJob) => Promise<unknown>> = {};

      worker = createWorker(queueName, async (bullJob: BullJob) => {
        const { type } = bullJob.data;
        const processor = processors[type];
        if (!processor) {
          throw new Error(`No processor registered for job type: ${type}`);
        }
        return processor(bullJob);
      });

      const added = await queue.add(
        "unknown_type",
        { jobId: "no-processor", type: "unknown_type" },
        { attempts: 1 }
      );

      await waitForJobState(queue, added.id!, "failed");

      const state = await added.getState();
      expect(state).toBe("failed");
    });
  });

  // ── Concurrency ────────────────────────────────────────────────────

  describe("Concurrency", () => {
    it("should process multiple jobs concurrently", async () => {
      const queueName = uniqueQueueName();
      queue = createQueue(queueName);

      let maxConcurrent = 0;
      let currentConcurrent = 0;

      worker = createWorker(queueName, async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        // Simulate work
        await new Promise((r) => setTimeout(r, 200));
        currentConcurrent--;
        return {};
      });

      // Add 4 jobs — worker concurrency is 2
      const jobs = await Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          queue.add("concurrent", { jobId: `c-${i}`, type: "concurrent" })
        )
      );

      // Wait for all jobs to complete
      await Promise.all(
        jobs.map((j) => waitForJobState(queue, j.id!, "completed"))
      );

      // At least 2 should have run concurrently
      expect(maxConcurrent).toBeGreaterThanOrEqual(2);
    });
  });
});
