/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockAssertStationScope = jest.fn<any>().mockResolvedValue(undefined);
const mockValidateDelete = jest.fn<any>().mockResolvedValue(undefined);
const mockExecuteDelete = jest.fn<any>().mockResolvedValue({ entityRecords: 5, fieldMappings: 3, entityTagAssignments: 1, entityGroupMembers: 2 });

jest.unstable_mockModule("../../utils/resolve-capabilities.util.js", () => ({
  assertStationScope: mockAssertStationScope,
}));
const mockFindEntityById = jest.fn<any>().mockResolvedValue({ id: "ce-1", label: "My Entity" });

jest.unstable_mockModule("../../services/connector-entity-validation.service.js", () => ({
  ConnectorEntityValidationService: { validateDelete: mockValidateDelete, executeDelete: mockExecuteDelete },
}));
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: { repository: { connectorEntities: { findById: mockFindEntityById } } },
}));

jest.unstable_mockModule("../../services/analytics.service.js", () => ({
  AnalyticsService: { applyEntityDelete: jest.fn() },
}));

const { ConnectorEntityDeleteTool } = await import("../../tools/connector-entity-delete.tool.js");

beforeEach(() => { jest.clearAllMocks(); });

interface Input { connectorEntityId: string }
const exec = (input: Input) =>
  new ConnectorEntityDeleteTool().build("station-1", "user-1")
    .execute!(input, { toolCallId: "t", messages: [], abortSignal: new AbortController().signal });

describe("ConnectorEntityDeleteTool", () => {
  it("returns cascaded counts on success", async () => {
    const result: any = await exec({ connectorEntityId: "ce-1" });
    expect(result.success).toBe(true);
    expect(result.summary.cascaded.entityRecords).toBe(5);
    expect(mockExecuteDelete).toHaveBeenCalledWith("ce-1", "user-1");
  });

  it("returns error when external references exist", async () => {
    mockValidateDelete.mockRejectedValueOnce(new Error("External refs"));
    const result: any = await exec({ connectorEntityId: "ce-1" });
    expect(result.error).toBeDefined();
    expect(mockExecuteDelete).not.toHaveBeenCalled();
  });

});
