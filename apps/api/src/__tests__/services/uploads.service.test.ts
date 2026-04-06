import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import type { ConfirmRequestBody } from "@portalai/core/contracts";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockJobsFindById = jest.fn<(id: string) => Promise<unknown>>();
const mockJobsUpdate = jest.fn<(id: string, data: unknown) => Promise<unknown>>();

const mockConnectorInstancesFindByOrgDefinitionAndName = jest.fn<() => Promise<unknown>>();
const mockConnectorInstancesCreate = jest.fn<(data: unknown, tx?: unknown) => Promise<unknown>>();
const mockConnectorInstancesUpdate = jest.fn<(id: string, data: unknown, tx?: unknown) => Promise<unknown>>();

const mockConnectorEntitiesUpsertByKey = jest.fn<(data: unknown, tx?: unknown) => Promise<unknown>>();

const mockColumnDefinitionsFindById = jest.fn<(id: string, tx?: unknown) => Promise<unknown>>();
const mockColumnDefinitionsFindByKey = jest.fn<(orgId: string, key: string, tx?: unknown) => Promise<unknown>>();
const mockColumnDefinitionsUpsertByKey = jest.fn<(data: unknown, tx?: unknown) => Promise<unknown>>();

const mockFieldMappingsUpsertByEntityAndColumn = jest.fn<(data: unknown, tx?: unknown) => Promise<unknown>>();

const mockTransition = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockPublishCustomEvent = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      jobs: {
        findById: mockJobsFindById,
        update: mockJobsUpdate,
      },
      connectorDefinitions: {
        findById: jest.fn<() => Promise<unknown>>().mockResolvedValue({ capabilityFlags: { sync: false, query: false, write: true } }),
      },
      connectorInstances: {
        findByOrgDefinitionAndName: mockConnectorInstancesFindByOrgDefinitionAndName,
        create: mockConnectorInstancesCreate,
        update: mockConnectorInstancesUpdate,
      },
      connectorEntities: {
        upsertByKey: mockConnectorEntitiesUpsertByKey,
      },
      columnDefinitions: {
        findById: mockColumnDefinitionsFindById,
        findByKey: mockColumnDefinitionsFindByKey,
        upsertByKey: mockColumnDefinitionsUpsertByKey,
      },
      fieldMappings: {
        upsertByEntityAndColumn: mockFieldMappingsUpsertByEntityAndColumn,
      },
    },
    transaction: jest.fn<(fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>>()
      .mockImplementation(async (fn) => fn("mock-tx")),
  },
}));

jest.unstable_mockModule("../../services/job-events.service.js", () => ({
  JobEventsService: {
    transition: mockTransition,
    publishCustomEvent: mockPublishCustomEvent,
  },
}));

const mockImportFromS3 = jest.fn<() => Promise<{ created: number; updated: number; unchanged: number; invalid: number }>>()
  .mockResolvedValue({ created: 10, updated: 0, unchanged: 0, invalid: 0 });

jest.unstable_mockModule("../../services/csv-import.service.js", () => ({
  CsvImportService: {
    importFromS3: mockImportFromS3,
  },
}));

const { UploadsService } = await import("../../services/uploads.service.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const JOB_ID = "job-001";
const ORG_ID = "org-001";
const USER_ID = "user-001";

function createAwaitingJob(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: JOB_ID,
    organizationId: ORG_ID,
    type: "file_upload",
    status: "awaiting_confirmation",
    progress: 80,
    metadata: {
      files: [{ originalName: "contacts.csv", s3Key: "uploads/org-001/job-001/contacts.csv", sizeBytes: 1024 }],
      organizationId: ORG_ID,
      connectorDefinitionId: "cdef_csv01",
    },
    result: {
      parseResults: [],
      recommendations: { connectorInstanceName: "My CSV", entities: [] },
    },
    error: null,
    startedAt: Date.now(),
    completedAt: null,
    bullJobId: "bull-1",
    attempts: 1,
    maxAttempts: 3,
    ...overrides,
  };
}

