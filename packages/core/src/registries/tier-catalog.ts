import { z } from "zod";

import { BuiltinToolpackSlugSchema } from "./builtin-toolpacks.js";
import { PerToolCapsSchema, TierCtaSchema } from "../models/tier.model.js";

/**
 * The declarative tier catalog (#218) — the versioned, env-agnostic record
 * of truth for tier POLICY: allocations, entitlements, display, overage,
 * `selectable`. **Pricing is deliberately absent** — price amounts live in
 * Stripe (the pricing record of truth); an entry carries only its
 * `stripeLookupKey`, the cross-environment price identity that
 * `portalops tier apply` resolves (read-only) to each environment's local
 * price id.
 *
 * Consumers: `portalops tier apply` (converges declared rows per env) and
 * `SeedService.seedTiers` (bootstrap-INSERTs `standard` on a fresh DB).
 * Editing this file + `tier apply` is the ONLY sanctioned way to change
 * tier policy — ad-hoc rows the catalog doesn't name are never touched.
 *
 * Field names deliberately mirror `TierSchema` (`models/tier.model.ts`) so
 * convergence is a flat field map; the registry test pins the mirror.
 */
export const TierCatalogEntrySchema = z.object({
  slug: z.string().min(1),
  displayName: z.string().min(1),
  // Literals, not enums: widen the day a second value actually exists.
  periodKind: z.literal("monthly"),
  periodAnchorDay: z.number().int().min(1).max(28),
  overage: z.literal("hard-deny"),
  freeUnitsPerPeriod: z.number().int().nonnegative().nullable(),
  freeRatePerMin: z.number().int().nonnegative().nullable(),
  meteredUnitsPerPeriod: z.number().int().nonnegative().nullable(),
  meteredRatePerMin: z.number().int().nonnegative().nullable(),
  expensiveUnitsPerPeriod: z.number().int().nonnegative().nullable(),
  expensiveRatePerMin: z.number().int().nonnegative().nullable(),
  perToolCaps: PerToolCapsSchema.nullable(),
  /** Listed in the self-serve plan list (#176). */
  selectable: z.boolean(),
  /** Built-in toolpack slugs available on this tier (#214) — compile-time
   *  checked against the pack registry. */
  builtinToolpacks: z.array(BuiltinToolpackSlugSchema),
  /** Whether orgs on this tier may register/use custom toolpacks (#214). */
  customToolpacks: z.boolean(),
  /** Card call-to-action (#241) — converged from the catalog. `subscribe`
   *  requires a resolvable `stripeLookupKey`; `none` is the free default. */
  cta: TierCtaSchema,
  /** #311: served to anonymous visitors on the public marketing site. */
  public: z.boolean(),
  /** #311: marketing pricing-card order, ascending. */
  displayOrder: z.number().int().nonnegative(),
  /** Stripe `lookup_key` — the cross-env price identity. null = not
   *  purchasable (no checkout path). */
  stripeLookupKey: z.string().min(1).nullable(),
});
export type TierCatalogEntry = z.infer<typeof TierCatalogEntrySchema>;

/**
 * The catalog — four self-serve tiers, ascending (#263): `standard` (free
 * default) < `plus` (paid) < `pro` (paid; everything allowed + generous) <
 * `enterprise` (public `contact`/contact-sales, no price). These are
 * **production, margin-tuned** magnitudes (#495): sized against the cost
 * model in `docs/TIER_PRICING_MODEL.md` (2026-09-02 pass — vendor rates,
 * fixed costs, per-tier margin thresholds, and the decision record live
 * there; re-run the model before retuning anything here).
 *
 * Tiering is capability-based — which built-in toolpacks a tier entitles,
 * and whether it may register custom ones. The core query/visualise/refresh
 * loop is never charged, so an allocation exists to bound the monthly vendor
 * bill against the tier's price, not to meter ordinary use. Every self-serve
 * tier bounds BOTH axes: `…UnitsPerPeriod` caps the monthly bill,
 * `…RatePerMin` caps how fast it can be run up. An unlimited (`null`)
 * allocation on a tier anyone can subscribe to is an unbounded vendor bill
 * against a fixed price — a guard test pins that none exists, and #495's
 * invariants additionally pin the ladder's shape (metered/expensive ascent,
 * entitlement monotonicity, rate-reaches-quota coherence).
 *
 * `expensive` is the Portal-billed class (`web_search`→Tavily, geocoding→
 * Mapbox), sized against real consumption: `bulk_geocode_records` charges one
 * unit per newly-geocoded row, so an allocation smaller than a realistic
 * column makes the feature unusable rather than metered. (The class's
 * adversarial ceiling is closed by the #495 follow-ups — per-tool unit
 * re-costing — not by shrinking these below geocode scale.)
 *
 * `enterprise` here is the generic public contact card and stays unlimited on
 * purpose — no org self-serves onto it, and a real deal gets an org-scoped
 * custom tier (#241) with negotiated numbers, floored per the model's T4
 * rule. Changes land as reviewed PRs, then reach an environment via
 * `portalops tier apply --env <e>` (paid tiers need their Stripe price created
 * first — apply fails closed on a missing lookup key).
 */
