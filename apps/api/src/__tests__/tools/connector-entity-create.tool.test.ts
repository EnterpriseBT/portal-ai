/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockFindByStationId = jest.fn<() => Promise<unknown[]>>().mockResolvedValue([
  { connectorInstanceId: "ci-1", stationId: "station-1" },
]);
const mockFindInstanceById = jest.fn<() => Promise<unknown>>().mockResolvedValue({
  id: "ci-1", organizationId: "org-1", connectorDefinitionId: "cd-1", enabledCapabilityFlags: null,
});
const mockFindDefinitionById = jest.fn<() => Promise<unknown>>().mockResolvedValue({
  id: "cd-1", capabilityFlags: { query: true, write: true },
});
const mockUpsertByKey = jest.fn<() => Promise<unknown>>().mockResolvedValue({ id: "ce-new" });

jest.unstable_mockModule("../../db/repositories/station-instances.repository.js", () => ({
  stationInstancesRepo: { findByStationId: mockFindByStationId },
}));
jest.unstable_mockModule("../../db/repositories/connector-definitions.repository.js", () => ({
  connectorDefinitionsRepo: { findById: mockFindDefinitionById },
}));
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      connectorInstances: { findById: mockFindInstanceById },
      connectorEntities: { upsertByKey: mockUpsertByKey },
    },
  },
}));

const { ConnectorEntityCreateTool } = await import("../../tools/connector-entity-create.tool.js");

beforeEach(() => { jest.clearAllMocks(); });

interface Input { connectorInstanceId: string; key: string; label: string }
const exec = (input: Input, onMutation?: () => void) =>
  new ConnectorEntityCreateTool().build("station-1", "user-1", onMutation)
    .execute!(input, { toolCallId: "t", messages: [], abortSignal: new AbortController().signal });

describe("ConnectorEntityCreateTool", () => {
  it("creates entity via upsertByKey", async () => {
    const result = await exec({ connectorInstanceId: "ci-1", key: "contacts", label: "Contacts" }) as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(result.entityId).toBe("ce-new");
    expect(mockUpsertByKey).toHaveBeenCalledWith(expect.objectContaining({ key: "contacts", label: "Contacts" }));
  });

  it("rejects when instance is not attached to station", async () => {
    const result = await exec({ connectorInstanceId: "ci-other", key: "k", label: "L" }) as Record<string, unknown>;
    expect(result.error).toBeDefined();
    expect(mockUpsertByKey).not.toHaveBeenCalled();
  });

  it("rejects when instance does not have write capability", async () => {
    mockFindDefinitionById.mockResolvedValueOnce({
      id: "cd-1", capabilityFlags: { query: true, write: false },
    });

    const result = await exec({ connectorInstanceId: "ci-1", key: "k", label: "L" }) as Record<string, unknown>;
    expect(result.error).toContain("write capability");
    expect(mockUpsertByKey).not.toHaveBeenCalled();
  });

  it("rejects when instance overrides narrow write to false", async () => {
    mockFindInstanceById.mockResolvedValueOnce({
      id: "ci-1", organizationId: "org-1", connectorDefinitionId: "cd-1",
      enabledCapabilityFlags: { write: false },
    });

    const result = await exec({ connectorInstanceId: "ci-1", key: "k", label: "L" }) as Record<string, unknown>;
    expect(result.error).toContain("write capability");
    expect(mockUpsertByKey).not.toHaveBeenCalled();
  });

  it("calls onMutation after success", async () => {
    const onMutation = jest.fn();
    await exec({ connectorInstanceId: "ci-1", key: "k", label: "L" }, onMutation);
    expect(onMutation).toHaveBeenCalledTimes(1);
  });
});
