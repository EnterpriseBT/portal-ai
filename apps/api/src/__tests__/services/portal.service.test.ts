/* eslint-disable @typescript-eslint/no-explicit-any */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ---------------------------------------------------------------------------
// Mocks — must be registered before any dynamic imports
// ---------------------------------------------------------------------------

// DB Service
const mockFindById_station = jest.fn<() => Promise<unknown>>();
const mockFindById_portal = jest.fn<() => Promise<unknown>>();
const mockCreate_portal = jest.fn<() => Promise<unknown>>();
const mockCreate_message = jest.fn<() => Promise<unknown>>();
const mockFindByPortal = jest.fn<() => Promise<unknown[]>>();
const mockDeleteByPortal = jest.fn<() => Promise<number>>();
const mockFindByStationId_toolpacks = jest.fn<() => Promise<unknown[]>>();
const mockFindById_organization = jest
  .fn<() => Promise<unknown>>()
  .mockResolvedValue({ id: "org-001", timezone: "UTC" });

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      stations: { findById: mockFindById_station },
      stationToolpacks: { findByStationId: mockFindByStationId_toolpacks },
      portals: {
        findById: mockFindById_portal,
        create: mockCreate_portal,
      },
      portalMessages: {
        findByPortal: mockFindByPortal,
        create: mockCreate_message,
        deleteByPortal: mockDeleteByPortal,
      },
      organizations: { findById: mockFindById_organization },
    },
  },
}));

