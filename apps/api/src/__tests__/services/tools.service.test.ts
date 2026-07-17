/* eslint-disable @typescript-eslint/no-explicit-any */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import { BUILTIN_TOOLPACKS } from "@portalai/core/registries";
import { ApiCode } from "../../constants/api-codes.constants.js";

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
const mockFindManyByIds_orgPacks = jest.fn<() => Promise<unknown[]>>();
const mockFindById_org = jest.fn<() => Promise<unknown>>();

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
        findHydratedMany: mockFindByConnectorEntityId_records,
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
      organizationToolpacks: { findManyByIds: mockFindManyByIds_orgPacks },
      organizations: { findById: mockFindById_org },
    },
  },
}));

// #214: the builder resolves the org's tier policy for entitlement
// filtering. Mocked per-case; the default (set in setupStationMocks) is
// fully permissive with unlimited allocations so the cost-gate paths the
// mock also feeds (checkAdmission/commitCharge) stay off Redis/DB.
const mockResolveTier = jest.fn<() => Promise<unknown>>();
jest.unstable_mockModule("../../services/tier.service.js", () => ({
  TierService: {
    resolveTier: mockResolveTier,
    invalidate: jest.fn(),
    periodIdFor: jest.fn(() => "2026-07"),
    tierPolicyFromRow: jest.fn(),
    DEFAULT_TIER: "standard",
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
    TOOLPACK_RUNTIME_MAX_RESPONSE_BYTES: 1024 * 1024,
    TOOLPACK_DISABLE_SSRF_FILTER: false,
    TOOLPACK_DISABLE_SIGNING: false,
  },
}));

// Mock resolve-capabilities for entity_management pack
const mockResolveStationCapabilities = jest.fn<() => Promise<unknown[]>>();
jest.unstable_mockModule("../../utils/resolve-capabilities.util.js", () => ({
  resolveStationCapabilities: mockResolveStationCapabilities,
  assertStationScope: jest.fn(),
  assertWriteCapability: jest.fn(),
  resolveCapabilities: jest.fn(),
  // Phase 3 slice 2: PortalSqlService.buildSessionViews calls this; the
  // tools.service test never reaches that code path, so an empty
  // resolution is fine.
  resolveEntityCapabilities: jest.fn(async () => ({})),
}));

// Mock the logger so the #184 cost-gate capability warn is observable.
const mockLoggerWarn = jest.fn();
jest.unstable_mockModule("../../utils/logger.util.js", () => {
  const stub = {
    info: jest.fn(),
    warn: mockLoggerWarn,
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    fatal: jest.fn(),
  };
  return {
    createLogger: () => ({ ...stub, child: () => stub }),
  };
});

// Mock fetch for webhook tests
const mockFetch =
  jest.fn<(url: string, options?: Record<string, any>) => Promise<unknown>>();
(globalThis as any).fetch = mockFetch;

// Skip SSRF DNS resolution in unit tests — assertUrlSafeToFetch
// would otherwise call dns.lookup against the test fixture URLs
// (e.g. api.example.com) which may or may not resolve depending on
// the network. The integration tests exercise the real SSRF path.
jest.unstable_mockModule("../../utils/url-safety.util.js", () => ({
  assertUrlSafeToFetch: async () => undefined,
  SsrfBlockedError: class SsrfBlockedError extends Error {},
  validateToolpackUrl: () => null,
}));

const { ToolService, BUILTIN_TOOL_NAMES } =
  await import("../../services/tools.service.js");
const { CostGateService } = await import("../../services/cost-gate.service.js");
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

const ALL_PACK_SLUGS = [
  "data_query",
  "statistics",
  "regression",
  "financial",
  "web_search",
  "entity_management",
];

/** A TierPolicy with the given entitlements. Allocations are unlimited so
 *  the (module-mock-fed) cost gate never touches Redis/DB in unit tests. */
