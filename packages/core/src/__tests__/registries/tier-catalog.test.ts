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

  it("standard is the free entry default (#263)", () => {
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
      // #263: modest entry allocations (ascending lineup).
      meteredUnitsPerPeriod: 500,
      meteredRatePerMin: 10,
      expensiveUnitsPerPeriod: 100,
      expensiveRatePerMin: 2,
      perToolCaps: null,
      selectable: true,
      // #495: entity_management on the free tier is deliberate — its sync
      // writes are all costHint "free" (never charged), so the entitlement
      // is margin-neutral; record-editing is part of the core product loop.
      builtinToolpacks: ["data_query", "web_search", "entity_management"],
      customToolpacks: false,
      // #241: the free default has no card CTA.
      cta: "none",
      stripeLookupKey: null,
    });
  });

  it("plus is a selectable paid mid tier (#263)", () => {
    const plus = TIER_CATALOG_BY_SLUG.get("plus");
    expect(plus).toMatchObject({
      slug: "plus",
      displayName: "Plus",
      meteredUnitsPerPeriod: 3_000,
      expensiveUnitsPerPeriod: 2_000,
      selectable: true,
      // #495: every pack except visualize/gis — those two plus custom
      // toolpacks are Pro's exclusives; the rest are own-compute and
      // margin-neutral (logistic_regression is expensive-class but vendor-$0).
      builtinToolpacks: [
        "data_query",
        "statistics",
        "regression",
        "financial",
        "web_search",
        "entity_management",
      ],
      customToolpacks: false,
      cta: "subscribe",
      stripeLookupKey: "plus_monthly",
    });
  });

  it("enterprise is the public contact-sales tier (#263)", () => {
    const ent = TIER_CATALOG_BY_SLUG.get("enterprise");
    expect(ent).toMatchObject({
      slug: "enterprise",
      displayName: "Enterprise",
      // Negotiated → unlimited across the board.
      meteredUnitsPerPeriod: null,
      expensiveUnitsPerPeriod: null,
      selectable: true,
      customToolpacks: true,
      cta: "contact",
      stripeLookupKey: null,
    });
    expect(ent?.builtinToolpacks).toEqual([
      ...BuiltinToolpackSlugSchema.options,
    ]);
  });

  it("pro is a selectable purchasable tier — everything, with ceilings (#263, #325)", () => {
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
      meteredUnitsPerPeriod: 15_000,
      meteredRatePerMin: 120,
      expensiveUnitsPerPeriod: 20_000,
      expensiveRatePerMin: 30,
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

  // #284: POST /api/stations defaults `toolPacks` to ["data_query"] when the
  // caller sends none, and the entitlement guard runs over that default. If a
  // tier ever stopped entitling data_query, station creation would 403 on a
  // payload the user never wrote. Re-tiering is free; dropping data_query is
  // not — this pins that.
  it("every tier entitles data_query (the station-create default)", () => {
    for (const entry of TIER_CATALOG) {
      expect(entry.builtinToolpacks).toContain("data_query");
    }
  });

  it("the catalog is frozen (no runtime mutation)", () => {
    expect(Object.isFrozen(TIER_CATALOG)).toBe(true);
    expect(() => {
      (TIER_CATALOG as unknown as unknown[]).push({});
    }).toThrow();
  });
});

// ── #311 — the public marketing-site fields ───────────────────────────

