/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockAssertStationScope = jest.fn<any>().mockResolvedValue(undefined);
const mockAssertWriteCapability = jest.fn<any>().mockResolvedValue(undefined);
const mockNormalizeMany = jest.fn<any>().mockResolvedValue([
  { normalizedData: { name: "Bob" }, validationErrors: null, isValid: true },
]);
const mockFindRecordById = jest.fn<any>().mockResolvedValue({ id: "rec-1", connectorEntityId: "ce-1" });
const mockUpdateMany = jest.fn<any>().mockImplementation(
  (payloads: any[]) => Promise.resolve(payloads.map((p: any) => ({ id: p.id }))),
);
const mockTransaction = jest.fn<(fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>>()
  .mockImplementation((fn) => fn("mock-tx"));

jest.unstable_mockModule("../../utils/resolve-capabilities.util.js", () => ({
  assertStationScope: mockAssertStationScope,
  assertWriteCapability: mockAssertWriteCapability,
}));
jest.unstable_mockModule("../../services/normalization.service.js", () => ({
  NormalizationService: { normalizeMany: mockNormalizeMany },
}));
const mockFindEntityById = jest.fn<any>().mockResolvedValue({ id: "ce-1", key: "customers", label: "My Entity" });

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      entityRecords: { findById: mockFindRecordById, updateMany: mockUpdateMany },
      connectorEntities: { findById: mockFindEntityById },
    },
  },
}));

jest.unstable_mockModule("../../services/analytics.service.js", () => ({
  AnalyticsService: { applyRecordUpdateMany: jest.fn() },
}));

jest.unstable_mockModule("../../db/repositories/base.repository.js", () => ({
  Repository: { transaction: mockTransaction },
}));

const { EntityRecordUpdateTool } = await import("../../tools/entity-record-update.tool.js");

beforeEach(() => { jest.clearAllMocks(); });

type ItemInput = { connectorEntityId: string; entityRecordId: string; data: Record<string, unknown> };
const exec = (input: { items: ItemInput[] }) =>
  new EntityRecordUpdateTool().build("station-1", "user-1")
    .execute!(input, { toolCallId: "t", messages: [], abortSignal: new AbortController().signal });

describe("EntityRecordUpdateTool", () => {
  it("single-item regression — { items: [single] } behaves as before", async () => {
    const result: any = await exec({ items: [{ connectorEntityId: "ce-1", entityRecordId: "rec-1", data: { Name: "Bob" } }] });
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(mockNormalizeMany).toHaveBeenCalledWith("ce-1", [{ Name: "Bob" }]);
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
  });

  it("bulk update — 3 items updated in single transaction", async () => {
    mockFindRecordById
      .mockResolvedValueOnce({ id: "rec-1", connectorEntityId: "ce-1" })
      .mockResolvedValueOnce({ id: "rec-2", connectorEntityId: "ce-1" })
      .mockResolvedValueOnce({ id: "rec-3", connectorEntityId: "ce-1" });
    mockNormalizeMany.mockResolvedValueOnce([
      { normalizedData: { a: 1 }, validationErrors: null, isValid: true },
      { normalizedData: { b: 2 }, validationErrors: null, isValid: true },
      { normalizedData: { c: 3 }, validationErrors: null, isValid: true },
    ]);

    const result: any = await exec({
      items: [
        { connectorEntityId: "ce-1", entityRecordId: "rec-1", data: { a: 1 } },
        { connectorEntityId: "ce-1", entityRecordId: "rec-2", data: { b: 2 } },
        { connectorEntityId: "ce-1", entityRecordId: "rec-3", data: { c: 3 } },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.count).toBe(3);
    expect(mockAssertStationScope).toHaveBeenCalledTimes(1);
    expect(mockAssertWriteCapability).toHaveBeenCalledTimes(1);
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    expect((mockUpdateMany.mock.calls[0] as any[])[0]).toHaveLength(3);
  });

  it("validation failure — record not found, nothing written", async () => {
    mockFindRecordById
      .mockResolvedValueOnce({ id: "rec-1", connectorEntityId: "ce-1" })
      .mockResolvedValueOnce(null);

    const result: any = await exec({
      items: [
        { connectorEntityId: "ce-1", entityRecordId: "rec-1", data: {} },
        { connectorEntityId: "ce-1", entityRecordId: "rec-missing", data: {} },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.failures).toBeDefined();
    expect(result.failures.some((f: any) => f.index === 1)).toBe(true);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("validation failure — record belongs to wrong entity", async () => {
    mockFindRecordById.mockResolvedValueOnce({ id: "rec-1", connectorEntityId: "ce-other" });

    const result: any = await exec({
      items: [{ connectorEntityId: "ce-1", entityRecordId: "rec-1", data: {} }],
    });

    expect(result.success).toBe(false);
    expect(result.failures[0].error).toContain("does not belong");
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("validation failure — scope check fails", async () => {
    mockAssertStationScope.mockRejectedValueOnce(new Error("Scope fail"));

    const result: any = await exec({
      items: [{ connectorEntityId: "ce-1", entityRecordId: "rec-1", data: {} }],
    });

    expect(result.success).toBe(false);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});
