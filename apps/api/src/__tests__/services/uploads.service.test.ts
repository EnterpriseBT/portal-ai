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

const mockFieldMappingsUpsertByEntityAndNormalizedKey = jest.fn<(data: unknown, tx?: unknown) => Promise<unknown>>();
const mockFieldMappingsFindByConnectorEntityId = jest.fn<(id: string, tx?: unknown) => Promise<unknown[]>>();
const mockFieldMappingsSoftDeleteMany = jest.fn<(ids: string[], deletedBy: string, tx?: unknown) => Promise<number>>();

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
      },
      fieldMappings: {
        upsertByEntityAndNormalizedKey: mockFieldMappingsUpsertByEntityAndNormalizedKey,
        findByConnectorEntityId: mockFieldMappingsFindByConnectorEntityId,
        softDeleteMany: mockFieldMappingsSoftDeleteMany,
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

const COLDEF_NAME = { id: "cd-name", organizationId: ORG_ID, key: "name", label: "Name", type: "string" };
const COLDEF_EMAIL = { id: "cd-email", organizationId: ORG_ID, key: "email", label: "Email", type: "string" };
const COLDEF_INTEGER = { id: "cd-integer", organizationId: ORG_ID, key: "integer", label: "Integer", type: "number" };
const COLDEF_REFERENCE = { id: "cd-reference", organizationId: ORG_ID, key: "reference", label: "Reference", type: "reference" };

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
            existingColumnDefinitionId: "cd-name",
            normalizedKey: "name",
            format: null,
            isPrimaryKey: false,
            required: true,
          },
          {
            sourceField: "Email",
            existingColumnDefinitionId: "cd-email",
            normalizedKey: "email",
            format: "email",
            isPrimaryKey: true,
            required: true,
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

    // findById resolves the correct column definition based on id
    mockColumnDefinitionsFindById.mockImplementation(async (id: string) => {
      const defs: Record<string, unknown> = {
        "cd-name": COLDEF_NAME,
        "cd-email": COLDEF_EMAIL,
        "cd-integer": COLDEF_INTEGER,
        "cd-reference": COLDEF_REFERENCE,
      };
      return defs[id] ?? undefined;
    });

    mockFieldMappingsUpsertByEntityAndNormalizedKey.mockImplementation(async (data: unknown) => ({
      ...(data as Record<string, unknown>),
      id: `fm-${(data as Record<string, unknown>).sourceField}`,
      sourceField: (data as Record<string, unknown>).sourceField,
      columnDefinitionId: (data as Record<string, unknown>).columnDefinitionId,
      isPrimaryKey: (data as Record<string, unknown>).isPrimaryKey,
      normalizedKey: (data as Record<string, unknown>).normalizedKey,
    }));

    mockFieldMappingsFindByConnectorEntityId.mockResolvedValue([]);
    mockFieldMappingsSoftDeleteMany.mockResolvedValue(0);
  });

  describe("confirm()", () => {
    it("should confirm with valid existingColumnDefinitionId for every column", async () => {
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
    });

    it("should create field mappings linked to the existing column definition IDs", async () => {
      const body = createConfirmBody();
      await UploadsService.confirm(JOB_ID, ORG_ID, USER_ID, body);

      expect(mockFieldMappingsUpsertByEntityAndNormalizedKey).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceField: "Name",
          columnDefinitionId: "cd-name",
          normalizedKey: "name",
        }),
        "mock-tx"
      );
      expect(mockFieldMappingsUpsertByEntityAndNormalizedKey).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceField: "Email",
          columnDefinitionId: "cd-email",
          normalizedKey: "email",
        }),
        "mock-tx"
      );
    });

    it("should not call columnDefinitions.upsertByKey (no column def creation)", async () => {
      const body = createConfirmBody();
      await UploadsService.confirm(JOB_ID, ORG_ID, USER_ID, body);

      // upsertByKey is not even in the mock — verify findById was used instead
      expect(mockColumnDefinitionsFindById).toHaveBeenCalledWith("cd-name", "mock-tx");
      expect(mockColumnDefinitionsFindById).toHaveBeenCalledWith("cd-email", "mock-tx");
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

    it("should use normalizedKey directly from the column (now required)", async () => {
      const body = createConfirmBody();
      await UploadsService.confirm(JOB_ID, ORG_ID, USER_ID, body);

      expect(mockFieldMappingsUpsertByEntityAndNormalizedKey).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceField: "Name",
          normalizedKey: "name",
        }),
        "mock-tx"
      );
    });

    it("should pass required, defaultValue, format, and enumValues to field mapping upsert", async () => {
      const body = createConfirmBody({
        entities: [
          {
            entityKey: "contacts",
            entityLabel: "Contacts",
            sourceFileName: "contacts.csv",
            columns: [
              {
                sourceField: "Status",
                existingColumnDefinitionId: "cd-name",
                normalizedKey: "status",
                format: null,
                isPrimaryKey: false,
                required: true,
                defaultValue: "active",
                enumValues: ["active", "inactive", "pending"],
              },
            ],
          },
        ],
      });

      await UploadsService.confirm(JOB_ID, ORG_ID, USER_ID, body);

      expect(mockFieldMappingsUpsertByEntityAndNormalizedKey).toHaveBeenCalledWith(
        expect.objectContaining({
          required: true,
          defaultValue: "active",
          format: null,
          enumValues: ["active", "inactive", "pending"],
        }),
        "mock-tx"
      );
    });

    it("should default defaultValue and enumValues to null when not provided", async () => {
      const body = createConfirmBody();
      await UploadsService.confirm(JOB_ID, ORG_ID, USER_ID, body);

      expect(mockFieldMappingsUpsertByEntityAndNormalizedKey).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceField: "Name",
          defaultValue: null,
          enumValues: null,
        }),
        "mock-tx"
      );
    });
  });

  describe("confirm() — stale mapping cleanup", () => {
    it("should soft-delete stale field mappings whose normalizedKey is not in the incoming set", async () => {
      mockFieldMappingsFindByConnectorEntityId.mockResolvedValue([
        { id: "fm-old", columnDefinitionId: "cd-integer", normalizedKey: "age" },
        { id: "fm-name", columnDefinitionId: "cd-name", normalizedKey: "name" },
      ]);

      const body = createConfirmBody();
      await UploadsService.confirm(JOB_ID, ORG_ID, USER_ID, body);

      // "age" is not in the incoming normalizedKeys (name, email), so fm-old should be deleted
      expect(mockFieldMappingsSoftDeleteMany).toHaveBeenCalledWith(
        ["fm-old"],
        USER_ID,
        "mock-tx"
      );
    });

    it("should not soft-delete any mappings when all existing normalizedKeys are in the incoming set", async () => {
      mockFieldMappingsFindByConnectorEntityId.mockResolvedValue([
        { id: "fm-name", columnDefinitionId: "cd-name", normalizedKey: "name" },
        { id: "fm-email", columnDefinitionId: "cd-email", normalizedKey: "email" },
      ]);

      const body = createConfirmBody();
      await UploadsService.confirm(JOB_ID, ORG_ID, USER_ID, body);

      expect(mockFieldMappingsSoftDeleteMany).not.toHaveBeenCalled();
    });

    it("should not call softDeleteMany when there are no existing mappings", async () => {
      mockFieldMappingsFindByConnectorEntityId.mockResolvedValue([]);

      const body = createConfirmBody();
      await UploadsService.confirm(JOB_ID, ORG_ID, USER_ID, body);

      expect(mockFieldMappingsSoftDeleteMany).not.toHaveBeenCalled();
    });
  });

  describe("confirm() — reference columns", () => {
    it("passes refNormalizedKey and refEntityKey for reference-type columns", async () => {
      const body = createConfirmBody({
        entities: [
          {
            entityKey: "users",
            entityLabel: "Users",
            sourceFileName: "contacts.csv",
            columns: [
              {
                sourceField: "role_id",
                existingColumnDefinitionId: "cd-reference",
                normalizedKey: "role_id",
                format: null,
                isPrimaryKey: false,
                required: false,
                refEntityKey: "roles",
                refNormalizedKey: "role_key",
              },
            ],
          },
        ],
      });

      await UploadsService.confirm(JOB_ID, ORG_ID, USER_ID, body);

      expect(mockFieldMappingsUpsertByEntityAndNormalizedKey).toHaveBeenCalledWith(
        expect.objectContaining({
          refNormalizedKey: "role_key",
          refEntityKey: "roles",
        }),
        "mock-tx"
      );
    });

    it("passes refNormalizedKey even when column definition type is not 'reference'", async () => {
      const COLDEF_TEXT = { id: "cd-text", organizationId: ORG_ID, key: "owner", label: "Owner", type: "text" };

      mockColumnDefinitionsFindById.mockImplementation(async (id: string) => {
        if (id === "cd-text") return COLDEF_TEXT;
        return undefined;
      });

      const body = createConfirmBody({
        entities: [
          {
            entityKey: "accounts",
            entityLabel: "Accounts",
            sourceFileName: "contacts.csv",
            columns: [
              {
                sourceField: "owner_id",
                existingColumnDefinitionId: "cd-text",
                normalizedKey: "owner_id",
                format: null,
                isPrimaryKey: false,
                required: false,
                refEntityKey: "users",
                refNormalizedKey: "user_id",
              },
            ],
          },
        ],
      });

      await UploadsService.confirm(JOB_ID, ORG_ID, USER_ID, body);

      expect(mockFieldMappingsUpsertByEntityAndNormalizedKey).toHaveBeenCalledWith(
        expect.objectContaining({
          refNormalizedKey: "user_id",
          refEntityKey: "users",
        }),
        "mock-tx"
      );
    });

    it("stores null refNormalizedKey when no ref fields are provided on a non-reference column", async () => {
      const body = createConfirmBody();
      await UploadsService.confirm(JOB_ID, ORG_ID, USER_ID, body);

      expect(mockFieldMappingsUpsertByEntityAndNormalizedKey).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceField: "Name",
          refNormalizedKey: null,
        }),
        "mock-tx"
      );
    });

    it("creates two distinct field mappings when columns share the same columnDefinitionId but different normalizedKey", async () => {
      const body = createConfirmBody({
        entities: [
          {
            entityKey: "contacts",
            entityLabel: "Contacts",
            sourceFileName: "contacts.csv",
            columns: [
              {
                sourceField: "First Name",
                existingColumnDefinitionId: "cd-name",
                normalizedKey: "first_name",
                format: null,
                isPrimaryKey: false,
                required: true,
              },
              {
                sourceField: "Last Name",
                existingColumnDefinitionId: "cd-name",
                normalizedKey: "last_name",
                format: null,
                isPrimaryKey: false,
                required: false,
              },
            ],
          },
        ],
      });

      await UploadsService.confirm(JOB_ID, ORG_ID, USER_ID, body);

      expect(mockFieldMappingsUpsertByEntityAndNormalizedKey).toHaveBeenCalledTimes(2);
      expect(mockFieldMappingsUpsertByEntityAndNormalizedKey).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceField: "First Name",
          columnDefinitionId: "cd-name",
          normalizedKey: "first_name",
        }),
        "mock-tx"
      );
      expect(mockFieldMappingsUpsertByEntityAndNormalizedKey).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceField: "Last Name",
          columnDefinitionId: "cd-name",
          normalizedKey: "last_name",
        }),
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

    it("should throw 400 for invalid existingColumnDefinitionId", async () => {
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
                existingColumnDefinitionId: "nonexistent-id",
                normalizedKey: "name",
                format: null,
                isPrimaryKey: false,
                required: true,
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
                existingColumnDefinitionId: "cd-other",
                normalizedKey: "name",
                format: null,
                isPrimaryKey: false,
                required: true,
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
