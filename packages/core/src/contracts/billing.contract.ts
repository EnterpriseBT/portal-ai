import { z } from "zod";
import { TierPolicySchema } from "../models/tier.model.js";

/**
 * Billing endpoint contracts (#176) — the self-serve subscription surface.
 *
 * `GET /api/billing/tiers` returns whole-tier objects (not bare allocation
 * numbers) so tier entitlements (#214) later add a field, not a reshape.
 */

/** One plan-list entry. `purchasable` is distinct from `price` so a Stripe
 *  outage (price `null`) can't be confused with "not for sale". */
export const BillingTierSchema = z.object({
  slug: z.string(),
  displayName: z.string(),
  allocations: TierPolicySchema.shape.allocations,
  /** `stripePriceId` present on the tier row. */
  purchasable: z.boolean(),
  /** Null: not purchasable OR price fetch degraded (Stripe outage). */
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

/** Response payload for `POST /api/billing/checkout` — hosted session URL. */
export const BillingCheckoutResponseSchema = z.object({ url: z.string() });
export type BillingCheckoutResponse = z.infer<
  typeof BillingCheckoutResponseSchema
>;

/** Response payload for `POST /api/billing/portal` — hosted portal URL. */
export const BillingPortalResponseSchema = z.object({ url: z.string() });
export type BillingPortalResponse = z.infer<typeof BillingPortalResponseSchema>;
