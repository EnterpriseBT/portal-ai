/**
 * #689 (code review): a page that disables actions on a running job must
 * hear when that job ends, or its actions stay disabled after the work is
 * done. The hook subscribes to each listed job and reports when it settles.
 */
import { jest } from "@jest/globals";

type Resolver = { resolve: () => void; reject: (e: unknown) => void };
const pending = new Map<string, Resolver>();
const signals = new Map<string, AbortSignal>();
const mockAwait = jest.fn(
  (_connect: unknown, jobId: string, opts: { signal?: AbortSignal }) =>
    new Promise<void>((resolve, reject) => {
      pending.set(jobId, { resolve, reject });
      if (opts.signal) signals.set(jobId, opts.signal);
    })
);

jest.unstable_mockModule("../api/sse.api", () => ({
  sse: { create: () => jest.fn() },
}));
jest.unstable_mockModule("../utils/job-stream.util", () => ({
  awaitJobCompletion: mockAwait,
}));

const { renderHook, act } = await import("@testing-library/react");
const { useRunningJobSubscriptions } =
  await import("../utils/use-running-job-subscriptions.util");

const job = (id: string) => ({ id, type: "connector_sync" });

describe("useRunningJobSubscriptions", () => {
  beforeEach(() => {
    pending.clear();
    signals.clear();
    mockAwait.mockClear();
  });

  it("subscribes once per running job, and reports when one settles", async () => {
    const onSettled = jest.fn();
    const jobs = [job("j1"), job("j2")];
    const { rerender } = renderHook(
      ({ list }) => useRunningJobSubscriptions(list, onSettled),
      { initialProps: { list: jobs } }
    );
    rerender({ list: jobs });
    expect(mockAwait).toHaveBeenCalledTimes(2);

    await act(async () => {
      pending.get("j1")!.resolve();
    });
    expect(onSettled).toHaveBeenCalledWith(jobs[0]);
  });

  it("reports a failed or cancelled job as settled too", async () => {
    const onSettled = jest.fn();
    const jobs = [job("j1")];
    renderHook(() => useRunningJobSubscriptions(jobs, onSettled));
    await act(async () => {
      pending.get("j1")!.reject(new Error("failed"));
    });
    expect(onSettled).toHaveBeenCalledWith(jobs[0]);
  });

  it("aborts a job's stream when it leaves the list, and every stream on unmount", () => {
    const { rerender, unmount } = renderHook(
      ({ list }) => useRunningJobSubscriptions(list, jest.fn()),
      { initialProps: { list: [job("j1"), job("j2")] } }
    );
    rerender({ list: [job("j2")] });
    expect(signals.get("j1")!.aborted).toBe(true);
    expect(signals.get("j2")!.aborted).toBe(false);
    unmount();
    expect(signals.get("j2")!.aborted).toBe(true);
  });
});
