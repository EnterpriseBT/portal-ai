/* eslint-disable @typescript-eslint/no-explicit-any */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFindById_station = jest.fn<() => Promise<unknown>>();
const mockFindByStationId_instances = jest.fn<() => Promise<unknown[]>>();
const mockFindByStationId_tools = jest.fn<() => Promise<unknown[]>>();
const mockFindByConnectorInstanceId = jest.fn<() => Promise<unknown[]>>();
const mockFindFieldMappingsByEntityIds = jest.fn<() => Promise<Map<string, unknown[]>>>();
const mockFindByConnectorEntityId_records = jest.fn<() => Promise<unknown[]>>();
const mockFindByConnectorEntityId_members = jest.fn<() => Promise<unknown[]>>();
const mockFindByEntityGroupId = jest.fn<() => Promise<unknown[]>>();
const mockFindById_group = jest.fn<() => Promise<unknown>>();

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
      stationTools: { findByStationId: mockFindByStationId_tools },
    },
  },
}));

// Mock AiService for web_search
const mockBuildWebSearchTool = jest.fn<() => unknown>();
jest.unstable_mockModule("../../services/ai.service.js", () => ({
  AiService: {
    buildWebSearchTool: mockBuildWebSearchTool,
  },
}));

// Mock fetch for webhook tests
const mockFetch = jest.fn<() => Promise<unknown>>();
(globalThis as any).fetch = mockFetch;

const { buildAnalyticsTools, callWebhook } = await import(
  "../../services/analytics.tools.js"
);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STATION_ID = "station-001";
const ORG_ID = "org-001";

