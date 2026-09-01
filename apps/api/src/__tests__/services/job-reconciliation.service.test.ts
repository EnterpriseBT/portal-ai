/**
 * The stranded-job sweep (#391 slice 2).
 *
 * The predicate is a conjunction — BullMQ absence AND heartbeat staleness —
 * and the fail-open rules are the risky part: absence must be POSITIVELY
 * observed (a getJob throw skips, never reaps), and a lost conditional write
 * counts as skipped, never as reaped. These cases pin that arithmetic.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFindStrandedCandidates =
  jest.fn<(...a: unknown[]) => Promise<unknown[]>>();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      jobs: { findStrandedCandidates: mockFindStrandedCandidates },
    },
  },
}));

const mockGetJob = jest.fn<(...a: unknown[]) => Promise<unknown>>();

jest.unstable_mockModule("../../queues/jobs.queue.js", () => ({
  getJobsQueue: () => ({ getJob: mockGetJob }),
}));

const mockTransitionIfNonTerminal =
  jest.fn<(...a: unknown[]) => Promise<boolean>>();

jest.unstable_mockModule("../../services/job-events.service.js", () => ({
  JobEventsService: { transitionIfNonTerminal: mockTransitionIfNonTerminal },
}));

jest.unstable_mockModule("../../environment.js", () => ({
  environment: { LOG_LEVEL: "silent", JOB_STRANDED_THRESHOLD_MS: 900_000 },
}));

const { JobReconciliationService, STRANDED_JOB_REASON } =
  await import("../../services/job-reconciliation.service.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const row = (over: Record<string, unknown> = {}) => ({
  id: `job-${Math.random().toString(36).slice(2, 8)}`,
  type: "connector_sync",
  status: "active",
  organizationId: "org-1",
  bullJobId: "bull-1",
  ...over,
});

beforeEach(() => {
  mockFindStrandedCandidates.mockReset().mockResolvedValue([]);
  mockGetJob.mockReset();
  mockTransitionIfNonTerminal.mockReset().mockResolvedValue(true);
});

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

describe("JobReconciliationService.sweepStrandedJobs (#391)", () => {
  it("reaps a candidate whose BullMQ entry is gone, with the fixed reason", async () => {
    const dead = row();
    mockFindStrandedCandidates.mockResolvedValue([dead]);
    mockGetJob.mockResolvedValue(undefined);

    const summary = await JobReconciliationService.sweepStrandedJobs();

    expect(mockTransitionIfNonTerminal).toHaveBeenCalledWith(
      dead.id,
      "failed",
      { error: STRANDED_JOB_REASON }
    );
    expect(summary).toEqual({ scanned: 1, reaped: 1, skipped: 0 });
  });

  it("reaps a candidate that never recorded a bullJobId", async () => {
    // Past the staleness threshold, a null bullJobId means the process died
    // in the milliseconds between insert and enqueue.
    mockFindStrandedCandidates.mockResolvedValue([row({ bullJobId: null })]);

    const summary = await JobReconciliationService.sweepStrandedJobs();

    expect(mockGetJob).not.toHaveBeenCalled();
    expect(summary.reaped).toBe(1);
  });

  it("does not reap a candidate whose BullMQ entry still exists", async () => {
    // Stale-but-present = a legitimately long-running job (possibly a
    // non-heartbeating type). Existence is the veto.
    mockFindStrandedCandidates.mockResolvedValue([row()]);
    mockGetJob.mockResolvedValue({ id: "bull-1" });

    const summary = await JobReconciliationService.sweepStrandedJobs();

    expect(mockTransitionIfNonTerminal).not.toHaveBeenCalled();
    expect(summary).toEqual({ scanned: 1, reaped: 0, skipped: 0 });
  });

  it("skips (never reaps) a candidate when the queue check throws", async () => {
    // Absence must be positively observed — an unreachable Redis is not
    // evidence the job is gone; it may be mid-flap.
    mockFindStrandedCandidates.mockResolvedValue([row()]);
    mockGetJob.mockRejectedValue(new Error("connection refused"));

    const summary = await JobReconciliationService.sweepStrandedJobs();

    expect(mockTransitionIfNonTerminal).not.toHaveBeenCalled();
    expect(summary).toEqual({ scanned: 1, reaped: 0, skipped: 1 });
  });

  it("counts a lost conditional write as skipped", async () => {
    // Someone else (a cancel, another instance's sweep, a zombie finish)
    // reached terminal first — that is convergence, not a reap.
    mockFindStrandedCandidates.mockResolvedValue([row()]);
    mockGetJob.mockResolvedValue(undefined);
    mockTransitionIfNonTerminal.mockResolvedValue(false);

    const summary = await JobReconciliationService.sweepStrandedJobs();

    expect(summary).toEqual({ scanned: 1, reaped: 0, skipped: 1 });
  });

  it("passes the staleness cutoff and the per-pass cap to the finder", async () => {
    const before = Date.now();
    await JobReconciliationService.sweepStrandedJobs();
    const after = Date.now();

    const [olderThan, limit] = mockFindStrandedCandidates.mock.calls[0] as [
      number,
      number,
    ];
    expect(olderThan).toBeGreaterThanOrEqual(before - 900_000);
    expect(olderThan).toBeLessThanOrEqual(after - 900_000);
    expect(limit).toBe(JobReconciliationService.MAX_REAP_PER_PASS);
  });

  it("sums mixed outcomes correctly", async () => {
    mockFindStrandedCandidates.mockResolvedValue([
      row({ id: "gone" }),
      row({ id: "alive" }),
      row({ id: "flaky" }),
      row({ id: "raced" }),
    ]);
    mockGetJob.mockImplementation(async (bullId: unknown) => {
      void bullId;
      const call = mockGetJob.mock.calls.length;
      if (call === 1) return undefined; // gone → reap
      if (call === 2) return { id: "x" }; // alive → leave
      if (call === 3) throw new Error("flap"); // flaky → skip
      return undefined; // raced → conditional write loses below
    });
    mockTransitionIfNonTerminal
      .mockResolvedValueOnce(true) // gone
      .mockResolvedValueOnce(false); // raced

    const summary = await JobReconciliationService.sweepStrandedJobs();

    expect(summary).toEqual({ scanned: 4, reaped: 1, skipped: 2 });
  });
});
