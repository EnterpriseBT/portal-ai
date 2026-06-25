import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ---------------------------------------------------------------------------
// Mocks — must register before the dynamic import below
// ---------------------------------------------------------------------------

const mockFindStationById = jest.fn<() => Promise<unknown>>();
const mockFindOrgById = jest.fn<() => Promise<unknown>>();
const mockFindColumnDefs = jest.fn<() => Promise<unknown[]>>();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      stations: { findById: mockFindStationById },
      organizations: { findById: mockFindOrgById },
      columnDefinitions: { findByOrganizationId: mockFindColumnDefs },
    },
  },
}));

const mockLoadStation = jest.fn<() => Promise<unknown>>();
jest.unstable_mockModule("../../services/analytics.service.js", () => ({
  AnalyticsService: { loadStation: mockLoadStation },
}));

const mockLoadConnectorInstanceContexts = jest
  .fn<() => Promise<unknown[]>>()
  .mockResolvedValue([]);
jest.unstable_mockModule("../../services/portal.service.js", () => ({
  loadConnectorInstanceContexts: mockLoadConnectorInstanceContexts,
}));

const mockWideTableStatementCacheGet = jest.fn<
  () => Promise<{
    columns: { columnName: string; normalizedKey: string }[];
  }>
>();
jest.unstable_mockModule(
  "../../services/wide-table-statement.cache.js",
  () => ({
    wideTableStatementCache: { get: mockWideTableStatementCacheGet },
  })
);

const mockResolveEntityCapabilities = jest
  .fn<() => Promise<Record<string, unknown>>>()
  .mockResolvedValue({});
jest.unstable_mockModule("../../utils/resolve-capabilities.util.js", () => ({
  resolveEntityCapabilities: mockResolveEntityCapabilities,
}));

// ---------------------------------------------------------------------------
// Dynamic import after mocks
// ---------------------------------------------------------------------------

const { StationContextTool } = await import(
  "../../tools/station-context.tool.js"
);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STATION_ID = "station-1";
const ORG_ID = "org-1";

const STATION_DATA = {
  entities: [
    {
      id: "ent-parcels",
      key: "parcels",
      label: "Parcels",
      connectorInstanceId: "ci-1",
      columns: [
        {
          key: "id",
          label: "ID",
          type: "number",
          columnDefinitionId: "cd-id",
          fieldMappingId: "fm-id",
          sourceField: "id",
        },
        {
          key: "address",
          label: "Address",
          type: "text",
          columnDefinitionId: "cd-addr",
          fieldMappingId: "fm-addr",
          sourceField: "address",
        },
      ],
    },
    {
      id: "ent-contacts",
      key: "contacts",
      label: "Contacts",
      connectorInstanceId: "ci-1",
      columns: [],
    },
  ],
  entityGroups: [
    {
      id: "eg-1",
      name: "Customer Orders",
      members: [
        {
          entityKey: "parcels",
          connectorEntityId: "ent-parcels",
          linkColumnKey: "owner_id",
          linkColumnLabel: "Owner ID",
          linkNormalizedKey: "owner_id",
          isPrimary: true,
        },
      ],
    },
  ],
};

function buildTool() {
  return new StationContextTool().build(STATION_ID, ORG_ID);
}