// Logger mock — used by createPortal to warn on invalid org timezones.
const mockWarn = jest.fn();
jest.unstable_mockModule("../../utils/logger.util.js", () => ({
  createLogger: () => ({
    warn: mockWarn,
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

// AnalyticsService
const mockLoadStation = jest.fn<() => Promise<unknown>>();

jest.unstable_mockModule("../../services/analytics.service.js", () => ({
  AnalyticsService: { loadStation: mockLoadStation },
}));

// Station-instance + connector repos used by buildStationContext when
// entity_management is enabled (#95).
const mockStationInstancesFindByStationId = jest
  .fn<() => Promise<unknown[]>>()
  .mockResolvedValue([]);
const mockConnectorInstancesFindById = jest.fn<() => Promise<unknown>>();
const mockConnectorDefinitionsFindById = jest.fn<() => Promise<unknown>>();

jest.unstable_mockModule(
  "../../db/repositories/station-instances.repository.js",
  () => ({
    stationInstancesRepo: {
      findByStationId: mockStationInstancesFindByStationId,
    },
  })
);
jest.unstable_mockModule(
  "../../db/repositories/connector-instances.repository.js",
  () => ({
    connectorInstancesRepo: { findById: mockConnectorInstancesFindById },
  })
);
jest.unstable_mockModule(
  "../../db/repositories/connector-definitions.repository.js",
  () => ({
    connectorDefinitionsRepo: { findById: mockConnectorDefinitionsFindById },
  })
);

// resolveEntityCapabilities — used when entity_management is enabled.
const mockResolveEntityCapabilities = jest
  .fn<() => Promise<Record<string, unknown>>>()
  .mockResolvedValue({});
// #284: buildStationContext splits its configured packs through
// EntitlementService. The default is fully permissive so every pre-existing
// case describes an entitled station; the entitlement cases below override it.
const mockSplitBuiltinPacks =
  jest.fn<
    (
      orgId: string,
      slugs: readonly string[]
    ) => Promise<{ effective: string[]; unentitled: string[]; tier: string }>
  >();
// #306: buildStationContext + createPortal now read the station's packs
// through `resolveStationPacks` (built-in split + custom packs in one call).
const mockResolveStationPacks = jest.fn<
  (
    stationId: string,
    orgId: string
  ) => Promise<{
    effective: string[];
    unentitled: string[];
    customPacks: {
      name: string;
      description: string | null;
      toolNames: string[];
    }[];
    tier: string;
  }>
>();
jest.unstable_mockModule("../../services/entitlement.service.js", () => ({
  EntitlementService: {
    splitBuiltinPacks: mockSplitBuiltinPacks,
    resolveStationPacks: mockResolveStationPacks,
    customPacksEntitled: jest.fn(),
  },
}));

jest.unstable_mockModule("../../utils/resolve-capabilities.util.js", () => ({
  resolveEntityCapabilities: mockResolveEntityCapabilities,
}));

// buildAnalyticsTools
const mockBuildAnalyticsTools =
  jest.fn<() => Promise<Record<string, unknown>>>();

jest.unstable_mockModule("../../services/tools.service.js", () => ({
  ToolService: {
    buildAnalyticsTools: mockBuildAnalyticsTools,
  },
}));

// AiService
const mockStreamText = jest.fn<() => unknown>();

jest.unstable_mockModule("ai", () => ({
  streamText: mockStreamText,
  stepCountIs: jest.fn(() => ({})),
}));

jest.unstable_mockModule("../../services/ai.service.js", () => ({
  AiService: {
    DEFAULT_MODEL: "claude-sonnet-4-6",
    providers: {
      anthropic: jest.fn(() => "mock-model"),
    },
  },
}));

// SystemUtilities
let _idCounter = 0;
jest.unstable_mockModule("../../utils/system.util.js", () => ({
  SystemUtilities: {
    id: {
      v4: { generate: jest.fn(() => `generated-id-${++_idCounter}`) },
    },
    utc: {
      now: jest.fn(() => ({ getTime: () => 1742860800000 })),
      format: jest.fn(() => "Mar 25, 2026"),
    },
  },
}));

// ---------------------------------------------------------------------------
// Dynamic imports (after mocks)
// ---------------------------------------------------------------------------

const { PortalService, resolveDisplayBlock } =
  await import("../../services/portal.service.js");
const { ApiCode } = await import("../../constants/api-codes.constants.js");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = "org-001";
const STATION_ID = "station-001";
const PORTAL_ID = "portal-001";
const USER_ID = "user-001";

const STATION = {
  id: STATION_ID,
  organizationId: ORG_ID,
  name: "Sales Station",
};

function makeToolpackRows(slugs: string[]) {
  return slugs.map((slug, i) => ({
    id: `stp-${i + 1}`,
    stationId: STATION_ID,
    builtinSlug: slug,
    organizationToolpackId: null,
    created: Date.now(),
    createdBy: USER_ID,
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  }));
}

const PORTAL = {
  id: PORTAL_ID,
  organizationId: ORG_ID,
  stationId: STATION_ID,
  name: "Portal — Mar 25, 2026",
  createdBy: USER_ID,
};

const ENTITIES = [
  {
    id: "ent-1",
    key: "customers",
    label: "Customers",
    connectorInstanceId: "ci-1",
    columns: [
      {
        key: "id",
        label: "ID",
        type: "string",
        columnDefinitionId: "cd-1",
        fieldMappingId: "fm-1",
        sourceField: "ID",
      },
      {
        key: "revenue",
        label: "Revenue",
        type: "number",
        columnDefinitionId: "cd-2",
        fieldMappingId: "fm-2",
        sourceField: "Revenue",
      },
    ],
  },
  {
    id: "ent-2",
    key: "orders",
    label: "Orders",
    connectorInstanceId: "ci-1",
    columns: [
      {
        key: "customer_id",
        label: "Customer ID",
        type: "string",
        columnDefinitionId: "cd-3",
        fieldMappingId: "fm-3",
        sourceField: "Customer ID",
      },
    ],
  },
];

const ENTITY_GROUPS = [
  {
    id: "group-1",
    name: "Customer Orders",
    members: [
      {
        entityKey: "customers",
        connectorEntityId: "ent-customers",
        linkNormalizedKey: "id",
        linkColumnKey: "id",
        linkColumnLabel: "ID",
        isPrimary: true,
      },
      {
        entityKey: "orders",
        connectorEntityId: "ent-orders",
        linkNormalizedKey: "customer_id",
        linkColumnKey: "customer_id",
        linkColumnLabel: "Customer ID",
        isPrimary: false,
      },
    ],
  },
];

const STATION_DATA = {
  entities: ENTITIES,
  entityGroups: ENTITY_GROUPS,
  records: new Map(),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an async generator that yields the given chunks. */
async function* makeStream(
  chunks: Record<string, unknown>[]
): AsyncGenerator<Record<string, unknown>> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

/** Build a mock SseUtil. */
function makeSse() {
  return {
    send: jest.fn(),
    end: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PortalService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSplitBuiltinPacks.mockImplementation(async (_org, slugs) => ({
      effective: [...slugs],
      unentitled: [],
      tier: "standard",
    }));
    // #306: mirror the real composition so cases that set up join-table rows
    // and a split still describe the same behavior through the resolver.
    mockResolveStationPacks.mockImplementation(async (stationId, orgId) => {
      void stationId;
      const rows = (await mockFindByStationId_toolpacks()) as {
        builtinSlug: string | null;
      }[];
      const builtin = rows
        .map((r) => r.builtinSlug)
        .filter((sl): sl is string => sl !== null);
      const split = await mockSplitBuiltinPacks(orgId, builtin);
      return { ...split, customPacks: [] };
    });
    _idCounter = 0;
  });

  // ── createPortal ─────────────────────────────────────────────────────────

  describe("createPortal", () => {
    it("returns portalId and stationContext on success", async () => {
      mockFindById_station.mockResolvedValue(STATION);
      mockFindByStationId_toolpacks.mockResolvedValue(
        makeToolpackRows(["data_query", "statistics"])
      );
      mockCreate_portal.mockResolvedValue(PORTAL);
      mockLoadStation.mockResolvedValue(STATION_DATA);

      const result = await PortalService.createPortal({
        stationId: STATION_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
      });

      expect(result.portalId).toBe(PORTAL_ID);
      expect(result.stationContext.stationId).toBe(STATION_ID);
      expect(result.stationContext.stationName).toBe("Sales Station");
      expect(result.stationContext.entities).toBe(ENTITIES);
      expect(result.stationContext.entityGroups).toBe(ENTITY_GROUPS);
    });

    it("populates organizationTimezone from the org row", async () => {
      mockFindById_station.mockResolvedValue(STATION);
      mockFindByStationId_toolpacks.mockResolvedValue(
        makeToolpackRows(["data_query"])
      );
      mockCreate_portal.mockResolvedValue(PORTAL);
      mockLoadStation.mockResolvedValue(STATION_DATA);
      mockFindById_organization.mockResolvedValueOnce({
        id: ORG_ID,
        timezone: "Europe/London",
      });

      const result = await PortalService.createPortal({
        stationId: STATION_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
      });

      expect(result.stationContext.organizationTimezone).toBe("Europe/London");
    });

    it("falls back to UTC with a warn log when the org's timezone is not a valid IANA name", async () => {
      mockFindById_station.mockResolvedValue(STATION);
      mockFindByStationId_toolpacks.mockResolvedValue(
        makeToolpackRows(["data_query"])
      );
      mockCreate_portal.mockResolvedValue(PORTAL);
      mockLoadStation.mockResolvedValue(STATION_DATA);
      mockFindById_organization.mockResolvedValueOnce({
        id: ORG_ID,
        timezone: "Not/Real",
      });

      const result = await PortalService.createPortal({
        stationId: STATION_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
      });

      expect(result.stationContext.organizationTimezone).toBe("UTC");
      expect(mockWarn).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_ID,
          badValue: "Not/Real",
        }),
        expect.stringMatching(/UTC/i)
      );
    });

    it("calls loadStation and caches result", async () => {
      mockFindById_station.mockResolvedValue(STATION);
      mockFindByStationId_toolpacks.mockResolvedValue(
        makeToolpackRows(["data_query", "statistics"])
      );
      mockCreate_portal.mockResolvedValue(PORTAL);
      mockLoadStation.mockResolvedValue(STATION_DATA);

      await PortalService.createPortal({
        stationId: STATION_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
      });

      expect(mockLoadStation).toHaveBeenCalledWith(STATION_ID, ORG_ID);
    });

    it("throws STATION_NOT_FOUND when station does not exist", async () => {
      mockFindById_station.mockResolvedValue(null);

      await expect(
        PortalService.createPortal({
          stationId: STATION_ID,
          organizationId: ORG_ID,
          userId: USER_ID,
        })
      ).rejects.toMatchObject({ code: ApiCode.STATION_NOT_FOUND });
    });

    it("throws STATION_NOT_FOUND when station belongs to a different org", async () => {
      mockFindById_station.mockResolvedValue({
        ...STATION,
        organizationId: "other-org",
      });

      await expect(
        PortalService.createPortal({
          stationId: STATION_ID,
          organizationId: ORG_ID,
          userId: USER_ID,
        })
      ).rejects.toMatchObject({ code: ApiCode.STATION_NOT_FOUND });
    });

    it("throws PORTAL_STATION_NO_TOOLS when station has no toolpacks attached", async () => {
      mockFindById_station.mockResolvedValue(STATION);
      mockFindByStationId_toolpacks.mockResolvedValue([]);

      await expect(
        PortalService.createPortal({
          stationId: STATION_ID,
          organizationId: ORG_ID,
          userId: USER_ID,
        })
      ).rejects.toMatchObject({ code: ApiCode.PORTAL_STATION_NO_TOOLS });
    });

    // #306 inverts a phase-1 pin. This case used to assert the opposite —
    // "throws … when only custom toolpack rows exist (phase 1)" — because
    // custom packs didn't reach the executor yet. #214 changed that:
    // `buildAnalyticsTools` accepts builtin-OR-custom (`tools.service.ts:416`),
    // so a custom-only station is a valid configuration and this guard was the
    // last thing making it unusable.
    it("opens a portal on a custom-only station", async () => {
      mockFindById_station.mockResolvedValue(STATION);
      mockFindByStationId_toolpacks.mockResolvedValue([
        {
          id: "stp-custom",
          stationId: STATION_ID,
          builtinSlug: null,
          organizationToolpackId: "otp-1",
          created: Date.now(),
          createdBy: USER_ID,
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        },
      ]);
      mockCreate_portal.mockResolvedValue(PORTAL);
      mockLoadStation.mockResolvedValue(STATION_DATA);
      mockResolveStationPacks.mockResolvedValue({
        effective: [],
        unentitled: [],
        customPacks: [
          { name: "smoke", description: null, toolNames: ["refresh_crm"] },
        ],
        tier: "pro",
      });

      const result = await PortalService.createPortal({
        stationId: STATION_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
      });

      expect(result.portalId).toBe(PORTAL_ID);
      expect(result.stationContext.customToolPacks).toEqual([
        { name: "smoke", description: null, toolNames: ["refresh_crm"] },
      ]);
    });

    it("still throws PORTAL_STATION_NO_TOOLS when neither kind of row exists", async () => {
      mockFindById_station.mockResolvedValue(STATION);
      mockFindByStationId_toolpacks.mockResolvedValue([]);

      await expect(
        PortalService.createPortal({
          stationId: STATION_ID,
          organizationId: ORG_ID,
          userId: USER_ID,
        })
      ).rejects.toMatchObject({ code: ApiCode.PORTAL_STATION_NO_TOOLS });
    });
  });

  // ── buildStationContext (#95) ─────────────────────────────────────────────

  describe("buildStationContext", () => {
    // ── #307 regression ───────────────────────────────────────────────
    //
    // The packs used to be a caller-supplied argument. The streaming path
    // passed `(station as any).toolPacks` — a field that does not exist on a
    // station row — so every streamed turn built its context from `[]`,
    // `splitBuiltinPacks` short-circuited on the empty input, and the prompt's
    // capability surface (#284) was empty on every turn. The function now
    // derives the packs from `station_toolpacks` itself and cannot be handed
    // the wrong array.

    it("derives the station's packs from the station id, unprompted", async () => {
      const { buildStationContext } =
        await import("../../services/portal.service.js");

      mockLoadStation.mockResolvedValueOnce(STATION_DATA);
      mockFindByStationId_toolpacks.mockResolvedValueOnce(
        makeToolpackRows(["data_query", "visualize"])
      );

      const ctx = await buildStationContext({
        station: { id: STATION_ID, name: "Sales Station" },
        organizationId: ORG_ID,
      });

      // #306 moved the join-table read into `resolveStationPacks`, whose own
      // suite pins the query. What matters here is that the context is built
      // from the station id alone — no caller-supplied packs to get wrong.
      expect(mockResolveStationPacks).toHaveBeenCalledWith(STATION_ID, ORG_ID);
      expect(ctx.effectiveToolPacks).toEqual(["data_query", "visualize"]);
    });

    it("ignores custom-pack rows, which carry a null builtinSlug", async () => {
      const { buildStationContext } =
        await import("../../services/portal.service.js");

      mockLoadStation.mockResolvedValueOnce(STATION_DATA);
      mockFindByStationId_toolpacks.mockResolvedValueOnce([
        ...makeToolpackRows(["data_query"]),
        {
          id: "stp-custom",
          stationId: STATION_ID,
          builtinSlug: null,
          organizationToolpackId: "otp-1",
          created: Date.now(),
          createdBy: USER_ID,
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        },
      ]);

      const ctx = await buildStationContext({
        station: { id: STATION_ID, name: "Sales Station" },
        organizationId: ORG_ID,
      });

      // No null entries leak into the built-in pack list.
      expect(ctx.effectiveToolPacks).toEqual(["data_query"]);
    });

    it("yields empty pack lists for a station with no rows, without throwing", async () => {
      const { buildStationContext } =
        await import("../../services/portal.service.js");

      mockLoadStation.mockResolvedValueOnce(STATION_DATA);
      mockFindByStationId_toolpacks.mockResolvedValueOnce([]);

      const ctx = await buildStationContext({
        station: { id: STATION_ID, name: "Sales Station" },
        organizationId: ORG_ID,
      });

      expect(ctx.effectiveToolPacks).toEqual([]);
      expect(ctx.unentitledToolPacks).toEqual([]);
    });

    it("populates connectorInstances + entityCapabilities when entity_management is enabled", async () => {
      // Re-import to pick up the freshly-mocked repos.
      const { buildStationContext } =
        await import("../../services/portal.service.js");

      mockLoadStation.mockResolvedValueOnce(STATION_DATA);
      mockStationInstancesFindByStationId.mockResolvedValueOnce([
        { connectorInstanceId: "ci-7" },
      ]);
      mockConnectorInstancesFindById.mockResolvedValueOnce({
        id: "ci-7",
        name: "NASA NeoWs",
        connectorDefinitionId: "cd-rest",
      });
      mockConnectorDefinitionsFindById.mockResolvedValueOnce({
        id: "cd-rest",
        display: "REST API",
        slug: "rest-api",
      });
      mockResolveEntityCapabilities.mockResolvedValueOnce({
        "ent-1": { read: true, write: true, push: false },
      });

      mockFindByStationId_toolpacks.mockResolvedValueOnce(
        makeToolpackRows(["data_query", "entity_management"])
      );

      const ctx = await buildStationContext({
        station: { id: STATION_ID, name: "Sales Station" },
        organizationId: ORG_ID,
      });

      expect(ctx.connectorInstances).toEqual([
        {
          id: "ci-7",
          name: "NASA NeoWs",
          display: "REST API",
          slug: "rest-api",
        },
      ]);
      expect(ctx.entityCapabilities).toEqual({
        "ent-1": { read: true, write: true, push: false },
      });
    });

    it("omits connectorInstances + entityCapabilities when entity_management is not enabled", async () => {
      const { buildStationContext } =
        await import("../../services/portal.service.js");

      mockLoadStation.mockResolvedValueOnce(STATION_DATA);

      mockFindByStationId_toolpacks.mockResolvedValueOnce(
        makeToolpackRows(["data_query"])
      );

      const ctx = await buildStationContext({
        station: { id: STATION_ID, name: "Sales Station" },
        organizationId: ORG_ID,
      });

      expect(ctx.connectorInstances).toBeUndefined();
      expect(ctx.entityCapabilities).toBeUndefined();
      // The connector-loading helpers must not even run.
      expect(mockStationInstancesFindByStationId).not.toHaveBeenCalled();
      expect(mockResolveEntityCapabilities).not.toHaveBeenCalled();
    });

    // ── Entitlement split (#284) ──────────────────────────────────────
    //
    // The caller passes CONFIGURED packs; the context reports what the
    // session actually has. Before #284 the prompt received the configured
    // set while buildAnalyticsTools built from the entitled subset, so the
    // agent was told about tools that had been stripped from its own session.

    it("splits configured packs into effective and unentitled", async () => {
      const { buildStationContext } =
        await import("../../services/portal.service.js");

      mockLoadStation.mockResolvedValueOnce(STATION_DATA);
      mockSplitBuiltinPacks.mockResolvedValueOnce({
        effective: ["data_query"],
        unentitled: ["entity_management"],
        tier: "standard",
      });

      mockFindByStationId_toolpacks.mockResolvedValueOnce(
        makeToolpackRows(["data_query", "entity_management"])
      );

      const ctx = await buildStationContext({
        station: { id: STATION_ID, name: "Sales Station" },
        organizationId: ORG_ID,
      });

      expect(ctx.effectiveToolPacks).toEqual(["data_query"]);
      expect(ctx.unentitledToolPacks).toEqual(["entity_management"]);
      expect(mockSplitBuiltinPacks).toHaveBeenCalledWith(ORG_ID, [
        "data_query",
        "entity_management",
      ]);
    });

    it("skips connector + capability loading when entity_management is configured but unentitled", async () => {
      // The pack's tools don't exist, so the work that only feeds them is
      // wasted — and surfacing connectorInstances would imply a capability
      // the session doesn't have.
      const { buildStationContext } =
        await import("../../services/portal.service.js");

      mockLoadStation.mockResolvedValueOnce(STATION_DATA);
      mockSplitBuiltinPacks.mockResolvedValueOnce({
        effective: ["data_query"],
        unentitled: ["entity_management"],
        tier: "standard",
      });

      mockFindByStationId_toolpacks.mockResolvedValueOnce(
        makeToolpackRows(["data_query", "entity_management"])
      );

      const ctx = await buildStationContext({
        station: { id: STATION_ID, name: "Sales Station" },
        organizationId: ORG_ID,
      });

      expect(ctx.connectorInstances).toBeUndefined();
      expect(ctx.entityCapabilities).toBeUndefined();
      expect(mockStationInstancesFindByStationId).not.toHaveBeenCalled();
      expect(mockResolveEntityCapabilities).not.toHaveBeenCalled();
    });

    it("still loads connectors + capabilities when entity_management is entitled", async () => {
      const { buildStationContext } =
        await import("../../services/portal.service.js");

      mockLoadStation.mockResolvedValueOnce(STATION_DATA);
      mockStationInstancesFindByStationId.mockResolvedValueOnce([]);
      mockResolveEntityCapabilities.mockResolvedValueOnce({});

      mockFindByStationId_toolpacks.mockResolvedValueOnce(
        makeToolpackRows(["entity_management"])
      );

      const ctx = await buildStationContext({
        station: { id: STATION_ID, name: "Sales Station" },
        organizationId: ORG_ID,
      });

      expect(ctx.effectiveToolPacks).toEqual(["entity_management"]);
      expect(ctx.unentitledToolPacks).toEqual([]);
      expect(ctx.connectorInstances).toEqual([]);
      expect(ctx.entityCapabilities).toEqual({});
    });

    it("reflects newly-attached connectors on a second call (no stale caching)", async () => {
      const { buildStationContext } =
        await import("../../services/portal.service.js");

      mockLoadStation.mockResolvedValue(STATION_DATA);
      mockResolveEntityCapabilities.mockResolvedValue({});

      // First call: zero connector instances attached.
      mockStationInstancesFindByStationId.mockResolvedValueOnce([]);
      mockFindByStationId_toolpacks.mockResolvedValueOnce(
        makeToolpackRows(["entity_management"])
      );
      const first = await buildStationContext({
        station: { id: STATION_ID, name: "Sales Station" },
        organizationId: ORG_ID,
      });
      expect(first.connectorInstances).toEqual([]);

      // Second call: one connector attached mid-session.
      mockStationInstancesFindByStationId.mockResolvedValueOnce([
        { connectorInstanceId: "ci-late" },
      ]);
      mockConnectorInstancesFindById.mockResolvedValueOnce({
        id: "ci-late",
        name: "Late-bound",
        connectorDefinitionId: "cd-rest",
      });
      mockConnectorDefinitionsFindById.mockResolvedValueOnce({
        id: "cd-rest",
        display: "REST API",
        slug: "rest-api",
      });
      mockFindByStationId_toolpacks.mockResolvedValueOnce(
        makeToolpackRows(["entity_management"])
      );
      const second = await buildStationContext({
        station: { id: STATION_ID, name: "Sales Station" },
        organizationId: ORG_ID,
      });
      expect(second.connectorInstances).toEqual([
        {
          id: "ci-late",
          name: "Late-bound",
          display: "REST API",
          slug: "rest-api",
        },
      ]);
    });
  });

  // ── getPortal ─────────────────────────────────────────────────────────────

  describe("getPortal", () => {
    it("returns portal, messages, and coreMessages", async () => {
      const messages = [
        {
          id: "msg-1",
          role: "user",
          blocks: [{ type: "text", content: "Hi" }],
        },
      ];
      mockFindById_portal.mockResolvedValue(PORTAL);
      mockFindByPortal.mockResolvedValue(messages);

      const result = await PortalService.getPortal(PORTAL_ID);

      expect(result.portal).toBe(PORTAL);
      expect(result.messages).toBe(messages);
      expect(result.coreMessages).toBeDefined();
      expect(mockFindByPortal).toHaveBeenCalledWith(PORTAL_ID);
    });

    it("reconstructs full ModelMessage[] including tool turns", async () => {
      const messages = [
        {
          id: "msg-1",
          role: "user",
          blocks: [{ type: "text", content: "Show me revenue" }],
        },
        {
          id: "msg-2",
          role: "assistant",
          blocks: [
            { type: "text", content: "Let me query that." },
            {
              type: "tool-call",
              toolCallId: "tc-1",
              toolName: "sql_query",
              args: { query: "SELECT *" },
            },
            {
              type: "tool-result",
              toolCallId: "tc-1",
              toolName: "sql_query",
              content: { rows: [{ id: 1 }] },
            },
            { type: "data-table", columns: ["id"], rows: [{ id: 1 }] },
            { type: "text", content: "Here are the results." },
          ],
        },
      ];
      mockFindById_portal.mockResolvedValue(PORTAL);
      mockFindByPortal.mockResolvedValue(messages);

      const result = await PortalService.getPortal(PORTAL_ID);

      // User message
      expect(result.coreMessages[0]).toEqual({
        role: "user",
        content: "Show me revenue",
      });

      // Step 1: assistant with text + tool-call
      expect(result.coreMessages[1]).toEqual({
        role: "assistant",
        content: [
          { type: "text", text: "Let me query that." },
          {
            type: "tool-call",
            toolCallId: "tc-1",
            toolName: "sql_query",
            input: { query: "SELECT *" },
          },
        ],
      });

      // Step 1: tool results (AI SDK v6: result → output with { type, value })
      expect(result.coreMessages[2]).toEqual({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc-1",
            toolName: "sql_query",
            output: { type: "json", value: { rows: [{ id: 1 }] } },
          },
        ],
      });

      // Trailing text after tool step
      expect(result.coreMessages[3]).toEqual({
        role: "assistant",
        content: [{ type: "text", text: "Here are the results." }],
      });
    });

    it("throws PORTAL_NOT_FOUND when portal does not exist", async () => {
      mockFindById_portal.mockResolvedValue(null);

      await expect(PortalService.getPortal(PORTAL_ID)).rejects.toMatchObject({
        code: ApiCode.PORTAL_NOT_FOUND,
      });
    });
  });

  // ── addMessage ────────────────────────────────────────────────────────────

  describe("addMessage", () => {
    it("persists a user message as a text block", async () => {
      const savedMsg = { id: "msg-new", role: "user", blocks: [] };
      mockFindById_portal.mockResolvedValue(PORTAL);
      mockCreate_message.mockResolvedValue(savedMsg);

      const result = await PortalService.addMessage(PORTAL_ID, {
        role: "user",
        content: "Hello!",
      });

      expect(result).toBe(savedMsg);
      expect(mockCreate_message).toHaveBeenCalledWith(
        expect.objectContaining({
          portalId: PORTAL_ID,
          organizationId: ORG_ID,
          role: "user",
          blocks: [{ type: "text", content: "Hello!" }],
        })
      );
    });

    it("throws PORTAL_NOT_FOUND when portal does not exist", async () => {
      mockFindById_portal.mockResolvedValue(null);

      await expect(
        PortalService.addMessage(PORTAL_ID, { role: "user", content: "hi" })
      ).rejects.toMatchObject({ code: ApiCode.PORTAL_NOT_FOUND });
    });
  });

  // ── resetPortal ──────────────────────────────────────────────────────────

  describe("resetPortal", () => {
    it("deletes all messages and returns count", async () => {
      mockFindById_portal.mockResolvedValue(PORTAL);
      mockDeleteByPortal.mockResolvedValue(5);

      const count = await PortalService.resetPortal(PORTAL_ID);

      expect(count).toBe(5);
      expect(mockDeleteByPortal).toHaveBeenCalledWith(PORTAL_ID);
    });

    it("returns 0 when portal has no messages", async () => {
      mockFindById_portal.mockResolvedValue(PORTAL);
      mockDeleteByPortal.mockResolvedValue(0);

      const count = await PortalService.resetPortal(PORTAL_ID);

      expect(count).toBe(0);
    });

    it("throws PORTAL_NOT_FOUND when portal does not exist", async () => {
      mockFindById_portal.mockResolvedValue(null);

      await expect(PortalService.resetPortal(PORTAL_ID)).rejects.toMatchObject({
        code: ApiCode.PORTAL_NOT_FOUND,
      });
    });
  });

  // ── streamResponse ────────────────────────────────────────────────────────

  describe("streamResponse", () => {
    const stationContext = {
      stationId: STATION_ID,
      stationName: "Sales Station",
      organizationTimezone: "UTC",
      entities: ENTITIES,
      entityGroups: [],
      effectiveToolPacks: ["data_query"],
      unentitledToolPacks: [],
    };

    const stationContextWithGroups = {
      ...stationContext,
      entityGroups: ENTITY_GROUPS,
    };

    beforeEach(() => {
      mockBuildAnalyticsTools.mockResolvedValue({});
      mockFindById_portal.mockResolvedValue(PORTAL);
      mockCreate_message.mockResolvedValue({ id: "msg-assistant" });
    });

    it("streams delta events and sends done on completion", async () => {
      const chunks = [
        { type: "text-delta", text: "Hello " },
        { type: "text-delta", text: "world" },
        { type: "finish" },
      ];
      mockStreamText.mockReturnValue({ fullStream: makeStream(chunks) });

      const sse = makeSse();
      await PortalService.streamResponse({
        portalId: PORTAL_ID,
        messages: [{ role: "user", content: "hi" }],
        stationContext,
        organizationId: ORG_ID,
        userId: "user-001",
        sse: sse as any,
      });

      expect(sse.send).toHaveBeenCalledWith("delta", {
        type: "delta",
        content: "Hello ",
      });
      expect(sse.send).toHaveBeenCalledWith("delta", {
        type: "delta",
        content: "world",
      });
      expect(sse.send).toHaveBeenCalledWith("done", {
        type: "done",
        portalId: PORTAL_ID,
        messageId: "msg-assistant",
      });
    });

    // ── #279 step lifecycle ─────────────────────────────────────────────
    //
    // `tool_call` / `tool_call_end` bracket a running tool so the client can
    // name the current phase. They are deliberately independent of
    // `tool_result`, which fires only for results that have a display shape —
    // a stats-only turn emits no `tool_result` at all, and before this the
    // frontend had no way to know a tool was running or had finished.
    describe("tool step lifecycle events (#279)", () => {
      const runStream = async (chunks: Record<string, unknown>[]) => {
        mockStreamText.mockReturnValue({ fullStream: makeStream(chunks) });
        const sse = makeSse();
        await PortalService.streamResponse({
          portalId: PORTAL_ID,
          messages: [],
          stationContext,
          organizationId: ORG_ID,
          userId: "user-001",
          sse: sse as any,
        });
        return sse;
      };

      const sentEvents = (sse: ReturnType<typeof makeSse>, name: string) =>
        (sse.send as any).mock.calls.filter((c: unknown[]) => c[0] === name);

      /** Index of the first `name` event in overall send order, or -1. */
      const sendIndex = (sse: ReturnType<typeof makeSse>, name: string) =>
        (sse.send as any).mock.calls.findIndex((c: unknown[]) => c[0] === name);

      it("emits tool_call when a tool starts", async () => {
        const sse = await runStream([
          {
            type: "tool-call",
            toolName: "visualize_d3",
            toolCallId: "tc-1",
            input: { spec: "bar" },
          },
          { type: "finish" },
        ]);

        const calls = sentEvents(sse, "tool_call");
        expect(calls).toHaveLength(1);
        expect(calls[0][1]).toEqual({
          type: "tool_call",
          toolCallId: "tc-1",
          toolName: "visualize_d3",
        });
      });

      it("skips tool_call when the chunk carries no toolCallId", async () => {
        const sse = await runStream([
          { type: "tool-call", toolName: "visualize_d3", input: {} },
          { type: "finish" },
        ]);

        // Unpairable by the client — better no step than a stuck one.
        expect(sentEvents(sse, "tool_call")).toHaveLength(0);
      });

      it("emits tool_call_end for a display-producing tool", async () => {
        const sse = await runStream([
          {
            type: "tool-result",
            toolName: "sql_query",
            toolCallId: "tc-2",
            output: { rows: [{ id: 1 }] },
          },
          { type: "finish" },
        ]);

        const calls = sentEvents(sse, "tool_call_end");
        expect(calls).toHaveLength(1);
        expect(calls[0][1]).toEqual({
          type: "tool_call_end",
          toolCallId: "tc-2",
          toolName: "sql_query",
        });
      });

      // The load-bearing case. `hypothesis_test` is resultKind "scalar", so
      // `resolveDisplayBlock` returns null and no `tool_result` is emitted —
      // the step must still close, or the indicator hangs for the rest of the
      // turn on a tool that already finished.
      it("emits tool_call_end for a tool that produces no display block", async () => {
        const sse = await runStream([
          {
            type: "tool-result",
            toolName: "hypothesis_test",
            toolCallId: "tc-3",
            output: { pValue: 0.03, statistic: 2.1 },
          },
          { type: "finish" },
        ]);

        expect(sentEvents(sse, "tool_result")).toHaveLength(0);
        expect(sentEvents(sse, "tool_call_end")).toHaveLength(1);
        expect(sentEvents(sse, "tool_call_end")[0][1]).toMatchObject({
          toolCallId: "tc-3",
          toolName: "hypothesis_test",
        });
      });

      it("emits tool_call_end before tool_result for the same call", async () => {
        const sse = await runStream([
          {
            type: "tool-result",
            toolName: "sql_query",
            toolCallId: "tc-4",
            output: { rows: [{ id: 1 }] },
          },
          { type: "finish" },
        ]);

        const endIdx = sendIndex(sse, "tool_call_end");
        const resultIdx = sendIndex(sse, "tool_result");
        expect(endIdx).toBeGreaterThanOrEqual(0);
        expect(resultIdx).toBeGreaterThanOrEqual(0);
        expect(endIdx).toBeLessThan(resultIdx);
      });

      it("leaves the tool_result payload untouched (additive contract)", async () => {
        const sse = await runStream([
          {
            type: "tool-result",
            toolName: "sql_query",
            toolCallId: "tc-5",
            output: { rows: [{ id: 1 }] },
          },
          { type: "finish" },
        ]);

        const payload = sentEvents(sse, "tool_result")[0][1];
        expect(Object.keys(payload).sort()).toEqual([
          "result",
          "toolName",
          "type",
        ]);
        expect(payload).not.toHaveProperty("toolCallId");
      });

      it("brackets a full tool turn in order", async () => {
        const sse = await runStream([
          { type: "text-delta", text: "Let me chart that" },
          {
            type: "tool-call",
            toolName: "sql_query",
            toolCallId: "tc-6",
            input: {},
          },
          {
            type: "tool-result",
            toolName: "sql_query",
            toolCallId: "tc-6",
            output: { rows: [{ id: 1 }] },
          },
          { type: "finish" },
        ]);

        expect(sendIndex(sse, "tool_call")).toBeLessThan(
          sendIndex(sse, "tool_call_end")
        );
        expect(sentEvents(sse, "tool_call")).toHaveLength(1);
        expect(sentEvents(sse, "tool_call_end")).toHaveLength(1);
      });
    });

    it("sends data-table SSE event for sql_query tool results", async () => {
      const queryResult = { rows: [{ id: 1, name: "Alice" }] };
      const chunks = [
        {
          type: "tool-result",
          toolName: "sql_query",
          toolCallId: "tc-1",
          output: queryResult,
        },
        { type: "finish" },
      ];
      mockStreamText.mockReturnValue({ fullStream: makeStream(chunks) });

      const sse = makeSse();
      await PortalService.streamResponse({
        portalId: PORTAL_ID,
        messages: [],
        stationContext,
        organizationId: ORG_ID,
        userId: "user-001",
        sse: sse as any,
      });

      const toolResultCalls = (sse.send as any).mock.calls.filter(
        (c: unknown[]) => c[0] === "tool_result"
      );
      expect(toolResultCalls).toHaveLength(1);
      expect(toolResultCalls[0][1]).toMatchObject({
        type: "tool_result",
        toolName: "sql_query",
        result: {
          type: "data-table",
          columns: ["id", "name"],
          rows: [{ id: 1, name: "Alice" }],
        },
      });
    });

    // #120 regression: cluster/detect_outliers are reduce tools (resultKind
    // "scalar"), not row producers. They must NOT auto-surface a data-table
    // — previously they were in ROW_SET_TOOLS and emitted spurious empty
    // widgets because their result shape carries no top-level `rows`.
    it.each(["detect_outliers", "cluster"])(
      "does not surface a data-table for %s (fixes #120)",
      async (toolName) => {
        const chunks = [
          {
            type: "tool-result",
            toolName,
            toolCallId: "tc-2",
            output: { outliers: [{ value: 99 }], indices: [3] },
          },
          { type: "finish" },
        ];
        mockStreamText.mockReturnValue({ fullStream: makeStream(chunks) });

        const sse = makeSse();
        await PortalService.streamResponse({
          portalId: PORTAL_ID,
          messages: [],
          stationContext,
          organizationId: ORG_ID,
          userId: "user-001",
          sse: sse as any,
        });

        const toolResultCalls = (sse.send as any).mock.calls.filter(
          (c: unknown[]) => c[0] === "tool_result"
        );
        expect(toolResultCalls).toHaveLength(0);
      }
    );

    it("does not send tool_result SSE for scalar tool results (correlate)", async () => {
      const chunks = [
        {
          type: "tool-result",
          toolName: "correlate",
          toolCallId: "tc-3",
          output: { coefficient: 0.87 },
        },
        { type: "finish" },
      ];
      mockStreamText.mockReturnValue({ fullStream: makeStream(chunks) });

      const sse = makeSse();
      await PortalService.streamResponse({
        portalId: PORTAL_ID,
        messages: [],
        stationContext,
        organizationId: ORG_ID,
        userId: "user-001",
        sse: sse as any,
      });

      const toolResultCalls = (sse.send as any).mock.calls.filter(
        (c: unknown[]) => c[0] === "tool_result"
      );
      expect(toolResultCalls).toHaveLength(0);
    });

    it("persists assistant message with tool-call, tool-result, and display blocks", async () => {
      const d3Result = { type: "d3", program: "/* d3 */", data: [] };
      const chunks = [
        { type: "text-delta", text: "Analysis: " },
        {
          type: "tool-call",
          toolCallId: "tc-1",
          toolName: "visualize_d3",
          input: { instruction: "bar chart" },
        },
        {
          type: "tool-result",
          toolCallId: "tc-1",
          toolName: "visualize_d3",
          output: d3Result,
        },
        { type: "text-delta", text: "done" },
        { type: "finish" },
      ];
      mockStreamText.mockReturnValue({ fullStream: makeStream(chunks) });

      const sse = makeSse();
      await PortalService.streamResponse({
        portalId: PORTAL_ID,
        messages: [],
        stationContext,
        organizationId: ORG_ID,
        userId: "user-001",
        sse: sse as any,
      });

      expect(mockCreate_message).toHaveBeenCalledWith(
        expect.objectContaining({
          role: "assistant",
          blocks: [
            { type: "text", content: "Analysis: " },
            {
              type: "tool-call",
              toolCallId: "tc-1",
              toolName: "visualize_d3",
              input: { instruction: "bar chart" },
            },
            {
              type: "tool-result",
              toolCallId: "tc-1",
              toolName: "visualize_d3",
              content: d3Result,
            },
            { type: "d3", content: d3Result },
            { type: "text", content: "done" },
          ],
        })
      );
    });

    // ── system prompt: no entity groups ──────────────────────────────────────

    it("system prompt does NOT include Cross-Entity Relationships when entityGroups is empty", async () => {
      mockStreamText.mockReturnValue({
        fullStream: makeStream([{ type: "finish" }]),
      });

      let capturedSystem: string | undefined;
      (mockStreamText as any).mockImplementation((opts: any) => {
        capturedSystem = opts.system;
        return { fullStream: makeStream([{ type: "finish" }]) };
      });

      const sse = makeSse();
      await PortalService.streamResponse({
        portalId: PORTAL_ID,
        messages: [],
        stationContext, // entityGroups: []
        organizationId: ORG_ID,
        userId: "user-001",
        sse: sse as any,
      });

      expect(capturedSystem).not.toContain("Cross-Entity Relationships");
    });

    // ── system prompt: with entity groups ────────────────────────────────────

    it("system prompt includes Cross-Entity Relationships when entityGroups is non-empty", async () => {
      let capturedSystem: string | undefined;
      (mockStreamText as any).mockImplementation((opts: any) => {
        capturedSystem = opts.system;
        return { fullStream: makeStream([{ type: "finish" }]) };
      });

      const sse = makeSse();
      await PortalService.streamResponse({
        portalId: PORTAL_ID,
        messages: [],
        stationContext: stationContextWithGroups,
        organizationId: ORG_ID,
        userId: "user-001",
        sse: sse as any,
      });

      expect(capturedSystem).toContain("Cross-Entity Relationships");
    });

    it("system prompt Entity Group section names the group count + points at station_context (#97)", async () => {
      let capturedSystem: string | undefined;
      (mockStreamText as any).mockImplementation((opts: any) => {
        capturedSystem = opts.system;
        return { fullStream: makeStream([{ type: "finish" }]) };
      });

      const sse = makeSse();
      await PortalService.streamResponse({
        portalId: PORTAL_ID,
        messages: [],
        stationContext: stationContextWithGroups,
        organizationId: ORG_ID,
        userId: "user-001",
        sse: sse as any,
      });

      expect(capturedSystem).toContain("## Cross-Entity Relationships");
      expect(capturedSystem).toMatch(/1 entity group/);
      expect(capturedSystem).toMatch(/station_context/);
      // The full member/link detail moved out of the prompt and into
      // the tool's response.
      expect(capturedSystem).not.toContain("Customer Orders");
      expect(capturedSystem).not.toContain("link column: `id`");
      expect(capturedSystem).not.toContain("[primary]");
    });

    it("system prompt lists entities as a roster + points at station_context (#97)", async () => {
      let capturedSystem: string | undefined;
      (mockStreamText as any).mockImplementation((opts: any) => {
        capturedSystem = opts.system;
        return { fullStream: makeStream([{ type: "finish" }]) };
      });

      const sse = makeSse();
      await PortalService.streamResponse({
        portalId: PORTAL_ID,
        messages: [],
        stationContext,
        organizationId: ORG_ID,
        userId: "user-001",
        sse: sse as any,
      });

      expect(capturedSystem).toContain("Sales Station");
      expect(capturedSystem).toContain("- `customers` — Customers");
      expect(capturedSystem).toContain("- `orders` — Orders");
      expect(capturedSystem).toMatch(/station_context/);
      // Column detail no longer in the static prompt.
      expect(capturedSystem).not.toContain("`revenue`");
    });

    it("calls buildAnalyticsTools with correct args and passes tools to streamText", async () => {
      const tools = { sql_query: {} };
      mockBuildAnalyticsTools.mockResolvedValue(tools);

      let capturedTools: unknown;
      (mockStreamText as any).mockImplementation((opts: any) => {
        capturedTools = opts.tools;
        return { fullStream: makeStream([{ type: "finish" }]) };
      });

      const sse = makeSse();
      await PortalService.streamResponse({
        portalId: PORTAL_ID,
        messages: [],
        stationContext,
        organizationId: ORG_ID,
        userId: "user-001",
        sse: sse as any,
      });

      expect(mockBuildAnalyticsTools).toHaveBeenCalledWith(
        ORG_ID,
        STATION_ID,
        "user-001",
        PORTAL_ID
      );
      expect(capturedTools).toBe(tools);
    });

    it("passes the always-available help tool through to streamText (#367)", async () => {
      // No trigger and no restricted run — platform_help rides the ordinary
      // tool set, and the agent routes to it. The whole feature depends on it
      // actually reaching the model, so pin the path rather than the builder.
      mockBuildAnalyticsTools.mockResolvedValue({
        sql_query: {},
        current_time: {},
        station_context: {},
        platform_help: {},
      });

      let capturedTools: Record<string, unknown> = {};
      (mockStreamText as any).mockImplementation((opts: any) => {
        capturedTools = opts.tools;
        return { fullStream: makeStream([{ type: "finish" }]) };
      });

      const sse = makeSse();
      await PortalService.streamResponse({
        portalId: PORTAL_ID,
        messages: [],
        stationContext,
        organizationId: ORG_ID,
        userId: "user-001",
        sse: sse as any,
      });

      expect(Object.keys(capturedTools)).toContain("platform_help");
    });

    it("does not force a tool choice (#367)", async () => {
      // The amended premise: there is no directive turn, so there is no turn
      // on which forcing a call would be correct. The agent routes, as it
      // does for every other tool.
      let captured: Record<string, unknown> = {};
      (mockStreamText as any).mockImplementation((opts: any) => {
        captured = opts;
        return { fullStream: makeStream([{ type: "finish" }]) };
      });

      const sse = makeSse();
      await PortalService.streamResponse({
        portalId: PORTAL_ID,
        messages: [],
        stationContext,
        organizationId: ORG_ID,
        userId: "user-001",
        sse: sse as any,
      });

      expect(captured.toolChoice).toBeUndefined();
    });

    it("throws PORTAL_NOT_FOUND when portal does not exist at persist time", async () => {
      mockStreamText.mockReturnValue({
        fullStream: makeStream([{ type: "finish" }]),
      });
      mockFindById_portal.mockResolvedValue(null);

      const sse = makeSse();
      await expect(
        PortalService.streamResponse({
          portalId: PORTAL_ID,
          messages: [],
          stationContext,
          organizationId: ORG_ID,
          userId: "user-001",
          sse: sse as any,
        })
      ).rejects.toMatchObject({ code: ApiCode.PORTAL_NOT_FOUND });
    });
  });
});

