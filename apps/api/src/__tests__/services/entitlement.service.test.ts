import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ── Mocks ─────────────────────────────────────────────────────────────

const mockFindById_org = jest.fn<() => Promise<unknown>>();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      organizations: { findById: mockFindById_org },
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
