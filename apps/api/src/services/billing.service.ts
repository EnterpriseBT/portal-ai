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

import type Stripe from "stripe";
import { StripeEventModelFactory } from "@portalai/core/models";
import { DbService } from "./db.service.js";
import { StripeService } from "./stripe.service.js";
import { SystemUtilities } from "../utils/system.util.js";
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

  /**
   * Webhook entry for `customer.subscription.{created,updated,deleted}`.
   *
   * Converge-to-source (D2): re-fetches the subscription's CURRENT state
   * from Stripe (out-of-order delivery can't regress the tier), then in ONE
   * transaction: the dedup insert (`false` → return `"duplicate"`, no
   * further work) + the org UPDATE. An unknown customer records
   * `"unmatched"` and resolves (Q2 — never a retry loop). Throws — → 500 →
   * Stripe retry — only on DB/Stripe-fetch failure; the rollback removes
   * the dedup row so the retry processes cleanly.
   */
  static async handleSubscriptionEvent(
    event: Stripe.Event
  ): Promise<"applied" | "noop" | "unmatched" | "duplicate"> {
    const snapshot = event.data.object as Stripe.Subscription;

    // Converge read — the decision input is Stripe's current state, never
    // the event snapshot. A deleted subscription retrieves as `canceled`.
    const sub = await StripeService.fetchSubscription(snapshot.id);
    const customerId =
      typeof sub.customer === "string" ? sub.customer : sub.customer.id;

    const org =
      await DbService.repository.organizations.findByStripeCustomerId(
        customerId
      );

    if (!org) {
      logger.warn(
        { eventId: event.id, customerId, subscriptionId: sub.id },
        "Stripe event for an unknown customer; recording unmatched"
      );
      const inserted = await DbService.repository.stripeEvents.insertIfNew(
        BillingService.eventRow(event, {
          stripeCustomerId: customerId,
          stripeSubscriptionId: sub.id,
          organizationId: null,
          resultingTier: null,
          outcome: "unmatched",
        })
      );
      return inserted ? "unmatched" : "duplicate";
    }

    const priceIndex = await DbService.repository.tiers.priceIndex();
    const derived = BillingService.deriveTierFromSubscription(
      {
        status: sub.status,
        priceId: sub.items.data[0]?.price?.id ?? null,
        billingCycleAnchor: sub.billing_cycle_anchor,
      },
      priceIndex,
      org.tier
    );

    const nextSubscriptionId = derived.subscriptionLive ? sub.id : null;
    const changed =
      org.tier !== derived.tier ||
      org.stripeSubscriptionId !== nextSubscriptionId ||
      org.billingAnchorDay !== derived.anchorDay;

    // Dedup row + org write commit or roll back together (D2).
    return DbService.transaction(async (tx) => {
      const inserted = await DbService.repository.stripeEvents.insertIfNew(
        BillingService.eventRow(event, {
          stripeCustomerId: customerId,
          stripeSubscriptionId: sub.id,
          organizationId: org.id,
          resultingTier: changed ? derived.tier : null,
          outcome: changed ? "applied" : "noop",
        }),
        tx
      );
      if (!inserted) return "duplicate";
      if (!changed) return "noop";

      await DbService.repository.organizations.update(
        org.id,
        {
          tier: derived.tier,
          stripeSubscriptionId: nextSubscriptionId,
          billingAnchorDay: derived.anchorDay,
          updated: Date.now(),
          updatedBy: SystemUtilities.id.system,
        },
        tx
      );
      logger.info(
        {
          eventId: event.id,
          organizationId: org.id,
          tier: derived.tier,
          billingAnchorDay: derived.anchorDay,
        },
        "Applied Stripe subscription state to organization"
      );
      return "applied";
    });
  }

  /**
   * Record a signature-verified event of a type we don't handle —
   * dedup'd like everything else, so redeliveries stay one row.
   */
  static async recordIgnoredEvent(
    event: Stripe.Event
  ): Promise<"ignored" | "duplicate"> {
    const obj = event.data.object as {
      customer?: unknown;
      subscription?: unknown;
    };
    const inserted = await DbService.repository.stripeEvents.insertIfNew(
      BillingService.eventRow(event, {
        stripeCustomerId:
          typeof obj.customer === "string" ? obj.customer : null,
        stripeSubscriptionId:
          typeof obj.subscription === "string" ? obj.subscription : null,
        organizationId: null,
        resultingTier: null,
        outcome: "ignored",
      })
    );
    return inserted ? "ignored" : "duplicate";
  }

  /** Assemble a `stripe_events` row (audit fields via the model factory). */
  private static eventRow(
    event: Stripe.Event,
    fields: {
      stripeCustomerId: string | null;
      stripeSubscriptionId: string | null;
      organizationId: string | null;
      resultingTier: string | null;
      outcome: "applied" | "noop" | "unmatched" | "ignored";
    }
  ) {
    return new StripeEventModelFactory()
      .create(SystemUtilities.id.system)
      .update({ eventId: event.id, type: event.type, ...fields })
      .parse();
  }
}
