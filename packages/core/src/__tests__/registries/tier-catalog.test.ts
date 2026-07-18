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

  it("standard matches the seed snapshot verbatim (#172/#214 values)", () => {
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
      meteredUnitsPerPeriod: 2500,
      meteredRatePerMin: 20,
      expensiveUnitsPerPeriod: 300,
      expensiveRatePerMin: 5,
      perToolCaps: null,
      selectable: true,
      // #214 generous-beta posture: fully permissive.
      builtinToolpacks: [...BuiltinToolpackSlugSchema.options],
      customToolpacks: true,
      // Not purchasable today — no Stripe price exists for standard.
      stripeLookupKey: null,
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
