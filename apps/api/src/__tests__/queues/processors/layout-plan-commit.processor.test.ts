import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Job as BullJob } from "bullmq";

const mockRunCommitDraft =
  jest.fn<(metadata: unknown) => Promise<unknown>>();
const mockRunRecommit = jest.fn<(metadata: unknown) => Promise<unknown>>();

jest.unstable_mockModule(
  "../../../services/layout-plan-draft.service.js",
  () => ({
    LayoutPlanDraftService: {
      runCommitDraft: mockRunCommitDraft,
      runRecommit: mockRunRecommit,
    },
  })
);

const { layoutPlanCommitProcessor } = await import(
  "../../../queues/processors/layout-plan-commit.processor.js"
);

function makeBullJob(data: Record<string, unknown>): BullJob {
  return {
    data: { jobId: "job-1", type: "layout_plan_commit", ...data },
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
  });

  it("dispatches draft kind to runCommitDraft and returns its result", async () => {
    mockRunCommitDraft.mockResolvedValue(sampleResult);

    const out = await layoutPlanCommitProcessor(
      makeBullJob(draftMetadata) as never
    );

    expect(mockRunCommitDraft).toHaveBeenCalledTimes(1);
    expect(mockRunCommitDraft).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "draft", planId: "plan-1" })
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
      expect.objectContaining({ kind: "recommit", planId: "plan-1" })
    );
    expect(mockRunCommitDraft).not.toHaveBeenCalled();
    expect(out).toBe(sampleResult);
  });

  it("propagates errors so the worker can mark the job failed", async () => {
    mockRunCommitDraft.mockRejectedValue(
      new Error("Connector definition not found")
    );

    await expect(
      layoutPlanCommitProcessor(makeBullJob(draftMetadata) as never)
    ).rejects.toThrow("Connector definition not found");
  });
});