// ---------------------------------------------------------------------------
// resolveDisplayBlock — d3 (#269)
// ---------------------------------------------------------------------------

describe("resolveDisplayBlock → d3 (#269)", () => {
  const PROGRAM = "api.d3.select(api.container);";

  it("routes a visualize_d3 success (type:d3) to a d3 block", () => {
    const result = resolveDisplayBlock("visualize_d3", {
      type: "d3",
      program: PROGRAM,
      rows: [{ x: 1 }],
    });
    expect(result?.block.type).toBe("d3");
    expect(result?.block.content).toMatchObject({ program: PROGRAM });
  });

  it("routes a handle-shaped d3 result through the block (queryHandle preserved, sseResult set)", () => {
    const result = resolveDisplayBlock("visualize_d3", {
      type: "d3",
      program: PROGRAM,
      queryHandle: "qh-1",
      rowCount: 5000,
      schema: [{ name: "x", type: "numeric" }],
      samplePeek: [],
      sampled: false,
    });
    expect(result?.block.type).toBe("d3");
    expect(
      (result?.block.content as { queryHandle?: string }).queryHandle
    ).toBe("qh-1");
    expect(result?.sseResult).toBeDefined();
  });

  it("routes the visualize_d3 data-table FALLBACK (type:data-table) to a data-table block, not d3", () => {
    const result = resolveDisplayBlock("visualize_d3", {
      type: "data-table",
      rows: [{ x: 1 }, { x: 2 }],
      message: "codegen failed; showing table",
    });
    expect(result?.block.type).toBe("data-table");
  });
});

