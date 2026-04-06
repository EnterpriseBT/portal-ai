/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockAssertStationScope = jest.fn<any>().mockResolvedValue(undefined);
const mockAssertWriteCapability = jest.fn<any>().mockResolvedValue(undefined);
const mockUpdate = jest.fn<any>().mockResolvedValue({ id: "ce-1" });

jest.unstable_mockModule("../../utils/resolve-capabilities.util.js", () => ({
  assertStationScope: mockAssertStationScope,
  assertWriteCapability: mockAssertWriteCapability,
}));
const mockFindById = jest.fn<any>().mockResolvedValue({ id: "ce-1", key: "contacts", label: "Contacts", connectorInstanceId: "ci-1" });

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: { repository: { connectorEntities: { findById: mockFindById, update: mockUpdate } } },
}));

jest.unstable_mockModule("../../services/analytics.service.js", () => ({
  AnalyticsService: { applyEntityUpdate: jest.fn() },
}));

const { ConnectorEntityUpdateTool } = await import("../../tools/connector-entity-update.tool.js");

beforeEach(() => { jest.clearAllMocks(); });

interface Input { connectorEntityId: string; label: string }
const exec = (input: Input) =>
  new ConnectorEntityUpdateTool().build("station-1", "user-1")
    .execute!(input, { toolCallId: "t", messages: [], abortSignal: new AbortController().signal });

describe("ConnectorEntityUpdateTool", () => {
  it("updates entity label", async () => {
    const result: any = await exec({ connectorEntityId: "ce-1", label: "New Label" });
    expect(result.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith("ce-1", expect.objectContaining({ label: "New Label", updatedBy: "user-1" }));
  });

  it("returns error when scope check fails", async () => {
    mockAssertStationScope.mockRejectedValueOnce(new Error("Scope fail"));
    const result: any = await exec({ connectorEntityId: "ce-1", label: "X" });
    expect(result.error).toBeDefined();
  });
});
