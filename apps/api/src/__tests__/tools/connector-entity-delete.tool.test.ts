/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockAssertStationScope = jest.fn<any>().mockResolvedValue(undefined);
const mockValidateDelete = jest.fn<any>().mockResolvedValue(undefined);
const mockExecuteDelete = jest.fn<any>().mockResolvedValue({ entityRecords: 5, fieldMappings: 3, entityTagAssignments: 1, entityGroupMembers: 2 });

jest.unstable_mockModule("../../utils/resolve-capabilities.util.js", () => ({
  assertStationScope: mockAssertStationScope,
}));
const mockFindEntityById = jest.fn<any>().mockResolvedValue({ id: "ce-1", key: "contacts", label: "My Entity" });

jest.unstable_mockModule("../../services/connector-entity-validation.service.js", () => ({
  ConnectorEntityValidationService: { validateDelete: mockValidateDelete, executeDelete: mockExecuteDelete },
}));
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: { repository: { connectorEntities: { findById: mockFindEntityById } } },
}));
jest.unstable_mockModule("../../services/analytics.service.js", () => ({
  AnalyticsService: { applyEntityDeleteMany: jest.fn() },
}));

const { ConnectorEntityDeleteTool } = await import("../../tools/connector-entity-delete.tool.js");

beforeEach(() => { jest.clearAllMocks(); });

type Item = { connectorEntityId: string };
const exec = (input: { items: Item[] }) =>
  new ConnectorEntityDeleteTool().build("station-1", "user-1")
    .execute!(input, { toolCallId: "t", messages: [], abortSignal: new AbortController().signal });

describe("ConnectorEntityDeleteTool", () => {
  it("single-item regression — returns cascaded counts", async () => {
    const result: any = await exec({ items: [{ connectorEntityId: "ce-1" }] });
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].entityId).toBe("ce-1");
    expect(mockExecuteDelete).toHaveBeenCalledWith("ce-1", "user-1");
  });

  it("bulk delete — 3 entities deleted sequentially", async () => {
    mockFindEntityById
      .mockResolvedValueOnce({ id: "ce-1", key: "a", label: "A" })
      .mockResolvedValueOnce({ id: "ce-2", key: "b", label: "B" })
      .mockResolvedValueOnce({ id: "ce-3", key: "c", label: "C" });
    mockExecuteDelete
      .mockResolvedValueOnce({ entityRecords: 1, fieldMappings: 0, entityTagAssignments: 0, entityGroupMembers: 0 })
      .mockResolvedValueOnce({ entityRecords: 2, fieldMappings: 1, entityTagAssignments: 0, entityGroupMembers: 0 })
      .mockResolvedValueOnce({ entityRecords: 0, fieldMappings: 0, entityTagAssignments: 0, entityGroupMembers: 0 });

    const result: any = await exec({
      items: [
        { connectorEntityId: "ce-1" },
        { connectorEntityId: "ce-2" },
        { connectorEntityId: "ce-3" },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.count).toBe(3);
    expect(mockValidateDelete).toHaveBeenCalledTimes(3);
    expect(mockExecuteDelete).toHaveBeenCalledTimes(3);
    // Validate all called before any execute
    const validateOrder = mockValidateDelete.mock.invocationCallOrder;
    const executeOrder = mockExecuteDelete.mock.invocationCallOrder;
    expect(Math.max(...validateOrder)).toBeLessThan(Math.min(...executeOrder));
  });

  it("validation failure — one entity fails validateDelete, nothing deleted", async () => {
    mockFindEntityById
      .mockResolvedValueOnce({ id: "ce-1", key: "a", label: "A" })
      .mockResolvedValueOnce({ id: "ce-2", key: "b", label: "B" });
    mockValidateDelete
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("External refs"));

    const result: any = await exec({
      items: [
        { connectorEntityId: "ce-1" },
        { connectorEntityId: "ce-2" },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.failures.some((f: any) => f.index === 1)).toBe(true);
    expect(mockExecuteDelete).not.toHaveBeenCalled();
  });

  it("scope check failure blocks deletion", async () => {
    mockAssertStationScope.mockRejectedValueOnce(new Error("Scope fail"));

    const result: any = await exec({ items: [{ connectorEntityId: "ce-1" }] });

    expect(result.success).toBe(false);
    expect(mockExecuteDelete).not.toHaveBeenCalled();
  });
});
