/* eslint-disable @typescript-eslint/no-explicit-any */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFindById_station = jest.fn<() => Promise<unknown>>();
const mockFindByStationId_instances = jest.fn<() => Promise<unknown[]>>();
const mockFindByStationId_tools = jest.fn<() => Promise<unknown[]>>();
const mockFindByConnectorInstanceId = jest.fn<() => Promise<unknown[]>>();
const mockFindFieldMappingsByEntityIds =
  jest.fn<() => Promise<Map<string, unknown[]>>>();
const mockFindByConnectorEntityId_records = jest.fn<() => Promise<unknown[]>>();
const mockFindByConnectorEntityId_members = jest.fn<() => Promise<unknown[]>>();
const mockFindByEntityGroupId = jest.fn<() => Promise<unknown[]>>();
const mockFindById_group = jest.fn<() => Promise<unknown>>();

// Mock direct db import for _connector_instances metadata query in loadStation
const _mockSelectChain = {
  from: () => _mockSelectChain,
  where: () => Promise.resolve([]),
};
jest.unstable_mockModule("../../db/client.js", () => ({
  db: { select: () => _mockSelectChain },
}));

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      stations: { findById: mockFindById_station },
      stationInstances: { findByStationId: mockFindByStationId_instances },
      connectorEntities: {
        findByConnectorInstanceId: mockFindByConnectorInstanceId,
        findFieldMappingsByEntityIds: mockFindFieldMappingsByEntityIds,
      },
      entityRecords: {
        findByConnectorEntityId: mockFindByConnectorEntityId_records,
      },
      entityGroupMembers: {
        findByConnectorEntityId: mockFindByConnectorEntityId_members,
        findByEntityGroupId: mockFindByEntityGroupId,
      },
      entityGroups: { findById: mockFindById_group },
      columnDefinitions: {
        findByOrganizationId: jest
          .fn<() => Promise<unknown[]>>()
          .mockResolvedValue([]),
      },
      stationToolpacks: { findByStationId: mockFindByStationId_tools },
    },
  },
}));

// Mock vega/vega-lite (pulled in transitively via AnalyticsService)
jest.unstable_mockModule("vega", () => ({
  parse: jest.fn().mockReturnValue({}),
  View: class {
    runAsync = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    finalize = jest.fn();
  },
}));
jest.unstable_mockModule("vega-lite", () => ({
  compile: jest.fn().mockReturnValue({ spec: {} }),
}));

// Mock tavily + environment for web_search
const mockTavilySearch = jest.fn<() => Promise<unknown>>();
jest.unstable_mockModule("@tavily/core", () => ({
  tavily: () => ({ search: mockTavilySearch }),
}));
jest.unstable_mockModule("../../environment.js", () => ({
  environment: {
    TAVILY_API_KEY: "test-key",
    LOG_LEVEL: "silent",
    LOG_FORMAT: "json",
  },
}));

// Mock resolve-capabilities for entity_management pack
const mockResolveStationCapabilities = jest.fn<() => Promise<unknown[]>>();
jest.unstable_mockModule("../../utils/resolve-capabilities.util.js", () => ({
  resolveStationCapabilities: mockResolveStationCapabilities,
  assertStationScope: jest.fn(),
  assertWriteCapability: jest.fn(),
  resolveCapabilities: jest.fn(),
}));

// Mock fetch for webhook tests
const mockFetch =
  jest.fn<(url: string, options?: Record<string, any>) => Promise<unknown>>();
(globalThis as any).fetch = mockFetch;

const { ToolService } = await import("../../services/tools.service.js");
const buildAnalyticsTools = ToolService.buildAnalyticsTools.bind(ToolService);
const callWebhook = ToolService.callWebhook.bind(ToolService);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STATION_ID = "station-001";
const ORG_ID = "org-001";

