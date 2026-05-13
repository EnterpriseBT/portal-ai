import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Job as BullJob } from "bullmq";

const mockRunCommitDraft =
  jest.fn<
    (metadata: unknown, onProgress?: (p: number) => void) => Promise<unknown>
  >();
const mockRunRecommit = jest.fn<
  (metadata: unknown, onProgress?: (p: number) => void) => Promise<unknown>
>();
const mockRollbackFailedDraftCommit = jest.fn<
  (metadata: unknown, reason: string) => Promise<void>
>();

jest.unstable_mockModule(
  "../../../services/layout-plan-draft.service.js",
  () => ({
    LayoutPlanDraftService: {
      runCommitDraft: mockRunCommitDraft,
      runRecommit: mockRunRecommit,
      rollbackFailedDraftCommit: mockRollbackFailedDraftCommit,
    },
  })
);

const { layoutPlanCommitProcessor } = await import(
  "../../../queues/processors/layout-plan-commit.processor.js"
);

function makeBullJob(
  data: Record<string, unknown>,
  opts: { attemptsMade?: number; attempts?: number } = {}
): BullJob {
  return {
    data: { jobId: "job-1", type: "layout_plan_commit", ...data },
    attemptsMade: opts.attemptsMade ?? 0,
    opts: { attempts: opts.attempts ?? 3 },
  } as unknown as BullJob;
}

const draftMetadata = {
  kind: "draft" as const,
  organizationId: "org-1",
  userId: "user-1",
  connectorInstanceId: "ci-1",
  planId: "plan-1",
  connectorDefinitionId: "cd-1",
  name: "My Connector",
  isExistingInstance: false,
  plan: { planVersion: "1.0.0" },
  workbookSource: {
    kind: "uploadSession" as const,
    uploadSessionId: "sess-1",
  },
};

const recommitMetadata = {
  kind: "recommit" as const,
  organizationId: "org-1",
  userId: "user-1",
  connectorInstanceId: "ci-1",
  planId: "plan-1",
  workbookSource: {
    kind: "connectorInstance" as const,
    connectorInstanceId: "ci-1",
  },
};

const sampleResult = {
  connectorInstanceId: "ci-1",
  planId: "plan-1",
  connectorEntityIds: ["entity-1"],
  recordCounts: { created: 10, updated: 0, unchanged: 0, invalid: 0 },
};

describe("layoutPlanCommitProcessor", () => {
  beforeEach(() => {
    mockRunCommitDraft.mockReset();
    mockRunRecommit.mockReset();
    mockRollbackFailedDraftCommit.mockReset();
    mockRollbackFailedDraftCommit.mockResolvedValue(undefined);
  });

  it("dispatches draft kind to runCommitDraft and returns its result", async () => {
    mockRunCommitDraft.mockResolvedValue(sampleResult);

    const out = await layoutPlanCommitProcessor(
      makeBullJob(draftMetadata) as never
    );

    expect(mockRunCommitDraft).toHaveBeenCalledTimes(1);
    expect(mockRunCommitDraft).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "draft", planId: "plan-1" }),
      expect.any(Function)
    );
    expect(mockRunRecommit).not.toHaveBeenCalled();
    expect(out).toBe(sampleResult);
  });

  it("dispatches recommit kind to runRecommit and returns its result", async () => {
    mockRunRecommit.mockResolvedValue(sampleResult);

    const out = await layoutPlanCommitProcessor(
      makeBullJob(recommitMetadata) as never
    );

    expect(mockRunRecommit).toHaveBeenCalledTimes(1);
    expect(mockRunRecommit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "recommit", planId: "plan-1" }),
      expect.any(Function)
    );
    expect(mockRunCommitDraft).not.toHaveBeenCalled();
    expect(out).toBe(sampleResult);
  });

  it("forwards the onProgress callback to bullJob.updateProgress", async () => {
    mockRunCommitDraft.mockImplementation(
      async (_metadata: unknown, onProgress: unknown) => {
        (onProgress as (n: number) => void)(42);
        (onProgress as (n: number) => void)(85);
        return sampleResult;
      }
    );

    const updateProgress = jest.fn<(p: number) => Promise<void>>();
    const bullJob = {
      data: { jobId: "job-1", type: "layout_plan_commit", ...draftMetadata },
      updateProgress,
    };
    await layoutPlanCommitProcessor(bullJob as never);

    expect(updateProgress).toHaveBeenCalledTimes(2);
    expect(updateProgress).toHaveBeenNthCalledWith(1, 42);
    expect(updateProgress).toHaveBeenNthCalledWith(2, 85);
  });

  it("propagates errors so the worker can mark the job failed", async () => {
    mockRunCommitDraft.mockRejectedValue(
      new Error("Connector definition not found")
    );

    await expect(
      layoutPlanCommitProcessor(makeBullJob(draftMetadata) as never)
    ).rejects.toThrow("Connector definition not found");
  });

  // Phase 3 follow-up: the runCommitDraft rollback used to fire on every
  // per-attempt failure and hard-deleted the plan row, turning a transient
  // first-attempt failure into a deterministic LAYOUT_PLAN_NOT_FOUND for
  // every retry. The processor now defers the cleanup to the final attempt.

  it("does NOT run the draft rollback on non-final retry attempts", async () => {
    mockRunCommitDraft.mockRejectedValue(new Error("transient failure"));

    // attemptsMade=0, attempts=3 → 0 < 2 → not final.
    await expect(
      layoutPlanCommitProcessor(
        makeBullJob(draftMetadata, { attemptsMade: 0, attempts: 3 }) as never
      )
    ).rejects.toThrow("transient failure");
    expect(mockRollbackFailedDraftCommit).not.toHaveBeenCalled();

    // attemptsMade=1, attempts=3 → 1 < 2 → still not final.
    await expect(
      layoutPlanCommitProcessor(
        makeBullJob(draftMetadata, { attemptsMade: 1, attempts: 3 }) as never
      )
    ).rejects.toThrow("transient failure");
    expect(mockRollbackFailedDraftCommit).not.toHaveBeenCalled();
  });

  it("runs the draft rollback once on the final attempt failure", async () => {
    mockRunCommitDraft.mockRejectedValue(new Error("permanent failure"));

    await expect(
      layoutPlanCommitProcessor(
        makeBullJob(draftMetadata, { attemptsMade: 2, attempts: 3 }) as never
      )
    ).rejects.toThrow("permanent failure");
    expect(mockRollbackFailedDraftCommit).toHaveBeenCalledTimes(1);
    expect(mockRollbackFailedDraftCommit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "draft", planId: "plan-1" }),
      "permanent failure"
    );
  });

  it("does NOT run the rollback for recommit failures (no orphan rows to clean)", async () => {
    mockRunRecommit.mockRejectedValue(new Error("recommit failed"));

    await expect(
      layoutPlanCommitProcessor(
        makeBullJob(recommitMetadata, { attemptsMade: 2, attempts: 3 }) as never
      )
    ).rejects.toThrow("recommit failed");
    expect(mockRollbackFailedDraftCommit).not.toHaveBeenCalled();
  });

  it("re-throws the original error even when the rollback itself fails", async () => {
    mockRunCommitDraft.mockRejectedValue(new Error("commit failed"));
    mockRollbackFailedDraftCommit.mockRejectedValue(new Error("delete failed"));

    await expect(
      layoutPlanCommitProcessor(
        makeBullJob(draftMetadata, { attemptsMade: 2, attempts: 3 }) as never
      )
    ).rejects.toThrow("commit failed");
    expect(mockRollbackFailedDraftCommit).toHaveBeenCalledTimes(1);
  });
});
