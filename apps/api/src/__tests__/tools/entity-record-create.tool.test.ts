/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockAssertStationScope = jest.fn<(...a: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
const mockAssertWriteCapability = jest.fn<(...a: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
const mockNormalizeMany = jest.fn<(...a: unknown[]) => Promise<unknown[]>>().mockResolvedValue([
  { normalizedData: { name: "Jane" }, validationErrors: null, isValid: true },
]);
const mockCreateMany = jest.fn<(...a: unknown[]) => Promise<unknown[]>>().mockImplementation(
  (...args: unknown[]) => {
    const items = args[0] as any[];
    return Promise.resolve(items.map((_: unknown, i: number) => ({ id: `rec-${i + 1}` })));
  },
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
const mockFindEntityById = jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue({ id: "ce-1", key: "customers", label: "My Entity" });

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      entityRecords: { createMany: mockCreateMany },
      connectorEntities: { findById: mockFindEntityById },
    },
  },
}));

jest.unstable_mockModule("../../services/analytics.service.js", () => ({
  AnalyticsService: { applyRecordInsertMany: jest.fn() },
}));

jest.unstable_mockModule("../../db/repositories/base.repository.js", () => ({
  Repository: { transaction: mockTransaction },
}));

const { EntityRecordCreateTool } = await import("../../tools/entity-record-create.tool.js");

beforeEach(() => { jest.clearAllMocks(); });

type ItemInput = { connectorEntityId: string; sourceId?: string; data: Record<string, unknown> };
const exec = (input: { items: ItemInput[] }) =>
  new EntityRecordCreateTool().build("station-1", "org-1", "user-1")
    .execute!(input, { toolCallId: "t", messages: [], abortSignal: new AbortController().signal });

describe("EntityRecordCreateTool", () => {
  it("single-item regression — { items: [single] } produces same result", async () => {
    const result: any = await exec({ items: [{ connectorEntityId: "ce-1", data: { Name: "Jane" } }] });
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].entityId).toBe("rec-1");
    expect(mockNormalizeMany).toHaveBeenCalledWith("ce-1", [{ Name: "Jane" }]);
    expect(mockCreateMany).toHaveBeenCalledWith(
      [expect.objectContaining({ connectorEntityId: "ce-1", origin: "portal", checksum: "manual" })],
      "mock-tx",
    );
  });

  it("bulk create — 3 items persisted in single createMany call", async () => {
    mockNormalizeMany.mockResolvedValueOnce([
      { normalizedData: { name: "A" }, validationErrors: null, isValid: true },
      { normalizedData: { name: "B" }, validationErrors: null, isValid: true },
      { normalizedData: { name: "C" }, validationErrors: null, isValid: true },
    ]);
    mockCreateMany.mockResolvedValueOnce([{ id: "r-1" }, { id: "r-2" }, { id: "r-3" }]);

    const result: any = await exec({
      items: [
        { connectorEntityId: "ce-1", data: { Name: "A" } },
        { connectorEntityId: "ce-1", data: { Name: "B" } },
        { connectorEntityId: "ce-1", data: { Name: "C" } },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.count).toBe(3);
    expect(result.items).toHaveLength(3);
    expect(mockAssertStationScope).toHaveBeenCalledTimes(1);
    expect(mockAssertWriteCapability).toHaveBeenCalledTimes(1);
    expect(mockNormalizeMany).toHaveBeenCalledTimes(1);
    expect(mockNormalizeMany).toHaveBeenCalledWith("ce-1", [{ Name: "A" }, { Name: "B" }, { Name: "C" }]);
    expect(mockCreateMany).toHaveBeenCalledTimes(1);
    expect((mockCreateMany.mock.calls[0] as unknown[])[0]).toHaveLength(3);
  });

  it("bulk create — mixed connectorEntityIds groups correctly", async () => {
    mockNormalizeMany
      .mockResolvedValueOnce([
        { normalizedData: { name: "A" }, validationErrors: null, isValid: true },
        { normalizedData: { name: "B" }, validationErrors: null, isValid: true },
      ])
      .mockResolvedValueOnce([
        { normalizedData: { name: "C" }, validationErrors: null, isValid: true },
      ]);
    mockFindEntityById
      .mockResolvedValueOnce({ id: "ce-1", key: "customers", label: "Customers" })
      .mockResolvedValueOnce({ id: "ce-2", key: "orders", label: "Orders" });
    mockCreateMany.mockResolvedValueOnce([{ id: "r-1" }, { id: "r-2" }, { id: "r-3" }]);

    const result: any = await exec({
      items: [
        { connectorEntityId: "ce-1", data: { Name: "A" } },
        { connectorEntityId: "ce-1", data: { Name: "B" } },
        { connectorEntityId: "ce-2", data: { Name: "C" } },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.count).toBe(3);
    expect(mockAssertStationScope).toHaveBeenCalledTimes(2);
    expect(mockAssertWriteCapability).toHaveBeenCalledTimes(2);
    expect(mockNormalizeMany).toHaveBeenCalledTimes(2);
  });

  it("validation failure — scope check fails, nothing written", async () => {
    mockAssertStationScope.mockRejectedValueOnce(new Error("Scope violation"));

    const result: any = await exec({
      items: [
        { connectorEntityId: "ce-1", data: { Name: "A" } },
        { connectorEntityId: "ce-1", data: { Name: "B" } },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.failures).toBeDefined();
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it("auto-generates sourceId per item when omitted", async () => {
    mockNormalizeMany.mockResolvedValueOnce([
      { normalizedData: { a: 1 }, validationErrors: null, isValid: true },
      { normalizedData: { b: 2 }, validationErrors: null, isValid: true },
    ]);
    mockCreateMany.mockResolvedValueOnce([{ id: "r-1" }, { id: "r-2" }]);

    await exec({
      items: [
        { connectorEntityId: "ce-1", data: { a: 1 } },
        { connectorEntityId: "ce-1", data: { b: 2 } },
      ],
    });

    const models = (mockCreateMany.mock.calls[0] as unknown[])[0] as any[];
    expect(models[0].sourceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(models[1].sourceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(models[0].sourceId).not.toBe(models[1].sourceId);
  });

  it("uses provided sourceId when given", async () => {
    await exec({ items: [{ connectorEntityId: "ce-1", data: {}, sourceId: "custom-id" }] });
    const models = (mockCreateMany.mock.calls[0] as unknown[])[0] as any[];
    expect(models[0].sourceId).toBe("custom-id");
  });

  it("sets origin portal and checksum manual on all items", async () => {
    mockNormalizeMany.mockResolvedValueOnce([
      { normalizedData: {}, validationErrors: null, isValid: true },
      { normalizedData: {}, validationErrors: null, isValid: true },
    ]);
    mockCreateMany.mockResolvedValueOnce([{ id: "r-1" }, { id: "r-2" }]);

    await exec({
      items: [
        { connectorEntityId: "ce-1", data: {} },
        { connectorEntityId: "ce-1", data: {} },
      ],
    });

    const models = (mockCreateMany.mock.calls[0] as unknown[])[0] as any[];
    for (const m of models) {
      expect(m.origin).toBe("portal");
      expect(m.checksum).toBe("manual");
    }
  });
});
