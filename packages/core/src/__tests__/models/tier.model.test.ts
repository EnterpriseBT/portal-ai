import { describe, it, expect } from "@jest/globals";
import {
  TierSchema,
  TierPolicySchema,
  AllocationSchema,
  TierPeriodSchema,
  OverageSchema,
  TierModelFactory,
} from "../../models/tier.model.js";

// ── Helpers ──────────────────────────────────────────────────────────

const validPolicy = {
  tier: "standard",
  period: { kind: "monthly", anchorDay: 1 },
  allocations: {
    free: { unitsPerPeriod: null, ratePerMin: null },
    metered: { unitsPerPeriod: 1000, ratePerMin: 20 },
    expensive: { unitsPerPeriod: 100, ratePerMin: 5 },
  },
  perToolCaps: null,
  overage: "hard-deny",
};

const validRowFields = {
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

// ── Tests ────────────────────────────────────────────────────────────

describe("AllocationSchema", () => {
  it("accepts null (unlimited) and non-negative integers", () => {
    expect(
      AllocationSchema.safeParse({ unitsPerPeriod: null, ratePerMin: null })
        .success
    ).toBe(true);
    expect(
      AllocationSchema.safeParse({ unitsPerPeriod: 100, ratePerMin: 5 }).success
    ).toBe(true);
  });

  it("rejects negative values", () => {
    expect(
      AllocationSchema.safeParse({ unitsPerPeriod: -1, ratePerMin: 0 }).success
    ).toBe(false);
  });
});

describe("TierPeriodSchema", () => {
  it("accepts monthly with anchorDay in 1..28", () => {
    expect(
      TierPeriodSchema.safeParse({ kind: "monthly", anchorDay: 1 }).success
    ).toBe(true);
    expect(
      TierPeriodSchema.safeParse({ kind: "monthly", anchorDay: 28 }).success
    ).toBe(true);
  });

  it("rejects anchorDay outside 1..28 and non-monthly kinds", () => {
    expect(
      TierPeriodSchema.safeParse({ kind: "monthly", anchorDay: 0 }).success
    ).toBe(false);
    expect(
      TierPeriodSchema.safeParse({ kind: "monthly", anchorDay: 29 }).success
    ).toBe(false);
    expect(
      TierPeriodSchema.safeParse({ kind: "weekly", anchorDay: 1 }).success
    ).toBe(false);
  });
});

describe("OverageSchema", () => {
  it("accepts the two valid values and rejects others", () => {
    expect(OverageSchema.safeParse("hard-deny").success).toBe(true);
    expect(OverageSchema.safeParse("soft-alert").success).toBe(true);
    expect(OverageSchema.safeParse("explode").success).toBe(false);
  });
});

describe("TierPolicySchema", () => {
  it("parses a well-formed policy", () => {
    expect(TierPolicySchema.safeParse(validPolicy).success).toBe(true);
  });

  it("rejects a policy missing a cost class", () => {
    const bad = {
      ...validPolicy,
      allocations: {
        free: validPolicy.allocations.free,
        metered: validPolicy.allocations.metered,
        // expensive missing
      },
    };
    expect(TierPolicySchema.safeParse(bad).success).toBe(false);
  });
});

describe("TierSchema", () => {
  it("round-trips through TierModelFactory with audit fields", () => {
    const model = new TierModelFactory()
      .create("SYSTEM")
      .update(validRowFields);
    const parsed = model.parse();

    expect(parsed.slug).toBe("standard");
    expect(parsed.meteredUnitsPerPeriod).toBe(1000);
    expect(parsed.freeUnitsPerPeriod).toBeNull();
    expect(parsed.createdBy).toBe("SYSTEM");
    expect(typeof parsed.created).toBe("number");
    expect(parsed.id).toBeTruthy();
    expect(TierSchema.safeParse(parsed).success).toBe(true);
  });
});