// resolveDisplayBlock — the durable pipeline survives projection (#349)
// ---------------------------------------------------------------------------
//
// d3 and geo results pass through whole, which is why only they kept their
// pipeline. The data-table arms field-whitelist, and dropped it — making every
// table block terminal at any size. These pin that the whitelist now carries it.

describe("resolveDisplayBlock → data-table pipeline (#349)", () => {
  const PIPELINE = {
    sql: "SELECT name, acres FROM parcels ORDER BY acres DESC LIMIT 10",
    stationId: "st-1",
    organizationId: "org-1",
  };

  it("keeps the pipeline on an inline data-table block", () => {
    const result = resolveDisplayBlock("sql_query", {
      rows: [{ name: "North Ridge", acres: 412 }],
      pipeline: PIPELINE,
    });
    expect(result?.block.type).toBe("data-table");
    expect(result?.block.content).toMatchObject({
      type: "data-table",
      columns: ["name", "acres"],
      pipeline: PIPELINE,
    });
    expect(result?.sseResult).toMatchObject({ pipeline: PIPELINE });
  });

  it("keeps the pipeline on a handle data-table block alongside the envelope fields", () => {
    const result = resolveDisplayBlock("sql_query", {
      type: "data-table",
      queryHandle: "qh-1",
      rowCount: 13_427,
      schema: [{ name: "acres", type: "numeric" }],
      samplePeek: [],
      sampled: false,
      pipeline: PIPELINE,
    });
    expect(result?.block.content).toMatchObject({
      type: "data-table",
      queryHandle: "qh-1",
      rowCount: 13_427,
      pipeline: PIPELINE,
    });
  });

  // The contract field is `.optional()`, so a legacy result must yield content
  // with the key ABSENT — not present-and-undefined, which would fail a strict
  // equality check against a pre-#349 block and muddy the notRefreshable path.
  it("omits the key entirely when the tool result carries no pipeline", () => {
    const inline = resolveDisplayBlock("sql_query", {
      rows: [{ name: "North Ridge" }],
    });
    expect(inline?.block.content).not.toHaveProperty("pipeline");

    const handle = resolveDisplayBlock("sql_query", {
      type: "data-table",
      queryHandle: "qh-2",
      rowCount: 5,
      schema: [],
      samplePeek: [],
      sampled: false,
    });
    expect(handle?.block.content).not.toHaveProperty("pipeline");
  });

  it("still returns null for an empty result, pipeline or not (#120)", () => {
    expect(
      resolveDisplayBlock("sql_query", { rows: [], pipeline: PIPELINE })
    ).toBeNull();
  });
});

