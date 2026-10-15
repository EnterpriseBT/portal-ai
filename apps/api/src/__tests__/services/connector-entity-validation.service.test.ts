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
const mockSoftDeleteEntityRecords = jest
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
      entityRecords: {
        softDeleteByConnectorEntityIds: mockSoftDeleteEntityRecords,
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
    mockSoftDeleteEntityRecords.mockResolvedValue(5);

    const result = await ConnectorEntityValidationService.executeDelete(
      "ce-1",
      "org-1",
      "user-1"
    );

    expect(result).toEqual({
      entityGroupMembers: 2,
      entityTagAssignments: 1,
      fieldMappings: 3,
      entityRecords: 5,
      curatedViews: 0,
    });
  });

  it("#802: deletes the entity's views, org-scoped, before the entity", async () => {
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
    expect(mockDeleteViews.mock.invocationCallOrder[0]).toBeLessThan(
      mockSoftDeleteEntity.mock.invocationCallOrder[0]
    );
    expect(result.curatedViews).toBe(2);
  });

  it("runs in a single transaction when no client provided", async () => {
    mockSoftDeleteGroupMembers.mockResolvedValue(0);
    mockSoftDeleteTagAssignments.mockResolvedValue(0);
    mockSoftDeleteFieldMappings.mockResolvedValue(0);
    mockSoftDeleteEntityRecords.mockResolvedValue(0);

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
    mockSoftDeleteEntityRecords.mockResolvedValue(0);

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
