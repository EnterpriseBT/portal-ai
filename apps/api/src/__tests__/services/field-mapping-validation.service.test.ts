import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFindMappingById = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockCountByEntityId = jest.fn<(...args: unknown[]) => Promise<number>>();
const mockSoftDeleteMapping = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined);
const mockUpdateWhere = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined);
const mockSoftDeleteGroupMembers = jest.fn<(...args: unknown[]) => Promise<number>>().mockResolvedValue(0);
const mockTransaction = jest.fn<(fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>>();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      fieldMappings: {
        findById: mockFindMappingById,
        softDelete: mockSoftDeleteMapping,
        updateWhere: mockUpdateWhere,
      },
      entityRecords: {
        countByConnectorEntityId: mockCountByEntityId,
      },
      entityGroupMembers: {
        softDeleteByLinkFieldMappingId: mockSoftDeleteGroupMembers,
      },
    },
  },
}));

jest.unstable_mockModule("../../db/repositories/base.repository.js", () => ({
  Repository: {
    transaction: mockTransaction,
  },
}));

// Need to mock the schema import used by the service for eq()
jest.unstable_mockModule("../../db/schema/index.js", () => ({
  fieldMappings: { id: "field_mappings.id" },
}));

const { FieldMappingValidationService } = await import(
  "../../services/field-mapping-validation.service.js"
);

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockTransaction.mockImplementation(async (fn) => fn("tx-mock"));
});

// ---------------------------------------------------------------------------
// validateDelete
// ---------------------------------------------------------------------------

describe("FieldMappingValidationService.validateDelete", () => {
  it("passes when entity has no records", async () => {
    mockFindMappingById.mockResolvedValue({
      id: "fm-1",
      connectorEntityId: "ce-1",
    });
    mockCountByEntityId.mockResolvedValue(0);

    await expect(
      FieldMappingValidationService.validateDelete("fm-1"),
    ).resolves.toBeUndefined();
  });

  it("throws FIELD_MAPPING_DELETE_HAS_RECORDS when records exist", async () => {
    mockFindMappingById.mockResolvedValue({
      id: "fm-1",
      connectorEntityId: "ce-1",
    });
    mockCountByEntityId.mockResolvedValue(10);

    await expect(
      FieldMappingValidationService.validateDelete("fm-1"),
    ).rejects.toMatchObject({
      code: "FIELD_MAPPING_DELETE_HAS_RECORDS",
    });
  });
});

// ---------------------------------------------------------------------------
// executeDelete
// ---------------------------------------------------------------------------

describe("FieldMappingValidationService.executeDelete", () => {
  it("cascade soft-deletes group members", async () => {
    mockFindMappingById.mockResolvedValue({
      id: "fm-1",
      connectorEntityId: "ce-1",
      refBidirectionalFieldMappingId: null,
    });
    mockSoftDeleteGroupMembers.mockResolvedValue(3);

    const result = await FieldMappingValidationService.executeDelete(
      "fm-1",
      "user-1",
    );

    expect(result.cascadedEntityGroupMembers).toBe(3);
    expect(mockSoftDeleteMapping).toHaveBeenCalledWith(
      "fm-1",
      "user-1",
      "tx-mock",
    );
  });

  it("clears bidirectional counterpart", async () => {
    mockFindMappingById.mockResolvedValue({
      id: "fm-1",
      connectorEntityId: "ce-1",
      refBidirectionalFieldMappingId: "fm-2",
    });

    const result = await FieldMappingValidationService.executeDelete(
      "fm-1",
      "user-1",
    );

    expect(result.bidirectionalCleared).toBe(true);
    expect(mockUpdateWhere).toHaveBeenCalled();
  });

  it("returns bidirectionalCleared: false when no counterpart", async () => {
    mockFindMappingById.mockResolvedValue({
      id: "fm-1",
      connectorEntityId: "ce-1",
      refBidirectionalFieldMappingId: null,
    });

    const result = await FieldMappingValidationService.executeDelete(
      "fm-1",
      "user-1",
    );

    expect(result.bidirectionalCleared).toBe(false);
    expect(mockUpdateWhere).not.toHaveBeenCalled();
  });

  it("uses provided client directly without creating a transaction", async () => {
    mockFindMappingById.mockResolvedValue({
      id: "fm-1",
      connectorEntityId: "ce-1",
      refBidirectionalFieldMappingId: null,
    });
    mockSoftDeleteGroupMembers.mockResolvedValue(0);

    const externalTx = "external-tx" as unknown;

    await FieldMappingValidationService.executeDelete("fm-1", "user-1", externalTx as never);

    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockSoftDeleteMapping).toHaveBeenCalledWith(
      "fm-1",
      "user-1",
      "external-tx",
    );
  });
});