export const TIER_CATALOG: readonly TierCatalogEntry[] = Object.freeze(
  z.array(TierCatalogEntrySchema).parse([
    {
      // Free entry tier (the default). Modest allocations, basic toolpacks.
      // entity_management is included below the paywall on purpose (#495):
      // its sync writes are all costHint "free" (never charged), so the
      // entitlement is margin-neutral, and record editing is core-loop work.
      slug: "standard",
      displayName: "Standard",
      periodKind: "monthly",
      periodAnchorDay: 1,
      overage: "hard-deny",
      freeUnitsPerPeriod: null,
      freeRatePerMin: null,
      meteredUnitsPerPeriod: 500,
      meteredRatePerMin: 10,
      expensiveUnitsPerPeriod: 100,
      expensiveRatePerMin: 2,
      perToolCaps: null,
      selectable: true,
      builtinToolpacks: ["data_query", "web_search", "entity_management"],
      customToolpacks: false,
      cta: "none",
      public: true,
      displayOrder: 1,
      stripeLookupKey: null,
    },
    {
      // Paid mid tier.
      slug: "plus",
      displayName: "Plus",
      periodKind: "monthly",
      periodAnchorDay: 1,
      overage: "hard-deny",
      freeUnitsPerPeriod: null,
      freeRatePerMin: null,
      meteredUnitsPerPeriod: 3_000,
      meteredRatePerMin: 60,
      expensiveUnitsPerPeriod: 2_000,
      expensiveRatePerMin: 10,
      perToolCaps: null,
      selectable: true,
      // Every pack except visualize/gis (#495) — those two and custom
      // toolpacks are Pro's exclusives. regression/financial are own-compute
      // (vendor-$0; logistic_regression charges the expensive allocation).
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
      public: true,
      displayOrder: 2,
      stripeLookupKey: "plus_monthly",
    },
    {
      // Top self-serve tier: everything allowed, ceilings margin-sized.
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
      cta: "subscribe",
      public: true,
      displayOrder: 3,
      stripeLookupKey: "pro_monthly",
    },
    {
      // Public "contact sales" tier (cta contact, no price). Distinct from the
      // per-client custom tiers of #241, which are org-scoped; this is the
      // generic Enterprise upgrade card everyone sees. Negotiated → unlimited.
      slug: "enterprise",
      displayName: "Enterprise",
      periodKind: "monthly",
      periodAnchorDay: 1,
      overage: "hard-deny",
      freeUnitsPerPeriod: null,
      freeRatePerMin: null,
      meteredUnitsPerPeriod: null,
      meteredRatePerMin: null,
      expensiveUnitsPerPeriod: null,
      expensiveRatePerMin: null,
      perToolCaps: null,
      selectable: true,
      builtinToolpacks: [...BuiltinToolpackSlugSchema.options],
      customToolpacks: true,
      cta: "contact",
      public: true,
      displayOrder: 4,
      stripeLookupKey: null,
    },
  ])
);

/** Slug-keyed view of {@link TIER_CATALOG}. */
export const TIER_CATALOG_BY_SLUG: ReadonlyMap<string, TierCatalogEntry> =
  new Map(TIER_CATALOG.map((entry) => [entry.slug, entry]));
