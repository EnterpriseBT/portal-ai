import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ── Mocks ─────────────────────────────────────────────────────────────

const mockFindById_org = jest.fn<() => Promise<unknown>>();
const mockFindByStationId_packs = jest.fn<() => Promise<unknown[]>>();
const mockFindManyByIds_customPacks = jest.fn<() => Promise<unknown[]>>();
// #1045: the names-only read, for packs the plan excludes.
const mockFindNamesByIds_customPacks = jest.fn<() => Promise<unknown[]>>();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      organizations: { findById: mockFindById_org },
      stationToolpacks: { findByStationId: mockFindByStationId_packs },
      organizationToolpacks: {
        findManyByIds: mockFindManyByIds_customPacks,
        findNamesByIds: mockFindNamesByIds_customPacks,
      },
    },
  },
}));

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
  return { createLogger: () => ({ ...stub, child: () => stub }) };
});

const { EntitlementService } =
  await import("../../services/entitlement.service.js");

// ── Fixtures ──────────────────────────────────────────────────────────

const ORG_ID = "org-001";

function makePolicy(
  entitlements = {
    builtinToolpacks: ["data_query", "web_search"],
    customToolpacks: false,
    customRbac: false,
    advancedViewFilters: false,
  },
  tier = "standard"
) {
  return {
    tier,
    period: { kind: "monthly" as const, anchorDay: 1 },
    allocations: {
      free: { unitsPerPeriod: null, ratePerMin: null },
      metered: { unitsPerPeriod: null, ratePerMin: null },
      expensive: { unitsPerPeriod: null, ratePerMin: null },
    },
    perToolCaps: null,
    agentTurns: { perMin: null, perDay: null },
    overage: "hard-deny" as const,
    entitlements,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFindById_org.mockResolvedValue({ id: ORG_ID, tier: "standard" });
  mockFindNamesByIds_customPacks.mockResolvedValue([]);
  mockResolveTier.mockResolvedValue(makePolicy());
});

// ── splitBuiltinPacks ─────────────────────────────────────────────────

describe("EntitlementService.splitBuiltinPacks (#284)", () => {
  it("splits configured slugs into effective and unentitled, preserving order", async () => {
    const split = await EntitlementService.splitBuiltinPacks(ORG_ID, [
      "visualize",
      "data_query",
      "entity_management",
      "web_search",
    ]);

    expect(split.effective).toEqual(["data_query", "web_search"]);
    expect(split.unentitled).toEqual(["visualize", "entity_management"]);
    expect(split.tier).toBe("standard");
  });

  it("ignores allowlist slugs unknown to the registry, with a warn", async () => {
    // A tier row may name a pack that ships in a later deploy. It must not
    // silently entitle anything, and support needs to see it.
    mockResolveTier.mockResolvedValue(
      makePolicy({
        builtinToolpacks: ["data_query", "not_a_real_pack"],
        customToolpacks: false,
        customRbac: false,
        advancedViewFilters: false,
      })
    );

    const split = await EntitlementService.splitBuiltinPacks(ORG_ID, [
      "data_query",
    ]);

    expect(split.effective).toEqual(["data_query"]);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ slugs: ["not_a_real_pack"] }),
      expect.stringMatching(/unknown to the toolpack registry/i)
    );
  });

  it("falls back to the default tier when the org row is missing", async () => {
    mockFindById_org.mockResolvedValue(null);

    const split = await EntitlementService.splitBuiltinPacks(ORG_ID, [
      "data_query",
    ]);

    // resolveTier receives an empty slug and applies its own default.
    expect(mockResolveTier).toHaveBeenCalledWith({ tier: "" });
    expect(split.effective).toEqual(["data_query"]);
  });

  it("returns both lists empty for empty configured input, without resolving a tier", async () => {
    const split = await EntitlementService.splitBuiltinPacks(ORG_ID, []);

    expect(split.effective).toEqual([]);
    expect(split.unentitled).toEqual([]);
    // A rename-only station PATCH must cost no queries.
    expect(mockResolveTier).not.toHaveBeenCalled();
    expect(mockFindById_org).not.toHaveBeenCalled();
  });
});

// ── customRbacEntitled (#622) ─────────────────────────────────────────