// resolveDisplayBlock — geo (#314)
// ---------------------------------------------------------------------------

describe("resolveDisplayBlock → geo (#314)", () => {
  const SPEC = {
    layers: [
      { kind: "points", source: { latColumn: "lat", lngColumn: "lng" } },
    ],
  };

  it("routes a visualize_map success (type:geo, inline rows) to a geo block", () => {
    const result = resolveDisplayBlock("visualize_map", {
      type: "geo",
      spec: SPEC,
      rows: [{ lat: 1, lng: 2 }],
    });
    expect(result?.block.type).toBe("geo");
    expect(result?.block.content).toMatchObject({ spec: SPEC });
    expect(result?.sseResult).toBeDefined();
  });

  it("routes a handle-shaped geo result through the block (queryHandle preserved)", () => {
    const result = resolveDisplayBlock("visualize_map", {
      type: "geo",
      spec: SPEC,
      queryHandle: "qh-geo-1",
      rowCount: 9000,
      schema: [{ name: "geom", type: "geometry" }],
      samplePeek: [],
      sampled: false,
    });
    expect(result?.block.type).toBe("geo");
    expect(
      (result?.block.content as { queryHandle?: string }).queryHandle
    ).toBe("qh-geo-1");
    expect(result?.sseResult).toBeDefined();
  });
});