describe("TIER_CATALOG public/displayOrder (#311)", () => {
  it("every entry carries `public` and an integer `displayOrder`", () => {
    for (const entry of TIER_CATALOG) {
      expect(typeof entry.public).toBe("boolean");
      expect(Number.isInteger(entry.displayOrder)).toBe(true);
    }
    // The four self-serve tiers all appear on the marketing site.
    expect(TIER_CATALOG.every((e) => e.public)).toBe(true);
  });

  it("displayOrders are unique and ascending in catalog order", () => {
    const orders = TIER_CATALOG.map((e) => e.displayOrder);
    expect(new Set(orders).size).toBe(orders.length);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it("the schema rejects a negative displayOrder", () => {
    const base = TIER_CATALOG_BY_SLUG.get("standard")!;
    expect(
      TierCatalogEntrySchema.safeParse({ ...base, displayOrder: -1 }).success
    ).toBe(false);
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

// #325: the catalog shipped with test-grade magnitudes — `pro` had a null
// (unlimited) metered allocation "so no denial interrupts manual testing".
// That is an unbounded vendor bill against a fixed monthly price. These pin
// the production shape as an invariant rather than as four separate numbers,
// so a fifth tier inherits it and a revert is loud.
describe("no self-serve tier has an unlimited allocation (#325)", () => {
  const selfServe = TIER_CATALOG.filter(
    (t) => t.selectable && t.cta === "subscribe"
  );
  const free = TIER_CATALOG.filter((t) => t.cta === "none");

  it("covers the paid tiers and the free default", () => {
    expect(selfServe.map((t) => t.slug).sort()).toEqual(["plus", "pro"]);
    expect(free.map((t) => t.slug)).toEqual(["standard"]);
  });

  it.each([...selfServe, ...free])(
    "$slug bounds every cost class it can consume",
    (tier) => {
      // `null` means unlimited. A tier anyone can reach without a negotiated
      // contract must bound both the period quota AND the burst rate: the
      // quota caps the monthly bill, the rate caps how fast it is run up.
      expect(tier.meteredUnitsPerPeriod).not.toBeNull();
      expect(tier.meteredRatePerMin).not.toBeNull();
      expect(tier.expensiveUnitsPerPeriod).not.toBeNull();
      expect(tier.expensiveRatePerMin).not.toBeNull();
    }
  );

  it("scales the expensive class strictly with tier", () => {
    // The Portal-paid class (Tavily, Mapbox). Ascending is what makes the
    // ladder meaningful; equal or inverted would be a copy-paste slip.
    const by = (slug: string) =>
      TIER_CATALOG_BY_SLUG.get(slug)!.expensiveUnitsPerPeriod!;
    expect(by("standard")).toBeLessThan(by("plus"));
    expect(by("plus")).toBeLessThan(by("pro"));
  });

  it("leaves enterprise unlimited — it is a contact card, not a self-serve tier", () => {
    // Deliberate: a real enterprise deal gets an org-scoped custom tier
    // (#241) with negotiated numbers. Pinned so the exception stays visible.
    const ent = TIER_CATALOG_BY_SLUG.get("enterprise")!;
    expect(ent.cta).toBe("contact");
    expect(ent.meteredUnitsPerPeriod).toBeNull();
  });
});

// ── #495 — margin-pass invariants ─────────────────────────────────────
// The magnitudes are tuned against docs/TIER_PRICING_MODEL.md. These pin
// the ladder's *shape*, not the numbers, so a future retune stays coherent
// without editing this block.

describe("margin-pass invariants (#495)", () => {
  const bounded = TIER_CATALOG.filter((t) => t.meteredUnitsPerPeriod !== null);

  it("scales the metered class strictly with tier", () => {
    // Mirror of the expensive-class ascent above — an inverted or flat
    // metered ladder is a copy-paste slip either way.
    const by = (slug: string) =>
      TIER_CATALOG_BY_SLUG.get(slug)!.meteredUnitsPerPeriod!;
    expect(by("standard")).toBeLessThan(by("plus"));
    expect(by("plus")).toBeLessThan(by("pro"));
  });

  it("the entitlement ladder is monotonic — an upgrade never loses a pack", () => {
    const packs = (slug: string) =>
      new Set(TIER_CATALOG_BY_SLUG.get(slug)!.builtinToolpacks);
    const isSubset = (a: Set<string>, b: Set<string>) =>
      [...a].every((p) => b.has(p));
    expect(isSubset(packs("standard"), packs("plus"))).toBe(true);
    expect(isSubset(packs("plus"), packs("pro"))).toBe(true);
  });

  it.each(bounded)(
    "$slug's burst rate can actually reach its monthly quota",
    (tier) => {
      // An over-tight ratePerMin silently shrinks the real allocation below
      // the advertised unitsPerPeriod: the quota must be reachable inside a
      // 28-day period (the shortest periodAnchorDay=1 month) at the rate cap.
      const minutesPerPeriod = 60 * 24 * 28;
      expect(tier.meteredRatePerMin! * minutesPerPeriod).toBeGreaterThanOrEqual(
        tier.meteredUnitsPerPeriod!
      );
      expect(
        tier.expensiveRatePerMin! * minutesPerPeriod
      ).toBeGreaterThanOrEqual(tier.expensiveUnitsPerPeriod!);
    }
  );
});
