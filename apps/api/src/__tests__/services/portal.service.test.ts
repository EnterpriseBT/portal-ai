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
    // #1079: createPortal writes the portal (and a first message) in one
    // transaction; the repo mocks stand in for the transaction's client.
    transaction: <R>(fn: (tx: unknown) => Promise<R>) => fn("tx"),
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
  },
}));

jest.unstable_mockModule("../../utils/resolve-capabilities.util.js", () => ({
  resolveEntityCapabilities: mockResolveEntityCapabilities,
  // #824: each connector in the prompt context carries `writable`.
  resolveCapabilities: () => ({ read: true, write: true, push: false }),
  resolveStationCapabilities: async () => [
    {
      connectorInstanceId: "ci-1",
      capabilities: { read: true, write: true, push: false },
    },
  ],
}));

// #599: buildStationContext scopes its entities to the caller's granted
// curated views via PortalSqlService.resolveGrantedViewColumns.
const mockResolveGrantedViewColumns = jest.fn<() => Promise<unknown>>();
jest.unstable_mockModule("../../services/portal-sql.service.js", () => ({
  PortalSqlService: {
    resolveGrantedViewColumns: mockResolveGrantedViewColumns,
  },
  // #643: portal-map-tile.service (a transitive import) statically imports this,
  // so the mock must provide it or the ESM linker fails to resolve the module.
  resolveScopeHash: jest.fn(() => "scope-test"),
  // #660 PR 2: same reason (the tile service and dissolve processor import it).
  openSqlSession: jest.fn(),
}));

// #674: buildStationContext reads the caller's attachment counts.
const ATTACHMENT_COUNTS = {
  views: { attached: 2, readable: 1 },
  connectors: { attached: 0, readable: 0 },
};
const mockCountsForCaller = jest
  .fn<() => Promise<unknown>>()
  .mockResolvedValue(ATTACHMENT_COUNTS);
jest.unstable_mockModule(
  "../../services/station-attachment.service.js",
  () => ({
    StationAttachmentService: { countsForCaller: mockCountsForCaller },
  })
);

