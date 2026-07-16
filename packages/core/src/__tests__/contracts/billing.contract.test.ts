import { describe, it, expect } from "@jest/globals";
import {
  BillingTierSchema,
  BillingTiersGetResponseSchema,
  BillingCheckoutRequestSchema,
  BillingCheckoutResponseSchema,
  BillingPortalResponseSchema,
} from "../../contracts/billing.contract.js";
import { TierPolicySchema } from "../../models/tier.model.js";

// ── Helpers ──────────────────────────────────────────────────────────

const allocations = {
  free: { unitsPerPeriod: null, ratePerMin: null },
  metered: { unitsPerPeriod: 2500, ratePerMin: 20 },
  expensive: { unitsPerPeriod: 300, ratePerMin: 5 },
};

const purchasableTier = {
  slug: "pro",
  displayName: "Pro",
  allocations,
  purchasable: true,
  price: { unitAmount: 4900, currency: "usd", interval: "month" },
};

// ── Tests ────────────────────────────────────────────────────────────

describe("BillingTierSchema", () => {
  it("parses a purchasable tier with a live price", () => {
    expect(BillingTierSchema.safeParse(purchasableTier).success).toBe(true);
  });

  it("accepts purchasable: true with price: null (degraded price display)", () => {
    const degraded = { ...purchasableTier, price: null };
    expect(BillingTierSchema.safeParse(degraded).success).toBe(true);
  });

  it("accepts an unpurchasable tier (standard) with price: null", () => {
    const standard = {
      slug: "standard",
      displayName: "Standard",
      allocations,
      purchasable: false,
      price: null,
    };
    expect(BillingTierSchema.safeParse(standard).success).toBe(true);
  });

  it("rejects an unknown price interval", () => {
    const bad = {
      ...purchasableTier,
      price: { unitAmount: 4900, currency: "usd", interval: "week" },
    };
    expect(BillingTierSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a non-integer unitAmount", () => {
    const bad = {
      ...purchasableTier,
      price: { unitAmount: 49.99, currency: "usd", interval: "month" },
    };
    expect(BillingTierSchema.safeParse(bad).success).toBe(false);
  });
});

describe("BillingTiersGetResponseSchema", () => {
  it("parses a representative tier list", () => {
    const payload = {
      tiers: [
        purchasableTier,
        {
          slug: "standard",
          displayName: "Standard",
          allocations,
          purchasable: false,
          price: null,
        },
      ],
    };
    expect(BillingTiersGetResponseSchema.safeParse(payload).success).toBe(true);
  });
});

describe("billing request/response contracts", () => {
  it("BillingCheckoutRequestSchema parses a tier slug", () => {
    expect(
      BillingCheckoutRequestSchema.safeParse({ tier: "pro" }).success
    ).toBe(true);
    expect(BillingCheckoutRequestSchema.safeParse({}).success).toBe(false);
  });

  it("checkout/portal responses carry a session URL", () => {
    expect(
      BillingCheckoutResponseSchema.safeParse({
        url: "https://checkout.stripe.com/c/pay/cs_test_123",
      }).success
    ).toBe(true);
    expect(
      BillingPortalResponseSchema.safeParse({
        url: "https://billing.stripe.com/p/session/test_123",
      }).success
    ).toBe(true);
    expect(BillingCheckoutResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe("TierPolicySchema key pin (#214 contract guard)", () => {
  it("carries exactly the #172 keys + #214's entitlements — no billing fields leak into the gate contract", () => {
    expect(Object.keys(TierPolicySchema.shape).sort()).toEqual(
      [
        "allocations",
        "entitlements",
        "overage",
        "perToolCaps",
        "period",
        "tier",
      ].sort()
    );
  });
});