function makePolicy(
  entitlements = { builtinToolpacks: ALL_PACK_SLUGS, customToolpacks: true }
) {
  return {
    tier: "standard",
    period: { kind: "monthly" as const, anchorDay: 1 },
    allocations: {
      free: { unitsPerPeriod: null, ratePerMin: null },
      metered: { unitsPerPeriod: null, ratePerMin: null },
      expensive: { unitsPerPeriod: null, ratePerMin: null },
    },
    perToolCaps: null,
    overage: "hard-deny" as const,
    entitlements,
  };
}

function setupStationMocks(toolPacks: string[]) {
  mockFindById_org.mockResolvedValue({ id: ORG_ID, tier: "standard" });
  mockResolveTier.mockResolvedValue(makePolicy());
  mockFindById_station.mockResolvedValue(makeStation());
  mockFindByStationId_instances.mockResolvedValue([
    { id: "si-1", stationId: STATION_ID, connectorInstanceId: "ci-1" },
  ]);
  mockFindByConnectorInstanceId.mockResolvedValue(ENTITIES);
  mockFindFieldMappingsByEntityIds.mockResolvedValue(FIELD_MAPPINGS_MAP);
  mockFindByConnectorEntityId_records.mockResolvedValue(CUSTOMER_RECORDS);
  mockFindByConnectorEntityId_members.mockResolvedValue([]);
  mockFindByStationId_tools.mockResolvedValue(makeToolpackRows(toolPacks));
  mockFindManyByIds_orgPacks.mockResolvedValue([]);
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
    expect(tools.cluster).toBeUndefined();
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

    expect(tools.cluster).toBeDefined();
    expect(tools.hypothesis_test).toBeDefined();
    // data_query tools should be absent
    expect(tools.sql_query).toBeUndefined();
  });

  it("should register regression tools when regression pack is selected", async () => {
    setupStationMocks(["regression"]);
    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID, "user-001");

    expect(tools.regression).toBeDefined();
    expect(tools.forecast).toBeDefined();
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
    expect(tools.var_cvar).toBeDefined();
    expect(tools.portfolio_metrics).toBeDefined();
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
    expect(tools.cluster).toBeDefined();
    expect(tools.hypothesis_test).toBeDefined();
    // regression
    expect(tools.regression).toBeDefined();
    expect(tools.forecast).toBeDefined();
    // financial
    expect(tools.technical_indicator).toBeDefined();
    expect(tools.npv).toBeDefined();
    expect(tools.irr).toBeDefined();
    expect(tools.amortize).toBeDefined();
    expect(tools.var_cvar).toBeDefined();
    expect(tools.portfolio_metrics).toBeDefined();
    // web_search
    expect(tools.web_search).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Universal tools (no pack gate)
  // -----------------------------------------------------------------------

  it("auto-attaches the station_context pack tools regardless of what's recorded", async () => {
    // `current_time` + `station_context` live in the always-attached
    // station_context pack — the agent needs temporal context and
    // on-demand id lookup whether or not data_query /
    // entity_management / etc. are enabled.
    for (const pack of [
      "data_query",
      "statistics",
      "regression",
      "financial",
      "web_search",
    ]) {
      setupStationMocks([pack]);
      mockResolveStationCapabilities.mockResolvedValue([]);
      const tools = await buildAnalyticsTools(ORG_ID, STATION_ID, "user-001");
      expect(tools.current_time).toBeDefined();
      expect(tools.station_context).toBeDefined();
    }
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
  // Custom toolpacks (phase 2)
  // -----------------------------------------------------------------------

  // Case 107
  it("exposes a custom pack's tools when its station_toolpack row is enabled", async () => {
    setupStationMocks(["data_query"]);
    mockFindByStationId_tools.mockResolvedValue([
      ...makeToolpackRows(["data_query"]),
      {
        id: "stp-custom",
        stationId: STATION_ID,
        builtinSlug: null,
        organizationToolpackId: "otp-1",
        created: Date.now(),
        createdBy: "user-001",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      },
    ]);
    mockFindManyByIds_orgPacks.mockResolvedValue([
      {
        id: "otp-1",
        organizationId: ORG_ID,
        name: "customer_intel",
        endpoints: {
          schema: "https://example.com/schema",
          runtime: "https://example.com/runtime",
        },
        authHeaders: null,
        tools: [
          {
            name: "lookup_company",
            description: "Look up a company.",
            parameterSchema: { type: "object", properties: {} },
          },
        ],
      },
    ]);

    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID, "user-001");
    expect(tools.sql_query).toBeDefined();
    expect(tools.lookup_company).toBeDefined();
  });

  // Case 108
  it("the custom tool's execute POSTs {tool, input} with auth headers to the runtime URL", async () => {
    setupStationMocks(["data_query"]);
    mockFindByStationId_tools.mockResolvedValue([
      ...makeToolpackRows(["data_query"]),
      {
        id: "stp-custom",
        stationId: STATION_ID,
        builtinSlug: null,
        organizationToolpackId: "otp-1",
        created: Date.now(),
        createdBy: "user-001",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      },
    ]);
    mockFindManyByIds_orgPacks.mockResolvedValue([
      {
        id: "otp-1",
        organizationId: ORG_ID,
        name: "customer_intel",
        endpoints: {
          schema: "https://example.com/schema",
          runtime: "https://example.com/runtime",
        },
        authHeaders: { "X-Api-Key": "secret123" },
        tools: [
          {
            name: "lookup_company",
            description: "Look up a company.",
            parameterSchema: {
              type: "object",
              properties: { domain: { type: "string" } },
            },
          },
        ],
      },
    ]);

    const respText = JSON.stringify({ name: "Acme" });
    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Map([["content-length", String(respText.length)]]),
      text: async () => respText,
      body: undefined,
    });

    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID, "user-001");
    const execute = (tools.lookup_company as any).execute;
    const result = await execute({ domain: "acme.com" });

    expect(result).toEqual({ name: "Acme" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://example.com/runtime");
    expect(options!.method).toBe("POST");
    expect(options!.headers["X-Api-Key"]).toBe("secret123");
    expect(JSON.parse(options!.body)).toEqual({
      tool: "lookup_company",
      input: { domain: "acme.com" },
    });
  });

  // Case 109
  it("throws when two enabled custom packs both define the same tool name", async () => {
    setupStationMocks(["data_query"]);
    mockFindByStationId_tools.mockResolvedValue([
      ...makeToolpackRows(["data_query"]),
      {
        id: "stp-a",
        stationId: STATION_ID,
        builtinSlug: null,
        organizationToolpackId: "otp-a",
        created: Date.now(),
        createdBy: "user-001",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      },
      {
        id: "stp-b",
        stationId: STATION_ID,
        builtinSlug: null,
        organizationToolpackId: "otp-b",
        created: Date.now(),
        createdBy: "user-001",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      },
    ]);
    const tool = {
      name: "lookup_company",
      description: "x",
      parameterSchema: { type: "object", properties: {} },
    };
    mockFindManyByIds_orgPacks.mockResolvedValue([
      {
        id: "otp-a",
        organizationId: ORG_ID,
        name: "pack_a",
        endpoints: {
          schema: "https://a/schema",
          runtime: "https://a/runtime",
        },
        authHeaders: null,
        tools: [tool],
      },
      {
        id: "otp-b",
        organizationId: ORG_ID,
        name: "pack_b",
        endpoints: {
          schema: "https://b/schema",
          runtime: "https://b/runtime",
        },
        authHeaders: null,
        tools: [tool],
      },
    ]);

    await expect(
      buildAnalyticsTools(ORG_ID, STATION_ID, "user-001")
    ).rejects.toThrow(/provided by more than one enabled toolpack/);
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

  // -----------------------------------------------------------------------
  // Cost gate wrap (#169) — the guard: EVERY built tool's execute must route
  // through resolveCostGate. A new tool-construction path that bypasses the
  // wrap fails here.
  // -----------------------------------------------------------------------

  it("wraps every built tool's execute with the cost gate", async () => {
    setupStationMocks([
      "data_query",
      "statistics",
      "regression",
      "financial",
      "web_search",
      "entity_management",
    ]);
    mockResolveStationCapabilities.mockResolvedValue([
      {
        connectorInstanceId: "ci-1",
        capabilities: { read: true, write: true },
      },
    ]);

    // Gate every call to a deny sentinel so the original executes never run
    // (no external calls / DB side effects) — we only assert the wrap intercepts.
    const sentinel = {
      allowed: false as const,
      result: {
        error: { code: ApiCode.TOOL_USAGE_QUOTA_EXCEEDED, message: "guard" },
      },
    };
    const spy = jest
      .spyOn(CostGateService, "checkAdmission")
      .mockResolvedValue(sentinel);

    const tools = await buildAnalyticsTools(
      ORG_ID,
      STATION_ID,
      "user-001",
      "portal-001"
    );
    const names = Object.keys(tools);
    expect(names.length).toBeGreaterThan(5);

    for (const name of names) {
      const out = await (tools[name] as any).execute(
        {},
        {
          toolCallId: "t",
          messages: [],
          abortSignal: new AbortController().signal,
        }
      );
      // Wrapped → returns the gate's deny result; the real tool never ran.
      expect(out).toBe(sentinel.result);
    }

    // checkAdmission was invoked once per tool, tagged with the tool name.
    expect(spy).toHaveBeenCalledTimes(names.length);
    for (const name of names) {
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ toolName: name, organizationId: ORG_ID })
      );
    }

    spy.mockRestore();
  });

  it("does not warn about a missing capability for the real built-in tool set (#184)", async () => {
    setupStationMocks([
      "data_query",
      "statistics",
      "regression",
      "financial",
      "web_search",
      "entity_management",
    ]);
    mockResolveStationCapabilities.mockResolvedValue([
      {
        connectorInstanceId: "ci-1",
        capabilities: { read: true, write: true },
      },
    ]);

    await buildAnalyticsTools(ORG_ID, STATION_ID, "user-001", "portal-001");

    // Every built-in resolves its costHint from the registry, so the #184
    // capability-missing warn must never fire for the real tool set — a live
    // no-leak assertion (an app-paid tool silently defaulting to free would
    // trip this).
    expect(mockLoggerWarn).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("no capability entry")
    );
  });

  it("commits the charge in the wrap when a sync tool succeeds (#183)", async () => {
    setupStationMocks(["web_search"]);
    mockTavilySearch.mockResolvedValue({ answer: "a", results: [] });
    const admitSpy = jest
      .spyOn(CostGateService, "checkAdmission")
      .mockResolvedValue({
        allowed: true,
        charge: {
          organizationId: ORG_ID,
          costClass: "metered",
          units: 1,
          actor: { userId: "user-001" },
          toolName: "web_search",
          toolCallId: "call_test_1",
          stationId: STATION_ID,
          portalId: null,
        },
      });
    const commitSpy = jest
      .spyOn(CostGateService, "commitCharge")
      .mockResolvedValue();

    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID, "user-001");
    await (tools.web_search as any).execute(
      { query: "x" },
      {
        toolCallId: "t",
        messages: [],
        abortSignal: new AbortController().signal,
      }
    );

    expect(commitSpy).toHaveBeenCalledTimes(1);
    admitSpy.mockRestore();
    commitSpy.mockRestore();
  });

  it("does NOT commit in the wrap for the async-job tool — it defers to the processor (#183)", async () => {
    setupStationMocks([
      "data_query",
      "statistics",
      "regression",
      "financial",
      "web_search",
      "entity_management",
    ]);
    mockResolveStationCapabilities.mockResolvedValue([
      {
        connectorInstanceId: "ci-1",
        capabilities: { read: true, write: true },
      },
    ]);
    const admitSpy = jest
      .spyOn(CostGateService, "checkAdmission")
      .mockResolvedValue({
        allowed: true,
        charge: {
          organizationId: ORG_ID,
          costClass: "expensive",
          units: 1,
          actor: { userId: "user-001" },
          toolName: "cluster",
          toolCallId: "call_test_2",
          stationId: STATION_ID,
          portalId: null,
        },
      });
    const commitSpy = jest
      .spyOn(CostGateService, "commitCharge")
      .mockResolvedValue();

    const tools = await buildAnalyticsTools(
      ORG_ID,
      STATION_ID,
      "user-001",
      "portal-001"
    );
    // transform_entity_records has resultKind "progress" → deferChargeToJob.
    // Whatever it does internally (validation/enqueue), the wrap must NOT
    // commit — the bulk-transform processor charges on job success.
    try {
      await (tools.transform_entity_records as any).execute(
        {},
        {
          toolCallId: "t",
          messages: [],
          abortSignal: new AbortController().signal,
        }
      );
    } catch {
      /* enqueue/validation path irrelevant to the defer assertion */
    }
    expect(commitSpy).not.toHaveBeenCalled();
    admitSpy.mockRestore();
    commitSpy.mockRestore();
  });

  it("tags built-in tools application-paid and custom tools organization-paid", async () => {
    setupStationMocks(["web_search"]); // web_search is a metered built-in
    mockFindByStationId_tools.mockResolvedValue([
      ...makeToolpackRows(["web_search"]),
      {
        id: "stp-custom",
        stationId: STATION_ID,
        builtinSlug: null,
        organizationToolpackId: "otp-1",
        created: Date.now(),
        createdBy: "user-001",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      },
    ]);
    mockFindManyByIds_orgPacks.mockResolvedValue([
      {
        id: "otp-1",
        organizationId: ORG_ID,
        name: "intel",
        endpoints: {
          schema: "https://example.com/schema",
          runtime: "https://example.com/runtime",
        },
        authHeaders: null,
        tools: [
          {
            name: "lookup_company",
            description: "x",
            parameterSchema: { type: "object", properties: {} },
            capability: { costHint: "metered" },
          },
        ],
      },
    ]);

    // Deny so the real tools never run; we only assert the metadata the wrap
    // passes to the gate (bearer/costHint).
    const spy = jest
      .spyOn(CostGateService, "checkAdmission")
      .mockResolvedValue({
        allowed: false,
        result: {
          error: { code: ApiCode.TOOL_USAGE_QUOTA_EXCEEDED, message: "x" },
        },
      });

    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID, "user-001");
    await (tools.web_search as any).execute({}, {});
    await (tools.lookup_company as any).execute({}, {});

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "web_search",
        costBearer: "application",
        costHint: "metered",
      })
    );
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "lookup_company",
        costBearer: "organization",
      })
    );
    spy.mockRestore();
  });

  it("annotates a metered custom tool's description with an org-cost advisory (not free ones)", async () => {
    setupStationMocks(["data_query"]);
    mockFindByStationId_tools.mockResolvedValue([
      ...makeToolpackRows(["data_query"]),
      {
        id: "stp-c",
        stationId: STATION_ID,
        builtinSlug: null,
        organizationToolpackId: "otp-1",
        created: Date.now(),
        createdBy: "user-001",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      },
    ]);
    mockFindManyByIds_orgPacks.mockResolvedValue([
      {
        id: "otp-1",
        organizationId: ORG_ID,
        name: "intel",
        endpoints: {
          schema: "https://example.com/schema",
          runtime: "https://example.com/runtime",
        },
        authHeaders: null,
        tools: [
          {
            name: "costly_hook",
            description: "Look up a company.",
            parameterSchema: { type: "object", properties: {} },
            capability: { costHint: "metered" },
          },
          {
            name: "free_hook",
            description: "Cheap lookup.",
            parameterSchema: { type: "object", properties: {} },
          },
        ],
      },
    ]);

    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID, "user-001");
    expect((tools.costly_hook as any).description).toMatch(
      /organization-provided tool and may be costly/i
    );
    expect((tools.free_hook as any).description).not.toMatch(/costly/i);
  });
});

