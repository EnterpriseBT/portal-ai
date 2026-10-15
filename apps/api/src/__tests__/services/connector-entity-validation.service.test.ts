import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFindEntityById = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockFindRefEntityKey =
  jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
const mockSoftDeleteGroupMembers = jest
  .fn<(...args: unknown[]) => Promise<number>>()
  .mockResolvedValue(0);
const mockSoftDeleteTagAssignments = jest
  .fn<(...args: unknown[]) => Promise<number>>()
  .mockResolvedValue(0);
const mockSoftDeleteFieldMappings = jest
  .fn<(...args: unknown[]) => Promise<number>>()
  .mockResolvedValue(0);
const mockSoftDeleteEntity = jest
  .fn<(...args: unknown[]) => Promise<unknown>>()
  .mockResolvedValue(undefined);
const mockTransaction =
  jest.fn<(fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>>();
const mockFindViewIds = jest
  .fn<(...args: unknown[]) => Promise<string[]>>()
  .mockResolvedValue([]);
const mockDeleteViews = jest
  .fn<(...args: unknown[]) => Promise<unknown>>()
  .mockResolvedValue({
    curatedViews: 0,
    fieldMappings: 0,
    stationViews: 0,
    grants: 0,
  });

const mockInsertJob = jest
  .fn<(...args: unknown[]) => Promise<unknown>>()
  .mockResolvedValue({ id: "job-1", type: "entity_data_delete" });

jest.unstable_mockModule(
  "../../services/entity-data-delete.service.js",
  () => ({ EntityDataDeleteService: { insertJob: mockInsertJob } })
);

jest.unstable_mockModule(
  "../../services/curated-view-delete.service.js",
  () => ({
    CuratedViewDeleteService: {
      findIdsByConnectorEntityIds: mockFindViewIds,
      deleteByIds: mockDeleteViews,
    },
  })
);

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      connectorEntities: {
        findById: mockFindEntityById,
        softDelete: mockSoftDeleteEntity,
      },
      fieldMappings: {
        findByRefEntityKey: mockFindRefEntityKey,
        softDeleteByConnectorEntityIds: mockSoftDeleteFieldMappings,
      },
      entityGroupMembers: {
        softDeleteByConnectorEntityIds: mockSoftDeleteGroupMembers,
      },
      entityTagAssignments: {
        softDeleteByConnectorEntityIds: mockSoftDeleteTagAssignments,
      },
    },
    transaction: mockTransaction,
  },
}));

const mockAssertWriteCapability = jest
  .fn<(...args: unknown[]) => Promise<void>>()
  .mockResolvedValue(undefined);

jest.unstable_mockModule("../../utils/resolve-capabilities.util.js", () => ({
  assertWriteCapability: mockAssertWriteCapability,
}));

const { ConnectorEntityValidationService } =
  await import("../../services/connector-entity-validation.service.js");

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockFindViewIds.mockResolvedValue([]);
  // The claim: the entity row the delete soft-deletes first.
  mockSoftDeleteEntity.mockResolvedValue({ id: "ce-1" });
  // Default: transaction calls the callback immediately
  mockTransaction.mockImplementation(async (fn) => fn("tx-mock"));
});

// ---------------------------------------------------------------------------
// validateDelete
// ---------------------------------------------------------------------------

describe("ConnectorEntityValidationService.validateDelete", () => {
  it("passes when no external references exist", async () => {
    mockFindEntityById.mockResolvedValue({ id: "ce-1", key: "contacts" });
    mockAssertWriteCapability.mockResolvedValue(undefined);
    mockFindRefEntityKey.mockResolvedValue([]);

    await expect(
      ConnectorEntityValidationService.validateDelete("ce-1")
    ).resolves.toBeUndefined();
  });

  it("throws CONNECTOR_INSTANCE_WRITE_DISABLED when write disabled", async () => {
    mockFindEntityById.mockResolvedValue({ id: "ce-1", key: "contacts" });
    mockAssertWriteCapability.mockRejectedValue(
      Object.assign(new Error("Write disabled"), {
        code: "CONNECTOR_INSTANCE_WRITE_DISABLED",
      })
    );

    await expect(
      ConnectorEntityValidationService.validateDelete("ce-1")
    ).rejects.toMatchObject({
      code: "CONNECTOR_INSTANCE_WRITE_DISABLED",
    });
  });

  it("throws ENTITY_HAS_EXTERNAL_REFERENCES when references exist", async () => {
    mockFindEntityById.mockResolvedValue({ id: "ce-1", key: "contacts" });
    mockAssertWriteCapability.mockResolvedValue(undefined);
    mockFindRefEntityKey.mockResolvedValue([
      { id: "fm-1", connectorEntityId: "ce-2" },
    ]);

    await expect(
      ConnectorEntityValidationService.validateDelete("ce-1")
    ).rejects.toMatchObject({
      code: "ENTITY_HAS_EXTERNAL_REFERENCES",
    });
  });
});

