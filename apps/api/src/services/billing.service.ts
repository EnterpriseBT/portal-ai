/**
 * BillingService (#176) — subscription billing logic over the Stripe SDK
 * wrapper ({@link StripeService}).
 *
 * This module holds the *decisions*; `stripe.service.ts` holds the SDK.
 * `deriveTierFromSubscription` is the pure Decision-3 status table the
 * webhook handler applies after its converge re-fetch.
 *
 * See `docs/STRIPE_SUBSCRIPTION_BILLING.spec.md`.
 */

import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "billing-service" });

/** Subscription states that revert the org to the free tier (D3). A deleted
 *  subscription (`customer.subscription.deleted`) reports `canceled`. */
const TERMINAL_SUBSCRIPTION_STATUSES = new Set([
  "canceled",
  "unpaid",
  "incomplete_expired",
]);

/** The tier every org reverts to when its subscription ends. */
const DEFAULT_TIER = "standard";

/** What the webhook writes to the org for a subscription state. */
export interface DerivedTierState {
  /** Tier slug the org should carry. */
  tier: string;
  /** False ⇒ clear `stripe_subscription_id` (customer id always stays). */
  subscriptionLive: boolean;
  /** `billing_anchor_day` to write (1–28), or null to clear it. */
  anchorDay: number | null;
}

export class BillingService {
  /**
   * PURE — the Decision-3 status table. No I/O.
   *
   * - `active`/`trialing` + known price → the mapped tier.
   * - `active`/`trialing` + unknown/absent price → keep `currentTier`
   *   (warn: a live subscription should always map).
   * - `past_due` → keep the paid tier; Stripe dunning owns the grace window.
   * - `canceled`/`unpaid`/`incomplete_expired` → revert to `standard`,
   *   clear subscription id + anchor.
   * - Anything else (`incomplete`, `paused`, future statuses) → keep
   *   `currentTier`; never grants, never revokes.
   *
   * The anchor day is the UTC day-of-month of `billingCycleAnchor`, clamped
   * to 28 so every period id exists in every month.
   */
  static deriveTierFromSubscription(
    sub: {
      status: string;
      priceId: string | null;
      billingCycleAnchor: number /* unix seconds */;
    },
    priceIndex: Map<string, string>, // stripe_price_id → tiers.slug
    currentTier: string
  ): DerivedTierState {
    if (TERMINAL_SUBSCRIPTION_STATUSES.has(sub.status)) {
      return { tier: DEFAULT_TIER, subscriptionLive: false, anchorDay: null };
    }

    const anchorDay = Math.min(
      new Date(sub.billingCycleAnchor * 1000).getUTCDate(),
      28
    );

    if (sub.status === "active" || sub.status === "trialing") {
      const mapped = sub.priceId ? priceIndex.get(sub.priceId) : undefined;
      if (mapped) {
        return { tier: mapped, subscriptionLive: true, anchorDay };
      }
      logger.warn(
        { priceId: sub.priceId, currentTier },
        "Live subscription carries an unmapped Stripe price; keeping the org's current tier"
      );
      return { tier: currentTier, subscriptionLive: true, anchorDay };
    }

    // past_due (Stripe dunning owns grace) and any unrecognized status:
    // hold the line — keep the current tier and the anchor.
    return { tier: currentTier, subscriptionLive: true, anchorDay };
  }
}
