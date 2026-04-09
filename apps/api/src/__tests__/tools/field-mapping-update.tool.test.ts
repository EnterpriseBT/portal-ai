/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockAssertStationScope = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockAssertWriteCapability = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockFindById = jest.fn<() => Promise<unknown>>().mockResolvedValue({
  id: "fm-1", connectorEntityId: "ce-1", organizationId: "org-1", sourceField: "Name",
});
const mockUpdate = jest.fn<() => Promise<unknown>>().mockResolvedValue({ id: "fm-1" });

jest.unstable_mockModule("../../utils/resolve-capabilities.util.js", () => ({
  assertStationScope: mockAssertStationScope,
  assertWriteCapability: mockAssertWriteCapability,
}));
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: { repository: { fieldMappings: { findById: mockFindById, update: mockUpdate } } },
}));

jest.unstable_mockModule("../../services/analytics.service.js", () => ({
  AnalyticsService: { applyFieldMappingUpdate: jest.fn() },
}));

const { FieldMappingUpdateTool } = await import("../../tools/field-mapping-update.tool.js");

beforeEach(() => { jest.clearAllMocks(); });

interface Input {
  fieldMappingId: string;
  sourceField?: string;
  isPrimaryKey?: boolean;
  normalizedKey?: string;
  required?: boolean;
  defaultValue?: string | null;
  format?: string | null;
  enumValues?: string[] | null;
}
const exec = (input: Input) =>
  new FieldMappingUpdateTool().build("station-1", "org-1", "user-1")
    .execute!(input, { toolCallId: "t", messages: [], abortSignal: new AbortController().signal });

describe("FieldMappingUpdateTool", () => {
  it("updates sourceField", async () => {
    const result = await exec({ fieldMappingId: "fm-1", sourceField: "Full Name" }) as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith("fm-1", expect.objectContaining({ sourceField: "Full Name", updatedBy: "user-1" }));
  });

  it("updates isPrimaryKey", async () => {
    const result = await exec({ fieldMappingId: "fm-1", isPrimaryKey: true }) as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith("fm-1", expect.objectContaining({ isPrimaryKey: true }));
  });

  it("returns error when mapping not found", async () => {
    mockFindById.mockResolvedValueOnce(null);
    const result = await exec({ fieldMappingId: "fm-missing" }) as Record<string, unknown>;
    expect(result.error).toBeDefined();
  });

  it("returns error when scope check fails", async () => {
    mockAssertStationScope.mockRejectedValueOnce(new Error("Scope fail"));
    const result = await exec({ fieldMappingId: "fm-1", sourceField: "X" }) as Record<string, unknown>;
    expect(result.error).toBeDefined();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("updates normalizedKey", async () => {
    const result = await exec({ fieldMappingId: "fm-1", normalizedKey: "new_key" }) as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith("fm-1", expect.objectContaining({ normalizedKey: "new_key" }));
  });

  it("updates required", async () => {
    const result = await exec({ fieldMappingId: "fm-1", required: true }) as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith("fm-1", expect.objectContaining({ required: true }));
  });

  it("updates defaultValue", async () => {
    const result = await exec({ fieldMappingId: "fm-1", defaultValue: "n/a" }) as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith("fm-1", expect.objectContaining({ defaultValue: "n/a" }));
  });

  it("updates format", async () => {
    const result = await exec({ fieldMappingId: "fm-1", format: "YYYY-MM-DD" }) as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith("fm-1", expect.objectContaining({ format: "YYYY-MM-DD" }));
  });

  it("updates enumValues", async () => {
    const result = await exec({ fieldMappingId: "fm-1", enumValues: ["a", "b", "c"] }) as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith("fm-1", expect.objectContaining({ enumValues: ["a", "b", "c"] }));
  });
});
