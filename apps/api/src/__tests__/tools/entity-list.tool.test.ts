/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFindByStationId = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
const mockFindByConnectorInstanceId = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();

jest.unstable_mockModule(
  "../../db/repositories/station-instances.repository.js",
  () => ({
    stationInstancesRepo: { findByStationId: mockFindByStationId },
  }),
);

jest.unstable_mockModule(
  "../../db/repositories/connector-entities.repository.js",
  () => ({
    connectorEntitiesRepo: {
      findByConnectorInstanceId: mockFindByConnectorInstanceId,
    },
  }),
);

// DbService not used directly but imported by the module
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: { repository: {} },
}));

const { EntityListTool } = await import("../../tools/entity-list.tool.js");

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

const STATION_ID = "station-1";

function buildTool() {
  return new EntityListTool().build(STATION_ID);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EntityListTool", () => {
  it("returns only entities attached to station", async () => {
    mockFindByStationId.mockResolvedValue([
      { connectorInstanceId: "ci-1", stationId: STATION_ID },
    ]);
    mockFindByConnectorInstanceId.mockResolvedValue([
      { id: "e-1", key: "contacts", label: "Contacts", connectorInstanceId: "ci-1" },
      { id: "e-2", key: "orders", label: "Orders", connectorInstanceId: "ci-1" },
    ]);

    const tool = buildTool();
    const result = await tool.execute!({}, { toolCallId: "tc-1", messages: [], abortSignal: new AbortController().signal });

    expect(result).toEqual({
      entities: [
        { id: "e-1", key: "contacts", label: "Contacts", connectorInstanceId: "ci-1" },
        { id: "e-2", key: "orders", label: "Orders", connectorInstanceId: "ci-1" },
      ],
    });
  });

  it("filters by connectorInstanceId when provided", async () => {
    mockFindByStationId.mockResolvedValue([
      { connectorInstanceId: "ci-1", stationId: STATION_ID },
      { connectorInstanceId: "ci-2", stationId: STATION_ID },
    ]);
    mockFindByConnectorInstanceId.mockImplementation(async (id: unknown) => {
      if (id === "ci-1")
        return [{ id: "e-1", key: "contacts", label: "Contacts", connectorInstanceId: "ci-1" }];
      if (id === "ci-2")
        return [{ id: "e-2", key: "orders", label: "Orders", connectorInstanceId: "ci-2" }];
      return [];
    });

    const tool = buildTool();
    const result = await tool.execute!(
      { connectorInstanceId: "ci-1" },
      { toolCallId: "tc-1", messages: [], abortSignal: new AbortController().signal },
    );

    expect((result as any).entities).toHaveLength(1);
    expect((result as any).entities[0].id).toBe("e-1");
  });

  it("returns empty array for station with no entities", async () => {
    mockFindByStationId.mockResolvedValue([]);

    const tool = buildTool();
    const result = await tool.execute!({}, { toolCallId: "tc-1", messages: [], abortSignal: new AbortController().signal });

    expect(result).toEqual({ entities: [] });
  });
});
