/**
 * Integration tests for the system_check processor.
 *
 * Runs against real Redis from docker-compose. Verifies that the processor
 * executes via the worker dispatch, reports progress, and completes.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from "@jest/globals";
import { Queue, Worker, Job as BullJob } from "bullmq";

import type { JobProcessor } from "../../../queues/jobs.worker.js";
import { systemCheckProcessor } from "../../../queues/processors/system-check.processor.js";
import { connectionOpts, uniqueQueueName, waitForJobState } from "./queue.util.js";

// ── Tests ────────────────────────────────────────────────────────────────

describe("system_check Processor Integration Tests", () => {
  const cleanupQueues: Queue[] = [];
  const cleanupWorkers: Worker[] = [];

  // Compress setTimeout delays ≥ 500ms by 10× so the processor's 1-second ticks
  // complete in ~100ms each (~1s total instead of 10s). Short delays used by
  // BullMQ internals (< 500ms) are left untouched.
  const originalSetTimeout = globalThis.setTimeout;
  beforeAll(() => {
    globalThis.setTimeout = ((fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
      const adjusted = ms != null && ms >= 500 ? Math.ceil(ms / 10) : ms;
      return originalSetTimeout(fn, adjusted, ...args);
    }) as typeof globalThis.setTimeout;
  });
  afterAll(() => {
    globalThis.setTimeout = originalSetTimeout;
  });

  afterEach(async () => {
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
        attempts: 1,
        removeOnComplete: { age: 60 },
        removeOnFail: { age: 60 },
      },
    });
    cleanupQueues.push(q);
    return q;
  }

  function createWorker(
    queueName: string,
    processors: Record<string, JobProcessor>
  ): Worker {
    const w = new Worker(
      queueName,
      async (bullJob: BullJob) => {
        const { type } = bullJob.data;
        const processor = processors[type];
        if (!processor) {
          throw new Error(`No processor registered for type: ${type}`);
        }
        return processor(bullJob);
      },
      { connection: connectionOpts, concurrency: 1 }
    );
    cleanupWorkers.push(w);
    return w;
  }

  it("should complete the system_check job via the processor registry", async () => {
    const queueName = uniqueQueueName();
    const queue = createQueue(queueName);

    createWorker(queueName, { system_check: systemCheckProcessor });

    const added = await queue.add("system_check", {
      jobId: "integration-sc-1",
      type: "system_check",
    });

    await waitForJobState(queue, added.id!, "completed");

    const job = await queue.getJob(added.id!);
    const state = await job!.getState();
    expect(state).toBe("completed");
  });

  it("should report progress events during execution", async () => {
    const queueName = uniqueQueueName();
    const queue = createQueue(queueName);

    const progressValues: number[] = [];
    const worker = createWorker(queueName, {
      system_check: systemCheckProcessor,
    });

    worker.on("progress", (_job, progress) => {
      if (typeof progress === "number") {
        progressValues.push(progress);
      }
    });

    const added = await queue.add("system_check", {
      jobId: "integration-sc-2",
      type: "system_check",
    });

    await waitForJobState(queue, added.id!, "completed");

    // Allow progress events to propagate
    await new Promise((r) => setTimeout(r, 500));

    // Should have received all 10 progress updates
    expect(progressValues.length).toBe(10);
    expect(progressValues).toContain(10);
    expect(progressValues).toContain(50);
    expect(progressValues).toContain(100);
  });

  it("should return a healthy result with check details", async () => {
    const queueName = uniqueQueueName();
    const queue = createQueue(queueName);

    createWorker(queueName, { system_check: systemCheckProcessor });

    const added = await queue.add("system_check", {
      jobId: "integration-sc-3",
      type: "system_check",
    });

    await waitForJobState(queue, added.id!, "completed");

    const job = await queue.getJob(added.id!);
    const result = job!.returnvalue;

    expect(result).toEqual({
      status: "healthy",
      checks: {
        database: "ok",
        redis: "ok",
        queue: "ok",
      },
      durationMs: 10_000,
    });
  });

  it("should fail when dispatched with unknown type", async () => {
    const queueName = uniqueQueueName();
    const queue = createQueue(queueName);

    createWorker(queueName, { system_check: systemCheckProcessor });

    const added = await queue.add(
      "unknown_type",
      { jobId: "integration-sc-fail", type: "unknown_type" },
      { attempts: 1 }
    );

    await waitForJobState(queue, added.id!, "failed");

    const state = await (await queue.getJob(added.id!))!.getState();
    expect(state).toBe("failed");
  });
});