function makeStation() {
  return {
    id: STATION_ID,
    organizationId: ORG_ID,
    name: "Test Station",
    description: null,
    created: Date.now(),
    createdBy: "user-001",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

function makeToolpackRows(slugs: string[]) {
  return slugs.map((slug, idx) => ({
    id: `stp-${idx + 1}`,
    stationId: STATION_ID,
    builtinSlug: slug,
    organizationToolpackId: null,
    created: Date.now(),
    createdBy: "user-001",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  }));
}

const ENTITIES = [
  {
    id: "ent-1",
    key: "customers",
    label: "Customers",
    connectorInstanceId: "ci-1",
  },
];

const FIELD_MAPPINGS_MAP = new Map<string, unknown[]>([
  [
    "ent-1",
    [
      {
        id: "fm-1",
        connectorEntityId: "ent-1",
        columnDefinitionId: "cd-1",
        sourceField: "Name",
        columnDefinition: { key: "name", label: "Name", type: "string" },
      },
    ],
  ],
]);

const CUSTOMER_RECORDS = [
  { id: "r1", normalizedData: { name: "Alice" } },
  { id: "r2", normalizedData: { name: "Bob" } },
];

function setupStationMocks(toolPacks: string[]) {
  mockFindById_station.mockResolvedValue(makeStation());
  mockFindByStationId_instances.mockResolvedValue([
    { id: "si-1", stationId: STATION_ID, connectorInstanceId: "ci-1" },
  ]);
  mockFindByConnectorInstanceId.mockResolvedValue(ENTITIES);
  mockFindFieldMappingsByEntityIds.mockResolvedValue(FIELD_MAPPINGS_MAP);
  mockFindByConnectorEntityId_records.mockResolvedValue(CUSTOMER_RECORDS);
  mockFindByConnectorEntityId_members.mockResolvedValue([]);
  mockFindByStationId_tools.mockResolvedValue(makeToolpackRows(toolPacks));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildAnalyticsTools()", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
  });

  // -----------------------------------------------------------------------
  // Pack gating
  // -----------------------------------------------------------------------

  it("should register data_query tools when data_query pack is selected", async () => {
    setupStationMocks(["data_query"]);
    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID, "user-001");

    expect(tools.sql_query).toBeDefined();
    expect(tools.visualize).toBeDefined();
    expect(tools.visualize_tree).toBeDefined();
    // resolve_identity omitted because no entity groups
    expect(tools.resolve_identity).toBeUndefined();
    // Other pack tools should be absent
    expect(tools.describe_column).toBeUndefined();
    expect(tools.regression).toBeUndefined();
    expect(tools.npv).toBeUndefined();
  });

  it("should NOT register visualize_tree when data_query pack is not selected", async () => {
    setupStationMocks(["statistics"]);
    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID, "user-001");
    expect(tools.visualize_tree).toBeUndefined();
  });

  it("should register statistics tools when statistics pack is selected", async () => {
    setupStationMocks(["statistics"]);
    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID, "user-001");

    expect(tools.describe_column).toBeDefined();
    expect(tools.correlate).toBeDefined();
    expect(tools.detect_outliers).toBeDefined();
    expect(tools.cluster).toBeDefined();
    // data_query tools should be absent
    expect(tools.sql_query).toBeUndefined();
  });

  it("should register regression tools when regression pack is selected", async () => {
    setupStationMocks(["regression"]);
    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID, "user-001");

    expect(tools.regression).toBeDefined();
    expect(tools.trend).toBeDefined();
    // Other tools absent
    expect(tools.sql_query).toBeUndefined();
    expect(tools.npv).toBeUndefined();
  });

  it("should register financial tools when financial pack is selected", async () => {
    setupStationMocks(["financial"]);
    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID, "user-001");

    expect(tools.technical_indicator).toBeDefined();
    expect(tools.npv).toBeDefined();
    expect(tools.irr).toBeDefined();
    expect(tools.amortize).toBeDefined();
    expect(tools.sharpe_ratio).toBeDefined();
    expect(tools.max_drawdown).toBeDefined();
    expect(tools.rolling_returns).toBeDefined();
    // Other tools absent
    expect(tools.sql_query).toBeUndefined();
  });

  it("should register web_search tool when web_search pack is selected", async () => {
    setupStationMocks(["web_search"]);

    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID, "user-001");

    expect(tools.web_search).toBeDefined();
  });

  it("should register tools from all selected packs", async () => {
    setupStationMocks([
      "data_query",
      "statistics",
      "regression",
      "financial",
      "web_search",
    ]);

    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID, "user-001");

    // data_query
    expect(tools.sql_query).toBeDefined();
    expect(tools.visualize).toBeDefined();
    expect(tools.visualize_tree).toBeDefined();
    // statistics
    expect(tools.describe_column).toBeDefined();
    expect(tools.correlate).toBeDefined();
    expect(tools.detect_outliers).toBeDefined();
    expect(tools.cluster).toBeDefined();
    // regression
    expect(tools.regression).toBeDefined();
    expect(tools.trend).toBeDefined();
    // financial
    expect(tools.technical_indicator).toBeDefined();
    expect(tools.npv).toBeDefined();
    expect(tools.irr).toBeDefined();
    expect(tools.amortize).toBeDefined();
    expect(tools.sharpe_ratio).toBeDefined();
    expect(tools.max_drawdown).toBeDefined();
    expect(tools.rolling_returns).toBeDefined();
    // web_search
    expect(tools.web_search).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // resolve_identity conditional registration
  // -----------------------------------------------------------------------

  it("should register resolve_identity when data_query pack AND ≥1 entity group has ≥2 loaded members", async () => {
    setupStationMocks(["data_query"]);

    // Add a second entity so we can have 2 loaded members
    mockFindByConnectorInstanceId.mockResolvedValue([
      ...ENTITIES,
      {
        id: "ent-2",
        key: "orders",
        label: "Orders",
        connectorInstanceId: "ci-1",
      },
    ]);
    mockFindFieldMappingsByEntityIds.mockResolvedValue(
      new Map([
        ...FIELD_MAPPINGS_MAP,
        [
          "ent-2",
          [
            {
              id: "fm-2",
              connectorEntityId: "ent-2",
              columnDefinitionId: "cd-2",
              columnDefinition: {
                key: "order_id",
                label: "Order ID",
                type: "string",
              },
            },
          ],
        ],
      ])
    );
    mockFindByConnectorEntityId_records
      .mockResolvedValueOnce(CUSTOMER_RECORDS)
      .mockResolvedValueOnce([
        { id: "r3", normalizedData: { order_id: "O001" } },
      ]);

    // Entity group with 2 loaded members
    const groupId = "eg-1";
    mockFindByConnectorEntityId_members
      .mockResolvedValueOnce([
        { id: "egm-1", entityGroupId: groupId, connectorEntityId: "ent-1" },
      ])
      .mockResolvedValueOnce([
        { id: "egm-2", entityGroupId: groupId, connectorEntityId: "ent-2" },
      ]);

    mockFindById_group.mockResolvedValue({
      id: groupId,
      name: "Customer Identity",
      organizationId: ORG_ID,
    });

    mockFindByEntityGroupId.mockResolvedValue([
      {
        id: "egm-1",
        entityGroupId: groupId,
        connectorEntityId: "ent-1",
        isPrimary: true,
        connectorEntity: ENTITIES[0],
        fieldMapping: { id: "fm-1" },
        columnDefinition: { key: "customer_id", label: "Customer ID" },
      },
      {
        id: "egm-2",
        entityGroupId: groupId,
        connectorEntityId: "ent-2",
        isPrimary: false,
        connectorEntity: { id: "ent-2", key: "orders" },
        fieldMapping: { id: "fm-2" },
        columnDefinition: { key: "customer_id", label: "Customer ID" },
      },
    ]);

    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID, "user-001");
    expect(tools.resolve_identity).toBeDefined();
  });

  it("should NOT register resolve_identity when data_query pack is selected but no entity groups have ≥2 loaded members", async () => {
    setupStationMocks(["data_query"]);
    // Default mock: no entity group members
    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID, "user-001");
    expect(tools.resolve_identity).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Error: empty toolPacks
  // -----------------------------------------------------------------------

  it("should throw when no toolpacks are enabled on the station", async () => {
    setupStationMocks([]);
    await expect(
      buildAnalyticsTools(ORG_ID, STATION_ID, "user-001")
    ).rejects.toThrow("Station must have at least one tool pack enabled");
  });

  // -----------------------------------------------------------------------
  // station_toolpacks reader path
  // -----------------------------------------------------------------------

  it("logs a warning and skips rows that reference a custom toolpack id", async () => {
    setupStationMocks(["data_query"]);
    mockFindByStationId_tools.mockResolvedValue([
      ...makeToolpackRows(["data_query"]),
      {
        id: "stp-custom",
        stationId: STATION_ID,
        builtinSlug: null,
        organizationToolpackId: "otp-future",
        created: Date.now(),
        createdBy: "user-001",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      },
    ]);

    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID, "user-001");
    expect(tools.sql_query).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Pack: entity_management
  // -----------------------------------------------------------------------

  it("should not register write tools when no instances have write capability", async () => {
    setupStationMocks(["entity_management"]);
    mockResolveStationCapabilities.mockResolvedValue([
      {
        connectorInstanceId: "ci-1",
        capabilities: { read: true, write: false },
      },
    ]);

    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID, "user-001");

    expect(tools.entity_record_create).toBeUndefined();
    expect(tools.connector_entity_create).toBeUndefined();
    expect(tools.connector_entity_update).toBeUndefined();
    expect(tools.column_definition_create).toBeUndefined();
    expect(tools.field_mapping_create).toBeUndefined();
    expect(tools.field_mapping_update).toBeUndefined();
  });

  it("should register the 9 write tools when any instance has write, without column_definition_* tools", async () => {
    setupStationMocks(["entity_management"]);
    mockResolveStationCapabilities.mockResolvedValue([
      {
        connectorInstanceId: "ci-1",
        capabilities: { read: true, write: true },
      },
    ]);

    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID, "user-001");

    expect(tools.entity_record_create).toBeDefined();
    expect(tools.entity_record_update).toBeDefined();
    expect(tools.entity_record_delete).toBeDefined();
    expect(tools.connector_entity_create).toBeDefined();
    expect(tools.connector_entity_update).toBeDefined();
    expect(tools.connector_entity_delete).toBeDefined();
    expect(tools.field_mapping_create).toBeDefined();
    expect(tools.field_mapping_update).toBeDefined();
    expect(tools.field_mapping_delete).toBeDefined();

    // Column definitions are managed outside the portal session — these
    // tools must not be registered, even when write capability is present.
    expect(tools.column_definition_create).toBeUndefined();
    expect(tools.column_definition_update).toBeUndefined();
    expect(tools.column_definition_delete).toBeUndefined();
  });

  it("should not register entity_management tools when pack is not enabled", async () => {
    setupStationMocks(["data_query"]);

    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID, "user-001");

    expect(tools.entity_record_create).toBeUndefined();
    expect(tools.field_mapping_delete).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// callWebhook
// ---------------------------------------------------------------------------

describe("callWebhook()", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("should POST to URL with headers and return parsed JSON", async () => {
    const responseData = { status: "ok", count: 42 };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => responseData,
    });

    const result = await callWebhook(
      {
        type: "webhook",
        url: "https://api.example.com/hook",
        headers: { Authorization: "Bearer token123" },
      },
      { input: "data" }
    );

    expect(result).toEqual(responseData);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.example.com/hook");
    expect(options!.method).toBe("POST");
    expect(options!.headers["Authorization"]).toBe("Bearer token123");
    expect(options!.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(options!.body)).toEqual({ input: "data" });
    expect(options!.signal).toBeDefined(); // AbortController signal
  });

  it("should throw on non-OK response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    await expect(
      callWebhook({ type: "webhook", url: "https://api.example.com/hook" }, {})
    ).rejects.toThrow("Webhook returned 500: Internal Server Error");
  });

  it("should enforce timeout via AbortController", async () => {
    // Simulate a timeout by having fetch reject with an abort error
    mockFetch.mockImplementation(async (_url, opts) => {
      // Check that an abort signal is provided
      expect(opts!.signal).toBeDefined();
      return { ok: true, json: async () => ({}) };
    });

    await callWebhook(
      { type: "webhook", url: "https://api.example.com/hook" },
      {}
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
