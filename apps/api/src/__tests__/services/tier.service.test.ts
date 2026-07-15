import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ── Mocks ────────────────────────────────────────────────────────────

const mockFindBySlug =
  jest.fn<(slug: string) => Promise<Record<string, unknown> | undefined>>();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      tiers: { findBySlug: mockFindBySlug },
    },
  },
}));

const { TierService } = await import("../../services/tier.service.js");

// ── Fixtures ─────────────────────────────────────────────────────────

const standardRow = {
  id: "t1",
  created: 1,
  createdBy: "SYSTEM",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
  slug: "standard",
  displayName: "Standard",
  periodKind: "monthly",
  periodAnchorDay: 1,
  overage: "hard-deny",
  freeUnitsPerPeriod: null,
  freeRatePerMin: null,
  meteredUnitsPerPeriod: 1000,
  meteredRatePerMin: 20,
  expensiveUnitsPerPeriod: 100,
  expensiveRatePerMin: 5,
  perToolCaps: null,
};

beforeEach(() => {
  mockFindBySlug.mockReset();
  TierService.invalidate(); // static cache persists across cases
});

// ── Tests ────────────────────────────────────────────────────────────

describe("TierService.tierPolicyFromRow", () => {
  it("assembles the nested policy; a null charge → null allocation", () => {
    const p = TierService.tierPolicyFromRow(standardRow as never);
    expect(p.tier).toBe("standard");
    expect(p.period).toEqual({ kind: "monthly", anchorDay: 1 });
    expect(p.allocations.free).toEqual({
      unitsPerPeriod: null,
      ratePerMin: null,
    });
    expect(p.allocations.metered).toEqual({
      unitsPerPeriod: 1000,
      ratePerMin: 20,
    });
    expect(p.overage).toBe("hard-deny");
  });
});

describe("TierService.resolveTier", () => {
  it("returns the policy for a known slug", async () => {
    mockFindBySlug.mockResolvedValue(standardRow);
    const p = await TierService.resolveTier({ tier: "standard" });
    expect(p.tier).toBe("standard");
    expect(mockFindBySlug).toHaveBeenCalledTimes(1);
  });

  it("caches within the TTL (one fetch for two calls)", async () => {
    mockFindBySlug.mockResolvedValue(standardRow);
    await TierService.resolveTier({ tier: "standard" }, 1000);
    await TierService.resolveTier({ tier: "standard" }, 1001);
    expect(mockFindBySlug).toHaveBeenCalledTimes(1);
  });

  it("falls back to the default tier on an unknown slug and does not throw", async () => {
    mockFindBySlug.mockImplementation(async (slug: string) =>
      slug === "standard" ? standardRow : undefined
    );
    const p = await TierService.resolveTier({ tier: "bogus" });
    expect(p.tier).toBe("standard");
    expect(mockFindBySlug).toHaveBeenCalledWith("bogus");
    expect(mockFindBySlug).toHaveBeenCalledWith("standard");
  });

  it("throws TIER_DEFAULT_MISSING when even the default tier is absent", async () => {
    mockFindBySlug.mockResolvedValue(undefined);
    await expect(
      TierService.resolveTier({ tier: "standard" })
    ).rejects.toMatchObject({ code: "TIER_DEFAULT_MISSING" });
  });

  it("invalidate forces a re-fetch", async () => {
    mockFindBySlug.mockResolvedValue(standardRow);
    await TierService.resolveTier({ tier: "standard" }, 1000);
    TierService.invalidate("standard");
    await TierService.resolveTier({ tier: "standard" }, 1001);
    expect(mockFindBySlug).toHaveBeenCalledTimes(2);
  });
});

describe("TierService.periodIdFor", () => {
  const monthlyAnchor1 = { kind: "monthly" as const, anchorDay: 1 };
  const monthlyAnchor15 = { kind: "monthly" as const, anchorDay: 15 };

  it("yields YYYY-MM for anchorDay=1", () => {
    expect(
      TierService.periodIdFor(monthlyAnchor1, new Date(Date.UTC(2026, 6, 15)))
    ).toBe("2026-07");
  });

  it("shifts to the previous month before the anchor day", () => {
    expect(
      TierService.periodIdFor(monthlyAnchor15, new Date(Date.UTC(2026, 6, 10)))
    ).toBe("2026-06");
    expect(
      TierService.periodIdFor(monthlyAnchor15, new Date(Date.UTC(2026, 6, 20)))
    ).toBe("2026-07");
  });

  it("handles the year boundary", () => {
    expect(
      TierService.periodIdFor(monthlyAnchor15, new Date(Date.UTC(2026, 0, 5)))
    ).toBe("2025-12");
  });

  // ── org-anchor override (#176 Q5) ───────────────────────────────────

  it("null/undefined override falls back to the tier anchor (regression-identical)", () => {
    const at = new Date(Date.UTC(2026, 6, 10));
    expect(TierService.periodIdFor(monthlyAnchor15, at, null)).toBe(
      TierService.periodIdFor(monthlyAnchor15, at)
    );
    expect(TierService.periodIdFor(monthlyAnchor15, at, undefined)).toBe(
      TierService.periodIdFor(monthlyAnchor15, at)
    );
    expect(TierService.periodIdFor(monthlyAnchor1, at, null)).toBe("2026-07");
  });

  it("override 15 straddles the boundary: the 14th is last month's period, the 15th this month's", () => {
    expect(
      TierService.periodIdFor(
        monthlyAnchor1,
        new Date(Date.UTC(2026, 6, 14)),
        15
      )
    ).toBe("2026-06");
    expect(
      TierService.periodIdFor(
        monthlyAnchor1,
        new Date(Date.UTC(2026, 6, 15)),
        15
      )
    ).toBe("2026-07");
  });

  it("override crosses the year boundary like the tier anchor does", () => {
    expect(
      TierService.periodIdFor(
        monthlyAnchor1,
        new Date(Date.UTC(2026, 0, 5)),
        15
      )
    ).toBe("2025-12");
  });
});
