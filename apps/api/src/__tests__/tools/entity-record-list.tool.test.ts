/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFindMany = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
const mockCountByEntityId = jest.fn<(...args: unknown[]) => Promise<number>>();
const mockAssertStationScope = jest.fn<(...args: unknown[]) => Promise<void>>();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      entityRecords: {
        findMany: mockFindMany,
        countByConnectorEntityId: mockCountByEntityId,
      },
    },
  },
}));

jest.unstable_mockModule("../../utils/resolve-capabilities.util.js", () => ({
  assertStationScope: mockAssertStationScope,
}));

jest.unstable_mockModule("../../db/schema/index.js", () => ({
  entityRecords: { connectorEntityId: "entity_records.connector_entity_id" },
}));

const { EntityRecordListTool } = await import(
  "../../tools/entity-record-list.tool.js"
);

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockAssertStationScope.mockResolvedValue(undefined);
});

const STATION_ID = "station-1";

function buildTool() {
  return new EntityRecordListTool().build(STATION_ID);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EntityRecordListTool", () => {
  it("returns paginated records (respects limit and offset)", async () => {
    mockFindMany.mockResolvedValue([
      { id: "r-3", sourceId: "src-3", normalizedData: { name: "C" } },
    ]);
    mockCountByEntityId.mockResolvedValue(10);

    const tool = buildTool();
    const result = await tool.execute!(
      { connectorEntityId: "ce-1", limit: 1, offset: 2 },
      { toolCallId: "tc-1", messages: [], abortSignal: new AbortController().signal },
    );

    expect(result).toEqual({
      records: [{ id: "r-3", sourceId: "src-3", normalizedData: { name: "C" } }],
      total: 10,
    });

    // Verify limit/offset were passed
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 1, offset: 2 }),
    );
  });

  it("validates station scope — rejects entity from another station", async () => {
    mockAssertStationScope.mockRejectedValue(
      Object.assign(new Error("Scope violation"), {
        code: "STATION_SCOPE_VIOLATION",
      }),
    );

    const tool = buildTool();
    await expect(
      tool.execute!(
        { connectorEntityId: "ce-other", limit: 20, offset: 0 },
        { toolCallId: "tc-1", messages: [], abortSignal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({ code: "STATION_SCOPE_VIOLATION" });

    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("returns total count alongside records", async () => {
    mockFindMany.mockResolvedValue([
      { id: "r-1", sourceId: "src-1", normalizedData: { name: "A" } },
      { id: "r-2", sourceId: "src-2", normalizedData: { name: "B" } },
    ]);
    mockCountByEntityId.mockResolvedValue(50);

    const tool = buildTool();
    const result = await tool.execute!(
      { connectorEntityId: "ce-1", limit: 20, offset: 0 },
      { toolCallId: "tc-1", messages: [], abortSignal: new AbortController().signal },
    );

    expect((result as any).total).toBe(50);
    expect((result as any).records).toHaveLength(2);
  });
});
