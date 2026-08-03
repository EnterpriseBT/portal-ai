/**
 * Public site-config contract (#311 slice 3) — the wire shape of
 * `GET /api/public/site-config`. A PRESENTATION snapshot, deliberately NOT
 * TierPolicy: strict schemas so billing internals (charge grid, perToolCaps,
 * period, overage) can never leak into the public contract unnoticed.
 */

import { describe, it, expect } from "@jest/globals";

import {
  PublicSiteTierSchema,
  PublicSiteConfigResponseSchema,
} from "../../contracts/site-config.contract";

const validTier = {
  slug: "pro",
  displayName: "Pro",
  description: "For growing teams.",
  cta: "subscribe",
  displayOrder: 3,
  credits: { metered: null, expensive: 1_000_000 },
  builtinToolpacks: ["data_query", "web_search"],
  customToolpacks: true,
  price: { unitAmount: 4900, currency: "usd", interval: "month" },
};

const validSnapshot = {
  tiers: [validTier],
  contact: {
    supportEmail: "support@portalsai.io",
    salesEmail: "sales@portalsai.io",
  },
  generatedAt: "2026-08-03T00:00:00.000Z",
};

describe("PublicSiteConfigResponseSchema (#311)", () => {
  it("parses a full snapshot", () => {
    const parsed = PublicSiteConfigResponseSchema.parse(validSnapshot);
    expect(parsed.tiers[0].slug).toBe("pro");
    expect(parsed.contact.supportEmail).toBe("support@portalsai.io");
  });

  it("price is nullable (the contact card) and round-trips null", () => {
    const contactTier = {
      ...validTier,
      slug: "enterprise",
      cta: "contact",
      price: null,
      credits: { metered: null, expensive: null },
    };
    const parsed = PublicSiteTierSchema.parse(contactTier);
    expect(parsed.price).toBeNull();
    expect(parsed.credits.metered).toBeNull();
  });

  it("rejects billing-internal leakage (strict — unknown keys fail)", () => {
    // The exact fields the discovery's contract-stability lean forbids.
    for (const leak of [
      { perToolCaps: { web_search: { unitsPerPeriod: 5 } } },
      { overage: "hard-deny" },
      { periodKind: "monthly" },
      { meteredRatePerMin: 10 },
      { stripePriceId: "price_123" },
      { visibleToOrganizationId: "org_1" },
    ]) {
      expect(
        PublicSiteTierSchema.safeParse({ ...validTier, ...leak }).success
      ).toBe(false);
    }
    // The envelope is strict too.
    expect(
      PublicSiteConfigResponseSchema.safeParse({
        ...validSnapshot,
        usage: {},
      }).success
    ).toBe(false);
  });
});
