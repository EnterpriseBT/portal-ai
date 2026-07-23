import { z } from "zod";
import { TierPolicySchema, TierCtaSchema } from "../models/tier.model.js";

/**
 * Billing endpoint contracts (#176, enriched #241) — the self-serve
 * subscription surface.
 *
 * `GET /api/billing/tiers` returns whole-tier objects so tier policy (#241)
 * and entitlements (#214) add a field, not a reshape.
 */

/** One plan-list entry. Carries the whole assembled {@link TierPolicySchema}
 *  (#241) so every card dimension — allocations per cost class (units +
 *  per-minute rate; `null` = unlimited), perToolCaps, overage, period,
 *  entitlements — is projected, plus an operator blurb and a single-source-of-
 *  truth `cta`. `cta` is distinct from `price` so a Stripe outage (price
 *  `null`) can't be confused with a non-`subscribe` card. */
export const BillingTierSchema = z.object({
  slug: z.string(),
  displayName: z.string(),
  /** The whole assembled tier policy (#241). */
  policy: TierPolicySchema,
  /** Operator-authored blurb; `null` renders cleanly (no blurb). */
  description: z.string().nullable(),
  /** The card's call-to-action — the single source of truth for its action
   *  (replaces the old derived `purchasable`). */
  cta: TierCtaSchema,
  /** Null: non-`subscribe` tier OR price fetch degraded (Stripe outage). */
  price: z
    .object({
      unitAmount: z.number().int(), // cents
      currency: z.string(),
      interval: z.enum(["month", "year"]),
    })
    .nullable(),
});
export type BillingTier = z.infer<typeof BillingTierSchema>;

/** Response payload for `GET /api/billing/tiers`. */
export const BillingTiersGetResponseSchema = z.object({
  tiers: z.array(BillingTierSchema),
});
export type BillingTiersGetResponse = z.infer<
  typeof BillingTiersGetResponseSchema
>;

/** Request body for `POST /api/billing/checkout` — the tier slug to buy. */
export const BillingCheckoutRequestSchema = z.object({ tier: z.string() });
export type BillingCheckoutRequest = z.infer<
  typeof BillingCheckoutRequestSchema
>;

/** Request body for `POST /api/billing/portal` (#260). No `tier` → Manage
 *  (portal home). A `tier` → open the subscription-update flow to that tier's
 *  price (in-app upgrade/downgrade). */
export const BillingPortalRequestSchema = z.object({
  tier: z.string().optional(),
});
export type BillingPortalRequest = z.infer<typeof BillingPortalRequestSchema>;

/** Response payload for `POST /api/billing/checkout` — hosted session URL. */
export const BillingCheckoutResponseSchema = z.object({ url: z.string() });
export type BillingCheckoutResponse = z.infer<
  typeof BillingCheckoutResponseSchema
>;

/** Response payload for `POST /api/billing/portal` — hosted portal URL. */
export const BillingPortalResponseSchema = z.object({ url: z.string() });
export type BillingPortalResponse = z.infer<typeof BillingPortalResponseSchema>;