// resolveDisplayBlock — mutation-result variants
// ---------------------------------------------------------------------------

describe("resolveDisplayBlock → mutation-result", () => {
  it("returns null for non-mutation tools", () => {
    const result = resolveDisplayBlock("sql_query", {
      rows: [{ id: 1 }],
    });
    // sql_query is a row-set tool, not a mutation — should produce a data-table,
    // but the shape is handled by the row-set branch, not the mutation branch.
    expect(result?.block.content).not.toMatchObject({
      type: "mutation-result",
    });
  });

  it("returns null when tool result has no items", () => {
    const result = resolveDisplayBlock("entity_record_create", {
      success: true,
      operation: "created",
      entity: "record",
    });
    expect(result).toBeNull();
  });

  it("returns null on failed tool result", () => {
    const result = resolveDisplayBlock("entity_record_create", {
      success: false,
      error: "Scope violation",
    });
    expect(result).toBeNull();
  });

  it("maps a single-item tool result to the Single variant", () => {
    const result = resolveDisplayBlock("entity_record_create", {
      success: true,
      operation: "created",
      entity: "record",
      items: [{ entityId: "r-1", summary: { sourceId: "abc" } }],
    });

    expect(result).not.toBeNull();
    expect(result!.block).toEqual({
      type: "mutation-result",
      content: {
        type: "mutation-result",
        operation: "created",
        entity: "record",
        item: { entityId: "r-1", summary: { sourceId: "abc" } },
      },
    });
    expect(result!.sseResult).toEqual(result!.block.content);
  });

  it("maps a multi-item tool result to the Bulk variant with count", () => {
    const result = resolveDisplayBlock("field_mapping_create", {
      success: true,
      operation: "created",
      entity: "field mapping",
      items: [
        { entityId: "fm-1", summary: { sourceField: "A" } },
        { entityId: "fm-2", summary: { sourceField: "B" } },
        { entityId: "fm-3", summary: { sourceField: "C" } },
      ],
    });

    expect(result).not.toBeNull();
    expect(result!.block.content).toEqual({
      type: "mutation-result",
      operation: "created",
      entity: "field mapping",
      count: 3,
      items: [
        { entityId: "fm-1", summary: { sourceField: "A" } },
        { entityId: "fm-2", summary: { sourceField: "B" } },
        { entityId: "fm-3", summary: { sourceField: "C" } },
      ],
    });
  });

  it("does not leak legacy top-level summary / entityId / count fields", () => {
    const result = resolveDisplayBlock("entity_record_create", {
      success: true,
      operation: "created",
      entity: "record",
      // Legacy fields the old contract allowed — must be dropped.
      entityId: "legacy-id",
      count: 1,
      summary: { legacy: "value" },
      items: [{ entityId: "r-1" }],
    });

    const content = result!.block.content as Record<string, unknown>;
    expect(content).not.toHaveProperty("entityId");
    expect(content).not.toHaveProperty("summary");
    expect(content).not.toHaveProperty("count");
    expect(content).not.toHaveProperty("items");
    expect(content.item).toEqual({ entityId: "r-1" });
  });
});