describe("EntitlementService.customRbacEntitled (#622)", () => {
  it("reflects the tier's customRbac boolean (fail-closed default false)", async () => {
    expect(await EntitlementService.customRbacEntitled(ORG_ID)).toBe(false);

    mockResolveTier.mockResolvedValue(
      makePolicy(
        {
          builtinToolpacks: [],
          customToolpacks: false,
          customRbac: true,
          advancedViewFilters: false,
        },
        "enterprise"
      )
    );
    expect(await EntitlementService.customRbacEntitled(ORG_ID)).toBe(true);
  });
});

// ── customPacksEntitlement (#1063) ─────────────────────────────────────

describe("EntitlementService.customPacksEntitlement (#1063)", () => {
  it("is false, with the tier, on a plan without custom packs", async () => {
    expect(await EntitlementService.customPacksEntitlement(ORG_ID)).toEqual({
      entitled: false,
      tier: "standard",
    });
  });

  it("is true on a plan with custom packs", async () => {
    mockResolveTier.mockResolvedValue(
      makePolicy(
        {
          builtinToolpacks: [],
          customToolpacks: true,
          customRbac: false,
          advancedViewFilters: false,
        },
        "pro"
      )
    );
    expect(await EntitlementService.customPacksEntitlement(ORG_ID)).toEqual({
      entitled: true,
      tier: "pro",
    });
  });

  it("throws when the plan can't be resolved (fail-closed)", async () => {
    mockResolveTier.mockRejectedValue(new Error("tier lookup failed"));
    await expect(
      EntitlementService.customPacksEntitlement(ORG_ID)
    ).rejects.toThrow("tier lookup failed");
  });
});

// ── advancedViewFiltersEntitled (#644) ──────────────────────────────────

describe("EntitlementService.advancedViewFiltersEntitled (#644)", () => {
  it("reflects the tier's advancedViewFilters boolean (fail-closed default false)", async () => {
    expect(await EntitlementService.advancedViewFiltersEntitled(ORG_ID)).toBe(
      false
    );

    mockResolveTier.mockResolvedValue(
      makePolicy(
        {
          builtinToolpacks: [],
          customToolpacks: true,
          customRbac: false,
          advancedViewFilters: true,
        },
        "pro"
      )
    );
    expect(await EntitlementService.advancedViewFiltersEntitled(ORG_ID)).toBe(
      true
    );
  });
});

// ── resolveStationPacks (#306) ─────────────────────────────────────────
//
// The single derivation of "what packs does this station actually have",
// built-in AND custom. Before #306, three paths each answered this from
// `builtinSlug` alone, so a registered custom pack was invisible to the agent
// even while its tools were attached — the agent denied tools it could call.

