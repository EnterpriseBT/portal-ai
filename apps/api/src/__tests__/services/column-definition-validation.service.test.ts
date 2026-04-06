import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFindByColumnDefId = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
const mockFindByRefColumnDefId = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      fieldMappings: {
        findByColumnDefinitionId: mockFindByColumnDefId,
        findByRefColumnDefinitionId: mockFindByRefColumnDefId,
      },
    },
  },
}));

const { ColumnDefinitionValidationService } = await import(
  "../../services/column-definition-validation.service.js"
);

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ColumnDefinitionValidationService.validatePattern", () => {
  it("accepts a valid regex pattern", () => {
    expect(() =>
      ColumnDefinitionValidationService.validatePattern("^[A-Z]+$")
    ).not.toThrow();
  });

  it("accepts a complex valid regex", () => {
    expect(() =>
      ColumnDefinitionValidationService.validatePattern("^[^@]+@[^@]+\\.[^@]+$")
    ).not.toThrow();
  });

  it("accepts null (no validation pattern)", () => {
    expect(() =>
      ColumnDefinitionValidationService.validatePattern(null)
    ).not.toThrow();
  });

  it("accepts undefined (no validation pattern)", () => {
    expect(() =>
      ColumnDefinitionValidationService.validatePattern(undefined)
    ).not.toThrow();
  });

  it("rejects an invalid regex pattern", () => {
    expect(() =>
      ColumnDefinitionValidationService.validatePattern("[invalid(")
    ).toThrow(
      expect.objectContaining({
        status: 400,
        code: "COLUMN_DEFINITION_INVALID_VALIDATION_PATTERN",
      })
    );
  });

  it("rejects another invalid regex (unbalanced group)", () => {
    expect(() =>
      ColumnDefinitionValidationService.validatePattern("(abc")
    ).toThrow(
      expect.objectContaining({
        status: 400,
        code: "COLUMN_DEFINITION_INVALID_VALIDATION_PATTERN",
      })
    );
  });
});

describe("ColumnDefinitionValidationService.validateDelete", () => {
  it("passes when no field mappings reference it", async () => {
    mockFindByColumnDefId.mockResolvedValue([]);
    mockFindByRefColumnDefId.mockResolvedValue([]);

    await expect(
      ColumnDefinitionValidationService.validateDelete("cd-1"),
    ).resolves.toBeUndefined();
  });

  it("throws COLUMN_DEFINITION_HAS_DEPENDENCIES when referenced", async () => {
    mockFindByColumnDefId.mockResolvedValue([{ id: "fm-1" }]);
    mockFindByRefColumnDefId.mockResolvedValue([]);

    await expect(
      ColumnDefinitionValidationService.validateDelete("cd-1"),
    ).rejects.toMatchObject({
      code: "COLUMN_DEFINITION_HAS_DEPENDENCIES",
    });
  });

  it("throws COLUMN_DEFINITION_HAS_DEPENDENCIES when referenced via refColumnDefinitionId", async () => {
    mockFindByColumnDefId.mockResolvedValue([]);
    mockFindByRefColumnDefId.mockResolvedValue([{ id: "fm-2" }]);

    await expect(
      ColumnDefinitionValidationService.validateDelete("cd-1"),
    ).rejects.toMatchObject({
      code: "COLUMN_DEFINITION_HAS_DEPENDENCIES",
    });
  });
});
