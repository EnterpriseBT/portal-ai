/**
 * Retry-aware terminal state and the attempt record (#441 slice 2).
 *
 * The worker used to write the app job `failed` inside its catch and then
 * rethrow so BullMQ could retry. Both halves ran, so the row went terminal
 * while two attempts remained — observed as `failed` at 18:35:16, BullMQ
 * re-delivering at 18:50:55, and the worker then writing ~400K more rows. For
 * fifteen minutes the UI showed a failed job that was about to mutate the
 * dataset, and the row later flipped back to `active` still carrying the
 * previous attempt's error text.
 *
 * Three separate things have to hold, and they are easy to break
 * independently:
 *
 *  1. A job with budget left goes to a NON-TERMINAL status, so the entity
 *     lock (which keys on `NON_TERMINAL_JOB_STATUSES`) keeps holding. Writing
 *     `failed` here does not merely mislead — it unlocks an entity whose
 *     worker is about to write to it.
 *  2. `UnrecoverableError` is exempt. BullMQ's stall-limit exhaustion VOIDS
 *     the remaining budget rather than consuming an attempt, so it is final
 *     on arrival however low `attemptsMade` is.
 *  3. A death that never reaches the catch — process kill, stall recovery —
 *     still records a reason. That path is `worker.on("failed")`, which also
 *     fires for failures the catch already handled, so it has to be
 *     idempotent or it overwrites good state with a second, vaguer message.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Job as BullJob } from "bullmq";

type Handler = (job: BullJob) => Promise<unknown>;
type Listener = (...a: unknown[]) => void;

let captured: Handler | undefined;
const listeners = new Map<string, Listener>();

jest.unstable_mockModule("bullmq", () => ({
  Worker: class {
    constructor(_name: string, handler: Handler) {
      captured = handler;
    }
    on(event: string, cb: Listener) {
      listeners.set(event, cb);
      return this;
    }
    close() {
      return Promise.resolve();
    }
  },
  Job: class {},
  // The real UnrecoverableError is what BullMQ throws on stall exhaustion;
  // the worker must recognise it by class, not by message text.
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

const mockFindById = jest.fn<(...a: unknown[]) => Promise<unknown>>();
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: { repository: { jobs: { findById: mockFindById } } },
}));

jest.unstable_mockModule("../../queues/jobs.queue.js", () => ({
  JOBS_QUEUE_NAME: "jobs",
}));

const { createJobsWorker } = await import("../../queues/jobs.worker.js");
const { UnrecoverableError } = await import("bullmq");

/** A BullMQ job on its `attemptsMade`-th prior attempt, of `max` total. */
const job = (attemptsMade: number, max = 3): BullJob =>
  ({
    data: { jobId: "job-1", type: "connector_sync" },
    attemptsMade,
    opts: { attempts: max },
  }) as unknown as BullJob;

/** Transitions other than the opening `active`. */
const nonActive = () =>
  mockTransition.mock.calls.filter((c) => c[1] !== "active");
const lastNonActive = () => nonActive().at(-1);
/** The opening transition of the attempt. */
const openingCall = () =>
  mockTransition.mock.calls.find((c) => c[1] === "active");

const boom = new Error("Fetch failed: fetch failed");

