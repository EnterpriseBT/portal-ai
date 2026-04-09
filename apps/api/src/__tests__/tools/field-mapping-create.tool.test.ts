/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockAssertStationScope = jest.fn<any>().mockResolvedValue(undefined);
const mockAssertWriteCapability = jest.fn<any>().mockResolvedValue(undefined);
const mockFindColDef = jest.fn<any>().mockResolvedValue({ id: "cd-1", organizationId: "org-1", label: "Column 1" });
const mockUpsert = jest.fn<any>().mockResolvedValue({ id: "fm-1" });

jest.unstable_mockModule("../../utils/resolve-capabilities.util.js", () => ({
  assertStationScope: mockAssertStationScope,
  assertWriteCapability: mockAssertWriteCapability,
}));
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      columnDefinitions: { findById: mockFindColDef },
      fieldMappings: { upsertByEntityAndNormalizedKey: mockUpsert },
    },
  },
}));

jest.unstable_mockModule("../../services/analytics.service.js", () => ({
  AnalyticsService: { applyFieldMappingInsert: jest.fn() },
}));

const { FieldMappingCreateTool } = await import("../../tools/field-mapping-create.tool.js");

beforeEach(() => { jest.clearAllMocks(); });

interface Input { connectorEntityId: string; columnDefinitionId: string; sourceField: string; isPrimaryKey?: boolean; normalizedKey: string; required?: boolean; defaultValue?: string | null; format?: string | null; enumValues?: string[] | null }
const exec = (input: Input) =>
  new FieldMappingCreateTool().build("station-1", "org-1", "user-1")
    .execute!(input, { toolCallId: "t", messages: [], abortSignal: new AbortController().signal });

describe("FieldMappingCreateTool", () => {
  it("upserts mapping by entity + column", async () => {
    const result: any = await exec({
      connectorEntityId: "ce-1", columnDefinitionId: "cd-1", sourceField: "Name", normalizedKey: "name",
    });
    expect(result.success).toBe(true);
    expect(result.entityId).toBe("fm-1");
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
      connectorEntityId: "ce-1", columnDefinitionId: "cd-1", sourceField: "Name",
      normalizedKey: "name", required: false, defaultValue: null, format: null, enumValues: null,
    }));
  });

  it("rejects if column definition does not exist", async () => {
    mockFindColDef.mockResolvedValueOnce(null);
    const result: any = await exec({
      connectorEntityId: "ce-1", columnDefinitionId: "cd-missing", sourceField: "X", normalizedKey: "x_field",
    });
    expect(result.error).toContain("not found");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

});
