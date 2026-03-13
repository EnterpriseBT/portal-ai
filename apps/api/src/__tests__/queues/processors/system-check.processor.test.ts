import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import type { Job as BullJob } from "bullmq";

import { systemCheckProcessor } from "../../../queues/processors/system-check.processor.js";

/** Create a mock BullMQ job with the given data. */
function createMockBullJob(
  data: Record<string, unknown> = {}
): BullJob {
  return {
    data: { jobId: "job-001", type: "system_check", ...data },
    updateProgress: jest.fn<(progress: number) => Promise<void>>().mockResolvedValue(
      undefined
    ),
  } as unknown as BullJob;
}

describe("systemCheckProcessor", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should return a healthy result", async () => {
    const bullJob = createMockBullJob();

    const promise = systemCheckProcessor(bullJob);

    // Fast-forward all 10 ticks (10 × 1000ms)
    for (let i = 0; i < 10; i++) {
      await jest.advanceTimersByTimeAsync(1_000);
    }

    const result = await promise;

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

  it("should update progress 10 times (10% per tick)", async () => {
    const bullJob = createMockBullJob();

    const promise = systemCheckProcessor(bullJob);

    for (let i = 0; i < 10; i++) {
      await jest.advanceTimersByTimeAsync(1_000);
    }

    await promise;

    expect(bullJob.updateProgress).toHaveBeenCalledTimes(10);
    expect(bullJob.updateProgress).toHaveBeenNthCalledWith(1, 10);
    expect(bullJob.updateProgress).toHaveBeenNthCalledWith(5, 50);
    expect(bullJob.updateProgress).toHaveBeenNthCalledWith(10, 100);
  });

  it("should report monotonically increasing progress", async () => {
    const bullJob = createMockBullJob();
    const progressValues: number[] = [];

    (bullJob.updateProgress as jest.Mock).mockImplementation(
      async (...args: unknown[]) => {
        progressValues.push(args[0] as number);
      }
    );

    const promise = systemCheckProcessor(bullJob);

    for (let i = 0; i < 10; i++) {
      await jest.advanceTimersByTimeAsync(1_000);
    }

    await promise;

    // Every value should be greater than the previous
    for (let i = 1; i < progressValues.length; i++) {
      expect(progressValues[i]).toBeGreaterThan(progressValues[i - 1]);
    }

    // First and last values
    expect(progressValues[0]).toBe(10);
    expect(progressValues[progressValues.length - 1]).toBe(100);
  });
});
