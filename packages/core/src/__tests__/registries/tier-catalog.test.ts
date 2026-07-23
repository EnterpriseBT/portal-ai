import { describe, it, expect } from "@jest/globals";

import {
  TIER_CATALOG,
  TIER_CATALOG_BY_SLUG,
  TierCatalogEntrySchema,
} from "../../registries/tier-catalog";
import { BuiltinToolpackSlugSchema } from "../../registries/builtin-toolpacks";
import { TierSchema } from "../../models/tier.model";

// ── case 1 — the catalog parses and snapshots today's standard row ────

describe("TIER_CATALOG (#218)", () => {
  it("every entry parses against TierCatalogEntrySchema", () => {
    for (const entry of TIER_CATALOG) {
      expect(TierCatalogEntrySchema.safeParse(entry).success).toBe(true);
    }
  });

  it("slugs are unique and the by-slug map mirrors the array", () => {
    const slugs = TIER_CATALOG.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const entry of TIER_CATALOG) {
      expect(TIER_CATALOG_BY_SLUG.get(entry.slug)).toBe(entry);
    }
  });

  it("standard is the QA-generous non-purchasable default (#239)", () => {
    const standard = TIER_CATALOG_BY_SLUG.get("standard");
    expect(standard).toBeDefined();
    expect(standard).toMatchObject({
      slug: "standard",
      displayName: "Standard",
      periodKind: "monthly",
      periodAnchorDay: 1,
      overage: "hard-deny",
      freeUnitsPerPeriod: null,
      freeRatePerMin: null,
      // #239 QA-sandbox posture: metered unlimited (null), expensive finite
      // to bound web_search→Tavily vendor cost even when quota is generous.
      meteredUnitsPerPeriod: null,
      meteredRatePerMin: null,
      expensiveUnitsPerPeriod: 1_000_000,
      expensiveRatePerMin: 10_000,
      perToolCaps: null,
      selectable: true,
      // #214 generous-beta posture: fully permissive.
      builtinToolpacks: [...BuiltinToolpackSlugSchema.options],
      customToolpacks: true,
      // #241: the free default has no card CTA.
      cta: "none",
      // Still the non-purchasable default — no Stripe price for standard.
      stripeLookupKey: null,
    });
  });

  it("pro is a selectable purchasable tier (#239)", () => {
    const pro = TIER_CATALOG_BY_SLUG.get("pro");
    expect(pro).toBeDefined();
    expect(pro).toMatchObject({
      slug: "pro",
      displayName: "Pro",
      periodKind: "monthly",
      periodAnchorDay: 1,
      overage: "hard-deny",
      freeUnitsPerPeriod: null,
      freeRatePerMin: null,
      meteredUnitsPerPeriod: null,
      meteredRatePerMin: null,
      expensiveUnitsPerPeriod: 1_000_000,
      expensiveRatePerMin: 10_000,
      perToolCaps: null,
      selectable: true,
      builtinToolpacks: [...BuiltinToolpackSlugSchema.options],
      customToolpacks: true,
      // #241: a purchasable tier's card offers self-serve checkout.
      cta: "subscribe",
      // Purchasable: the cross-env lookup key tier apply resolves to a price.
      stripeLookupKey: "pro_monthly",
    });
  });

  it("the catalog is frozen (no runtime mutation)", () => {
    expect(Object.isFrozen(TIER_CATALOG)).toBe(true);
    expect(() => {
      (TIER_CATALOG as unknown as unknown[]).push({});
    }).toThrow();
  });
});

// ── case 2 — the flat-map convergence guarantee ───────────────────────

describe("TierCatalogEntrySchema ↔ TierSchema field mirror (#218)", () => {
  it("every catalog field (minus stripeLookupKey) is a TierSchema column", () => {
    const catalogFields = Object.keys(TierCatalogEntrySchema.shape).filter(
      (f) => f !== "stripeLookupKey"
    );
    const tierFields = new Set(Object.keys(TierSchema.shape));
    for (const field of catalogFields) {
      expect(tierFields).toContain(field);
    }
  });
});