describe("jobs worker — retry-aware terminal state (#441)", () => {
  beforeEach(() => {
    mockTransition.mockReset().mockResolvedValue(undefined);
    mockFindById.mockReset().mockResolvedValue(undefined);
    listeners.clear();
    captured = undefined;
  });

  const build = (processor: () => Promise<unknown>) =>
    createJobsWorker({ connector_sync: processor });

  // ── 1. budget remaining ────────────────────────────────────────────

  it("does not write a terminal status while retry budget remains", async () => {
    build(async () => {
      throw boom;
    });

    await expect(captured!(job(0))).rejects.toThrow(boom);

    const [, status, patch] = lastNonActive()!;
    expect(status).toBe("pending");
    expect(patch?.error).toBe("Fetch failed: fetch failed");
    // A job about to run again must not carry a completion time. The
    // transition service stamps completedAt on `failed`, so the status choice
    // is what keeps that from happening.
    expect(status).not.toBe("failed");
  });

  it("rethrows regardless, so BullMQ still owns the retry", async () => {
    build(async () => {
      throw boom;
    });
    await expect(captured!(job(0))).rejects.toThrow(boom);
  });

  it("keeps the retrying status non-terminal, so the entity lock holds", async () => {
    const { TERMINAL_JOB_STATUSES } = await import("@portalai/core/models");
    build(async () => {
      throw boom;
    });

    await expect(captured!(job(1))).rejects.toThrow(boom);

    const status = lastNonActive()![1] as never;
    expect(TERMINAL_JOB_STATUSES).not.toContain(status);
  });

  // ── 2. budget spent ───────────────────────────────────────────────

  it("writes failed on the last attempt", async () => {
    build(async () => {
      throw boom;
    });

    // attemptsMade 2 means this is the 3rd of 3 — nothing follows it.
    await expect(captured!(job(2))).rejects.toThrow(boom);

    expect(lastNonActive()![1]).toBe("failed");
  });

  it("treats a single-attempt job as terminal on its only failure", async () => {
    build(async () => {
      throw boom;
    });

    await expect(captured!(job(0, 1))).rejects.toThrow(boom);

    expect(lastNonActive()![1]).toBe("failed");
  });

  it("writes failed for UnrecoverableError even with budget left", async () => {
    // Stall-limit exhaustion voids the remaining attempts rather than
    // consuming one, so `attemptsMade: 0` here is still final.
    const unrecoverable = new UnrecoverableError(
      "job stalled more than allowable limit"
    );
    build(async () => {
      throw unrecoverable;
    });

    await expect(captured!(job(0))).rejects.toThrow(unrecoverable);

    expect(lastNonActive()![1]).toBe("failed");
  });

  // ── 3. attempt record + stale error ───────────────────────────────

  it("clears the previous attempt's error and records the attempt number", async () => {
    build(async () => "ok");

    await captured!(job(1));

    const [, , patch] = openingCall()!;
    // Explicit null, not omitted — omitted keeps the stale text.
    expect(patch?.error).toBeNull();
    // 1-based: attemptsMade 1 means this is attempt 2.
    expect(patch?.attempts).toBe(2);
  });

  it("records attempt 1 on a first run", async () => {
    build(async () => "ok");

    await captured!(job(0));

    expect(openingCall()![2]?.attempts).toBe(1);
  });

  it("still completes a successful job at progress 100", async () => {
    build(async () => ({ ok: true }));

    await captured!(job(0));

    const [, status, patch] = lastNonActive()!;
    expect(status).toBe("completed");
    expect(patch?.progress).toBe(100);
  });

  // ── 4. out-of-band death ──────────────────────────────────────────

  it("records a reason when the row is still non-terminal (the catch never ran)", async () => {
    build(async () => "ok");
    mockFindById.mockResolvedValue({ id: "job-1", status: "active" });

    await listeners.get("failed")!(job(0), new Error("stalled"));

    const call = lastNonActive();
    expect(call).toBeDefined();
    expect(String(call![2]?.error)).toMatch(/stalled/i);
  });

  it("records a stall-limit failure with its plain reason, not the out-of-band wrapper (#468)", async () => {
    // UnrecoverableError = BullMQ stall-limit exhaustion: the reason IS known
    // and specific. The handler used to wrap it into the self-contradictory
    // "Attempt ended without recording a reason (job stalled more than
    // allowable limit)". It must record the reason verbatim instead.
    build(async () => "ok");
    mockFindById.mockResolvedValue({ id: "job-1", status: "active" });
    const stalled = new UnrecoverableError(
      "job stalled more than allowable limit"
    );

    await listeners.get("failed")!(job(0), stalled);

    const patch = lastNonActive()![2];
    expect(patch?.error).toBe("job stalled more than allowable limit");
    expect(String(patch?.error)).not.toMatch(/without recording a reason/i);
  });

  it("writes nothing when the row is already terminal", async () => {
    // The handler fires for every failure, including ones the catch just
    // recorded. Without the guard it overwrites a specific error with a
    // vaguer one.
    build(async () => "ok");
    mockFindById.mockResolvedValue({ id: "job-1", status: "failed" });

    await listeners.get("failed")!(job(2), boom);

    expect(mockTransition).not.toHaveBeenCalled();
  });

  it("writes nothing when the row is already pending for a retry", async () => {
    // `pending` is the retry state this slice introduces — the catch DID run
    // and chose it deliberately, so the event handler must not stomp it.
    build(async () => "ok");
    mockFindById.mockResolvedValue({ id: "job-1", status: "pending" });

    await listeners.get("failed")!(job(0), boom);

    expect(mockTransition).not.toHaveBeenCalled();
  });

  it("survives a missing job row without throwing", async () => {
    build(async () => "ok");
    mockFindById.mockResolvedValue(undefined);

    await expect(listeners.get("failed")!(job(0), boom)).resolves.not.toThrow();
  });

  // ── 5. lost-execution recording (#464) ────────────────────────────
  //
  // A row still `active` at the top of a NEW execution means a prior execution
  // set it active and died without a terminal/pending transition — a BullMQ
  // stall re-delivery, which does not increment `attemptsMade` and fires no
  // `failed` event. The resuming execution is the only place this is knowable.

  it("increments lostExecutions when it resumes a still-active row", async () => {
    build(async () => "ok");
    mockFindById.mockResolvedValue({
      id: "job-1",
      status: "active",
      lostExecutions: 0,
    });

    await captured!(job(0));

    expect(openingCall()![2]?.lostExecutions).toBe(1);
  });

  it("carries a prior lostExecutions count forward", async () => {
    build(async () => "ok");
    mockFindById.mockResolvedValue({
      id: "job-1",
      status: "active",
      lostExecutions: 2,
    });

    await captured!(job(0));

    expect(openingCall()![2]?.lostExecutions).toBe(3);
  });

  it("does not increment for a fresh pending row", async () => {
    build(async () => "ok");
    mockFindById.mockResolvedValue({
      id: "job-1",
      status: "pending",
      lostExecutions: 0,
    });

    await captured!(job(0));

    expect(openingCall()![2]).not.toHaveProperty("lostExecutions");
  });

  it("does not increment when the row is not found", async () => {
    build(async () => "ok");
    mockFindById.mockResolvedValue(undefined);

    await captured!(job(0));

    expect(openingCall()![2]).not.toHaveProperty("lostExecutions");
  });

  it("fails open: a pre-read failure does not sink the execution", async () => {
    build(async () => "ok");
    mockFindById.mockRejectedValue(new Error("db unreachable"));

    // The execution still runs and the opening active transition still fires;
    // only the diagnostic increment is skipped.
    await expect(captured!(job(0))).resolves.toBe("ok");

    expect(openingCall()).toBeDefined();
    expect(openingCall()![2]).not.toHaveProperty("lostExecutions");
  });
});
