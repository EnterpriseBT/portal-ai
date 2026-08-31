/**
 * layout_plan_commit under the sync ownership lock (#461).
 *
 * Both commit kinds reap by watermark, so a BullMQ stall re-delivery — a
 * second pass of one job while the first still writes — carries #460's
 * data-loss mechanism. The processor answers it by WAITING on the instance
 * lock (a user is blocked in a live wizard; a delayed commit beats a skipped
 * one), then echoing the persisted result when the other pass already
 * finished, instead of re-running the commit or reporting a false result.
 *
 * The rollback interaction carries the sharpest edge: a lock-wait timeout
 * means another execution still HOLDS the lock and is writing the very rows
 * the final-attempt draft rollback would hard-delete. These cases pin that a
 * timeout never cleans up, while a genuine commit failure still does.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Job as BullJob } from "bullmq";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRunCommitDraft = jest.fn<(...a: unknown[]) => Promise<unknown>>();
const mockRunRecommit = jest.fn<(...a: unknown[]) => Promise<unknown>>();
const mockRollback = jest
  .fn<(...a: unknown[]) => Promise<void>>()
  .mockResolvedValue(undefined);

jest.unstable_mockModule(
  "../../../services/layout-plan-draft.service.js",
  () => ({
    LayoutPlanDraftService: {
      runCommitDraft: mockRunCommitDraft,
      runRecommit: mockRunRecommit,
      rollbackFailedDraftCommit: mockRollback,
    },
  })
);

// Mirrors the real class shape so the processor's `instanceof` check works
// against what the mocked module exports.
class MockSyncLockWaitTimeoutError extends Error {
  constructor(timeoutMs: number, connectorInstanceId: string) {
    super(
      `Timed out after ${timeoutMs}ms waiting for the sync lock on connector instance ${connectorInstanceId}`
    );
    this.name = "SyncLockWaitTimeoutError";
  }
}

const mockWithInstanceLockWait =
  jest.fn<
    (
      id: string,
      fn: () => Promise<unknown>,
      opts: { timeoutMs: number }
    ) => Promise<unknown>
  >();

jest.unstable_mockModule("../../../services/sync-lock.service.js", () => ({
  SyncLockService: { withInstanceLockWait: mockWithInstanceLockWait },
  SyncLockWaitTimeoutError: MockSyncLockWaitTimeoutError,
}));

const mockJobsFindById = jest.fn<(...a: unknown[]) => Promise<unknown>>();

jest.unstable_mockModule("../../../services/db.service.js", () => ({
  DbService: {
    repository: {
      jobs: { findById: mockJobsFindById },
    },
  },
}));

jest.unstable_mockModule("../../../environment.js", () => ({
  environment: { LOG_LEVEL: "silent", LAYOUT_PLAN_COMMIT_LOCK_WAIT_MS: 12345 },
}));

const { layoutPlanCommitProcessor } =
  await import("../../../queues/processors/layout-plan-commit.processor.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RECOMMIT_METADATA = {
  jobId: "job-461",
  type: "layout_plan_commit",
  kind: "recommit",
  organizationId: "org-1",
  userId: "user-1",
  connectorInstanceId: "ci-461",
  planId: "plan-461",
  workbookSource: { kind: "connectorInstance", connectorInstanceId: "ci-461" },
};

const DRAFT_METADATA = {
  ...RECOMMIT_METADATA,
  kind: "draft",
  connectorDefinitionId: "cd-1",
  name: "Imported sheet",
  isExistingInstance: false,
  plan: {},
  workbookSource: { kind: "uploadSession", uploadSessionId: "us-1" },
};

const COMMIT_RESULT = {
  connectorInstanceId: "ci-461",
  planId: "plan-461",
  connectorEntityIds: ["ce-1", "ce-2"],
  recordCounts: { created: 10, updated: 0, unchanged: 0, invalid: 0 },
};

function createMockBullJob(
  data: Record<string, unknown>,
  opts: { attemptsMade?: number; attempts?: number } = {}
): BullJob {
  return {
    data,
    attemptsMade: opts.attemptsMade ?? 0,
    opts: { attempts: opts.attempts ?? 3 },
    updateProgress: jest.fn(),
  } as unknown as BullJob;
}

/** Lock acquires immediately: run fn straight through. */
const lockFree = () => {
  mockWithInstanceLockWait.mockImplementation((_id, fn) => fn());
};

