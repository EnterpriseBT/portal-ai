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
 * The catalog. app-dev is a QA sandbox (#239), so allocation magnitudes are
 * QA-generous rather than production-graded: `metered` is unlimited (null) so
 * no metered denial interrupts manual testing, while `expensive` stays finite
 * to bound the one Portal-billed class (`web_search`→Tavily) even under a
 * generous quota. `standard` (the non-purchasable default) and `pro` (the
 * purchasable tier) carry the same policy here — `pro` differs only by having
 * a `stripeLookupKey`. Meaningful per-tier differentiation is a production
 * concern; Enterprise/Custom plan is #241. Product/policy changes land here as
 * reviewed PRs, then reach an environment via `portalops tier apply --env <e>`.
 */
export const TIER_CATALOG: readonly TierCatalogEntry[] = Object.freeze(
  z.array(TierCatalogEntrySchema).parse([
    {
      slug: "standard",
      displayName: "Standard",
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
      cta: "none",
      stripeLookupKey: null,
    },
    {
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
  ])
);

/** Slug-keyed view of {@link TIER_CATALOG}. */
export const TIER_CATALOG_BY_SLUG: ReadonlyMap<string, TierCatalogEntry> =
  new Map(TIER_CATALOG.map((entry) => [entry.slug, entry]));
