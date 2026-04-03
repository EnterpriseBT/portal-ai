/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockAssertStationScope = jest.fn<any>().mockResolvedValue(undefined);
const mockAssertWriteCapability = jest.fn<any>().mockResolvedValue(undefined);
const mockFindById = jest.fn<any>().mockResolvedValue({ id: "fm-1", connectorEntityId: "ce-1", organizationId: "org-1" });
const mockValidateDelete = jest.fn<any>().mockResolvedValue(undefined);
const mockExecuteDelete = jest.fn<any>().mockResolvedValue({ cascadedEntityGroupMembers: 2, bidirectionalCleared: true });

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

const { FieldMappingDeleteTool } = await import("../../tools/field-mapping-delete.tool.js");

beforeEach(() => { jest.clearAllMocks(); });

interface Input { fieldMappingId: string }
const exec = (input: Input, onMutation?: () => void) =>
  new FieldMappingDeleteTool().build("station-1", "org-1", "user-1", onMutation)
    .execute!(input, { toolCallId: "t", messages: [], abortSignal: new AbortController().signal });

describe("FieldMappingDeleteTool", () => {
  it("returns cascaded counts (entityGroupMembers, bidirectionalCleared)", async () => {
    const result: any = await exec({ fieldMappingId: "fm-1" });
    expect(result.success).toBe(true);
    expect(result.cascaded.entityGroupMembers).toBe(2);
    expect(result.cascaded.bidirectionalCleared).toBe(true);
  });

  it("returns error when entity has records", async () => {
    mockValidateDelete.mockRejectedValueOnce(new Error("Has records"));
    const result: any = await exec({ fieldMappingId: "fm-1" });
    expect(result.error).toBeDefined();
    expect(mockExecuteDelete).not.toHaveBeenCalled();
  });

  it("calls onMutation after success", async () => {
    const onMutation = jest.fn();
    await exec({ fieldMappingId: "fm-1" }, onMutation);
    expect(onMutation).toHaveBeenCalledTimes(1);
  });

  it("returns error when scope check fails", async () => {
    mockAssertStationScope.mockRejectedValueOnce(new Error("Scope fail"));
    const result: any = await exec({ fieldMappingId: "fm-1" });
    expect(result.error).toBeDefined();
  });
});
