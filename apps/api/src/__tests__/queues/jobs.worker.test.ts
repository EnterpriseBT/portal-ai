import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Job as BullJob } from "bullmq";

// ── Mocks (must precede the dynamic import) ──────────────────────────

/**
 * BullMQ's `Worker` is constructed with the handler as its second argument.
 * Capturing it lets the handler be invoked directly, so the terminal-status
 * decision is tested for real rather than grepped for in the source.
 */
type Handler = (job: BullJob) => Promise<unknown>;
let captured: Handler | undefined;

jest.unstable_mockModule("bullmq", () => ({
  Worker: class {
    constructor(_name: string, handler: Handler) {
      captured = handler;
    }
    on() {
      return this;
    }
    close() {
      return Promise.resolve();
    }
  },
  Job: class {},
  // #441: the worker imports this to exempt stall-limit exhaustion from the
  // retry-aware terminal decision, so the mock has to provide it.
  UnrecoverableError: class UnrecoverableError extends Error {},
}));

const mockTransition = jest.fn<
  (
    jobId: string,
    status: string,
    patch?: Record<string, unknown>
  ) => Promise<void>
>(async () => {});

jest.unstable_mockModule("../../services/job-events.service.js", () => ({
  JobEventsService: {
    transition: mockTransition,
    publishCustomEvent: jest.fn(async () => {}),
  },
}));

jest.unstable_mockModule("../../queues/jobs.queue.js", () => ({
  JOBS_QUEUE_NAME: "jobs",
}));

const { createJobsWorker } = await import("../../queues/jobs.worker.js");

const job = (type: string): BullJob =>
  ({ data: { jobId: "job-1", type } }) as unknown as BullJob;

/** The status the worker transitioned to, ignoring the earlier `active`. */
const terminalCall = () =>
  mockTransition.mock.calls.filter((c) => c[1] !== "active").at(-1);

/**
 * #410 — the worker used to transition every non-throwing processor to
 * `completed`. Batch jobs wrap each item in its own try/catch, so a run where
 * every item failed reached here having thrown nothing and was recorded as a
 * success. That is how app-dev's geocoding stayed broken indefinitely.
 */
describe("jobs worker classifies batch outcomes (#410)", () => {
  beforeEach(() => {
    captured = undefined;
    mockTransition.mockClear();
  });

  const run = async (result: unknown) => {
    createJobsWorker({ bulk_geocode: async () => result });
    if (!captured) throw new Error("worker handler was not captured");
    await captured(job("bulk_geocode"));
  };

  it("fails a batch where nothing succeeded", async () => {
    await run({ recordsProcessed: 10, recordsFailed: 10, recordsSucceeded: 0 });
    expect(terminalCall()?.[1]).toBe("failed");
  });

  it("persists the result on a classified failure", async () => {
    // `partialFailures` is the only record of WHY each row failed — losing it
    // on the failure path would make the new status less useful than the bug.
    const result = {
      recordsProcessed: 2,
      recordsFailed: 2,
      recordsSucceeded: 0,
      partialFailures: [{ sourceKey: "r1", error: { code: "X" } }],
    };
    await run(result);
    const patch = terminalCall()?.[2] as { result?: unknown; error?: string };
    expect(patch.result).toEqual(result);
    // And a stated reason: nothing threw, so there is no exception to format.
    expect(patch.error).toContain("Every record failed");
  });

  it("completes a partial failure", async () => {
    await run({ recordsProcessed: 10, recordsFailed: 2, recordsSucceeded: 8 });
    expect(terminalCall()?.[1]).toBe("completed");
  });

  it("completes a fully successful batch", async () => {
    await run({ recordsProcessed: 5, recordsFailed: 0, recordsSucceeded: 5 });
    expect(terminalCall()?.[1]).toBe("completed");
  });

  it("completes an empty batch", async () => {
    await run({ recordsProcessed: 0, recordsFailed: 0, recordsSucceeded: 0 });
    expect(terminalCall()?.[1]).toBe("completed");
  });

  it("leaves a non-batch job type untouched", async () => {
    // Seven of nine job types carry no per-item accounting and must be
    // unaffected — this change must not be able to fail a connector_sync.
    createJobsWorker({
      connector_sync: async () => ({
        recordCounts: { created: 0, updated: 0, unchanged: 0, deleted: 0 },
      }),
    });
    if (!captured) throw new Error("worker handler was not captured");
    await captured(job("connector_sync"));
    expect(terminalCall()?.[1]).toBe("completed");
  });

  it("completes a legacy batch result with no recordsSucceeded", async () => {
    // A processor that has not been updated keeps the old behavior rather than
    // being retroactively failed.
    await run({ recordsProcessed: 10, recordsFailed: 10 });
    expect(terminalCall()?.[1]).toBe("completed");
  });

  it("still fails a job whose processor throws", async () => {
    createJobsWorker({
      bulk_geocode: async () => {
        throw new Error("provider exploded");
      },
    });
    if (!captured) throw new Error("worker handler was not captured");
    await expect(captured(job("bulk_geocode"))).rejects.toThrow(
      "provider exploded"
    );
    const call = terminalCall();
    expect(call?.[1]).toBe("failed");
    expect((call?.[2] as { error?: string }).error).toContain(
      "provider exploded"
    );
  });
});
