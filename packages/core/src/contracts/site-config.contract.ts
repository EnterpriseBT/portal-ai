import { z } from "zod";

import { TierCtaSchema } from "../models/tier.model.js";

/**
 * Public site-config contract (#311) — the wire shape of the anonymous
 * `GET /api/public/site-config`, consumed by the marketing site's build
 * (`apps/site`) and baked into static HTML.
 *
 * A **presentation snapshot**, deliberately NOT a serialized `TierPolicy`:
 * the charge grid, `perToolCaps`, period fields, and `overage` are billing
 * internals whose shape (#172/#214) must be free to move without breaking
 * a published static site. Schemas are STRICT so leakage of an internal
 * field is a contract-test failure, not a silent addition. New public
 * facts land as additive fields.
 */

/** Stripe-resolved display price (mirrors `BillingTierSchema.price`). */
export const PublicSitePriceSchema = z.strictObject({
  unitAmount: z.number().int(), // cents
  currency: z.string(),
  interval: z.enum(["month", "year"]),
});
export type PublicSitePrice = z.infer<typeof PublicSitePriceSchema>;

/** One marketing pricing card. */
export const PublicSiteTierSchema = z.strictObject({
  slug: z.string(),
  displayName: z.string(),
  /** Operator-authored blurb; null renders cleanly (no blurb). */
  description: z.string().nullable(),
  cta: TierCtaSchema,
  /** Pricing-card order, ascending (`tiers.display_order`). */
  displayOrder: z.number().int(),
  /** Monthly credit allocation per charged class; null = unlimited. The
   *  `free` class is deliberately absent — never charged, never marketed. */
  credits: z.strictObject({
    metered: z.number().int().nullable(),
    expensive: z.number().int().nullable(),
  }),
  /** Built-in pack slugs; the site maps slugs → display copy via
   *  `@portalai/core/registries` at build time. */
  builtinToolpacks: z.array(z.string()),
  customToolpacks: z.boolean(),
  /** null ⇔ the tier has no Stripe price (the bespoke contact card). An
   *  unresolvable non-null price is a 503 upstream, never a null here —
   *  the split rule that keeps a Stripe outage from being published as a
   *  pricing change. */
  price: PublicSitePriceSchema.nullable(),
});
export type PublicSiteTier = z.infer<typeof PublicSiteTierSchema>;

/** The whole response payload — ONE atomic snapshot, fetched once per site
 *  build and threaded to every page so pages can never disagree. */
export const PublicSiteConfigResponseSchema = z.strictObject({
  tiers: z.array(PublicSiteTierSchema),
  /** ISO timestamp of snapshot assembly — stamped into the site's
   *  `portal:build` meta tag for staleness forensics. */
  generatedAt: z.string(),
});
export type PublicSiteConfigResponse = z.infer<
  typeof PublicSiteConfigResponseSchema
>;