// ---------------------------------------------------------------------------
// executeDelete
// ---------------------------------------------------------------------------

describe("ConnectorEntityValidationService.executeDelete", () => {
  it("cascade soft-deletes all dependent objects", async () => {
    mockSoftDeleteGroupMembers.mockResolvedValue(2);
    mockSoftDeleteTagAssignments.mockResolvedValue(1);
    mockSoftDeleteFieldMappings.mockResolvedValue(3);

    const result = await ConnectorEntityValidationService.executeDelete(
      "ce-1",
      "org-1",
      "user-1"
    );

    expect(result).toEqual({
      cascaded: {
        entityGroupMembers: 2,
        entityTagAssignments: 1,
        fieldMappings: 3,
        curatedViews: 0,
      },
      recordsJob: { id: "job-1", type: "entity_data_delete" },
    });
  });

  it("#802: leaves the records to an entity_data_delete job inserted on the same tx", async () => {
    await ConnectorEntityValidationService.executeDelete(
      "ce-1",
      "org-1",
      "user-1"
    );

    expect(mockInsertJob).toHaveBeenCalledWith(
      {
        organizationId: "org-1",
        userId: "user-1",
        connectorEntityIds: ["ce-1"],
        connectorInstanceId: null,
      },
      "tx-mock"
    );
    expect(mockInsertJob.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockSoftDeleteEntity.mock.invocationCallOrder[0]
    );
  });

  it("#802: claims the entity first, then deletes its views, org-scoped", async () => {
    mockFindViewIds.mockResolvedValue(["cv-1", "cv-2"]);
    mockDeleteViews.mockResolvedValue({
      curatedViews: 2,
      fieldMappings: 3,
      stationViews: 1,
      grants: 4,
    });

    const result = await ConnectorEntityValidationService.executeDelete(
      "ce-1",
      "org-1",
      "user-1"
    );

    expect(mockFindViewIds).toHaveBeenCalledWith("org-1", ["ce-1"], "tx-mock");
    expect(mockDeleteViews).toHaveBeenCalledWith(
      "org-1",
      ["cv-1", "cv-2"],
      "user-1",
      "tx-mock"
    );
    expect(mockSoftDeleteEntity.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeleteViews.mock.invocationCallOrder[0]
    );
    expect(result.cascaded.curatedViews).toBe(2);
  });

  it("#802: refuses with 404 when the entity was already deleted, before any cascade or job", async () => {
    // A concurrent delete committed first: the claim updates no row.
    mockSoftDeleteEntity.mockResolvedValueOnce(undefined);

    await expect(
      ConnectorEntityValidationService.executeDelete("ce-1", "org-1", "user-1")
    ).rejects.toMatchObject({
      status: 404,
      code: "CONNECTOR_ENTITY_NOT_FOUND",
    });
    expect(mockDeleteViews).not.toHaveBeenCalled();
    expect(mockSoftDeleteFieldMappings).not.toHaveBeenCalled();
    expect(mockInsertJob).not.toHaveBeenCalled();
  });

  it("runs in a single transaction when no client provided", async () => {
    mockSoftDeleteGroupMembers.mockResolvedValue(0);
    mockSoftDeleteTagAssignments.mockResolvedValue(0);
    mockSoftDeleteFieldMappings.mockResolvedValue(0);

    await ConnectorEntityValidationService.executeDelete(
      "ce-1",
      "org-1",
      "user-1"
    );

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    // Verify cascade methods received the tx argument
    expect(mockSoftDeleteGroupMembers).toHaveBeenCalledWith(
      ["ce-1"],
      "user-1",
      "tx-mock"
    );
  });

  it("uses provided client directly without creating a transaction", async () => {
    mockSoftDeleteGroupMembers.mockResolvedValue(0);
    mockSoftDeleteTagAssignments.mockResolvedValue(0);
    mockSoftDeleteFieldMappings.mockResolvedValue(0);

    const externalTx = "external-tx" as unknown;

    await ConnectorEntityValidationService.executeDelete(
      "ce-1",
      "org-1",
      "user-1",
      externalTx as never
    );

    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockSoftDeleteGroupMembers).toHaveBeenCalledWith(
      ["ce-1"],
      "user-1",
      "external-tx"
    );
  });
});