describe("EntitlementService.resolveStationPacks (#306)", () => {
  const STATION_ID = "station-001";

  const builtinRow = (slug: string, i = 0) => ({
    id: `stp-b${i}`,
    stationId: STATION_ID,
    builtinSlug: slug,
    organizationToolpackId: null,
  });

  const customRow = (packId: string, i = 0) => ({
    id: `stp-c${i}`,
    stationId: STATION_ID,
    builtinSlug: null,
    organizationToolpackId: packId,
  });

  const customPack = (id: string, name: string, toolNames: string[]) => ({
    id,
    organizationId: ORG_ID,
    name,
    description: `${name} description`,
    tools: toolNames.map((n) => ({ name: n, description: `${n} does things` })),
  });

  beforeEach(() => {
    mockFindByStationId_packs.mockResolvedValue([]);
    mockFindManyByIds_customPacks.mockResolvedValue([]);
  });

  it("splits built-in slugs exactly as splitBuiltinPacks does", async () => {
    mockFindByStationId_packs.mockResolvedValue([
      builtinRow("data_query", 1),
      builtinRow("statistics", 2),
    ]);

    const packs = await EntitlementService.resolveStationPacks(
      STATION_ID,
      ORG_ID
    );

    expect(mockFindByStationId_packs).toHaveBeenCalledWith(STATION_ID);
    expect(packs.effective).toEqual(["data_query"]);
    expect(packs.unentitled).toEqual(["statistics"]);
  });

  it("returns registered custom packs with their tool names", async () => {
    mockResolveTier.mockResolvedValue(
      makePolicy({
        builtinToolpacks: ["data_query"],
        customToolpacks: true,
        customRbac: false,
        advancedViewFilters: false,
      })
    );
    mockFindByStationId_packs.mockResolvedValue([
      builtinRow("data_query", 1),
      customRow("otp-1", 1),
    ]);
    mockFindManyByIds_customPacks.mockResolvedValue([
      customPack("otp-1", "smoke", ["refresh_crm", "sync_all_records"]),
    ]);

    const packs = await EntitlementService.resolveStationPacks(
      STATION_ID,
      ORG_ID
    );

    expect(mockFindManyByIds_customPacks).toHaveBeenCalledWith(["otp-1"], {
      organizationId: ORG_ID,
    });
    expect(packs.customPacks).toEqual([
      {
        name: "smoke",
        description: "smoke description",
        toolNames: ["refresh_crm", "sync_all_records"],
      },
    ]);
    expect(packs.effective).toEqual(["data_query"]);
  });

  it("never reports a custom pack as unentitled", async () => {
    // `splitBuiltinPacks` would classify any non-builtin ref as a plan limit,
    // which is what sent the user to Subscription & Billing for a working pack.
    mockResolveTier.mockResolvedValue(
      makePolicy({
        builtinToolpacks: ["data_query"],
        customToolpacks: true,
        customRbac: false,
        advancedViewFilters: false,
      })
    );
    mockFindByStationId_packs.mockResolvedValue([
      builtinRow("data_query", 1),
      customRow("otp-1", 1),
    ]);
    mockFindManyByIds_customPacks.mockResolvedValue([
      customPack("otp-1", "smoke", ["refresh_crm"]),
    ]);

    const packs = await EntitlementService.resolveStationPacks(
      STATION_ID,
      ORG_ID
    );

    expect(packs.unentitled).toEqual([]);
    expect(packs.unentitled).not.toContain("otp-1");
  });

  it("omits custom packs when the tier does not include them", async () => {
    // #214: registrations stay untouched on a downgrade; their tools simply
    // stop being offered — so the inventory must stop naming them too.
    mockResolveTier.mockResolvedValue(
      makePolicy({
        builtinToolpacks: ["data_query"],
        customToolpacks: false,
        customRbac: false,
        advancedViewFilters: false,
      })
    );
    mockFindByStationId_packs.mockResolvedValue([
      builtinRow("data_query", 1),
      customRow("otp-1", 1),
    ]);

    const packs = await EntitlementService.resolveStationPacks(
      STATION_ID,
      ORG_ID
    );

    expect(packs.customPacks).toEqual([]);
    expect(mockFindManyByIds_customPacks).not.toHaveBeenCalled();
    expect(packs.effective).toEqual(["data_query"]);
  });

  it("handles a custom-only station", async () => {
    mockResolveTier.mockResolvedValue(
      makePolicy({
        builtinToolpacks: ["data_query"],
        customToolpacks: true,
        customRbac: false,
        advancedViewFilters: false,
      })
    );
    mockFindByStationId_packs.mockResolvedValue([customRow("otp-1", 1)]);
    mockFindManyByIds_customPacks.mockResolvedValue([
      customPack("otp-1", "smoke", ["refresh_crm"]),
    ]);

    const packs = await EntitlementService.resolveStationPacks(
      STATION_ID,
      ORG_ID
    );

    expect(packs.effective).toEqual([]);
    expect(packs.unentitled).toEqual([]);
    expect(packs.customPacks).toHaveLength(1);
  });

  it("returns empty lists for a station with no packs at all", async () => {
    const packs = await EntitlementService.resolveStationPacks(
      STATION_ID,
      ORG_ID
    );

    expect(packs).toMatchObject({
      effective: [],
      unentitled: [],
      customPacks: [],
    });
  });
});

