import { describe, it, expect } from "@jest/globals";
import { UsageSchema, UsageModelFactory } from "../../models/usage.model.js";
import { OrganizationUsageGetResponseSchema } from "../../contracts/tier.contract.js";

// ── UsageSchema (case 6) ─────────────────────────────────────────────

describe("UsageSchema", () => {
  const base = {
    id: "u1",
    created: 1,
    createdBy: "SYSTEM",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    organizationId: "o1",
    periodId: "2026-07",
    costClass: "metered",
    unitsUsed: 5,
  };

  it("accepts a valid row", () => {
    expect(UsageSchema.safeParse(base).success).toBe(true);
  });

  it("rejects negative unitsUsed", () => {
    expect(UsageSchema.safeParse({ ...base, unitsUsed: -1 }).success).toBe(
      false
    );
  });

  it("round-trips through UsageModelFactory with audit fields", () => {
    const parsed = new UsageModelFactory()
      .create("SYSTEM")
      .update({
        organizationId: "o1",
        periodId: "2026-07",
        costClass: "metered",
        unitsUsed: 5,
      })
      .parse();
    expect(parsed.unitsUsed).toBe(5);
    expect(parsed.costClass).toBe("metered");
    expect(parsed.createdBy).toBe("SYSTEM");
    expect(parsed.id).toBeTruthy();
  });
});

// ── OrganizationUsageGetResponseSchema (case 7) ──────────────────────

describe("OrganizationUsageGetResponseSchema", () => {
  it("accepts a full payload including available: null (unlimited)", () => {
    const payload = {
      tier: {
        tier: "standard",
        period: { kind: "monthly", anchorDay: 1 },
        allocations: {
          free: { unitsPerPeriod: null, ratePerMin: null },
          metered: { unitsPerPeriod: 1000, ratePerMin: 20 },
          expensive: { unitsPerPeriod: 100, ratePerMin: 5 },
        },
        perToolCaps: null,
        overage: "hard-deny",
      },
      usage: {
        periodId: "2026-07",
        byClass: {
          free: { used: 0, available: null },
          metered: { used: 30, available: 970 },
          expensive: { used: 0, available: 100 },
        },
      },
    };
    expect(OrganizationUsageGetResponseSchema.safeParse(payload).success).toBe(
      true
    );
  });
});
