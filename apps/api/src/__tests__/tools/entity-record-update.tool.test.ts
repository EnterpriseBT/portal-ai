/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockAssertStationScope = jest.fn<any>().mockResolvedValue(undefined);
const mockAssertWriteCapability = jest.fn<any>().mockResolvedValue(undefined);
const mockNormalize = jest.fn<any>().mockResolvedValue({ name: "Bob" });
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

const { EntityRecordUpdateTool } = await import("../../tools/entity-record-update.tool.js");

beforeEach(() => { jest.clearAllMocks(); });

interface Input { connectorEntityId: string; entityRecordId: string; data: Record<string, unknown> }
const exec = (input: Input, onMutation?: () => void) =>
  new EntityRecordUpdateTool().build("station-1", "user-1", onMutation)
    .execute!(input, { toolCallId: "t", messages: [], abortSignal: new AbortController().signal });

describe("EntityRecordUpdateTool", () => {
  it("updates data and normalizedData", async () => {
    const result: any = await exec({ connectorEntityId: "ce-1", entityRecordId: "rec-1", data: { Name: "Bob" } });
    expect(result.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith("rec-1", expect.objectContaining({ data: { Name: "Bob" }, updatedBy: "user-1" }));
  });

  it("rejects if record does not belong to entity", async () => {
    mockFindById.mockResolvedValueOnce({ id: "rec-1", connectorEntityId: "ce-other" });
    const result: any = await exec({ connectorEntityId: "ce-1", entityRecordId: "rec-1", data: {} });
    expect(result.error).toContain("does not belong");
  });

  it("calls onMutation after successful write", async () => {
    const onMutation = jest.fn();
    await exec({ connectorEntityId: "ce-1", entityRecordId: "rec-1", data: {} }, onMutation);
    expect(onMutation).toHaveBeenCalledTimes(1);
  });

  it("returns error when scope check fails", async () => {
    mockAssertStationScope.mockRejectedValueOnce(new Error("Scope fail"));
    const result: any = await exec({ connectorEntityId: "ce-1", entityRecordId: "rec-1", data: {} });
    expect(result.error).toBeDefined();
  });
});