// #848: the packs the plan includes that this station doesn't carry. The
// prompt names them so the agent can say which pack a request needs and point
// at a station that has it.
describe("EntitlementService.resolveStationPacks — otherPlanPacks (#848)", () => {
  const STATION_ID = "station-848";

  beforeEach(() => {
    mockFindManyByIds_customPacks.mockResolvedValue([]);
    mockResolveTier.mockResolvedValue(
      makePolicy({
        builtinToolpacks: [
          "data_query",
          "rbac_management",
          "view_management",
          "not_shipped_yet",
        ],
        customToolpacks: false,
        customRbac: false,
        advancedViewFilters: false,
      })
    );
  });

  it("lists the plan's packs that aren't configured on the station", async () => {
    mockFindByStationId_packs.mockResolvedValue([
      { builtinSlug: "rbac_management", organizationToolpackId: null },
    ]);
    const packs = await EntitlementService.resolveStationPacks(
      STATION_ID,
      ORG_ID
    );
    expect(packs.effective).toEqual(["rbac_management"]);
    // Plan order, known slugs only.
    expect(packs.otherPlanPacks).toEqual(["data_query", "view_management"]);
  });

  it("leaves out a pack that is configured, entitled or not", async () => {
    mockFindByStationId_packs.mockResolvedValue([
      { builtinSlug: "data_query", organizationToolpackId: null },
      { builtinSlug: "gis", organizationToolpackId: null },
    ]);
    const packs = await EntitlementService.resolveStationPacks(
      STATION_ID,
      ORG_ID
    );
    expect(packs.unentitled).toEqual(["gis"]);
    expect(packs.otherPlanPacks).toEqual([
      "rbac_management",
      "view_management",
    ]);
  });

  // The session's context is built on every turn: one org read and one tier
  // resolve serve the split, the plan list and the custom-pack entitlement.
  it("reads the org and resolves the tier once, custom packs included", async () => {
    mockResolveTier.mockResolvedValue(
      makePolicy({
        builtinToolpacks: ["data_query", "rbac_management"],
        customToolpacks: true,
        customRbac: false,
        advancedViewFilters: false,
      })
    );
    mockFindByStationId_packs.mockResolvedValue([
      { builtinSlug: "rbac_management", organizationToolpackId: null },
      { builtinSlug: null, organizationToolpackId: "otp-1" },
    ]);
    mockFindManyByIds_customPacks.mockResolvedValue([
      {
        id: "otp-1",
        organizationId: ORG_ID,
        name: "smoke",
        description: null,
        tools: [{ name: "smoke_tool", description: "x" }],
      },
    ]);

    const packs = await EntitlementService.resolveStationPacks(
      STATION_ID,
      ORG_ID
    );

    expect(packs.effective).toEqual(["rbac_management"]);
    expect(packs.otherPlanPacks).toEqual(["data_query"]);
    expect(packs.customPacks.map((p) => p.name)).toEqual(["smoke"]);
    expect(packs.configuredCustomPackCount).toBe(1);
    expect(packs.customPacksEntitled).toBe(true);
    expect(mockFindById_org).toHaveBeenCalledTimes(1);
    expect(mockResolveTier).toHaveBeenCalledTimes(1);
  });

  // The count says the station has packs; `customPacksEntitled` says whether
  // they build any tools. platform_help reads both.
  it("counts attached custom packs whether or not the plan includes them", async () => {
    mockFindByStationId_packs.mockResolvedValue([
      { builtinSlug: "rbac_management", organizationToolpackId: null },
      { builtinSlug: null, organizationToolpackId: "otp-1" },
      { builtinSlug: null, organizationToolpackId: "otp-2" },
    ]);
    const packs = await EntitlementService.resolveStationPacks(
      STATION_ID,
      ORG_ID
    );
    // The fixture tier has customToolpacks: false.
    expect(packs.customPacks).toEqual([]);
    expect(packs.configuredCustomPackCount).toBe(2);
    expect(packs.customPacksEntitled).toBe(false);
    expect(mockFindManyByIds_customPacks).not.toHaveBeenCalled();
  });

  // platform_help needs the count and the entitlement, not the packs: the
  // row read decrypts stored credentials, and a failure there would cost it
  // its whole answer. The split has no `customPacks` to misread as "none".
  it("resolveStationPackSplit returns the split without reading custom pack rows", async () => {
    mockResolveTier.mockResolvedValue(
      makePolicy({
        builtinToolpacks: ["data_query"],
        customToolpacks: true,
        customRbac: false,
        advancedViewFilters: false,
      })
    );
    mockFindByStationId_packs.mockResolvedValue([
      { builtinSlug: null, organizationToolpackId: "otp-1" },
    ]);
    const split = await EntitlementService.resolveStationPackSplit(
      STATION_ID,
      ORG_ID
    );
    expect(mockFindManyByIds_customPacks).not.toHaveBeenCalled();
    expect(split).toEqual({
      effective: [],
      unentitled: [],
      otherPlanPacks: ["data_query"],
      configuredCustomPackCount: 1,
      customPacksEntitled: true,
      excludedCustomPacks: [],
      tier: "standard",
    });
    expect(split).not.toHaveProperty("customPacks");
  });

  it("counts none for a station with only built-in packs", async () => {
    mockFindByStationId_packs.mockResolvedValue([
      { builtinSlug: "data_query", organizationToolpackId: null },
    ]);
    const packs = await EntitlementService.resolveStationPacks(
      STATION_ID,
      ORG_ID
    );
    expect(packs.configuredCustomPackCount).toBe(0);
  });

  it("lists the whole plan for a station with no built-in pack", async () => {
    mockFindByStationId_packs.mockResolvedValue([]);
    const packs = await EntitlementService.resolveStationPacks(
      STATION_ID,
      ORG_ID
    );
    expect(packs.otherPlanPacks).toEqual([
      "data_query",
      "rbac_management",
      "view_management",
    ]);
  });
});

