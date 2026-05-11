import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockFindRunningForConnectorInstance =
  jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
const mockConnectorEntitiesFindById =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockEntityRecordsFindById =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockFieldMappingsFindById =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      jobs: {
        findRunningForConnectorInstance: mockFindRunningForConnectorInstance,
      },
      connectorEntities: { findById: mockConnectorEntitiesFindById },
      entityRecords: { findById: mockEntityRecordsFindById },
      fieldMappings: { findById: mockFieldMappingsFindById },
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

  describe("assertConnectorEntityUnlocked", () => {
    beforeEach(() => {
      mockConnectorEntitiesFindById.mockReset();
    });

    it("walks entity → instance and throws when the instance is locked", async () => {
      mockConnectorEntitiesFindById.mockResolvedValue({
        id: "entity-1",
        connectorInstanceId: "ci-1",
      });
      mockFindRunningForConnectorInstance.mockResolvedValue([fakeJob()]);

      await expect(
        JobLockService.assertConnectorEntityUnlocked("entity-1", "org-1")
      ).rejects.toMatchObject({
        status: 409,
        code: ApiCode.ENTITY_LOCKED_BY_JOB,
      });
      expect(mockConnectorEntitiesFindById).toHaveBeenCalledWith("entity-1");
      expect(mockFindRunningForConnectorInstance).toHaveBeenCalledWith(
        "ci-1",
        "org-1"
      );
    });

    it("no-ops when the entity doesn't exist — caller's own 404 fires", async () => {
      mockConnectorEntitiesFindById.mockResolvedValue(undefined);
      await expect(
        JobLockService.assertConnectorEntityUnlocked("missing", "org-1")
      ).resolves.toBeUndefined();
      expect(mockFindRunningForConnectorInstance).not.toHaveBeenCalled();
    });
  });

  describe("assertEntityRecordUnlocked", () => {
    beforeEach(() => {
      mockEntityRecordsFindById.mockReset();
      mockConnectorEntitiesFindById.mockReset();
    });

    it("walks record → entity → instance and throws when locked", async () => {
      mockEntityRecordsFindById.mockResolvedValue({
        id: "rec-1",
        connectorEntityId: "entity-1",
      });
      mockConnectorEntitiesFindById.mockResolvedValue({
        id: "entity-1",
        connectorInstanceId: "ci-1",
      });
      mockFindRunningForConnectorInstance.mockResolvedValue([fakeJob()]);

      await expect(
        JobLockService.assertEntityRecordUnlocked("rec-1", "org-1")
      ).rejects.toMatchObject({
        status: 409,
        code: ApiCode.ENTITY_LOCKED_BY_JOB,
      });
    });

    it("no-ops when the record doesn't exist", async () => {
      mockEntityRecordsFindById.mockResolvedValue(undefined);
      await expect(
        JobLockService.assertEntityRecordUnlocked("missing", "org-1")
      ).resolves.toBeUndefined();
      expect(mockConnectorEntitiesFindById).not.toHaveBeenCalled();
    });
  });

  describe("assertFieldMappingUnlocked", () => {
    beforeEach(() => {
      mockFieldMappingsFindById.mockReset();
      mockConnectorEntitiesFindById.mockReset();
    });

    it("walks mapping → entity → instance and throws when locked", async () => {
      mockFieldMappingsFindById.mockResolvedValue({
        id: "fm-1",
        connectorEntityId: "entity-1",
      });
      mockConnectorEntitiesFindById.mockResolvedValue({
        id: "entity-1",
        connectorInstanceId: "ci-1",
      });
      mockFindRunningForConnectorInstance.mockResolvedValue([fakeJob()]);

      await expect(
        JobLockService.assertFieldMappingUnlocked("fm-1", "org-1")
      ).rejects.toMatchObject({
        status: 409,
        code: ApiCode.ENTITY_LOCKED_BY_JOB,
      });
    });

    it("no-ops when the mapping doesn't exist", async () => {
      mockFieldMappingsFindById.mockResolvedValue(undefined);
      await expect(
        JobLockService.assertFieldMappingUnlocked("missing", "org-1")
      ).resolves.toBeUndefined();
      expect(mockConnectorEntitiesFindById).not.toHaveBeenCalled();
    });
  });
});