// #1100: the turn's caller, named in the system prompt.
const mockGetMember = jest.fn<() => Promise<unknown>>().mockResolvedValue({
  userId: "user-001",
  email: "ada@example.com",
  name: "Ada Lovelace",
  roles: ["owner"],
  roleSlugs: ["owner"],
  groupIds: [],
  joinedAt: 1,
});
jest.unstable_mockModule("../../services/seat.service.js", () => ({
  SeatService: { getMember: mockGetMember },
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

const {
  PortalService,
  resolveDisplayBlock,
  endsOnSelfContainedBlocks,
  narrationStepPrep,
  renderedBlockReminder,
  NEXT_TOOL_REMINDER,
  EARLIER_TURN_PREFIX,
} = await import("../../services/portal.service.js");
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
        connectorEntityId: "ent-1",
        linkNormalizedKey: "id",
        linkColumnKey: "id",
        linkColumnLabel: "ID",
        isPrimary: true,
      },
      {
        entityKey: "orders",
        connectorEntityId: "ent-2",
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
    // Default: every entity is a granted passthrough view with all columns
    // readable — so the view-scoped roster mirrors the raw entities.
    mockResolveGrantedViewColumns.mockResolvedValue({
      set: { canPerformAny: () => false },
      views: ENTITIES.map((e) => ({
        view: {
          id: `view-${e.id}`,
          key: e.key,
          label: e.label,
          connectorEntityId: e.id,
        },
        columns: e.columns.map((c) => ({
          fieldMappingId: c.fieldMappingId,
          columnName: `c_${c.key}`,
          normalizedKey: c.key,
        })),
      })),
    });
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
      expect(result.stationContext.entities).toEqual(ENTITIES);
      // #648: entity groups are view-scoped now (a filtered copy). The default
      // grant covers both member entities, so the content is unchanged.
      expect(result.stationContext.entityGroups).toEqual(ENTITY_GROUPS);
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

    it("#674: carries the caller's attachment counts for the empty-station lines", async () => {
      const { buildStationContext } =
        await import("../../services/portal.service.js");
      mockLoadStation.mockResolvedValueOnce(STATION_DATA);
      mockFindByStationId_toolpacks.mockResolvedValueOnce(
        makeToolpackRows(["data_query"])
      );
      mockResolveGrantedViewColumns.mockResolvedValueOnce({
        set: { canPerformAny: () => false },
        views: [],
      });

      const ctx = await buildStationContext({
        station: { id: STATION_ID, name: "S" },
        organizationId: ORG_ID,
        userId: "user-001",
      });

      expect(ctx.attachments).toEqual(ATTACHMENT_COUNTS);
      expect(mockCountsForCaller).toHaveBeenCalledWith(
        STATION_ID,
        ORG_ID,
        "user-001"
      );
    });

    // ── #1100: the caller's identity ──────────────────────────────────

    const contextFor = async (userId: string) => {
      const { buildStationContext } =
        await import("../../services/portal.service.js");
      mockLoadStation.mockResolvedValueOnce(STATION_DATA);
      mockFindByStationId_toolpacks.mockResolvedValueOnce(
        makeToolpackRows(["data_query"])
      );
      mockResolveGrantedViewColumns.mockResolvedValueOnce({
        set: { canPerformAny: () => false },
        views: [],
      });
      return buildStationContext({
        station: { id: STATION_ID, name: "S" },
        organizationId: ORG_ID,
        userId,
      });
    };

    it("#1100: names the turn's caller from their membership in this org", async () => {
      const ctx = await contextFor("user-001");
      expect(mockGetMember).toHaveBeenCalledWith(ORG_ID, "user-001");
      expect(ctx.caller).toEqual({
        userId: "user-001",
        name: "Ada Lovelace",
        email: "ada@example.com",
        roles: ["owner"],
        roleSlugs: ["owner"],
      });
    });

    it("#1100: falls back to the userId alone when the lookup fails", async () => {
      mockGetMember.mockRejectedValueOnce(new Error("pool exhausted"));
      const ctx = await contextFor("user-500");
      expect(ctx.caller).toEqual({
        userId: "user-500",
        name: null,
        email: null,
        roles: [],
        roleSlugs: [],
      });
    });

    it("#1100: falls back to the userId alone when no membership is found", async () => {
      mockGetMember.mockResolvedValueOnce(null);
      const ctx = await contextFor("user-404");
      expect(ctx.caller).toEqual({
        userId: "user-404",
        name: null,
        email: null,
        roles: [],
        roleSlugs: [],
      });
    });

    // ── #599: view-scoping (the OQ2 roster leak fix) ──────────────────

    it("scopes the roster to the caller's granted views + readable columns", async () => {
      const { buildStationContext } =
        await import("../../services/portal.service.js");

      mockLoadStation.mockResolvedValueOnce(STATION_DATA);
      mockFindByStationId_toolpacks.mockResolvedValueOnce(
        makeToolpackRows(["data_query"])
      );
      // Only `customers` is granted, and only its `id` column is readable —
      // `orders` and the `revenue` column must not appear in the roster.
      mockResolveGrantedViewColumns.mockResolvedValueOnce({
        set: { canPerformAny: () => false },
        views: [
          {
            view: {
              id: "v-customers",
              key: "customers",
              label: "Customers",
              connectorEntityId: "ent-1",
            },
            columns: [
              {
                fieldMappingId: "fm-1",
                columnName: "c_id",
                normalizedKey: "id",
              },
            ],
          },
        ],
      });

      const ctx = await buildStationContext({
        station: { id: STATION_ID, name: "Sales Station" },
        organizationId: ORG_ID,
        userId: USER_ID,
      });

      expect(ctx.entities).toHaveLength(1);
      expect(ctx.entities[0].key).toBe("customers");
      expect(ctx.entities[0].columns.map((c) => c.key)).toEqual(["id"]);
    });

    // ── #648: entity-group view-scoping (all-or-nothing per group) ────
    it("keeps a group only when every member entity is granted", async () => {
      const { buildStationContext } =
        await import("../../services/portal.service.js");

      mockLoadStation.mockResolvedValueOnce(STATION_DATA);
      mockFindByStationId_toolpacks.mockResolvedValueOnce(
        makeToolpackRows(["data_query"])
      );
      // Both `customers` (ent-1) and `orders` (ent-2) are granted → the group
      // is emitted intact (both members, primary preserved).
      mockResolveGrantedViewColumns.mockResolvedValueOnce({
        set: { canPerformAny: () => false },
        views: [
          {
            view: {
              id: "v-customers",
              key: "customers",
              label: "Customers",
              connectorEntityId: "ent-1",
            },
            columns: [
              {
                fieldMappingId: "fm-1",
                columnName: "c_id",
                normalizedKey: "id",
              },
            ],
          },
          {
            view: {
              id: "v-orders",
              key: "orders",
              label: "Orders",
              connectorEntityId: "ent-2",
            },
            columns: [
              {
                fieldMappingId: "fm-3",
                columnName: "c_customer_id",
                normalizedKey: "customer_id",
              },
            ],
          },
        ],
      });

      const ctx = await buildStationContext({
        station: { id: STATION_ID, name: "Sales Station" },
        organizationId: ORG_ID,
        userId: USER_ID,
      });

      expect(ctx.entityGroups).toHaveLength(1);
      expect(
        ctx.entityGroups[0].members.map((m) => m.connectorEntityId)
      ).toEqual(["ent-1", "ent-2"]);
    });

    it("drops a group entirely when any member entity is ungranted", async () => {
      const { buildStationContext } =
        await import("../../services/portal.service.js");

      mockLoadStation.mockResolvedValueOnce(STATION_DATA);
      mockFindByStationId_toolpacks.mockResolvedValueOnce(
        makeToolpackRows(["data_query"])
      );
      // Only `customers` (ent-1) is granted — the "Customer Orders" group also
      // links `orders` (ent-2, ungranted), so the whole group is absent: a
      // partially-granted group is unusable for a join and would leak the
      // ungranted entity's participation. (Also covers no-granted-member.)
      mockResolveGrantedViewColumns.mockResolvedValueOnce({
        set: { canPerformAny: () => false },
        views: [
          {
            view: {
              id: "v-customers",
              key: "customers",
              label: "Customers",
              connectorEntityId: "ent-1",
            },
            columns: [
              {
                fieldMappingId: "fm-1",
                columnName: "c_id",
                normalizedKey: "id",
              },
            ],
          },
        ],
      });

      const ctx = await buildStationContext({
        station: { id: STATION_ID, name: "Sales Station" },
        organizationId: ORG_ID,
        userId: USER_ID,
      });

      expect(ctx.entityGroups).toEqual([]);
    });

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
        userId: USER_ID,
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
        userId: USER_ID,
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
        userId: USER_ID,
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
        userId: USER_ID,
      });

      expect(ctx.connectorInstances).toEqual([
        {
          id: "ci-7",
          name: "NASA NeoWs",
          display: "REST API",
          slug: "rest-api",
          writable: true,
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
        userId: USER_ID,
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

    // #848: the plan's packs that aren't on this station reach the prompt, so
    // the agent can name the pack a request needs.
    it("carries the plan's other packs into the context (#848)", async () => {
      const { buildStationContext } =
        await import("../../services/portal.service.js");

      mockLoadStation.mockResolvedValueOnce(STATION_DATA);
      mockResolveStationPacks.mockResolvedValueOnce({
        effective: ["rbac_management"],
        unentitled: [],
        otherPlanPacks: ["data_query", "view_management"],
        customPacks: [],
        configuredCustomPackCount: 1,
        customPacksEntitled: false,
        excludedCustomPacks: ["acme"],
        tier: "standard",
      } as never);

      const ctx = await buildStationContext({
        station: { id: STATION_ID, name: "Administrate" },
        organizationId: ORG_ID,
        userId: USER_ID,
      });

      expect(ctx.otherPlanToolPacks).toEqual(["data_query", "view_management"]);
      // A custom pack the plan excludes has no summary, and the prompt goes
      // by the summaries.
      expect(ctx.customToolPacks).toEqual([]);
      expect(ctx).not.toHaveProperty("configuredCustomPackCount");
      // #1045: its name reaches the prompt's plan-limit section.
      expect(ctx.excludedCustomToolPacks).toEqual(["acme"]);
    });

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
        userId: USER_ID,
      });

      expect(ctx.effectiveToolPacks).toEqual(["data_query"]);
      expect(ctx.unentitledToolPacks).toEqual(["entity_management"]);
      expect(mockSplitBuiltinPacks).toHaveBeenCalledWith(ORG_ID, [
        "data_query",
        "entity_management",
      ]);
    });

    // #615: the GIS section names geocode tools only when they're built,
    // which takes GEOCODING_API_KEY; bulk_geocode_records also needs writes.
    it.each([
      ["set", "gis-key", true, true],
      ["unset", "", false, undefined],
    ])(
      "reports geocodingAvailable from GEOCODING_API_KEY (%s), resolving writability only when bulk geocoding could exist",
      async (_label, key, expected, writable) => {
        const { buildStationContext } =
          await import("../../services/portal.service.js");
        const { environment } = await import("../../environment.js");
        const previous = environment.GEOCODING_API_KEY;
        environment.GEOCODING_API_KEY = key;
        try {
          mockLoadStation.mockResolvedValueOnce(STATION_DATA);
          mockSplitBuiltinPacks.mockResolvedValueOnce({
            effective: ["data_query", "gis"],
            unentitled: [],
            tier: "standard",
          });
          mockFindByStationId_toolpacks.mockResolvedValueOnce(
            makeToolpackRows(["data_query", "gis"])
          );

          const ctx = await buildStationContext({
            station: { id: STATION_ID, name: "Sales Station" },
            organizationId: ORG_ID,
            userId: USER_ID,
          });

          expect(ctx.geocodingAvailable).toBe(expected);
          expect(ctx.stationWritable).toBe(writable);
        } finally {
          environment.GEOCODING_API_KEY = previous;
        }
      }
    );

    it("leaves geocodingAvailable unset when gis isn't in the session", async () => {
      const { buildStationContext } =
        await import("../../services/portal.service.js");
      mockLoadStation.mockResolvedValueOnce(STATION_DATA);
      mockSplitBuiltinPacks.mockResolvedValueOnce({
        effective: ["data_query"],
        unentitled: [],
        tier: "standard",
      });
      mockFindByStationId_toolpacks.mockResolvedValueOnce(
        makeToolpackRows(["data_query"])
      );

      const ctx = await buildStationContext({
        station: { id: STATION_ID, name: "Sales Station" },
        organizationId: ORG_ID,
        userId: USER_ID,
      });

      expect(ctx.geocodingAvailable).toBeUndefined();
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
        userId: USER_ID,
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
        userId: USER_ID,
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
        userId: USER_ID,
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
        userId: USER_ID,
      });
      expect(second.connectorInstances).toEqual([
        {
          id: "ci-late",
          name: "Late-bound",
          display: "REST API",
          slug: "rest-api",
          writable: true,
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
      // #1038: served through stripStoredMessage, so a copy, unchanged here.
      expect(result.messages).toEqual(messages);
      expect(result.coreMessages).toBeDefined();
      expect(mockFindByPortal).toHaveBeenCalledWith(PORTAL_ID);
    });

    // #1049 smoke walk: the model sent invalid JSON for a tool's input, the
    // SDK stored it as the raw string, and replaying that string made every
    // later turn fail ("tool_use.input: Input should be an object").
    it("replays a tool call whose stored input is a string as an object", async () => {
      const call = (id: string, input: unknown) => ({
        type: "tool-call",
        toolCallId: id,
        toolName: "platform_help",
        input,
      });
      const result_ = (id: string) => ({
        type: "tool-result",
        toolCallId: id,
        toolName: "platform_help",
        content: { error: "Invalid input" },
      });
      mockFindById_portal.mockResolvedValue(PORTAL);
      mockFindByPortal.mockResolvedValue([
        { id: "m1", role: "user", blocks: [{ type: "text", content: "Q" }] },
        {
          id: "m2",
          role: "assistant",
          blocks: [
            call(
              "tc-bad",
              '{"question": "weather", "keywords": weather Paris lookup}'
            ),
            result_("tc-bad"),
            call("tc-json", '{"question": "What is a portal?"}'),
            result_("tc-json"),
            { type: "text", content: "Done." },
          ],
        },
      ]);

      const { coreMessages } = await PortalService.getPortal(PORTAL_ID);
      const parts = coreMessages.flatMap(
        (m) => (Array.isArray(m.content) ? m.content : []) as unknown[]
      ) as { type: string; input?: unknown }[];
      const inputs = parts
        .filter((p) => p.type === "tool-call")
        .map((p) => p.input);
      expect(inputs).toEqual([{}, { question: "What is a portal?" }]);
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
            // #1038: a row result replays as its shape, never its rows.
            output: {
              type: "text",
              value:
                "[Previous sql_query result: 1 rows, columns: [id]. Its rows aren't kept; re-run the query to see values.]",
            },
          },
        ],
      });

      // Trailing text after tool step
      expect(result.coreMessages[3]).toEqual({
        role: "assistant",
        content: [{ type: "text", text: "Here are the results." }],
      });
    });

    // #726: a replayed map result kept 50 full GeoJSON polygons (row cap
    // only), so a follow-up after a contour map overflowed the context.
    it("replays a large tool result under the model byte cap", async () => {
      const polygon = {
        type: "MultiPolygon",
        coordinates: [["x".repeat(20_000)]],
      };
      const messages = [
        {
          id: "u1",
          role: "user",
          blocks: [{ type: "text", content: "contours" }],
        },
        {
          id: "a1",
          role: "assistant",
          blocks: [
            {
              type: "tool-call",
              toolCallId: "tc-geo",
              toolName: "visualize_map",
              args: {},
            },
            {
              type: "tool-result",
              toolCallId: "tc-geo",
              toolName: "visualize_map",
              content: {
                type: "geo",
                spec: { basemap: "streets" },
                rows: Array.from({ length: 80 }, (_, i) => ({
                  elev: i,
                  geom: polygon,
                })),
              },
            },
            { type: "text", content: "Here is the map." },
          ],
        },
        {
          id: "u2",
          role: "user",
          blocks: [{ type: "text", content: "which is lowest?" }],
        },
      ];
      mockFindById_portal.mockResolvedValue(PORTAL);
      mockFindByPortal.mockResolvedValue(messages);

      const result = await PortalService.getPortal(PORTAL_ID);
      const toolMsg = result.coreMessages.find((m) => m.role === "tool") as {
        content: Array<{ output: { type: string; value: string } }>;
      };
      const { output } = toolMsg.content[0];
      // #1038: the map's rows aren't kept, so the replay is its shape alone:
      // the true row count, its columns, and no geometry.
      expect(output.type).toBe("text");
      expect(output.value).toContain("80 rows");
      expect(output.value).toContain("columns: [elev, geom]");
      expect(output.value).not.toContain("MultiPolygon");
      expect(Buffer.byteLength(output.value, "utf8")).toBeLessThan(1_000);
    });

    // #1071 (adversarial walk): the model read a previous turn's tag_list /
    // tag_target_list results as this turn's. Every replayed result says it
    // is from an earlier turn.
    it("marks a replayed JSON result as from an earlier turn", async () => {
      const result = { tags: [{ id: "t1", name: "Finance Ops" }], total: 1 };
      const messages = [
        {
          id: "u1",
          role: "user",
          blocks: [{ type: "text", content: "tags?" }],
        },
        {
          id: "a1",
          role: "assistant",
          blocks: [
            {
              type: "tool-call",
              toolCallId: "tc-tags",
              toolName: "tag_list",
              input: {},
            },
            {
              type: "tool-result",
              toolCallId: "tc-tags",
              toolName: "tag_list",
              content: result,
            },
            { type: "text", content: "One tag." },
          ],
        },
        {
          id: "u2",
          role: "user",
          blocks: [{ type: "text", content: "again" }],
        },
      ];
      mockFindById_portal.mockResolvedValue(PORTAL);
      mockFindByPortal.mockResolvedValue(messages);

      const { coreMessages } = await PortalService.getPortal(PORTAL_ID);
      const toolMsg = coreMessages.find((m) => m.role === "tool") as {
        content: Array<{ output: unknown }>;
      };

      expect(toolMsg.content[0].output).toEqual({
        type: "json",
        value: { fromEarlierTurn: true, result },
      });
    });

    it("prefixes a replayed text result as from an earlier turn", async () => {
      const messages = [
        {
          id: "u1",
          role: "user",
          blocks: [{ type: "text", content: "time?" }],
        },
        {
          id: "a1",
          role: "assistant",
          blocks: [
            {
              type: "tool-call",
              toolCallId: "tc-t",
              toolName: "current_time",
              input: {},
            },
            {
              type: "tool-result",
              toolCallId: "tc-t",
              toolName: "current_time",
              content: "2026-11-24T06:00:00Z",
            },
          ],
        },
      ];
      mockFindById_portal.mockResolvedValue(PORTAL);
      mockFindByPortal.mockResolvedValue(messages);

      const { coreMessages } = await PortalService.getPortal(PORTAL_ID);
      const toolMsg = coreMessages.find((m) => m.role === "tool") as {
        content: Array<{ output: unknown }>;
      };

      expect(toolMsg.content[0].output).toEqual({
        type: "text",
        value: `${EARLIER_TURN_PREFIX} 2026-11-24T06:00:00Z`,
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

      const result = await PortalService.addMessage(
        PORTAL_ID,
        { role: "user", content: "Hello!" },
        "caller-1"
      );

      expect(result).toBe(savedMsg);
      expect(mockCreate_message).toHaveBeenCalledWith(
        expect.objectContaining({
          portalId: PORTAL_ID,
          organizationId: ORG_ID,
          role: "user",
          blocks: [{ type: "text", content: "Hello!" }],
          // #685: the message belongs to the caller who sent it.
          createdBy: "caller-1",
        })
      );
    });

    it("throws PORTAL_NOT_FOUND when portal does not exist", async () => {
      mockFindById_portal.mockResolvedValue(null);

      await expect(
        PortalService.addMessage(
          PORTAL_ID,
          { role: "user", content: "hi" },
          "caller-1"
        )
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
      attachments: {
        views: { attached: 1, readable: 1 },
        connectors: { attached: 1, readable: 1 },
      },
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

      // #846: a tool call the SDK refuses (input that fails the tool's schema)
      // or whose execute throws arrives as a `tool-error`, not a
      // `tool-result`. Dropping it left the step open for the rest of the
      // turn and stripped the call from history as an orphan.
      const invalidInputError = () =>
        Object.assign(
          new Error(
            'Invalid input for tool curated_view_create: Type validation failed: Value: {"filterSql":"x"}.'
          ),
          {
            name: "AI_InvalidToolInputError",
            cause: Object.assign(new Error("Type validation failed"), {
              name: "AI_TypeValidationError",
              cause: {
                issues: [
                  {
                    code: "custom",
                    path: [],
                    message: "Set filter or filterSql, not both",
                  },
                ],
              },
            }),
          }
        );

      const savedBlocks = () =>
        (
          (mockCreate_message.mock.calls as unknown as unknown[][]).at(
            -1
          )?.[0] as { blocks: unknown[] }
        ).blocks;

      it("closes the step when the SDK refuses a tool's input", async () => {
        const sse = await runStream([
          // The SDK's real shape (ai/dist parseToolCall + the stream
          // transform): the error object rides the `tool-call` part, flagged
          // `invalid`; the `tool-error` that follows carries only its message.
          {
            type: "tool-call",
            toolName: "curated_view_create",
            toolCallId: "tc-err",
            input: { filterSql: "x" },
            invalid: true,
            error: invalidInputError(),
          },
          {
            type: "tool-error",
            toolName: "curated_view_create",
            toolCallId: "tc-err",
            input: { filterSql: "x" },
            error: invalidInputError().message,
          },
          { type: "finish" },
        ]);

        expect(sentEvents(sse, "tool_call_end")).toHaveLength(1);
        expect(sentEvents(sse, "tool_call_end")[0][1]).toEqual({
          type: "tool_call_end",
          toolCallId: "tc-err",
          toolName: "curated_view_create",
        });
      });

      it("keeps a refused call in history, with the schema's reason as a typed result", async () => {
        await runStream([
          // The SDK's real shape (ai/dist parseToolCall + the stream
          // transform): the error object rides the `tool-call` part, flagged
          // `invalid`; the `tool-error` that follows carries only its message.
          {
            type: "tool-call",
            toolName: "curated_view_create",
            toolCallId: "tc-err",
            input: { filterSql: "x" },
            invalid: true,
            error: invalidInputError(),
          },
          {
            type: "tool-error",
            toolName: "curated_view_create",
            toolCallId: "tc-err",
            input: { filterSql: "x" },
            error: invalidInputError().message,
          },
          { type: "finish" },
        ]);

        expect(savedBlocks()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "tool-call",
              toolCallId: "tc-err",
            }),
            {
              type: "tool-result",
              toolCallId: "tc-err",
              toolName: "curated_view_create",
              content: {
                error: {
                  code: "TOOL_INPUT_INVALID",
                  message: "Set filter or filterSql, not both",
                },
              },
            },
          ])
        );
      });

      // A thrown error's text can carry raw DB detail (#687, #719); history is
      // readable by everyone in the session, so it keeps a generic message.
      it("records a tool that throws as TOOL_EXECUTION_FAILED, without its text", async () => {
        await runStream([
          {
            type: "tool-call",
            toolName: "sql_query",
            toolCallId: "tc-throw",
            input: { sql: "select 1" },
          },
          {
            type: "tool-error",
            toolName: "sql_query",
            toolCallId: "tc-throw",
            input: { sql: "select 1" },
            error: new Error("connection reset"),
          },
          { type: "finish" },
        ]);

        expect(savedBlocks()).toEqual(
          expect.arrayContaining([
            {
              type: "tool-result",
              toolCallId: "tc-throw",
              toolName: "sql_query",
              content: {
                error: {
                  code: "TOOL_EXECUTION_FAILED",
                  message: "The tool failed while running.",
                },
              },
            },
          ])
        );
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

    // #805: model output (text, or a custom tool's result) can carry U+0000,
    // which the jsonb blocks column can't store, so the turn failed to save.
    it("persists an assistant turn whose text or tool result holds U+0000, stripped", async () => {
      mockWarn.mockClear();
      const chunks = [
        { type: "text-delta", text: "Hel\u0000lo" },
        {
          type: "tool-result",
          toolName: "cluster",
          toolCallId: "tc-nul",
          output: { label: "gro\u0000up" },
        },
        { type: "finish" },
      ];
      mockStreamText.mockReturnValue({ fullStream: makeStream(chunks) });

      await PortalService.streamResponse({
        portalId: PORTAL_ID,
        messages: [],
        stationContext,
        organizationId: ORG_ID,
        userId: "user-001",
        sse: makeSse() as any,
      });

      const saved = (mockCreate_message.mock.calls.at(-1) as unknown[])[0] as {
        blocks: unknown[];
      };
      const json = JSON.stringify(saved.blocks);
      expect(json).not.toContain("\\u0000");
      expect(json).toContain("Hello");
      expect(json).toContain("group");
      expect(mockWarn).toHaveBeenCalledWith(
        expect.objectContaining({
          portalId: PORTAL_ID,
          stripped: expect.any(Number),
        }),
        expect.any(String)
      );
    });

    it("doesn't warn when the assistant turn is clean", async () => {
      mockWarn.mockClear();
      mockStreamText.mockReturnValue({
        fullStream: makeStream([
          { type: "text-delta", text: "Hello" },
          { type: "finish" },
        ]),
      });

      await PortalService.streamResponse({
        portalId: PORTAL_ID,
        messages: [],
        stationContext,
        organizationId: ORG_ID,
        userId: "user-001",
        sse: makeSse() as any,
      });

      expect(mockWarn).not.toHaveBeenCalledWith(
        expect.objectContaining({ stripped: expect.anything() }),
        expect.anything()
      );
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
      const pipeline = {
        sql: "SELECT month, total FROM sales",
        stationId: "station-001",
        organizationId: ORG_ID,
      };
      const d3Result = {
        type: "d3",
        program: "/* d3 */",
        rows: [{ month: "Jan", total: 12 }],
        pipeline,
      };
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
            // #1038: the stored tool result keeps the result's shape, and
            // the stored chart its recipe; neither keeps a row.
            {
              type: "tool-result",
              toolCallId: "tc-1",
              toolName: "visualize_d3",
              content: {
                rowsNotKept: true,
                columns: ["month", "total"],
                rowCount: 1,
                sql: pipeline.sql,
              },
            },
            {
              type: "d3",
              content: { type: "d3", program: "/* d3 */", pipeline },
            },
            { type: "text", content: "done" },
          ],
        })
      );
      // The live stream still carries the rows: the reader saw them now.
      const toolResultEvent = (sse.send as any).mock.calls.find(
        (c: unknown[]) => c[0] === "tool_result"
      );
      expect(toolResultEvent[1].result.rows).toEqual(d3Result.rows);
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

// resolveDisplayBlock — help (#1049)
// ---------------------------------------------------------------------------

describe("resolveDisplayBlock → help (#1049)", () => {
  const HELP = {
    type: "help",
    query: "what is a portal",
    entries: [
      {
        surface: "glossary",
        slug: "portal",
        title: "Portal",
        url: "/help?tab=glossary#glossary-entry-portal",
        body: "A chat session.",
      },
    ],
    candidates: [],
    noMatch: false,
    helpUrl: "/help?tab=getting-started",
  };

  it("builds a help block from platform_help's own result, quoting it as is", () => {
    const result = resolveDisplayBlock("platform_help", HELP);
    expect(result?.block).toEqual({ type: "help", content: HELP });
    expect(result?.sseResult).toEqual(HELP);
  });

  it("makes no block from a result that isn't a valid help result", () => {
    expect(
      resolveDisplayBlock("platform_help", { ...HELP, entries: "nope" })
    ).toBeNull();
    expect(
      resolveDisplayBlock("platform_help", { answer: "old shape", links: [] })
    ).toBeNull();
  });
});

// resolveDisplayBlock — invitation (#847)
// ---------------------------------------------------------------------------

describe("resolveDisplayBlock → invitation (#847)", () => {
  const INVITATION = {
    type: "invitation",
    invitationId: "inv-1",
    email: "alice@example.com",
    role: "member",
    status: "pending",
    expiresAt: 1_800_000_000_000,
  };

  it("builds an invitation block from member_invite's and invitation_show's results", () => {
    for (const tool of ["member_invite", "invitation_show"]) {
      const result = resolveDisplayBlock(tool, INVITATION);
      expect(result?.block).toEqual({
        type: "invitation",
        content: INVITATION,
      });
      expect(result?.sseResult).toEqual(INVITATION);
    }
  });

  it("makes no block from a relayed refusal", () => {
    expect(
      resolveDisplayBlock("member_invite", {
        error: "An invitation is already pending for this email",
        code: "INVITATION_ALREADY_PENDING",
      })
    ).toBeNull();
  });

  it("makes no block from a result carrying a link", () => {
    expect(
      resolveDisplayBlock("member_invite", {
        ...INVITATION,
        inviteUrl: "https://app/invitations/accept?token=secret",
      })
    ).toBeNull();
  });
});

// endsOnSelfContainedBlocks — a help block is the whole answer (#1049)
// ---------------------------------------------------------------------------

describe("endsOnSelfContainedBlocks (#1049)", () => {
  const HELP = {
    type: "help",
    query: "what is a portal",
    entries: [],
    candidates: [],
    noMatch: true,
    helpUrl: "/help?tab=getting-started",
  };
  const help = { toolName: "platform_help", output: HELP };
  const step = (
    toolCalls: { toolName: string }[],
    toolResults: { toolName: string; output: unknown }[]
  ) => ({ toolCalls, toolResults });

  it("ends the turn after a step whose calls were all platform_help help blocks", () => {
    // The adversarial walk: three help blocks, then a step quoting them back.
    expect(
      endsOnSelfContainedBlocks({
        steps: [step([help, help, help], [help, help, help])],
      })
    ).toBe(true);
  });

  it("carries on when the step also called another tool", () => {
    expect(
      endsOnSelfContainedBlocks({
        steps: [
          step(
            [help, { toolName: "sql_query" }],
            [help, { toolName: "sql_query", output: { rows: [] } }]
          ),
        ],
      })
    ).toBe(false);
  });

  it("carries on when a help call failed, so the model can retry", () => {
    // Invalid input is a tool error: no result for the call.
    expect(endsOnSelfContainedBlocks({ steps: [step([help], [])] })).toBe(
      false
    );
    expect(
      endsOnSelfContainedBlocks({
        steps: [
          step([help], [{ toolName: "platform_help", output: { error: "x" } }]),
        ],
      })
    ).toBe(false);
  });

  it("carries on after a text-only or empty step", () => {
    expect(endsOnSelfContainedBlocks({ steps: [] })).toBe(false);
    expect(endsOnSelfContainedBlocks({ steps: [step([], [])] })).toBe(false);
  });

  it("ends the turn on invitation blocks too, alone or with help blocks (#847)", () => {
    const invitation = {
      toolName: "member_invite",
      output: {
        type: "invitation",
        invitationId: "inv-1",
        email: "a@example.com",
        role: "member",
        status: "pending",
        expiresAt: 1,
      },
    };
    const shown = { ...invitation, toolName: "invitation_show" };
    expect(
      endsOnSelfContainedBlocks({
        steps: [step([invitation, invitation], [invitation, invitation])],
      })
    ).toBe(true);
    expect(
      endsOnSelfContainedBlocks({
        steps: [step([shown, help], [shown, help])],
      })
    ).toBe(true);
  });

  it("carries on after a refused invite, so the model relays it (#847)", () => {
    const refused = {
      toolName: "member_invite",
      output: { error: "seats full", code: "SEAT_LIMIT_EXCEEDED" },
    };
    expect(
      endsOnSelfContainedBlocks({
        steps: [step([refused, refused], [refused, refused])],
      })
    ).toBe(false);
  });

  it("looks only at the latest step", () => {
    expect(
      endsOnSelfContainedBlocks({
        steps: [
          step([help], [help]),
          step(
            [{ toolName: "sql_query" }],
            [{ toolName: "sql_query", output: {} }]
          ),
        ],
      })
    ).toBe(false);
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

// ---------------------------------------------------------------------------
// narrationStepPrep — no recap after a rendered block (#1102)
// ---------------------------------------------------------------------------

describe("narrationStepPrep (#1102)", () => {
  const SYSTEM = "base prompt";
  const prep = narrationStepPrep(SYSTEM);
  type Result = { toolName: string; output: unknown };
  const after = (toolResults: Result[], toolCalls?: { toolName: string }[]) =>
    prep({
      steps: [
        {
          toolCalls:
            toolCalls ?? toolResults.map((r) => ({ toolName: r.toolName })),
          toolResults,
        },
      ],
    });
  const withReminders = (...parts: string[]) => ({
    system: [SYSTEM, ...parts].join("\n\n"),
  });
  const TABLE: Result = {
    toolName: "sql_query",
    output: { rows: [{ id: 1 }] },
  };
  const SCALAR: Result = { toolName: "cluster", output: { clusters: [] } };

  it.each([
    ["a built-in table", TABLE],
    ["a bare row array", { toolName: "sql_query", output: [{ id: 1 }] }],
    [
      "a custom tool's data-table payload",
      {
        toolName: "crm_accounts",
        output: { type: "data-table", columns: ["id"], rows: [{ id: 1 }] },
      },
    ],
    [
      "a chart",
      {
        toolName: "visualize_d3",
        output: {
          type: "d3",
          program: "api.d3.select(api.container);",
          rows: [{ x: 1 }],
        },
      },
    ],
    [
      "a map",
      {
        toolName: "visualize_map",
        output: {
          type: "geo",
          spec: {
            layers: [
              {
                kind: "points",
                source: { latColumn: "lat", lngColumn: "lng" },
              },
            ],
          },
          rows: [{ lat: 1, lng: 2 }],
        },
      },
    ],
    [
      "a mutation result",
      {
        toolName: "entity_record_create",
        output: {
          success: true,
          operation: "created",
          entity: "record",
          items: [{ entityId: "r-1", summary: { sourceId: "abc" } }],
        },
      },
    ],
  ])(
    "after %s: the block reminder naming the tool, then the next-tool reminder",
    (_label, result) => {
      expect(after([result as Result])).toEqual(
        withReminders(
          renderedBlockReminder([(result as Result).toolName], false),
          NEXT_TOOL_REMINDER
        )
      );
    }
  );

  it("names only the rendered tools in a step that also ran a scalar tool", () => {
    const r = after([TABLE, SCALAR]);
    expect(r).toEqual(
      withReminders(
        renderedBlockReminder(["sql_query"], true),
        NEXT_TOOL_REMINDER
      )
    );
    expect(r.system).not.toContain("`cluster`");
  });

  it("leaves a failed call in the same step to be relayed", () => {
    // The failed call has no result; the step made two calls.
    const r = after(
      [TABLE],
      [{ toolName: "sql_query" }, { toolName: "geocode" }]
    );
    expect(r).toEqual(
      withReminders(
        renderedBlockReminder(["sql_query"], true),
        NEXT_TOOL_REMINDER
      )
    );
    expect(r.system).toMatch(/including any that failed/);
  });

  // The #1102 smoke walk: "Let me peek at the data…" after a scalar result,
  // and a preamble after a failed lookup, where no block had rendered.
  it("gives only the next-tool reminder after a scalar result", () => {
    expect(after([SCALAR])).toEqual(withReminders(NEXT_TOOL_REMINDER));
  });

  it("gives only the next-tool reminder after a step whose only call failed", () => {
    expect(after([], [{ toolName: "sql_query" }])).toEqual(
      withReminders(NEXT_TOOL_REMINDER)
    );
  });

  it("tolerates a non-object tool output (no block, still a tool step)", () => {
    expect(after([{ toolName: "sql_query", output: "oops" }])).toEqual(
      withReminders(NEXT_TOOL_REMINDER)
    );
  });

  // The #1102 rerun: "Let me look up both the pending invitations…" came in
  // the turn's first step, so the reminder applies from step 0.
  it("gives the first step, and a step after text only, the next-tool reminder", () => {
    expect(prep({ steps: [] })).toEqual(withReminders(NEXT_TOOL_REMINDER));
    expect(prep({ steps: [{ toolCalls: [], toolResults: [] }] })).toEqual(
      withReminders(NEXT_TOOL_REMINDER)
    );
  });
});

describe("renderedBlockReminder (#1102)", () => {
  it("names the tool and keeps the answer to a question the block holds", () => {
    const text = renderedBlockReminder(["sql_query"], false);
    expect(text).toMatch(
      /^The result of `sql_query` is already on screen as a block\./
    );
    expect(text).toMatch(/Don't list or restate the block's rows or contents/);
    expect(text).toMatch(
      /If it answers the user's question, give that answer in one sentence/
    );
    expect(text).not.toMatch(/above/);
    expect(text).not.toMatch(/explain or relay/);
    // The next-tool rule is NEXT_TOOL_REMINDER's, said once.
    expect(text).not.toMatch(/next tool/);
  });

  it("names several tools once each", () => {
    expect(
      renderedBlockReminder(["sql_query", "visualize_d3", "sql_query"], false)
    ).toMatch(
      /^The results of `sql_query` and `visualize_d3` are already on screen/
    );
  });

  it("scopes itself when the step ran other tools", () => {
    expect(renderedBlockReminder(["sql_query"], true)).toMatch(
      /This covers only those results: explain or relay your other tool results from that step as usual, including any that failed\./
    );
  });
});

describe("NEXT_TOOL_REMINDER (#1102)", () => {
  it("puts no text before another tool call and keeps explanation for the reply", () => {
    expect(NEXT_TOOL_REMINDER).toMatch(
      /When you call a tool, call it with no text before it/
    );
    expect(NEXT_TOOL_REMINDER).toMatch(/"Let me…", "Now…"/);
    expect(NEXT_TOOL_REMINDER).toMatch(
      /Keep any explanation for your reply after your last tool call/
    );
  });
});
