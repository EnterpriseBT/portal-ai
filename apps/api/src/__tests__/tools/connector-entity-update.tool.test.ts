/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockAssertStationScope = jest.fn<any>().mockResolvedValue(undefined);
const mockAssertWriteCapability = jest.fn<any>().mockResolvedValue(undefined);
const mockFindById = jest
  .fn<any>()
  .mockResolvedValue({
    id: "ce-1",
    key: "contacts",
    label: "Contacts",
    connectorInstanceId: "ci-1",
  });
const mockUpdate = jest.fn<any>().mockResolvedValue({ id: "ce-1" });
const mockTransaction = jest
  .fn<(fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>>()
  .mockImplementation((fn) => fn("mock-tx"));

jest.unstable_mockModule("../../utils/resolve-capabilities.util.js", () => ({
  assertStationScope: mockAssertStationScope,
  assertWriteCapability: mockAssertWriteCapability,
}));
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      connectorEntities: { findById: mockFindById, update: mockUpdate },
    },
  },
}));
jest.unstable_mockModule("../../services/analytics.service.js", () => ({
  AnalyticsService: { applyEntityUpdateMany: jest.fn() },
}));
jest.unstable_mockModule("../../db/repositories/base.repository.js", () => ({
  Repository: { transaction: mockTransaction },
}));

const { ConnectorEntityUpdateTool } =
  await import("../../tools/connector-entity-update.tool.js");

beforeEach(() => {
  jest.clearAllMocks();
});

type Item = { connectorEntityId: string; label: string };
const exec = (input: { items: Item[] }) =>
  new ConnectorEntityUpdateTool().build("station-1", "user-1").execute!(input, {
    toolCallId: "t",
    messages: [],
    abortSignal: new AbortController().signal,
  });

describe("ConnectorEntityUpdateTool", () => {
  it("single-item regression — updates entity label", async () => {
    const result: any = await exec({
      items: [{ connectorEntityId: "ce-1", label: "New Label" }],
    });
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(mockUpdate).toHaveBeenCalledWith(
      "ce-1",
      expect.objectContaining({ label: "New Label", updatedBy: "user-1" }),
      "mock-tx"
    );
  });

  it("bulk update — 3 entities updated in transaction", async () => {
    mockFindById
      .mockResolvedValueOnce({
        id: "ce-1",
        key: "a",
        label: "A",
        connectorInstanceId: "ci-1",
      })
      .mockResolvedValueOnce({
        id: "ce-2",
        key: "b",
        label: "B",
        connectorInstanceId: "ci-1",
      })
      .mockResolvedValueOnce({
        id: "ce-3",
        key: "c",
        label: "C",
        connectorInstanceId: "ci-1",
      });

    const result: any = await exec({
      items: [
        { connectorEntityId: "ce-1", label: "A2" },
        { connectorEntityId: "ce-2", label: "B2" },
        { connectorEntityId: "ce-3", label: "C2" },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.count).toBe(3);
    expect(mockAssertStationScope).toHaveBeenCalledTimes(3);
    expect(mockUpdate).toHaveBeenCalledTimes(3);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("validation failure — entity not found", async () => {
    mockFindById.mockResolvedValueOnce(null);

    const result: any = await exec({
      items: [{ connectorEntityId: "ce-missing", label: "X" }],
    });

    expect(result.success).toBe(false);
    expect(result.failures[0].error).toContain("not found");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("scope check failure blocks all items for that entity", async () => {
    mockAssertStationScope.mockRejectedValueOnce(new Error("Scope fail"));

    const result: any = await exec({
      items: [{ connectorEntityId: "ce-1", label: "X" }],
    });

    expect(result.success).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
