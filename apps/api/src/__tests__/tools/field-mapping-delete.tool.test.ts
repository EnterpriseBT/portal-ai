/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockAssertStationScope = jest.fn<any>().mockResolvedValue(undefined);
const mockAssertWriteCapability = jest.fn<any>().mockResolvedValue(undefined);
const mockFindById = jest.fn<any>().mockResolvedValue({ id: "fm-1", connectorEntityId: "ce-1", organizationId: "org-1", sourceField: "Name" });
const mockValidateDelete = jest.fn<any>().mockResolvedValue(undefined);
const mockExecuteDelete = jest.fn<any>().mockResolvedValue({ cascadedEntityGroupMembers: 2, counterpartCleared: true });

jest.unstable_mockModule("../../utils/resolve-capabilities.util.js", () => ({
  assertStationScope: mockAssertStationScope,
  assertWriteCapability: mockAssertWriteCapability,
}));
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: { repository: { fieldMappings: { findById: mockFindById } } },
}));
jest.unstable_mockModule("../../services/field-mapping-validation.service.js", () => ({
  FieldMappingValidationService: { validateDelete: mockValidateDelete, executeDelete: mockExecuteDelete },
}));
jest.unstable_mockModule("../../services/analytics.service.js", () => ({
  AnalyticsService: { applyFieldMappingDeleteMany: jest.fn() },
}));

const { FieldMappingDeleteTool } = await import("../../tools/field-mapping-delete.tool.js");

beforeEach(() => { jest.clearAllMocks(); });

type Item = { fieldMappingId: string };
const exec = (input: { items: Item[] }) =>
  new FieldMappingDeleteTool().build("station-1", "org-1", "user-1")
    .execute!(input, { toolCallId: "t", messages: [], abortSignal: new AbortController().signal });

describe("FieldMappingDeleteTool", () => {
  it("single-item regression — deletes with cascaded counts", async () => {
    const result: any = await exec({ items: [{ fieldMappingId: "fm-1" }] });
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].entityId).toBe("fm-1");
    expect(mockValidateDelete).toHaveBeenCalledWith("fm-1");
    expect(mockExecuteDelete).toHaveBeenCalledWith("fm-1", "user-1");
  });

  it("bulk delete — 3 mappings deleted sequentially", async () => {
    mockFindById
      .mockResolvedValueOnce({ id: "fm-1", connectorEntityId: "ce-1", organizationId: "org-1", sourceField: "A" })
      .mockResolvedValueOnce({ id: "fm-2", connectorEntityId: "ce-1", organizationId: "org-1", sourceField: "B" })
      .mockResolvedValueOnce({ id: "fm-3", connectorEntityId: "ce-1", organizationId: "org-1", sourceField: "C" });
    mockExecuteDelete
      .mockResolvedValueOnce({ cascadedEntityGroupMembers: 1, counterpartCleared: false })
      .mockResolvedValueOnce({ cascadedEntityGroupMembers: 0, counterpartCleared: false })
      .mockResolvedValueOnce({ cascadedEntityGroupMembers: 0, counterpartCleared: true });

    const result: any = await exec({
      items: [
        { fieldMappingId: "fm-1" },
        { fieldMappingId: "fm-2" },
        { fieldMappingId: "fm-3" },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.count).toBe(3);
    expect(mockValidateDelete).toHaveBeenCalledTimes(3);
    expect(mockExecuteDelete).toHaveBeenCalledTimes(3);
    // Validate all called before any execute
    const validateOrder = mockValidateDelete.mock.invocationCallOrder;
    const executeOrder = mockExecuteDelete.mock.invocationCallOrder;
    expect(Math.max(...validateOrder)).toBeLessThan(Math.min(...executeOrder));
  });

  it("validation failure — one mapping fails validateDelete, nothing deleted", async () => {
    mockFindById
      .mockResolvedValueOnce({ id: "fm-1", connectorEntityId: "ce-1", organizationId: "org-1", sourceField: "A" })
      .mockResolvedValueOnce({ id: "fm-2", connectorEntityId: "ce-1", organizationId: "org-1", sourceField: "B" });
    mockValidateDelete
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Has records"));

    const result: any = await exec({
      items: [
        { fieldMappingId: "fm-1" },
        { fieldMappingId: "fm-2" },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.failures.some((f: any) => f.index === 1)).toBe(true);
    expect(mockExecuteDelete).not.toHaveBeenCalled();
  });

  it("validation failure — mapping not found", async () => {
    mockFindById.mockResolvedValueOnce(null);

    const result: any = await exec({ items: [{ fieldMappingId: "fm-missing" }] });

    expect(result.success).toBe(false);
    expect(mockExecuteDelete).not.toHaveBeenCalled();
  });

  it("scope check failure blocks deletion", async () => {
    mockAssertStationScope.mockRejectedValueOnce(new Error("Scope fail"));

    const result: any = await exec({ items: [{ fieldMappingId: "fm-1" }] });

    expect(result.success).toBe(false);
    expect(mockExecuteDelete).not.toHaveBeenCalled();
  });
});
