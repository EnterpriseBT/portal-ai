/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockAssertStationScope = jest.fn<any>().mockResolvedValue(undefined);
const mockAssertWriteCapability = jest.fn<any>().mockResolvedValue(undefined);
const mockFindColDef = jest.fn<any>().mockResolvedValue({ id: "cd-1" });
const mockFindEntity = jest.fn<any>().mockResolvedValue({ id: "ce-1", organizationId: "org-1" });
const mockUpsert = jest.fn<any>().mockResolvedValue({ id: "fm-1" });

jest.unstable_mockModule("../../utils/resolve-capabilities.util.js", () => ({
  assertStationScope: mockAssertStationScope,
  assertWriteCapability: mockAssertWriteCapability,
}));
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      columnDefinitions: { findById: mockFindColDef },
      connectorEntities: { findById: mockFindEntity },
      fieldMappings: { upsertByEntityAndColumn: mockUpsert },
    },
  },
}));

const { FieldMappingCreateTool } = await import("../../tools/field-mapping-create.tool.js");

beforeEach(() => { jest.clearAllMocks(); });

interface Input { connectorEntityId: string; columnDefinitionId: string; sourceField: string; isPrimaryKey?: boolean }
const exec = (input: Input, onMutation?: () => void) =>
  new FieldMappingCreateTool().build("station-1", "user-1", onMutation)
    .execute!(input, { toolCallId: "t", messages: [], abortSignal: new AbortController().signal });

describe("FieldMappingCreateTool", () => {
  it("upserts mapping by entity + column", async () => {
    const result: any = await exec({
      connectorEntityId: "ce-1", columnDefinitionId: "cd-1", sourceField: "Name",
    });
    expect(result.success).toBe(true);
    expect(result.fieldMappingId).toBe("fm-1");
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
      connectorEntityId: "ce-1", columnDefinitionId: "cd-1", sourceField: "Name",
    }));
  });

  it("rejects if column definition does not exist", async () => {
    mockFindColDef.mockResolvedValueOnce(null);
    const result: any = await exec({
      connectorEntityId: "ce-1", columnDefinitionId: "cd-missing", sourceField: "X",
    });
    expect(result.error).toContain("not found");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("calls onMutation after success", async () => {
    const onMutation = jest.fn();
    await exec({ connectorEntityId: "ce-1", columnDefinitionId: "cd-1", sourceField: "X" }, onMutation);
    expect(onMutation).toHaveBeenCalledTimes(1);
  });
});
