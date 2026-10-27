import { jest } from "@jest/globals";

import type { JobCompletionResult } from "../utils/job-stream.util";

const awaitJobCompletionMock =
  jest.fn<
    (
      connect: (path: string) => Promise<EventSource>,
      jobId: string,
      options?: { onProgress?: (percent: number) => void }
    ) => Promise<JobCompletionResult>
  >();

class JobFailedError extends Error {
  constructor(
    message: string,
    readonly status: "failed" | "cancelled"
  ) {
    super(message);
  }
}

jest.unstable_mockModule("../utils/job-stream.util", () => ({
  awaitJobCompletion: awaitJobCompletionMock,
  JobFailedError,
}));

const { awaitCommitJob, COMMIT_FAILED_CODE } =
  await import("../utils/commit-job.util");
const { ApiError } = await import("../utils/api.util");

const connect = jest.fn<(path: string) => Promise<EventSource>>();

describe("awaitCommitJob (#887)", () => {
  beforeEach(() => awaitJobCompletionMock.mockReset());

  it("resolves when the commit job completes", async () => {
    awaitJobCompletionMock.mockResolvedValue({ result: { ok: true } });
    await expect(awaitCommitJob(connect, "job-1")).resolves.toBeUndefined();
    expect(awaitJobCompletionMock).toHaveBeenCalledWith(connect, "job-1", {
      onProgress: undefined,
    });
  });

  it("turns a failed job into an ApiError carrying the job's own message", async () => {
    awaitJobCompletionMock.mockRejectedValue(
      new JobFailedError(
        "Drift at 'warn' severity — region drift knobs require halt.",
        "failed"
      )
    );
    const err = await awaitCommitJob(connect, "job-1").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe(COMMIT_FAILED_CODE);
    expect(COMMIT_FAILED_CODE).toBe("LAYOUT_PLAN_COMMIT_FAILED");
    expect(err.message).toBe(
      "Drift at 'warn' severity — region drift knobs require halt."
    );
  });

  it("reports a cancelled job the same way", async () => {
    awaitJobCompletionMock.mockRejectedValue(
      new JobFailedError("Job cancelled", "cancelled")
    );
    const err = await awaitCommitJob(connect, "job-1").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe(COMMIT_FAILED_CODE);
    expect(err.message).toBe("Job cancelled");
  });

  it("passes an SSE connection error through unchanged: the job's outcome is unknown", async () => {
    const sseError = new Error("SSE connection error while waiting for job");
    awaitJobCompletionMock.mockRejectedValue(sseError);
    await expect(awaitCommitJob(connect, "job-1")).rejects.toBe(sseError);
  });

  it("forwards progress", async () => {
    const onProgress = jest.fn();
    awaitJobCompletionMock.mockResolvedValue({ result: null });
    await awaitCommitJob(connect, "job-1", { onProgress });
    expect(awaitJobCompletionMock).toHaveBeenCalledWith(connect, "job-1", {
      onProgress,
    });
  });
});
