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
