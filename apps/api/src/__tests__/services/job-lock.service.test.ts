import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockFindRunningForConnectorInstance =
  jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
const mockFindRunningByTargetEntityIds =
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
        findRunningByTargetEntityIds: mockFindRunningByTargetEntityIds,
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
      mockFindRunningByTargetEntityIds.mockReset();
      // Default: no bulk_transform locks. Individual tests that
      // exercise the entity-level lock override this.
      mockFindRunningByTargetEntityIds.mockResolvedValue([]);
    });

    it("walks entity → instance and throws when the instance is locked", async () => {
      mockConnectorEntitiesFindById.mockImplementation(async (id) => ({
        id,
        connectorInstanceId: "ci-1",
      }));
      mockFindRunningForConnectorInstance.mockResolvedValue([fakeJob()]);

      await expect(
        JobLockService.assertConnectorEntityUnlocked(["entity-1"], "org-1")
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

    it("no-ops when no entities in the input exist — caller's own 404 fires", async () => {
      mockConnectorEntitiesFindById.mockResolvedValue(undefined);
      await expect(
        JobLockService.assertConnectorEntityUnlocked(["missing"], "org-1")
      ).resolves.toBeUndefined();
      expect(mockFindRunningForConnectorInstance).not.toHaveBeenCalled();
      expect(mockFindRunningByTargetEntityIds).not.toHaveBeenCalled();
    });

    it("no-ops on empty input", async () => {
      await expect(
        JobLockService.assertConnectorEntityUnlocked([], "org-1")
      ).resolves.toBeUndefined();
      expect(mockConnectorEntitiesFindById).not.toHaveBeenCalled();
      expect(mockFindRunningByTargetEntityIds).not.toHaveBeenCalled();
    });

    // Case 3.1 (#99) — no locks anywhere across the input array.
    it("resolves when neither instance nor entity-level locks fire across the array", async () => {
      mockConnectorEntitiesFindById.mockImplementation(async (id) => ({
        id,
        connectorInstanceId: "ci-1",
      }));
      mockFindRunningForConnectorInstance.mockResolvedValue([]);
      mockFindRunningByTargetEntityIds.mockResolvedValue([]);

      await expect(
        JobLockService.assertConnectorEntityUnlocked(
          ["entity-a", "entity-b"],
          "org-1"
        )
      ).resolves.toBeUndefined();
      // Layer 1 visits each unique instance — in this case both ids
      // share `ci-1`, so one call.
      expect(mockFindRunningForConnectorInstance).toHaveBeenCalledTimes(1);
      // Layer 2 fires a single array-overlap query.
      expect(mockFindRunningByTargetEntityIds).toHaveBeenCalledWith(
        ["entity-a", "entity-b"],
        "org-1"
      );
    });

    // Case 3.2 (#99) — one of the requested entities is locked. The
    // 409 details carry both the locking job AND the specific entity
    // (`entity-b`) that's blocked.
    it("throws BULK_JOB_TARGET_LOCKED naming the single blocked entity when only one of the inputs is locked", async () => {
      mockConnectorEntitiesFindById.mockImplementation(async (id) => ({
        id,
        connectorInstanceId: "ci-1",
      }));
      mockFindRunningForConnectorInstance.mockResolvedValue([]);
      mockFindRunningByTargetEntityIds.mockResolvedValue([
        fakeJob({
          id: "job-bulk-b",
          type: "bulk_transform",
          metadata: { targetConnectorEntityIds: ["entity-b"] },
        }),
      ]);

      try {
        await JobLockService.assertConnectorEntityUnlocked(
          ["entity-a", "entity-b"],
          "org-1"
        );
        throw new Error("expected throw");
      } catch (err) {
        const e = err as {
          code?: string;
          message?: string;
          details?: {
            lockingJobs?: Array<{ id: string }>;
            blockedEntities?: string[];
          };
        };
        expect(e.code).toBe(ApiCode.BULK_JOB_TARGET_LOCKED);
        expect(e.details?.blockedEntities).toEqual(["entity-b"]);
        expect(e.details?.lockingJobs?.map((j) => j.id)).toEqual([
          "job-bulk-b",
        ]);
        expect(e.message).toContain("entity-b");
      }
    });

    // Case 3.3 (#99) — both inputs are locked, by two different jobs.
    // Details enumerate both blocked entities + both locking jobs.
    it("throws BULK_JOB_TARGET_LOCKED enumerating every blocked entity + job when multiple are locked", async () => {
      mockConnectorEntitiesFindById.mockImplementation(async (id) => ({
        id,
        connectorInstanceId: "ci-1",
      }));
      mockFindRunningForConnectorInstance.mockResolvedValue([]);
      mockFindRunningByTargetEntityIds.mockResolvedValue([
        fakeJob({
          id: "job-bulk-a",
          type: "bulk_transform",
          metadata: { targetConnectorEntityIds: ["entity-a"] },
        }),
        fakeJob({
          id: "job-bulk-b",
          type: "bulk_transform",
          metadata: { targetConnectorEntityIds: ["entity-b"] },
        }),
      ]);

      try {
        await JobLockService.assertConnectorEntityUnlocked(
          ["entity-a", "entity-b"],
          "org-1"
        );
        throw new Error("expected throw");
      } catch (err) {
        const e = err as {
          code?: string;
          message?: string;
          details?: {
            lockingJobs?: Array<{ id: string }>;
            blockedEntities?: string[];
          };
        };
        expect(e.code).toBe(ApiCode.BULK_JOB_TARGET_LOCKED);
        expect(e.details?.blockedEntities).toEqual(["entity-a", "entity-b"]);
        expect(e.details?.lockingJobs?.map((j) => j.id).sort()).toEqual([
          "job-bulk-a",
          "job-bulk-b",
        ]);
        expect(e.message).toContain("entity-a");
        expect(e.message).toContain("entity-b");
      }
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