beforeEach(() => {
  mockRunCommitDraft.mockReset();
  mockRunRecommit.mockReset();
  mockRollback.mockReset().mockResolvedValue(undefined);
  mockWithInstanceLockWait.mockReset();
  mockJobsFindById.mockReset().mockResolvedValue({
    id: "job-461",
    status: "active",
    result: null,
  });
});

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

describe("layoutPlanCommitProcessor under the sync lock (#461)", () => {
  it("runs the commit inside the instance lock, keyed and budgeted correctly", async () => {
    lockFree();
    mockRunRecommit.mockResolvedValue(COMMIT_RESULT);

    const result = await layoutPlanCommitProcessor(
      createMockBullJob(RECOMMIT_METADATA)
    );

    expect(result).toEqual(COMMIT_RESULT);
    expect(mockRunRecommit).toHaveBeenCalledTimes(1);
    const [key, , opts] = mockWithInstanceLockWait.mock.calls[0];
    expect(key).toBe("ci-461");
    expect(opts).toEqual({ timeoutMs: 12345 });
  });

  it("keeps the lock for a draft minting a fresh instance", async () => {
    // `isExistingInstance: false` means no OTHER job can contend — but the
    // stall-re-delivered second pass of THIS job is exactly the contender
    // being locked out. Dropping the lock here would reopen #460 for the
    // one case the ticket exists for.
    lockFree();
    mockRunCommitDraft.mockResolvedValue(COMMIT_RESULT);

    await layoutPlanCommitProcessor(createMockBullJob(DRAFT_METADATA));

    expect(mockWithInstanceLockWait).toHaveBeenCalledTimes(1);
    expect(mockRunCommitDraft).toHaveBeenCalledTimes(1);
  });

  it("echoes the persisted result when the other pass already completed — without re-running the commit", async () => {
    lockFree();
    mockJobsFindById.mockResolvedValue({
      id: "job-461",
      status: "completed",
      result: COMMIT_RESULT,
    });

    const result = await layoutPlanCommitProcessor(
      createMockBullJob(RECOMMIT_METADATA)
    );

    // Re-running would re-import and re-reap work that already succeeded;
    // the worker re-persists an identical payload, so nothing is overwritten.
    expect(result).toEqual(COMMIT_RESULT);
    expect(mockRunRecommit).not.toHaveBeenCalled();
    expect(mockRunCommitDraft).not.toHaveBeenCalled();
    expect(mockRollback).not.toHaveBeenCalled();
  });

  it("runs the commit when the row is still `active` — the holder died without transitioning (#464)", async () => {
    lockFree();
    mockJobsFindById.mockResolvedValue({
      id: "job-461",
      status: "active",
      result: null,
    });
    mockRunRecommit.mockResolvedValue(COMMIT_RESULT);

    const result = await layoutPlanCommitProcessor(
      createMockBullJob(RECOMMIT_METADATA)
    );

    expect(result).toEqual(COMMIT_RESULT);
    expect(mockRunRecommit).toHaveBeenCalledTimes(1);
  });

  it("never rolls back a draft on a lock-wait timeout, even on the final attempt", async () => {
    const timeout = new MockSyncLockWaitTimeoutError(12345, "ci-461");
    mockWithInstanceLockWait.mockRejectedValue(timeout);

    await expect(
      layoutPlanCommitProcessor(
        createMockBullJob(DRAFT_METADATA, { attemptsMade: 2, attempts: 3 })
      )
    ).rejects.toThrow(timeout);

    // The holder of the lock is alive and writing the very plan/instance
    // rows the rollback hard-deletes. "Never owned the work" must not run
    // the failure cleanup.
    expect(mockRollback).not.toHaveBeenCalled();
  });

  it("still rolls back a draft on a genuine final-attempt commit failure", async () => {
    lockFree();
    const boom = new Error("write pipeline blew up");
    mockRunCommitDraft.mockRejectedValue(boom);

    await expect(
      layoutPlanCommitProcessor(
        createMockBullJob(DRAFT_METADATA, { attemptsMade: 2, attempts: 3 })
      )
    ).rejects.toThrow(boom);

    expect(mockRollback).toHaveBeenCalledTimes(1);
  });

  it("does not roll back a non-final failed attempt (pre-existing semantics)", async () => {
    lockFree();
    mockRunCommitDraft.mockRejectedValue(new Error("transient"));

    await expect(
      layoutPlanCommitProcessor(
        createMockBullJob(DRAFT_METADATA, { attemptsMade: 0, attempts: 3 })
      )
    ).rejects.toThrow("transient");

    expect(mockRollback).not.toHaveBeenCalled();
  });
});