// #1045: a custom pack the plan excludes builds no tools, so it is left out of
// `customPacks`. That also left the assistant unable to say why the pack's
// tools were gone. Its name is reported separately, from a read that doesn't
// touch the pack's stored credentials.
describe("EntitlementService — excludedCustomPacks (#1045)", () => {
  const STATION_ID = "station-1045";
  const rows = [
    { builtinSlug: "rbac_management", organizationToolpackId: null },
    { builtinSlug: null, organizationToolpackId: "otp-1" },
    { builtinSlug: null, organizationToolpackId: "otp-2" },
  ];
  const plan = (customToolpacks: boolean) =>
    makePolicy({
      builtinToolpacks: ["data_query", "rbac_management"],
      customToolpacks,
      customRbac: false,
      advancedViewFilters: false,
    });

  beforeEach(() => {
    mockFindByStationId_packs.mockResolvedValue(rows);
    mockFindManyByIds_customPacks.mockResolvedValue([]);
    // Returned out of order: neither the attachment rows nor this read has
    // a defined order, so the service sorts by name.
    mockFindNamesByIds_customPacks.mockResolvedValue([
      { id: "otp-2", name: "crm" },
      { id: "otp-1", name: "acme" },
    ]);
  });

  it("names the attached custom packs when the plan excludes custom packs", async () => {
    mockResolveTier.mockResolvedValue(plan(false));
    const packs = await EntitlementService.resolveStationPacks(
      STATION_ID,
      ORG_ID
    );
    expect(packs.excludedCustomPacks).toEqual(["acme", "crm"]);
    expect(packs.customPacks).toEqual([]);
    expect(mockFindNamesByIds_customPacks).toHaveBeenCalledWith(
      ["otp-1", "otp-2"],
      { organizationId: ORG_ID }
    );
    // The decrypting read is never used for them.
    expect(mockFindManyByIds_customPacks).not.toHaveBeenCalled();
  });

  it("carries them on the split-only read too", async () => {
    mockResolveTier.mockResolvedValue(plan(false));
    const split = await EntitlementService.resolveStationPackSplit(
      STATION_ID,
      ORG_ID
    );
    expect(split.excludedCustomPacks).toEqual(["acme", "crm"]);
  });

  // The usable packs are listed in the prompt too, and their read has no
  // defined order either.
  it("returns the usable custom packs sorted by name", async () => {
    mockResolveTier.mockResolvedValue(plan(true));
    const pack = (id: string, name: string) => ({
      id,
      organizationId: ORG_ID,
      name,
      description: null,
      tools: [],
    });
    mockFindManyByIds_customPacks.mockResolvedValue([
      pack("otp-2", "crm"),
      pack("otp-1", "acme"),
    ]);
    const packs = await EntitlementService.resolveStationPacks(
      STATION_ID,
      ORG_ID
    );
    expect(packs.customPacks.map((p) => p.name)).toEqual(["acme", "crm"]);
  });

  it("is empty, with no names read, when the plan includes custom packs", async () => {
    mockResolveTier.mockResolvedValue(plan(true));
    const packs = await EntitlementService.resolveStationPacks(
      STATION_ID,
      ORG_ID
    );
    expect(packs.excludedCustomPacks).toEqual([]);
    expect(mockFindNamesByIds_customPacks).not.toHaveBeenCalled();
  });

  it("is empty, with no names read, when no custom pack is attached", async () => {
    mockResolveTier.mockResolvedValue(plan(false));
    mockFindByStationId_packs.mockResolvedValue([rows[0]]);
    const packs = await EntitlementService.resolveStationPacks(
      STATION_ID,
      ORG_ID
    );
    expect(packs.excludedCustomPacks).toEqual([]);
    expect(mockFindNamesByIds_customPacks).not.toHaveBeenCalled();
  });
});
