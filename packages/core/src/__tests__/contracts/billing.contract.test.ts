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

const policy = {
  tier: "pro",
  period: { kind: "monthly", anchorDay: 1 },
  allocations: {
    free: { unitsPerPeriod: null, ratePerMin: null },
    metered: { unitsPerPeriod: 2500, ratePerMin: 20 },
    expensive: { unitsPerPeriod: 300, ratePerMin: 5 },
  },
  perToolCaps: null,
  overage: "hard-deny",
  entitlements: { builtinToolpacks: ["data_query"], customToolpacks: true },
};

// A `subscribe` tier with a live price (#241).
const subscribeTier = {
  slug: "pro",
  displayName: "Pro",
  policy,
  description: "Everything in Standard, plus more.",
  cta: "subscribe",
  price: { unitAmount: 4900, currency: "usd", interval: "month" },
};

// ── Tests ────────────────────────────────────────────────────────────

describe("BillingTierSchema (#241)", () => {
  it("parses a full enriched tier: embedded policy, blurb, cta, live price", () => {
    expect(BillingTierSchema.safeParse(subscribeTier).success).toBe(true);
  });

  it("accepts cta: subscribe with price: null (degraded price display)", () => {
    const degraded = { ...subscribeTier, price: null };
    expect(BillingTierSchema.safeParse(degraded).success).toBe(true);
  });

  it("accepts a null description (no blurb) and a contact tier", () => {
    const contact = {
      slug: "acme_enterprise",
      displayName: "Acme Enterprise",
      policy: { ...policy, tier: "acme_enterprise" },
      description: null,
      cta: "contact",
      price: null,
    };
    expect(BillingTierSchema.safeParse(contact).success).toBe(true);
  });

  it("rejects a tier missing the embedded policy", () => {
    const { policy: _policy, ...bad } = subscribeTier;
    expect(BillingTierSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an unknown cta", () => {
    const bad = { ...subscribeTier, cta: "buy-now" };
    expect(BillingTierSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an unknown price interval", () => {
    const bad = {
      ...subscribeTier,
      price: { unitAmount: 4900, currency: "usd", interval: "week" },
    };
    expect(BillingTierSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a non-integer unitAmount", () => {
    const bad = {
      ...subscribeTier,
      price: { unitAmount: 49.99, currency: "usd", interval: "month" },
    };
    expect(BillingTierSchema.safeParse(bad).success).toBe(false);
  });
});

describe("BillingTiersGetResponseSchema", () => {
  it("parses a representative tier list", () => {
    const payload = {
      tiers: [
        subscribeTier,
        {
          slug: "standard",
          displayName: "Standard",
          policy: { ...policy, tier: "standard" },
          description: null,
          cta: "none",
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
