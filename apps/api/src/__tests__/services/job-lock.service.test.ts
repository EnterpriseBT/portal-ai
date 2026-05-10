import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockFindRunningForConnectorInstance =
  jest.fn<(...args: unknown[]) => Promise<unknown[]>>();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      jobs: {
        findRunningForConnectorInstance: mockFindRunningForConnectorInstance,
      },
    },
  },
}));

const { JobLockService } = await import("../../services/job-lock.service.js");
const { ApiCode } = await import(
  "../../constants/api-codes.constants.js"
);

function fakeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    type: "layout_plan_commit",
    status: "active",
    startedAt: 1_700_000_000_000,
    created: 1_700_000_000_000,
    organizationId: "org-1",
    progress: 0,
    metadata: { connectorInstanceId: "ci-1" },
    result: null,
    error: null,
    completedAt: null,
    bullJobId: null,
    attempts: 0,
    maxAttempts: 3,
    createdBy: "user-1",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    ...overrides,
  };
}

describe("JobLockService", () => {
  beforeEach(() => {
    mockFindRunningForConnectorInstance.mockReset();
  });

  describe("findRunningForConnectorInstance", () => {
    it("returns a trimmed RunningJobSummary[] from the repository rows", async () => {
      mockFindRunningForConnectorInstance.mockResolvedValue([
        fakeJob({ id: "job-a", type: "connector_sync", status: "active" }),
        fakeJob({ id: "job-b", type: "layout_plan_commit", status: "pending" }),
      ]);

      const out = await JobLockService.findRunningForConnectorInstance(
        "ci-1",
        "org-1"
      );

      expect(mockFindRunningForConnectorInstance).toHaveBeenCalledWith(
        "ci-1",
        "org-1"
      );
      expect(out).toEqual([
        {
          id: "job-a",
          type: "connector_sync",
          status: "active",
          startedAt: 1_700_000_000_000,
          created: 1_700_000_000_000,
        },
        {
          id: "job-b",
          type: "layout_plan_commit",
          status: "pending",
          startedAt: 1_700_000_000_000,
          created: 1_700_000_000_000,
        },
      ]);
      // Heavy job columns (`metadata`, `result`, audit fields) are
      // intentionally stripped — they can carry full layout plans /
      // upload payloads and shouldn't leak to the 409 details body
      // or the GET-running-jobs response.
      for (const summary of out) {
        expect(summary).not.toHaveProperty("metadata");
        expect(summary).not.toHaveProperty("result");
        expect(summary).not.toHaveProperty("organizationId");
      }
    });

    it("returns an empty array when no running jobs lock the instance", async () => {
      mockFindRunningForConnectorInstance.mockResolvedValue([]);
      const out = await JobLockService.findRunningForConnectorInstance(
        "ci-1",
        "org-1"
      );
      expect(out).toEqual([]);
    });
  });

  describe("assertConnectorInstanceUnlocked", () => {
    it("resolves silently when no jobs lock the instance", async () => {
      mockFindRunningForConnectorInstance.mockResolvedValue([]);
      await expect(
        JobLockService.assertConnectorInstanceUnlocked("ci-1", "org-1")
      ).resolves.toBeUndefined();
    });

    it("throws 409 ENTITY_LOCKED_BY_JOB with the runningJobs in details", async () => {
      mockFindRunningForConnectorInstance.mockResolvedValue([
        fakeJob({ id: "job-a", type: "layout_plan_commit", status: "active" }),
      ]);
      await expect(
        JobLockService.assertConnectorInstanceUnlocked("ci-1", "org-1")
      ).rejects.toMatchObject({
        status: 409,
        code: ApiCode.ENTITY_LOCKED_BY_JOB,
        details: {
          runningJobs: [
            expect.objectContaining({
              id: "job-a",
              type: "layout_plan_commit",
              status: "active",
            }),
          ],
        },
      });
    });
  });
});
