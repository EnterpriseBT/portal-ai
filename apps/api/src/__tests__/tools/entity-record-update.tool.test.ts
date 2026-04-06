/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockAssertStationScope = jest.fn<any>().mockResolvedValue(undefined);
const mockAssertWriteCapability = jest.fn<any>().mockResolvedValue(undefined);
const mockNormalize = jest.fn<any>().mockResolvedValue({ normalizedData: { name: "Bob" }, validationErrors: null, isValid: true });
const mockFindById = jest.fn<any>().mockResolvedValue({ id: "rec-1", connectorEntityId: "ce-1" });
const mockUpdate = jest.fn<any>().mockResolvedValue({ id: "rec-1" });

jest.unstable_mockModule("../../utils/resolve-capabilities.util.js", () => ({
  assertStationScope: mockAssertStationScope,
  assertWriteCapability: mockAssertWriteCapability,
}));
jest.unstable_mockModule("../../services/normalization.service.js", () => ({
  NormalizationService: { normalize: mockNormalize },
}));
const mockFindEntityById = jest.fn<any>().mockResolvedValue({ id: "ce-1", label: "My Entity" });

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: { repository: { entityRecords: { findById: mockFindById, update: mockUpdate }, connectorEntities: { findById: mockFindEntityById } } },
}));

jest.unstable_mockModule("../../services/analytics.service.js", () => ({
  AnalyticsService: { applyRecordUpdate: jest.fn() },
}));

const { EntityRecordUpdateTool } = await import("../../tools/entity-record-update.tool.js");

beforeEach(() => { jest.clearAllMocks(); });

interface Input { connectorEntityId: string; entityRecordId: string; data: Record<string, unknown> }
const exec = (input: Input) =>
  new EntityRecordUpdateTool().build("station-1", "user-1")
    .execute!(input, { toolCallId: "t", messages: [], abortSignal: new AbortController().signal });

describe("EntityRecordUpdateTool", () => {
  it("updates data and normalizedData", async () => {
    const result: any = await exec({ connectorEntityId: "ce-1", entityRecordId: "rec-1", data: { Name: "Bob" } });
    expect(result.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith("rec-1", expect.objectContaining({ data: { Name: "Bob" }, updatedBy: "user-1" }));
  });

  it("passes validationErrors and isValid from normalization to update payload", async () => {
    mockNormalize.mockResolvedValueOnce({
      normalizedData: { name: "Bob" },
      validationErrors: [{ field: "age", error: "Expected a number" }],
      isValid: false,
    });
    await exec({ connectorEntityId: "ce-1", entityRecordId: "rec-1", data: { Name: "Bob" } });
    expect(mockUpdate).toHaveBeenCalledWith("rec-1", expect.objectContaining({
      normalizedData: { name: "Bob" },
      validationErrors: [{ field: "age", error: "Expected a number" }],
      isValid: false,
    }));
  });

  it("rejects if record does not belong to entity", async () => {
    mockFindById.mockResolvedValueOnce({ id: "rec-1", connectorEntityId: "ce-other" });
    const result: any = await exec({ connectorEntityId: "ce-1", entityRecordId: "rec-1", data: {} });
    expect(result.error).toContain("does not belong");
  });

  it("returns error when scope check fails", async () => {
    mockAssertStationScope.mockRejectedValueOnce(new Error("Scope fail"));
    const result: any = await exec({ connectorEntityId: "ce-1", entityRecordId: "rec-1", data: {} });
    expect(result.error).toBeDefined();
  });
});