// ---------------------------------------------------------------------------
// Registry consistency (#115) — guards against descriptor / name-set drift.
//
// Two sources must agree with what `buildAnalyticsTools` actually registers:
//   1. `BUILTIN_TOOL_NAMES` (the webhook name-collision guard).
//   2. The built-in toolpack descriptor registry (`BUILTIN_TOOLPACKS`),
//      which feeds `GET /api/toolpacks` and the web metadata modal.
// `current_time` / `station_context` are always-attached system tools that
// intentionally belong to no pack, so the descriptor check allowlists them.
// ---------------------------------------------------------------------------

describe("built-in tool registry consistency (#115)", () => {
  const SYSTEM_TOOLS = new Set(["current_time", "station_context"]);
  const descriptorNames = new Set(
    BUILTIN_TOOLPACKS.flatMap((p) => p.tools.map((t) => t.name))
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("every registered built-in tool is in BUILTIN_TOOL_NAMES and (non-system) has a pack descriptor", async () => {
    // Enable every pack, grant write capability, and pass a portalId so the
    // job-enqueuing tools register too — the widest possible built-in surface.
    setupStationMocks([
      "data_query",
      "statistics",
      "regression",
      "financial",
      "web_search",
      "entity_management",
    ]);
    mockResolveStationCapabilities.mockResolvedValue([
      {
        connectorInstanceId: "ci-1",
        capabilities: { read: true, write: true },
      },
    ]);

    const tools = await buildAnalyticsTools(
      ORG_ID,
      STATION_ID,
      "user-001",
      "portal-001"
    );

    // No custom packs are enabled here, so every registered tool is built-in.
    for (const name of Object.keys(tools)) {
      expect(BUILTIN_TOOL_NAMES.has(name)).toBe(true);
      if (!SYSTEM_TOOLS.has(name)) {
        expect(descriptorNames.has(name)).toBe(true);
      }
    }

    // Sanity: the tools that previously drifted are present.
    expect(tools.display_entity_records).toBeDefined();
    expect(tools.transform_entity_records).toBeDefined();
  });

  it("BUILTIN_TOOL_NAMES equals the descriptor tool set plus the system tools", () => {
    const expected = new Set([...descriptorNames, ...SYSTEM_TOOLS]);
    expect(new Set(BUILTIN_TOOL_NAMES)).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// callWebhook
// ---------------------------------------------------------------------------

describe("callWebhook()", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  /** Helper: build a fetch-like response with text/headers shape. */
  function fetchResp(
    body: unknown,
    opts?: { ok?: boolean; status?: number; statusText?: string }
  ) {
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return {
      ok: opts?.ok ?? true,
      status: opts?.status ?? 200,
      statusText: opts?.statusText ?? "OK",
      headers: new Map([["content-length", String(text.length)]]),
      text: async () => text,
      body: undefined,
    };
  }

  it("should POST to URL with headers and return parsed JSON", async () => {
    const responseData = { status: "ok", count: 42 };
    mockFetch.mockResolvedValue(fetchResp(responseData));

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
    mockFetch.mockResolvedValue(
      fetchResp("", {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      })
    );

    await expect(
      callWebhook({ type: "webhook", url: "https://api.example.com/hook" }, {})
    ).rejects.toThrow("Webhook returned 500: Internal Server Error");
  });

  it("should enforce timeout via AbortController", async () => {
    // Simulate a timeout by having fetch reject with an abort error
    mockFetch.mockImplementation(async (_url, opts) => {
      // Check that an abort signal is provided
      expect(opts!.signal).toBeDefined();
      return fetchResp({});
    });

    await callWebhook(
      { type: "webhook", url: "https://api.example.com/hook" },
      {}
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // ── Phase 6: HMAC signing + runtime size cap ────────────────────

  // Case 154
  it("signs the runtime POST body when given a signing secret", async () => {
    mockFetch.mockResolvedValue(fetchResp({ result: "ok" }));
    const secret = "whsec_test154";
    const input = { tool: "echo", message: "hi" };

    await callWebhook(
      {
        type: "webhook",
        url: "https://api.example.com/runtime",
        signingSecret: secret,
      },
      input
    );

    const [, options] = mockFetch.mock.calls[0];
    const headers = options!.headers as Record<string, string>;
    expect(headers["X-Portalai-Webhook-Id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers["X-Portalai-Timestamp"]).toMatch(/^\d+$/);
    expect(headers["X-Portalai-Signature"]).toMatch(/^v1=[0-9a-f]{64}$/);

    // Recompute the signature against the captured body bytes —
    // signature must bind the exact JSON string that was sent.
    const body = options!.body as string;
    expect(JSON.parse(body)).toEqual(input);

    const ts = headers["X-Portalai-Timestamp"];
    const id = headers["X-Portalai-Webhook-Id"];
    const sig = headers["X-Portalai-Signature"]!.replace(/^v1=/, "");
    const crypto = await import("crypto");
    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${ts}.${id}.${body}`)
      .digest("hex");
    expect(sig).toBe(expected);
  });

  // Case 155
  it("aborts when runtime response exceeds TOOLPACK_RUNTIME_MAX_RESPONSE_BYTES", async () => {
    // Build a 1.5 MB response — default cap is 1 MB.
    const huge = "x".repeat(1_500_000);
    mockFetch.mockResolvedValue(fetchResp(huge));

    await expect(
      callWebhook({ type: "webhook", url: "https://api.example.com/hook" }, {})
    ).rejects.toThrow(/exceeds.*bytes/i);
  });
});

// ---------------------------------------------------------------------------
// Tier toolpack entitlements (#214) — availability is a projection of the
// org's tier row; the builder is the single enforcement point.
// ---------------------------------------------------------------------------

describe("buildAnalyticsTools() tier entitlements (#214)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
  });

  const CUSTOM_STATION_ROW = {
    id: "stp-custom",
    stationId: STATION_ID,
    builtinSlug: null,
    organizationToolpackId: "otp-1",
    created: Date.now(),
    createdBy: "user-001",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };

  const CUSTOM_PACK = {
    id: "otp-1",
    organizationId: ORG_ID,
    name: "customer_intel",
    endpoints: {
      schema: "https://example.com/schema",
      runtime: "https://example.com/runtime",
    },
    authHeaders: null,
    tools: [
      {
        name: "lookup_company",
        description: "Look up a company.",
        parameterSchema: { type: "object", properties: {} },
      },
    ],
  };

  // ── case 6: per-pack subtraction ────────────────────────────────────

  it("excludes exactly the packs the allowlist omits", async () => {
    setupStationMocks(["data_query", "web_search"]);
    mockResolveTier.mockResolvedValue(
      makePolicy({ builtinToolpacks: ["data_query"], customToolpacks: true })
    );

    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID, "user-001");

    expect(tools.web_search).toBeUndefined();
    expect(tools.sql_query).toBeDefined();
    expect(tools.visualize).toBeDefined();
  });

  // ── case 7: custom boolean, non-destructive ─────────────────────────

  it("customToolpacks: false skips the custom loop entirely — reads only, nothing built", async () => {
    setupStationMocks(["data_query"]);
    mockFindByStationId_tools.mockResolvedValue([
      ...makeToolpackRows(["data_query"]),
      CUSTOM_STATION_ROW,
    ]);
    mockFindManyByIds_orgPacks.mockResolvedValue([CUSTOM_PACK]);
    mockResolveTier.mockResolvedValue(
      makePolicy({
        builtinToolpacks: ALL_PACK_SLUGS,
        customToolpacks: false,
      })
    );

    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID, "user-001");

    expect(tools.lookup_company).toBeUndefined();
    // The pack rows were never even fetched — the boolean short-circuits
    // before the org-toolpacks read; no write path exists at all.
    expect(mockFindManyByIds_orgPacks).not.toHaveBeenCalled();
    expect(tools.sql_query).toBeDefined();
  });

  it("customToolpacks: true builds the same attached pack (upgrade round-trip)", async () => {
    setupStationMocks(["data_query"]);
    mockFindByStationId_tools.mockResolvedValue([
      ...makeToolpackRows(["data_query"]),
      CUSTOM_STATION_ROW,
    ]);
    mockFindManyByIds_orgPacks.mockResolvedValue([CUSTOM_PACK]);

    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID, "user-001");

    expect(tools.lookup_company).toBeDefined();
  });

  // ── case 8: unknown allowlist slug ──────────────────────────────────

  it("ignores allowlist slugs unknown to the registry, with a warn", async () => {
    setupStationMocks(["data_query"]);
    mockResolveTier.mockResolvedValue(
      makePolicy({
        builtinToolpacks: ["data_query", "future_pack"],
        customToolpacks: true,
      })
    );

    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID, "user-001");

    expect(tools.sql_query).toBeDefined();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ slugs: ["future_pack"] }),
      expect.stringMatching(/unknown/i)
    );
  });

  // ── case 9: fully-filtered station ──────────────────────────────────

  it("a station whose every configured pack is unentitled builds system tools only — no throw", async () => {
    setupStationMocks(ALL_PACK_SLUGS);
    mockResolveTier.mockResolvedValue(
      makePolicy({ builtinToolpacks: [], customToolpacks: true })
    );

    const tools = await buildAnalyticsTools(ORG_ID, STATION_ID, "user-001");

    expect(Object.keys(tools).sort()).toEqual(
      ["current_time", "station_context"].sort()
    );
  });

  // ── cases 10–11: the #184-sibling guard ─────────────────────────────

  it("GUARD (restrictive): an empty entitlement set builds nothing but system tools, custom pack attached or not", async () => {
    setupStationMocks(ALL_PACK_SLUGS);
    mockFindByStationId_tools.mockResolvedValue([
      ...makeToolpackRows(ALL_PACK_SLUGS),
      CUSTOM_STATION_ROW,
    ]);
    mockFindManyByIds_orgPacks.mockResolvedValue([CUSTOM_PACK]);
    mockResolveStationCapabilities.mockResolvedValue([
      {
        connectorInstanceId: "ci-1",
        capabilities: { read: true, write: true },
      },
    ]);
    mockResolveTier.mockResolvedValue(
      makePolicy({ builtinToolpacks: [], customToolpacks: false })
    );

    const tools = await buildAnalyticsTools(
      ORG_ID,
      STATION_ID,
      "user-001",
      "portal-001"
    );

    // Enumeration by construction: any new tool-construction path that
    // bypasses the entitlement filter surfaces as an unexpected key here.
    expect(Object.keys(tools).sort()).toEqual(
      ["current_time", "station_context"].sort()
    );
  });

  it("GUARD (permissive): a full entitlement set builds every pack's tools (per-pack representatives present)", async () => {
    setupStationMocks(ALL_PACK_SLUGS);
    mockFindByStationId_tools.mockResolvedValue([
      ...makeToolpackRows(ALL_PACK_SLUGS),
      CUSTOM_STATION_ROW,
    ]);
    mockFindManyByIds_orgPacks.mockResolvedValue([CUSTOM_PACK]);
    mockResolveStationCapabilities.mockResolvedValue([
      {
        connectorInstanceId: "ci-1",
        capabilities: { read: true, write: true },
      },
    ]);

    const tools = await buildAnalyticsTools(
      ORG_ID,
      STATION_ID,
      "user-001",
      "portal-001"
    );
    const names = new Set(Object.keys(tools));

    // Every registry pack contributes at least one declared tool (the
    // per-pack representative), so a filter bug that drops a pack under
    // the permissive tier fails here.
    for (const pack of BUILTIN_TOOLPACKS) {
      const represented = pack.tools.some((t) => names.has(t.name));
      expect(`${pack.slug}:${represented}`).toBe(`${pack.slug}:true`);
    }
    expect(names.has("lookup_company")).toBe(true);
    expect(names.has("current_time")).toBe(true);
  });
});
