import { jest } from "@jest/globals";

import type { JobCompletionResult } from "../utils/job-stream.util";

type Connect = (path: string) => Promise<EventSource>;

const awaitJobCompletionMock =
  jest.fn<
    (
      connect: Connect,
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

const { commitAndAwait, COMMIT_FAILED_CODE } =
  await import("../utils/commit-job.util");
const { ApiError } = await import("../utils/api.util");

const DRIFT = "Drift at 'warn' severity — region drift knobs require halt.";

type FetchJob = (
  id: string
) => Promise<{ status: string; error: string | null }>;

function deps(overrides: Partial<Parameters<typeof commitAndAwait>[0]> = {}) {
  return {
    enqueue: jest
      .fn<() => Promise<{ jobId: string; connectorInstanceId: string }>>()
      .mockResolvedValue({ jobId: "job-1", connectorInstanceId: "ci-1" }),
    connect: jest.fn<Connect>(),
    fetchJob: jest.fn<FetchJob>().mockRejectedValue(new Error("not expected")),
    connectorExists: jest
      .fn<(id: string) => Promise<boolean>>()
      .mockResolvedValue(false),
    onLanded: jest.fn(),
    pollIntervalMs: 0,
    ...overrides,
  };
}

describe("commitAndAwait (#887)", () => {
  beforeEach(() => awaitJobCompletionMock.mockReset());

  it("doesn't settle before the job does, then returns the new connector", async () => {
    let finish!: (r: JobCompletionResult) => void;
    awaitJobCompletionMock.mockReturnValue(
      new Promise((resolve) => (finish = resolve))
    );
    const d = deps();
    let settled = false;
    const done = commitAndAwait(d).then((r) => {
      settled = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(settled).toBe(false);
    finish({ result: null });
    await expect(done).resolves.toEqual({ connectorInstanceId: "ci-1" });
    expect(d.onLanded).toHaveBeenCalledTimes(1);
  });

  it("throws the job's error when it failed and the rollback removed the connector", async () => {
    awaitJobCompletionMock.mockRejectedValue(
      new JobFailedError(DRIFT, "failed")
    );
    const d = deps();
    const err = await commitAndAwait(d).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe(COMMIT_FAILED_CODE);
    expect(COMMIT_FAILED_CODE).toBe("LAYOUT_PLAN_COMMIT_FAILED");
    expect(err.message).toBe(DRIFT);
    expect(d.connectorExists).toHaveBeenCalledWith("ci-1");
    expect(d.onLanded).not.toHaveBeenCalled();
  });

  it("lands on the connector when a failed or cancelled job left it in place", async () => {
    awaitJobCompletionMock.mockRejectedValue(
      new JobFailedError("Job cancelled", "cancelled")
    );
    const d = deps({
      connectorExists: jest
        .fn<(id: string) => Promise<boolean>>()
        .mockResolvedValue(true),
    });
    await expect(commitAndAwait(d)).resolves.toEqual({
      connectorInstanceId: "ci-1",
    });
    expect(d.onLanded).toHaveBeenCalledTimes(1);
  });

  it("lands on the connector when it can't tell whether the connector survived", async () => {
    awaitJobCompletionMock.mockRejectedValue(
      new JobFailedError(DRIFT, "failed")
    );
    const d = deps({
      connectorExists: jest
        .fn<(id: string) => Promise<boolean>>()
        .mockRejectedValue(new Error("network")),
    });
    await expect(commitAndAwait(d)).resolves.toEqual({
      connectorInstanceId: "ci-1",
    });
  });

  it("polls the job when the stream drops, and reports its real outcome", async () => {
    awaitJobCompletionMock.mockRejectedValue(
      new Error("SSE connection error while waiting for job")
    );
    const fetchJob = jest
      .fn<FetchJob>()
      .mockResolvedValueOnce({ status: "active", error: null })
      .mockResolvedValueOnce({ status: "failed", error: DRIFT });
    const d = deps({ fetchJob });
    const err = await commitAndAwait(d).catch((e) => e);
    expect(fetchJob).toHaveBeenCalledTimes(2);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe(DRIFT);
  });

  it("returns the connector when polling finds the job completed", async () => {
    awaitJobCompletionMock.mockRejectedValue(new Error("SSE dropped"));
    const d = deps({
      fetchJob: jest
        .fn<FetchJob>()
        .mockResolvedValue({ status: "completed", error: null }),
    });
    await expect(commitAndAwait(d)).resolves.toEqual({
      connectorInstanceId: "ci-1",
    });
    expect(d.onLanded).toHaveBeenCalledTimes(1);
  });

  it("falls back to the connector page when the job can't be read: never invites a duplicate commit", async () => {
    awaitJobCompletionMock.mockRejectedValue(new Error("SSE dropped"));
    const d = deps({ maxPollFailures: 3 });
    await expect(commitAndAwait(d)).resolves.toEqual({
      connectorInstanceId: "ci-1",
    });
    expect(d.fetchJob).toHaveBeenCalledTimes(3);
  });

  it("forwards progress from the job stream", async () => {
    awaitJobCompletionMock.mockResolvedValue({ result: null });
    const onProgress = jest.fn();
    const d = deps({ onProgress });
    await commitAndAwait(d);
    expect(awaitJobCompletionMock).toHaveBeenCalledWith(d.connect, "job-1", {
      onProgress,
    });
  });

  it("surfaces an enqueue failure as is, with nothing to wait for", async () => {
    const refusal = new ApiError("Locked", "ENTITY_LOCKED_BY_JOB", 409);
    const d = deps({
      enqueue: jest
        .fn<() => Promise<{ jobId: string; connectorInstanceId: string }>>()
        .mockRejectedValue(refusal),
    });
    await expect(commitAndAwait(d)).rejects.toBe(refusal);
    expect(awaitJobCompletionMock).not.toHaveBeenCalled();
  });
});
