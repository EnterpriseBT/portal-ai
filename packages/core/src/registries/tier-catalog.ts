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
  /** Stripe `lookup_key` — the cross-env price identity. null = not
   *  purchasable (no checkout path). */
  stripeLookupKey: z.string().min(1).nullable(),
});
export type TierCatalogEntry = z.infer<typeof TierCatalogEntrySchema>;

/**
 * The catalog — four self-serve tiers, ascending (#263): `standard` (free
 * default) < `plus` (paid) < `pro` (paid; everything allowed + generous) <
 * `enterprise` (public `contact`/contact-sales, no price). These are
 * **test-grade** magnitudes, not production-graded — `pro`'s `metered` is
 * unlimited (null) so no denial interrupts manual testing, while its
 * `expensive` stays finite-but-huge to bound the one Portal-billed class
 * (`web_search`→Tavily) even under a generous quota. `enterprise` here is the
 * generic public contact card; the per-client custom tiers of #241 are
 * org-scoped and created out-of-band. Product/policy + real pricing are refined
 * later; changes land as reviewed PRs, then reach an environment via
 * `portalops tier apply --env <e>` (paid tiers need their Stripe price created
 * first — apply fails closed on a missing lookup key).
 */
export const TIER_CATALOG: readonly TierCatalogEntry[] = Object.freeze(
  z.array(TierCatalogEntrySchema).parse([
    {
      // Free entry tier (the default). Modest allocations, basic toolpacks.
      slug: "standard",
      displayName: "Standard",
      periodKind: "monthly",
      periodAnchorDay: 1,
      overage: "hard-deny",
      freeUnitsPerPeriod: null,
      freeRatePerMin: null,
      meteredUnitsPerPeriod: 500,
      meteredRatePerMin: 10,
      expensiveUnitsPerPeriod: 20,
      expensiveRatePerMin: 2,
      perToolCaps: null,
      selectable: true,
      builtinToolpacks: ["data_query", "web_search"],
      customToolpacks: false,
      cta: "none",
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
      meteredUnitsPerPeriod: 5_000,
      meteredRatePerMin: 60,
      expensiveUnitsPerPeriod: 200,
      expensiveRatePerMin: 10,
      perToolCaps: null,
      selectable: true,
      builtinToolpacks: [
        "data_query",
        "statistics",
        "web_search",
        "entity_management",
      ],
      customToolpacks: false,
      cta: "subscribe",
      stripeLookupKey: "plus_monthly",
    },
    {
      // Top self-serve tier: everything allowed + generous (metered unlimited);
      // `expensive` stays finite-but-huge to bound Tavily/web_search cost.
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
      cta: "subscribe",
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
      stripeLookupKey: null,
    },
  ])
);

/** Slug-keyed view of {@link TIER_CATALOG}. */
export const TIER_CATALOG_BY_SLUG: ReadonlyMap<string, TierCatalogEntry> =
  new Map(TIER_CATALOG.map((entry) => [entry.slug, entry]));
