/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockAssertStationScope = jest.fn<any>().mockResolvedValue(undefined);
const mockAssertWriteCapability = jest.fn<any>().mockResolvedValue(undefined);
const mockFindRecordById = jest.fn<any>().mockResolvedValue({ id: "rec-1", connectorEntityId: "ce-1" });
const mockSoftDeleteMany = jest.fn<any>().mockResolvedValue(1);
const mockTransaction = jest.fn<(fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>>()
  .mockImplementation((fn) => fn("mock-tx"));

jest.unstable_mockModule("../../utils/resolve-capabilities.util.js", () => ({
  assertStationScope: mockAssertStationScope,
  assertWriteCapability: mockAssertWriteCapability,
}));
const mockFindEntityById = jest.fn<any>().mockResolvedValue({ id: "ce-1", key: "customers", label: "My Entity" });

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      entityRecords: { findById: mockFindRecordById, softDeleteMany: mockSoftDeleteMany },
      connectorEntities: { findById: mockFindEntityById },
    },
  },
}));

jest.unstable_mockModule("../../services/analytics.service.js", () => ({
  AnalyticsService: { applyRecordDeleteMany: jest.fn() },
}));

jest.unstable_mockModule("../../db/repositories/base.repository.js", () => ({
  Repository: { transaction: mockTransaction },
}));

const { EntityRecordDeleteTool } = await import("../../tools/entity-record-delete.tool.js");

beforeEach(() => { jest.clearAllMocks(); });

type ItemInput = { connectorEntityId: string; entityRecordId: string };
const exec = (input: { items: ItemInput[] }) =>
  new EntityRecordDeleteTool().build("station-1", "user-1")
    .execute!(input, { toolCallId: "t", messages: [], abortSignal: new AbortController().signal });

describe("EntityRecordDeleteTool", () => {
  it("single-item regression — soft-deletes the record", async () => {
    const result: any = await exec({ items: [{ connectorEntityId: "ce-1", entityRecordId: "rec-1" }] });
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].entityId).toBe("rec-1");
    expect(mockSoftDeleteMany).toHaveBeenCalledWith(["rec-1"], "user-1", "mock-tx");
  });

  it("bulk delete — 3 items soft-deleted via softDeleteMany", async () => {
    mockFindRecordById
      .mockResolvedValueOnce({ id: "rec-1", connectorEntityId: "ce-1" })
      .mockResolvedValueOnce({ id: "rec-2", connectorEntityId: "ce-1" })
      .mockResolvedValueOnce({ id: "rec-3", connectorEntityId: "ce-1" });
    mockSoftDeleteMany.mockResolvedValueOnce(3);

    const result: any = await exec({
      items: [
        { connectorEntityId: "ce-1", entityRecordId: "rec-1" },
        { connectorEntityId: "ce-1", entityRecordId: "rec-2" },
        { connectorEntityId: "ce-1", entityRecordId: "rec-3" },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.count).toBe(3);
    expect(result.items).toHaveLength(3);
    expect(mockAssertStationScope).toHaveBeenCalledTimes(1);
    expect(mockAssertWriteCapability).toHaveBeenCalledTimes(1);
    expect(mockSoftDeleteMany).toHaveBeenCalledWith(["rec-1", "rec-2", "rec-3"], "user-1", "mock-tx");
  });

  it("validation failure — record not found, nothing deleted", async () => {
    mockFindRecordById
      .mockResolvedValueOnce({ id: "rec-1", connectorEntityId: "ce-1" })
      .mockResolvedValueOnce(null);

    const result: any = await exec({
      items: [
        { connectorEntityId: "ce-1", entityRecordId: "rec-1" },
        { connectorEntityId: "ce-1", entityRecordId: "rec-missing" },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.failures).toBeDefined();
    expect(result.failures.some((f: any) => f.index === 1)).toBe(true);
    expect(mockSoftDeleteMany).not.toHaveBeenCalled();
  });

  it("validation failure — record belongs to wrong entity", async () => {
    mockFindRecordById.mockResolvedValueOnce({ id: "rec-1", connectorEntityId: "ce-other" });

    const result: any = await exec({
      items: [{ connectorEntityId: "ce-1", entityRecordId: "rec-1" }],
    });

    expect(result.success).toBe(false);
    expect(mockSoftDeleteMany).not.toHaveBeenCalled();
  });

  it("returns error when write check fails", async () => {
    mockAssertWriteCapability.mockRejectedValueOnce(new Error("Write disabled"));

    const result: any = await exec({
      items: [{ connectorEntityId: "ce-1", entityRecordId: "rec-1" }],
    });

    expect(result.success).toBe(false);
    expect(mockSoftDeleteMany).not.toHaveBeenCalled();
  });
});