function createConfirmBody(overrides?: Partial<ConfirmRequestBody>): ConfirmRequestBody {
  return {
    connectorInstanceName: "My CSV Import",
    entities: [
      {
        entityKey: "contacts",
        entityLabel: "Contacts",
        sourceFileName: "contacts.csv",
        columns: [
          {
            sourceField: "Name",
            key: "name",
            label: "Name",
            type: "string",
            format: null,
            isPrimaryKey: false,
            required: true,
            action: "create_new",
            existingColumnDefinitionId: null,
          },
          {
            sourceField: "Email",
            key: "email",
            label: "Email",
            type: "string",
            format: "email",
            isPrimaryKey: true,
            required: true,
            action: "create_new",
            existingColumnDefinitionId: null,
          },
        ],
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("UploadsService", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock implementations
    mockJobsFindById.mockResolvedValue(createAwaitingJob());

    mockConnectorInstancesFindByOrgDefinitionAndName.mockResolvedValue(null);
    mockConnectorInstancesCreate.mockImplementation(async (data: unknown) => ({
      ...(data as Record<string, unknown>),
      id: "ci-001",
      name: "My CSV Import",
    }));

    mockConnectorEntitiesUpsertByKey.mockImplementation(async (data: unknown) => ({
      ...(data as Record<string, unknown>),
      id: "ce-001",
      key: (data as Record<string, unknown>).key,
      label: (data as Record<string, unknown>).label,
    }));

    mockColumnDefinitionsUpsertByKey.mockImplementation(async (data: unknown) => ({
      ...(data as Record<string, unknown>),
      id: `cd-${(data as Record<string, unknown>).key}`,
      key: (data as Record<string, unknown>).key,
      label: (data as Record<string, unknown>).label,
    }));

    mockFieldMappingsUpsertByEntityAndColumn.mockImplementation(async (data: unknown) => ({
      ...(data as Record<string, unknown>),
      id: `fm-${(data as Record<string, unknown>).sourceField}`,
      sourceField: (data as Record<string, unknown>).sourceField,
      columnDefinitionId: (data as Record<string, unknown>).columnDefinitionId,
      isPrimaryKey: (data as Record<string, unknown>).isPrimaryKey,
    }));

    mockColumnDefinitionsFindByKey.mockResolvedValue(undefined);
  });

  describe("confirm()", () => {
    it("should upsert connector instance, entities, column definitions, and field mappings", async () => {
      const body = createConfirmBody();
      const result = await UploadsService.confirm(JOB_ID, ORG_ID, USER_ID, body);

      expect(result.connectorInstanceId).toBe("ci-001");
      expect(result.connectorInstanceName).toBe("My CSV Import");
      expect(result.confirmedEntities).toHaveLength(1);

      const entity = result.confirmedEntities[0];
      expect(entity.entityKey).toBe("contacts");
      expect(entity.entityLabel).toBe("Contacts");
      expect(entity.columnDefinitions).toHaveLength(2);
      expect(entity.fieldMappings).toHaveLength(2);

      // Verify connector instance was created (not found existing)
      expect(mockConnectorInstancesFindByOrgDefinitionAndName).toHaveBeenCalledWith(
        ORG_ID, "cdef_csv01", "My CSV Import", "mock-tx"
      );
      expect(mockConnectorInstancesCreate).toHaveBeenCalledTimes(1);
    });

    it("should reuse existing connector instance if found", async () => {
      mockConnectorInstancesFindByOrgDefinitionAndName.mockResolvedValue({
        id: "ci-existing",
        name: "My CSV Import",
        connectorDefinitionId: "cdef_csv01",
        organizationId: ORG_ID,
      });
      mockConnectorInstancesUpdate.mockResolvedValue({
        id: "ci-existing",
        name: "My CSV Import",
      });

      const body = createConfirmBody();
      const result = await UploadsService.confirm(JOB_ID, ORG_ID, USER_ID, body);

      expect(result.connectorInstanceId).toBe("ci-existing");
      expect(mockConnectorInstancesCreate).not.toHaveBeenCalled();
      expect(mockConnectorInstancesUpdate).toHaveBeenCalledWith(
        "ci-existing",
        expect.objectContaining({ updatedBy: USER_ID }),
        "mock-tx"
      );
    });

    it("should create shared column definitions once (not duplicated across entities)", async () => {
      const body = createConfirmBody({
        entities: [
          {
            entityKey: "contacts",
            entityLabel: "Contacts",
            sourceFileName: "contacts.csv",
            columns: [
              {
                sourceField: "Name",
                key: "full_name",
                label: "Full Name",
                type: "string",
                format: null,
                isPrimaryKey: false,
                required: true,
                action: "create_new",
                existingColumnDefinitionId: null,
              },
            ],
          },
          {
            entityKey: "leads",
            entityLabel: "Leads",
            sourceFileName: "leads.csv",
            columns: [
              {
                sourceField: "Lead Name",
                key: "full_name",
                label: "Full Name",
                type: "string",
                format: null,
                isPrimaryKey: false,
                required: true,
                action: "create_new",
                existingColumnDefinitionId: null,
              },
            ],
          },
        ],
      });

      // Make entity upsert return unique IDs
      let entityCounter = 0;
      mockConnectorEntitiesUpsertByKey.mockImplementation(async (data: unknown) => {
        entityCounter++;
        return {
          ...(data as Record<string, unknown>),
          id: `ce-${entityCounter}`,
          key: (data as Record<string, unknown>).key,
          label: (data as Record<string, unknown>).label,
        };
      });

      await UploadsService.confirm(JOB_ID, ORG_ID, USER_ID, body);

      // Column definition upsertByKey should only be called once for "full_name"
      expect(mockColumnDefinitionsUpsertByKey).toHaveBeenCalledTimes(1);
    });

    it("should import CSV records from S3 after confirmation", async () => {
      const body = createConfirmBody();
      const result = await UploadsService.confirm(JOB_ID, ORG_ID, USER_ID, body);

      expect(mockImportFromS3).toHaveBeenCalledWith(
        expect.objectContaining({
          s3Key: "uploads/org-001/job-001/contacts.csv",
          connectorEntityId: "ce-001",
          organizationId: ORG_ID,
          userId: USER_ID,
        })
      );
      // fieldMappings should NOT be passed — normalization fetches its own
      const callArgs = (mockImportFromS3.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(callArgs).not.toHaveProperty("fieldMappings");

      // Import result should be on the confirmed entity
      expect(result.confirmedEntities[0].importResult).toEqual({
        created: 10,
        updated: 0,
        unchanged: 0,
        invalid: 0,
      });
    });

    it("should still succeed if CSV import fails", async () => {
      mockImportFromS3.mockRejectedValueOnce(new Error("S3 read error"));

      const body = createConfirmBody();
      const result = await UploadsService.confirm(JOB_ID, ORG_ID, USER_ID, body);

      // Confirm should still succeed with empty import result
      expect(result.confirmedEntities[0].importResult).toEqual({
        created: 0,
        updated: 0,
        unchanged: 0,
        invalid: 0,
      });
    });

    it("should transition job to completed", async () => {
      const body = createConfirmBody();
      await UploadsService.confirm(JOB_ID, ORG_ID, USER_ID, body);

      expect(mockTransition).toHaveBeenCalledWith(
        JOB_ID,
        "completed",
        expect.objectContaining({
          progress: 100,
          result: expect.objectContaining({
            confirmedEntities: expect.arrayContaining(["ce-001"]),
          }),
        })
      );
    });

    it("should emit job:complete SSE event with confirmed entity IDs", async () => {
      const body = createConfirmBody();
      await UploadsService.confirm(JOB_ID, ORG_ID, USER_ID, body);

      expect(mockPublishCustomEvent).toHaveBeenCalledWith(
        JOB_ID,
        "complete",
        expect.objectContaining({
          confirmedEntities: expect.arrayContaining(["ce-001"]),
        })
      );
    });

    it("should be idempotent — re-calling with same payload returns same result", async () => {
      const body = createConfirmBody();
      const result1 = await UploadsService.confirm(JOB_ID, ORG_ID, USER_ID, body);

      // Reset job status mock for second call
      mockJobsFindById.mockResolvedValue(createAwaitingJob());
      jest.clearAllMocks();

      // Re-setup mocks for second call
      mockJobsFindById.mockResolvedValue(createAwaitingJob());
      mockConnectorInstancesFindByOrgDefinitionAndName.mockResolvedValue({
        id: "ci-001",
        name: "My CSV Import",
      });
      mockConnectorInstancesUpdate.mockResolvedValue({
        id: "ci-001",
        name: "My CSV Import",
      });
      mockConnectorEntitiesUpsertByKey.mockImplementation(async (data: unknown) => ({
        ...(data as Record<string, unknown>),
        id: "ce-001",
        key: (data as Record<string, unknown>).key,
        label: (data as Record<string, unknown>).label,
      }));
      mockColumnDefinitionsUpsertByKey.mockImplementation(async (data: unknown) => ({
        ...(data as Record<string, unknown>),
        id: `cd-${(data as Record<string, unknown>).key}`,
        key: (data as Record<string, unknown>).key,
        label: (data as Record<string, unknown>).label,
      }));
      mockFieldMappingsUpsertByEntityAndColumn.mockImplementation(async (data: unknown) => ({
        ...(data as Record<string, unknown>),
        id: `fm-${(data as Record<string, unknown>).sourceField}`,
        sourceField: (data as Record<string, unknown>).sourceField,
        columnDefinitionId: (data as Record<string, unknown>).columnDefinitionId,
        isPrimaryKey: (data as Record<string, unknown>).isPrimaryKey,
      }));

      const result2 = await UploadsService.confirm(JOB_ID, ORG_ID, USER_ID, body);

      // Same structure returned — upserts prevent duplicates
      expect(result1.connectorInstanceId).toBe(result2.connectorInstanceId);
      expect(result1.confirmedEntities[0].entityKey).toBe(result2.confirmedEntities[0].entityKey);
    });

    it("should use match_existing column definitions without creating new ones", async () => {
      const existingColDef = {
        id: "cd-existing-123",
        organizationId: ORG_ID,
        key: "existing_name",
        label: "Existing Name",
        type: "string",
      };
      mockColumnDefinitionsFindById.mockResolvedValue(existingColDef);

      const body = createConfirmBody({
        entities: [
          {
            entityKey: "contacts",
            entityLabel: "Contacts",
            sourceFileName: "contacts.csv",
            columns: [
              {
                sourceField: "Name",
                key: "existing_name",
                label: "Existing Name",
                type: "string",
                format: null,
                isPrimaryKey: false,
                required: true,
                action: "match_existing",
                existingColumnDefinitionId: "cd-existing-123",
              },
            ],
          },
        ],
      });

      const result = await UploadsService.confirm(JOB_ID, ORG_ID, USER_ID, body);

      // Should NOT call upsertByKey for match_existing columns
      expect(mockColumnDefinitionsUpsertByKey).not.toHaveBeenCalled();
      expect(result.confirmedEntities[0].columnDefinitions[0].id).toBe("cd-existing-123");
    });
  });

  describe("confirm() — reference columns", () => {
    it("passes refEntityKey and refColumnDefinitionId to field mapping upsert when ID is pre-resolved", async () => {
      const body = createConfirmBody({
        entities: [
          {
            entityKey: "users",
            entityLabel: "Users",
            sourceFileName: "contacts.csv",
            columns: [
              {
                sourceField: "role_id",
                key: "role_id",
                label: "Role ID",
                type: "reference",
                format: null,
                isPrimaryKey: false,
                required: false,
                action: "create_new",
                existingColumnDefinitionId: null,
                refEntityKey: "roles",
                refColumnDefinitionId: "cd-existing-roles-id",
              },
            ],
          },
        ],
      });

      await UploadsService.confirm(JOB_ID, ORG_ID, USER_ID, body);

      // Column def upsert should NOT include ref fields
      expect(mockColumnDefinitionsUpsertByKey).toHaveBeenCalledWith(
        expect.objectContaining({ key: "role_id", type: "reference" }),
        "mock-tx"
      );
      expect(mockColumnDefinitionsUpsertByKey).toHaveBeenCalledWith(
        expect.not.objectContaining({ refEntityKey: expect.anything() }),
        "mock-tx"
      );

      // Field mapping upsert SHOULD carry the ref metadata
      expect(mockFieldMappingsUpsertByEntityAndColumn).toHaveBeenCalledWith(
        expect.objectContaining({
          refColumnDefinitionId: "cd-existing-roles-id",
          refEntityKey: "roles",
        }),
        "mock-tx"
      );
    });

    it("resolves within-batch refColumnKey to refColumnDefinitionId via cache and stores on field mapping", async () => {
      let entityCounter = 0;
      mockConnectorEntitiesUpsertByKey.mockImplementation(async (data: unknown) => {
        entityCounter++;
        return {
          ...(data as Record<string, unknown>),
          id: `ce-${entityCounter}`,
          key: (data as Record<string, unknown>).key,
          label: (data as Record<string, unknown>).label,
        };
      });

      const body = createConfirmBody({
        entities: [
          {
            entityKey: "roles",
            entityLabel: "Roles",
            sourceFileName: "contacts.csv",
            columns: [
              {
                sourceField: "id",
                key: "id",
                label: "ID",
                type: "string",
                format: null,
                isPrimaryKey: true,
                required: true,
                action: "create_new",
                existingColumnDefinitionId: null,
              },
            ],
          },
          {
            entityKey: "users",
            entityLabel: "Users",
            sourceFileName: "contacts.csv",
            columns: [
              {
                sourceField: "role_id",
                key: "role_id",
                label: "Role ID",
                type: "reference",
                format: null,
                isPrimaryKey: false,
                required: false,
                action: "create_new",
                existingColumnDefinitionId: null,
                refEntityKey: "roles",
                refColumnKey: "id",
              },
            ],
          },
        ],
      });

      await UploadsService.confirm(JOB_ID, ORG_ID, USER_ID, body);

      // The field mapping for role_id should have resolved "id" → "cd-id" from the cache
      expect(mockFieldMappingsUpsertByEntityAndColumn).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceField: "role_id",
          refColumnDefinitionId: "cd-id",
          refEntityKey: "roles",
        }),
        "mock-tx"
      );
    });

    it("falls back to DB lookup when refColumnKey is from a previous batch", async () => {
      mockColumnDefinitionsFindByKey.mockResolvedValue({
        id: "cd-from-db",
        key: "role_key",
        organizationId: ORG_ID,
      });

      const body = createConfirmBody({
        entities: [
          {
            entityKey: "users",
            entityLabel: "Users",
            sourceFileName: "contacts.csv",
            columns: [
              {
                sourceField: "role_id",
                key: "role_id",
                label: "Role ID",
                type: "reference",
                format: null,
                isPrimaryKey: false,
                required: false,
                action: "create_new",
                existingColumnDefinitionId: null,
                refEntityKey: "roles",
                refColumnKey: "role_key",
              },
            ],
          },
        ],
      });

      await UploadsService.confirm(JOB_ID, ORG_ID, USER_ID, body);

      expect(mockColumnDefinitionsFindByKey).toHaveBeenCalledWith(ORG_ID, "role_key", "mock-tx");
      expect(mockFieldMappingsUpsertByEntityAndColumn).toHaveBeenCalledWith(
        expect.objectContaining({
          refColumnDefinitionId: "cd-from-db",
          refEntityKey: "roles",
        }),
        "mock-tx"
      );
    });

    it("stores null refColumnDefinitionId when refColumnKey cannot be resolved", async () => {
      const body = createConfirmBody({
        entities: [
          {
            entityKey: "users",
            entityLabel: "Users",
            sourceFileName: "contacts.csv",
            columns: [
              {
                sourceField: "role_id",
                key: "role_id",
                label: "Role ID",
                type: "reference",
                format: null,
                isPrimaryKey: false,
                required: false,
                action: "create_new",
                existingColumnDefinitionId: null,
                refEntityKey: "roles",
                refColumnKey: "nonexistent_key",
              },
            ],
          },
        ],
      });

      await expect(
        UploadsService.confirm(JOB_ID, ORG_ID, USER_ID, body)
      ).resolves.toBeDefined();

      expect(mockFieldMappingsUpsertByEntityAndColumn).toHaveBeenCalledWith(
        expect.objectContaining({ refColumnDefinitionId: null }),
        "mock-tx"
      );
    });
  });

  describe("confirm() — error paths", () => {
    it("should throw 404 when job not found", async () => {
      mockJobsFindById.mockResolvedValue(undefined);

      await expect(
        UploadsService.confirm(JOB_ID, ORG_ID, USER_ID, createConfirmBody())
      ).rejects.toMatchObject({
        status: 404,
        code: "JOB_NOT_FOUND",
      });
    });

    it("should throw 403 when job belongs to different org", async () => {
      mockJobsFindById.mockResolvedValue(
        createAwaitingJob({ organizationId: "other-org" })
      );

      await expect(
        UploadsService.confirm(JOB_ID, ORG_ID, USER_ID, createConfirmBody())
      ).rejects.toMatchObject({
        status: 403,
        code: "JOB_UNAUTHORIZED",
      });
    });

    it("should throw 409 when job is not in awaiting_confirmation state", async () => {
      mockJobsFindById.mockResolvedValue(
        createAwaitingJob({ status: "completed" })
      );

      await expect(
        UploadsService.confirm(JOB_ID, ORG_ID, USER_ID, createConfirmBody())
      ).rejects.toMatchObject({
        status: 409,
        code: "UPLOAD_INVALID_STATE",
      });
    });

    it("should throw 400 for invalid column definition references", async () => {
      mockColumnDefinitionsFindById.mockResolvedValue(undefined);

      const body = createConfirmBody({
        entities: [
          {
            entityKey: "contacts",
            entityLabel: "Contacts",
            sourceFileName: "contacts.csv",
            columns: [
              {
                sourceField: "Name",
                key: "name",
                label: "Name",
                type: "string",
                format: null,
                isPrimaryKey: false,
                required: true,
                action: "match_existing",
                existingColumnDefinitionId: "nonexistent-id",
              },
            ],
          },
        ],
      });

      await expect(
        UploadsService.confirm(JOB_ID, ORG_ID, USER_ID, body)
      ).rejects.toMatchObject({
        status: 400,
        code: "UPLOAD_INVALID_REFERENCE",
      });
    });

    it("should throw 400 when column definition belongs to different org", async () => {
      mockColumnDefinitionsFindById.mockResolvedValue({
        id: "cd-other",
        organizationId: "other-org",
        key: "name",
        label: "Name",
      });

      const body = createConfirmBody({
        entities: [
          {
            entityKey: "contacts",
            entityLabel: "Contacts",
            sourceFileName: "contacts.csv",
            columns: [
              {
                sourceField: "Name",
                key: "name",
                label: "Name",
                type: "string",
                format: null,
                isPrimaryKey: false,
                required: true,
                action: "match_existing",
                existingColumnDefinitionId: "cd-other",
              },
            ],
          },
        ],
      });

      await expect(
        UploadsService.confirm(JOB_ID, ORG_ID, USER_ID, body)
      ).rejects.toMatchObject({
        status: 400,
        code: "UPLOAD_INVALID_REFERENCE",
      });
    });

    it("should roll back transaction on DB error — job stays awaiting_confirmation", async () => {
      const { DbService } = await import("../../services/db.service.js");
      (DbService.transaction as jest.Mock<() => Promise<unknown>>).mockRejectedValueOnce(new Error("DB connection lost"));

      await expect(
        UploadsService.confirm(JOB_ID, ORG_ID, USER_ID, createConfirmBody())
      ).rejects.toThrow("DB connection lost");

      // Job transition should NOT have been called
      expect(mockTransition).not.toHaveBeenCalled();
    });
  });
});