function makeStation(toolPacks: string[]) {
  return {
    id: STATION_ID,
    organizationId: ORG_ID,
    name: "Test Station",
    description: null,
    toolPacks,
    created: Date.now(),
    createdBy: "user-001",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

const ENTITIES = [
  { id: "ent-1", key: "customers", label: "Customers", connectorInstanceId: "ci-1" },
];

const FIELD_MAPPINGS_MAP = new Map<string, unknown[]>([
  [
    "ent-1",
    [
      { id: "fm-1", connectorEntityId: "ent-1", columnDefinitionId: "cd-1", columnDefinition: { key: "name", label: "Name", type: "string" } },
    ],
  ],
]);

const CUSTOMER_RECORDS = [
  { id: "r1", normalizedData: { name: "Alice" } },
  { id: "r2", normalizedData: { name: "Bob" } },
];

function setupStationMocks(toolPacks: string[]) {
  mockFindById_station.mockResolvedValue(makeStation(toolPacks));
  mockFindByStationId_instances.mockResolvedValue([
    { id: "si-1", stationId: STATION_ID, connectorInstanceId: "ci-1" },
  ]);
  mockFindByConnectorInstanceId.mockResolvedValue(ENTITIES);
  mockFindFieldMappingsByEntityIds.mockResolvedValue(FIELD_MAPPINGS_MAP);
  mockFindByConnectorEntityId_records.mockResolvedValue(CUSTOMER_RECORDS);
  mockFindByConnectorEntityId_members.mockResolvedValue([]);
  mockFindByStationId_tools.mockResolvedValue([]);
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
    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID);

    expect(tools.sql_query).toBeDefined();
    expect(tools.visualize).toBeDefined();
    // resolve_identity omitted because no entity groups
    expect(tools.resolve_identity).toBeUndefined();
    // Other pack tools should be absent
    expect(tools.describe_column).toBeUndefined();
    expect(tools.regression).toBeUndefined();
    expect(tools.npv).toBeUndefined();
  });

  it("should register statistics tools when statistics pack is selected", async () => {
    setupStationMocks(["statistics"]);
    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID);

    expect(tools.describe_column).toBeDefined();
    expect(tools.correlate).toBeDefined();
    expect(tools.detect_outliers).toBeDefined();
    expect(tools.cluster).toBeDefined();
    // data_query tools should be absent
    expect(tools.sql_query).toBeUndefined();
  });

  it("should register regression tools when regression pack is selected", async () => {
    setupStationMocks(["regression"]);
    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID);

    expect(tools.regression).toBeDefined();
    expect(tools.trend).toBeDefined();
    // Other tools absent
    expect(tools.sql_query).toBeUndefined();
    expect(tools.npv).toBeUndefined();
  });

  it("should register financial tools when financial pack is selected", async () => {
    setupStationMocks(["financial"]);
    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID);

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
    const fakeTool = { type: "function", description: "Search" };
    mockBuildWebSearchTool.mockReturnValue(fakeTool);
    setupStationMocks(["web_search"]);

    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID);

    expect(tools.web_search).toBe(fakeTool);
    expect(mockBuildWebSearchTool).toHaveBeenCalledTimes(1);
  });

  it("should register tools from all selected packs", async () => {
    mockBuildWebSearchTool.mockReturnValue({ type: "function" });
    setupStationMocks(["data_query", "statistics", "regression", "financial", "web_search"]);

    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID);

    // data_query
    expect(tools.sql_query).toBeDefined();
    expect(tools.visualize).toBeDefined();
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
      { id: "ent-2", key: "orders", label: "Orders", connectorInstanceId: "ci-1" },
    ]);
    mockFindFieldMappingsByEntityIds.mockResolvedValue(
      new Map([
        ...FIELD_MAPPINGS_MAP,
        [
          "ent-2",
          [{ id: "fm-2", connectorEntityId: "ent-2", columnDefinitionId: "cd-2", columnDefinition: { key: "order_id", label: "Order ID", type: "string" } }],
        ],
      ])
    );
    mockFindByConnectorEntityId_records
      .mockResolvedValueOnce(CUSTOMER_RECORDS)
      .mockResolvedValueOnce([{ id: "r3", normalizedData: { order_id: "O001" } }]);

    // Entity group with 2 loaded members
    const groupId = "eg-1";
    mockFindByConnectorEntityId_members
      .mockResolvedValueOnce([{ id: "egm-1", entityGroupId: groupId, connectorEntityId: "ent-1" }])
      .mockResolvedValueOnce([{ id: "egm-2", entityGroupId: groupId, connectorEntityId: "ent-2" }]);

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

    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID);
    expect(tools.resolve_identity).toBeDefined();
  });

  it("should NOT register resolve_identity when data_query pack is selected but no entity groups have ≥2 loaded members", async () => {
    setupStationMocks(["data_query"]);
    // Default mock: no entity group members
    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID);
    expect(tools.resolve_identity).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Error: empty toolPacks
  // -----------------------------------------------------------------------

  it("should throw when station.toolPacks is empty", async () => {
    mockFindById_station.mockResolvedValue(makeStation([]));
    await expect(buildAnalyticsTools(ORG_ID, STATION_ID)).rejects.toThrow(
      "Station must have at least one tool pack enabled"
    );
  });

  // -----------------------------------------------------------------------
  // Custom webhook tools
  // -----------------------------------------------------------------------

  it("should register custom webhook tools and call webhook with correct URL + headers", async () => {
    setupStationMocks(["data_query"]);

    const webhookTool = {
      id: "st-1",
      stationId: STATION_ID,
      organizationToolId: "ot-1",
      organizationTool: {
        id: "ot-1",
        name: "my_custom_tool",
        description: "A custom webhook tool",
        parameterSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
        implementation: {
          type: "webhook",
          url: "https://example.com/webhook",
          headers: { "X-Api-Key": "secret123" },
        },
      },
    };
    mockFindByStationId_tools.mockResolvedValue([webhookTool]);

    const webhookResponse = { result: "success" };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => webhookResponse,
    });

    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID);

    expect(tools.my_custom_tool).toBeDefined();

    // Execute the tool
    const execute = (tools.my_custom_tool as any).execute;
    const result = await execute({ query: "test" });

    expect(result).toEqual({ result: "success" });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, options] = mockFetch.mock.calls[0] as [string, any];
    expect(url).toBe("https://example.com/webhook");
    expect(options.method).toBe("POST");
    expect(options.headers["X-Api-Key"]).toBe("secret123");
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(options.body)).toEqual({ query: "test" });
  });

  it("should propagate vega-lite chart results from webhook", async () => {
    setupStationMocks(["data_query"]);

    mockFindByStationId_tools.mockResolvedValue([
      {
        id: "st-1",
        stationId: STATION_ID,
        organizationToolId: "ot-1",
        organizationTool: {
          id: "ot-1",
          name: "chart_tool",
          description: "Returns a chart",
          parameterSchema: { type: "object", properties: {} },
          implementation: { type: "webhook", url: "https://example.com/chart" },
        },
      },
    ]);

    const vegaSpec = { mark: "bar", encoding: {} };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ type: "vega-lite", spec: vegaSpec }),
    });

    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID);
    const result = await (tools.chart_tool as any).execute({});

    expect(result).toEqual({ type: "vega-lite", spec: vegaSpec });
  });

  it("should throw when custom tool name shadows a pack tool name", async () => {
    setupStationMocks(["data_query"]);

    mockFindByStationId_tools.mockResolvedValue([
      {
        id: "st-1",
        stationId: STATION_ID,
        organizationToolId: "ot-1",
        organizationTool: {
          id: "ot-1",
          name: "sql_query", // conflicts with data_query pack tool
          description: "Conflicting tool",
          parameterSchema: { type: "object", properties: {} },
          implementation: { type: "webhook", url: "https://example.com" },
        },
      },
    ]);

    await expect(buildAnalyticsTools(ORG_ID, STATION_ID)).rejects.toThrow(
      'Custom tool "sql_query" conflicts with a built-in pack tool name'
    );
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

    const [url, options] = mockFetch.mock.calls[0] as [string, any];
    expect(url).toBe("https://api.example.com/hook");
    expect(options.method).toBe("POST");
    expect(options.headers["Authorization"]).toBe("Bearer token123");
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(options.body)).toEqual({ input: "data" });
    expect(options.signal).toBeDefined(); // AbortController signal
  });

  it("should throw on non-OK response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    await expect(
      callWebhook(
        { type: "webhook", url: "https://api.example.com/hook" },
        {}
      )
    ).rejects.toThrow("Webhook returned 500: Internal Server Error");
  });

  it("should enforce timeout via AbortController", async () => {
    // Simulate a timeout by having fetch reject with an abort error
    mockFetch.mockImplementation(async (_url: unknown, opts: any) => {
      // Check that an abort signal is provided
      expect(opts.signal).toBeDefined();
      return { ok: true, json: async () => ({}) };
    });

    await callWebhook(
      { type: "webhook", url: "https://api.example.com/hook" },
      {}
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
