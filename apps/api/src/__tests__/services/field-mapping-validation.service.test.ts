import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFindMappingById = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockFindMany = jest.fn<(...args: unknown[]) => Promise<unknown[]>>().mockResolvedValue([]);
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
        findMany: mockFindMany,
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
// validateNormalizedKey
// ---------------------------------------------------------------------------

describe("FieldMappingValidationService.validateNormalizedKey", () => {
  it("accepts valid normalizedKey formats", () => {
    expect(() => FieldMappingValidationService.validateNormalizedKey("email")).not.toThrow();
    expect(() => FieldMappingValidationService.validateNormalizedKey("first_name")).not.toThrow();
    expect(() => FieldMappingValidationService.validateNormalizedKey("field123")).not.toThrow();
    expect(() => FieldMappingValidationService.validateNormalizedKey("a")).not.toThrow();
  });

  it("rejects normalizedKey that does not match /^[a-z][a-z0-9_]*$/", () => {
    expect(() => FieldMappingValidationService.validateNormalizedKey("Invalid")).toThrow(
      expect.objectContaining({ code: "FIELD_MAPPING_INVALID_NORMALIZED_KEY" })
    );
    expect(() => FieldMappingValidationService.validateNormalizedKey("123abc")).toThrow(
      expect.objectContaining({ code: "FIELD_MAPPING_INVALID_NORMALIZED_KEY" })
    );
    expect(() => FieldMappingValidationService.validateNormalizedKey("_leading")).toThrow(
      expect.objectContaining({ code: "FIELD_MAPPING_INVALID_NORMALIZED_KEY" })
    );
    expect(() => FieldMappingValidationService.validateNormalizedKey("has space")).toThrow(
      expect.objectContaining({ code: "FIELD_MAPPING_INVALID_NORMALIZED_KEY" })
    );
    expect(() => FieldMappingValidationService.validateNormalizedKey("")).toThrow(
      expect.objectContaining({ code: "FIELD_MAPPING_INVALID_NORMALIZED_KEY" })
    );
  });
});

// ---------------------------------------------------------------------------
// validateNormalizedKeyUniqueness
// ---------------------------------------------------------------------------

describe("FieldMappingValidationService.validateNormalizedKeyUniqueness", () => {
  it("resolves when no duplicate exists", async () => {
    mockFindMany.mockResolvedValue([]);

    await expect(
      FieldMappingValidationService.validateNormalizedKeyUniqueness("ce-1", "email")
    ).resolves.toBeUndefined();
  });

  it("throws FIELD_MAPPING_DUPLICATE_NORMALIZED_KEY when duplicate exists", async () => {
    mockFindMany.mockResolvedValue([{ id: "fm-other", normalizedKey: "email" }]);

    await expect(
      FieldMappingValidationService.validateNormalizedKeyUniqueness("ce-1", "email")
    ).rejects.toMatchObject({ code: "FIELD_MAPPING_DUPLICATE_NORMALIZED_KEY" });
  });

  it("allows duplicate when excludeId matches the existing mapping", async () => {
    mockFindMany.mockResolvedValue([{ id: "fm-self", normalizedKey: "email" }]);

    await expect(
      FieldMappingValidationService.validateNormalizedKeyUniqueness("ce-1", "email", "fm-self")
    ).resolves.toBeUndefined();
  });

  it("rejects duplicate even with excludeId when a different mapping conflicts", async () => {
    mockFindMany.mockResolvedValue([
      { id: "fm-other", normalizedKey: "email" },
    ]);

    await expect(
      FieldMappingValidationService.validateNormalizedKeyUniqueness("ce-1", "email", "fm-self")
    ).rejects.toMatchObject({ code: "FIELD_MAPPING_DUPLICATE_NORMALIZED_KEY" });
  });
});

// ---------------------------------------------------------------------------
// validateEnumValues
// ---------------------------------------------------------------------------

describe("FieldMappingValidationService.validateEnumValues", () => {
  it("accepts null enumValues", () => {
    expect(() => FieldMappingValidationService.validateEnumValues(null)).not.toThrow();
  });

  it("accepts undefined enumValues", () => {
    expect(() => FieldMappingValidationService.validateEnumValues(undefined)).not.toThrow();
  });

  it("accepts valid array of non-empty strings", () => {
    expect(() => FieldMappingValidationService.validateEnumValues(["a", "b", "c"])).not.toThrow();
  });

  it("rejects empty array", () => {
    expect(() => FieldMappingValidationService.validateEnumValues([])).toThrow(
      expect.objectContaining({ code: "FIELD_MAPPING_INVALID_ENUM_VALUES" })
    );
  });

  it("rejects array with empty strings", () => {
    expect(() => FieldMappingValidationService.validateEnumValues(["valid", ""])).toThrow(
      expect.objectContaining({ code: "FIELD_MAPPING_INVALID_ENUM_VALUES" })
    );
  });

  it("rejects array with whitespace-only strings", () => {
    expect(() => FieldMappingValidationService.validateEnumValues(["valid", "   "])).toThrow(
      expect.objectContaining({ code: "FIELD_MAPPING_INVALID_ENUM_VALUES" })
    );
  });
});

// ---------------------------------------------------------------------------
// validateFormat
// ---------------------------------------------------------------------------

describe("FieldMappingValidationService.validateFormat", () => {
  it("accepts null format for any type", () => {
    expect(() => FieldMappingValidationService.validateFormat(null, "boolean")).not.toThrow();
    expect(() => FieldMappingValidationService.validateFormat(null, "string")).not.toThrow();
  });

  it("accepts undefined format for any type", () => {
    expect(() => FieldMappingValidationService.validateFormat(undefined, "boolean")).not.toThrow();
  });

  it("accepts valid boolean format (trueLabel/falseLabel)", () => {
    expect(() => FieldMappingValidationService.validateFormat("Yes/No", "boolean")).not.toThrow();
    expect(() => FieldMappingValidationService.validateFormat("true/false", "boolean")).not.toThrow();
    expect(() => FieldMappingValidationService.validateFormat("1/0", "boolean")).not.toThrow();
  });

  it("rejects invalid boolean format (no separator)", () => {
    expect(() => FieldMappingValidationService.validateFormat("yes", "boolean")).toThrow(
      expect.objectContaining({ code: "FIELD_MAPPING_INVALID_FORMAT" })
    );
  });

  it("allows any format for non-boolean types", () => {
    expect(() => FieldMappingValidationService.validateFormat("YYYY-MM-DD", "date")).not.toThrow();
    expect(() => FieldMappingValidationService.validateFormat("email", "string")).not.toThrow();
    expect(() => FieldMappingValidationService.validateFormat("anything", "number")).not.toThrow();
  });
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
