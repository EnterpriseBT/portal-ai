import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ── Mocks ─────────────────────────────────────────────────────────────

const mockFindById_org = jest.fn<() => Promise<unknown>>();
const mockFindByStationId_packs = jest.fn<() => Promise<unknown[]>>();
const mockFindManyByIds_customPacks = jest.fn<() => Promise<unknown[]>>();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      organizations: { findById: mockFindById_org },
      stationToolpacks: { findByStationId: mockFindByStationId_packs },
      organizationToolpacks: { findManyByIds: mockFindManyByIds_customPacks },
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
    overage: "hard-deny" as const,
    entitlements,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFindById_org.mockResolvedValue({ id: ORG_ID, tier: "standard" });
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

// ── customPacksEntitled ───────────────────────────────────────────────

describe("EntitlementService.customPacksEntitled (#284)", () => {
  it("reflects the tier's customToolpacks boolean", async () => {
    expect(await EntitlementService.customPacksEntitled(ORG_ID)).toBe(false);

    mockResolveTier.mockResolvedValue(
      makePolicy({ builtinToolpacks: [], customToolpacks: true }, "pro")
    );
    expect(await EntitlementService.customPacksEntitled(ORG_ID)).toBe(true);
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
      makePolicy({ builtinToolpacks: ["data_query"], customToolpacks: true })
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
      makePolicy({ builtinToolpacks: ["data_query"], customToolpacks: true })
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
      makePolicy({ builtinToolpacks: ["data_query"], customToolpacks: false })
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
      makePolicy({ builtinToolpacks: ["data_query"], customToolpacks: true })
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
