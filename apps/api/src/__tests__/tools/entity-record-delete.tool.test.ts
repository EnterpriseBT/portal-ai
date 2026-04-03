/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockAssertStationScope = jest.fn<any>().mockResolvedValue(undefined);
const mockAssertWriteCapability = jest.fn<any>().mockResolvedValue(undefined);
const mockFindById = jest.fn<any>().mockResolvedValue({ id: "rec-1", connectorEntityId: "ce-1" });
const mockSoftDelete = jest.fn<any>().mockResolvedValue({ id: "rec-1" });

jest.unstable_mockModule("../../utils/resolve-capabilities.util.js", () => ({
  assertStationScope: mockAssertStationScope,
  assertWriteCapability: mockAssertWriteCapability,
}));
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: { repository: { entityRecords: { findById: mockFindById, softDelete: mockSoftDelete } } },
}));

const { EntityRecordDeleteTool } = await import("../../tools/entity-record-delete.tool.js");

beforeEach(() => { jest.clearAllMocks(); });

interface Input { connectorEntityId: string; entityRecordId: string }
const exec = (input: Input, onMutation?: () => void) =>
  new EntityRecordDeleteTool().build("station-1", "user-1", onMutation)
    .execute!(input, { toolCallId: "t", messages: [], abortSignal: new AbortController().signal });

describe("EntityRecordDeleteTool", () => {
  it("soft-deletes the record", async () => {
    const result: any = await exec({ connectorEntityId: "ce-1", entityRecordId: "rec-1" });
    expect(result.success).toBe(true);
    expect(mockSoftDelete).toHaveBeenCalledWith("rec-1", "user-1");
  });

  it("rejects if record does not belong to entity", async () => {
    mockFindById.mockResolvedValueOnce({ id: "rec-1", connectorEntityId: "ce-other" });
    const result: any = await exec({ connectorEntityId: "ce-1", entityRecordId: "rec-1" });
    expect(result.error).toContain("does not belong");
  });

  it("calls onMutation after successful delete", async () => {
    const onMutation = jest.fn();
    await exec({ connectorEntityId: "ce-1", entityRecordId: "rec-1" }, onMutation);
    expect(onMutation).toHaveBeenCalledTimes(1);
  });

  it("returns error when write check fails", async () => {
    mockAssertWriteCapability.mockRejectedValueOnce(new Error("Write disabled"));
    const result: any = await exec({ connectorEntityId: "ce-1", entityRecordId: "rec-1" });
    expect(result.error).toBeDefined();
    expect(mockSoftDelete).not.toHaveBeenCalled();
  });
});