async function exec(input: Record<string, unknown> = {}) {
  const t = buildTool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await (t as any).execute(input, {
    toolCallId: "t",
    messages: [],
    abortSignal: new AbortController().signal,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StationContextTool", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindStationById.mockResolvedValue({
      id: STATION_ID,
      name: "Test Station",
    });
    mockFindOrgById.mockResolvedValue({ id: ORG_ID, timezone: "UTC" });
    mockLoadStation.mockResolvedValue(STATION_DATA);
    mockLoadConnectorInstanceContexts.mockResolvedValue([
      {
        id: "ci-1",
        name: "NASA NeoWs",
        display: "REST API",
        slug: "rest-api",
      },
    ]);
    mockWideTableStatementCacheGet.mockResolvedValue({
      columns: [
        { columnName: "c_id", normalizedKey: "id" },
        { columnName: "c_address", normalizedKey: "address" },
      ],
    });
    mockResolveEntityCapabilities.mockResolvedValue({
      "ent-parcels": { read: true, write: true, push: false },
    });
    mockFindColumnDefs.mockResolvedValue([
      {
        id: "cd-id",
        key: "id",
        label: "ID",
        type: "number",
        description: "Primary identifier",
      },
      {
        id: "cd-email",
        key: "email",
        label: "Email",
        type: "string",
        description: null,
      },
    ]);
  });

  it("returns the station header plus all sections by default", async () => {
    const result = (await exec()) as {
      station: { id: string; name: string; timezone: string };
      entities: unknown[];
      connectorInstances: unknown[];
      entityGroups: unknown[];
      columnDefinitions: unknown[];
    };

    expect(result.station).toEqual({
      id: STATION_ID,
      name: "Test Station",
      timezone: "UTC",
    });
    expect(result.entities).toHaveLength(2);
    expect(result.connectorInstances).toHaveLength(1);
    expect(result.entityGroups).toHaveLength(1);
    expect(result.columnDefinitions).toHaveLength(2);
  });

  it("returns the org column-definition catalog (#154)", async () => {
    const result = (await exec({ include: ["columnDefinitions"] })) as {
      columnDefinitions: Array<{
        columnDefinitionId: string;
        key: string;
        label: string;
        type: string;
        description: string | null;
      }>;
      entities?: unknown;
      connectorInstances?: unknown;
    };

    expect(mockFindColumnDefs).toHaveBeenCalledWith(ORG_ID);
    // Maps id → columnDefinitionId; carries key/label/type/description.
    expect(result.columnDefinitions).toEqual([
      {
        columnDefinitionId: "cd-id",
        key: "id",
        label: "ID",
        type: "number",
        description: "Primary identifier",
      },
      {
        columnDefinitionId: "cd-email",
        key: "email",
        label: "Email",
        type: "string",
        description: null,
      },
    ]);
    // include-scoping: other sections omitted.
    expect(result.entities).toBeUndefined();
    expect(result.connectorInstances).toBeUndefined();
  });

  it("attaches wideColumnName per column from the wide-table cache", async () => {
    const result = (await exec()) as {
      entities: Array<{
        key: string;
        columns: Array<{ key: string; wideColumnName: string | null }>;
      }>;
    };
    const parcels = result.entities.find((e) => e.key === "parcels")!;
    expect(parcels.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "id", wideColumnName: "c_id" }),
        expect.objectContaining({
          key: "address",
          wideColumnName: "c_address",
        }),
      ])
    );
  });

  it("falls back to wideColumnName: null when the wide table isn't provisioned", async () => {
    mockWideTableStatementCacheGet.mockRejectedValueOnce(
      new Error("table missing")
    );
    const result = (await exec({ entityKeys: ["parcels"] })) as {
      entities: Array<{
        columns: Array<{ wideColumnName: string | null }>;
      }>;
    };
    expect(result.entities[0].columns.every((c) => c.wideColumnName === null))
      .toBe(true);
  });

  it("narrows the entities array when `entityKeys` is supplied", async () => {
    const result = (await exec({ entityKeys: ["parcels"] })) as {
      entities: Array<{ key: string }>;
    };
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].key).toBe("parcels");
  });

  it("attaches connectorInstanceName per entity from the loaded instances", async () => {
    const result = (await exec({ entityKeys: ["parcels"] })) as {
      entities: Array<{ connectorInstanceName: string | null }>;
    };
    expect(result.entities[0].connectorInstanceName).toBe("NASA NeoWs");
  });

  it("includes capabilities per entity when `capabilities` is in include set", async () => {
    const result = (await exec({
      include: ["entities", "capabilities"],
      entityKeys: ["parcels"],
    })) as {
      entities: Array<{
        capabilities?: { read: boolean; write: boolean; push: boolean };
      }>;
    };
    expect(result.entities[0].capabilities).toEqual({
      read: true,
      write: true,
      push: false,
    });
  });

  it("omits sections that aren't in `include`", async () => {
    const result = (await exec({ include: ["entities"] })) as Record<
      string,
      unknown
    >;
    expect(result.entities).toBeDefined();
    expect(result.connectorInstances).toBeUndefined();
    expect(result.entityGroups).toBeUndefined();
  });

  it("falls back to UTC when the org's timezone is not a valid IANA name", async () => {
    mockFindOrgById.mockResolvedValueOnce({ id: ORG_ID, timezone: "Not/Real" });
    const result = (await exec()) as {
      station: { timezone: string };
    };
    expect(result.station.timezone).toBe("UTC");
  });
});