// ---------------------------------------------------------------------------
// replayTurn (#504) — re-emit a persisted assistant turn over SSE with no
// model call, so an EventSource reconnect renders the stored answer instead of
// firing a duplicate Anthropic call.
// ---------------------------------------------------------------------------

describe("PortalService.replayTurn (#504)", () => {
  const PORTAL = "portal-replay";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("re-emits text as delta and a display tool-result as tool_result, then done — never calling the model", () => {
    const message = {
      id: "msg-asst-9",
      role: "assistant",
      blocks: [
        { type: "text", content: "Here is the chart:" },
        // tool-call parts have no render — must be skipped.
        {
          type: "tool-call",
          toolCallId: "tc1",
          toolName: "visualize_d3",
          input: {},
        },
        {
          type: "tool-result",
          toolCallId: "tc1",
          toolName: "visualize_d3",
          content: { type: "d3", spec: { mark: "bar" } },
        },
        // The derived display block is reconstructed client-side from the
        // tool_result event — replaying it too would double-render.
        { type: "d3", content: { type: "d3", spec: { mark: "bar" } } },
        { type: "text", content: "Let me know if you want changes." },
      ],
    };
    const sse = makeSse();

    PortalService.replayTurn(sse as any, message as any, PORTAL);

    expect(mockStreamText).not.toHaveBeenCalled();
    expect((sse.send as any).mock.calls).toEqual([
      ["delta", { type: "delta", content: "Here is the chart:" }],
      [
        "tool_result",
        {
          type: "tool_result",
          toolName: "visualize_d3",
          result: { type: "d3", spec: { mark: "bar" } },
        },
      ],
      ["delta", { type: "delta", content: "Let me know if you want changes." }],
      ["done", { type: "done", portalId: PORTAL, messageId: "msg-asst-9" }],
    ]);
  });

  it("skips a scalar tool-result that has no display shape", () => {
    const message = {
      id: "msg-asst-10",
      role: "assistant",
      blocks: [
        {
          type: "tool-result",
          toolCallId: "tc2",
          toolName: "hypothesis_test",
          content: { pValue: 0.03, statistic: 2.1 },
        },
      ],
    };
    const sse = makeSse();

    PortalService.replayTurn(sse as any, message as any, PORTAL);

    // Only the terminal done — a scalar result produces no tool_result.
    expect((sse.send as any).mock.calls).toEqual([
      ["done", { type: "done", portalId: PORTAL, messageId: "msg-asst-10" }],
    ]);
  });
});
