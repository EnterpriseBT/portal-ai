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
import type { BillingTier } from "@portalai/core/contracts";
import { DbService } from "./db.service.js";
import { StripeService } from "./stripe.service.js";
import { TierService } from "./tier.service.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { environment } from "../environment.js";
import { SystemUtilities } from "../utils/system.util.js";
import { createLogger } from "../utils/logger.util.js";
import type { OrganizationSelect } from "../db/schema/zod.js";

const logger = createLogger({ module: "billing-service" });

/** The web app's settings page — Checkout/Portal return target. */
function settingsUrl(): string {
  const origin = environment.CORS_ORIGIN[0] ?? "http://localhost:3000";
  return `${origin}/settings`;
}

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

  /**
   * The self-serve plan list (`GET /api/billing/tiers`): `selectable` rows
   * mapped to whole-tier objects (#214 contract-shaping). `purchasable`
   * stays truthful under a Stripe outage — only `price` null-degrades (Q7).
   */
  static async listBillingTiers(): Promise<BillingTier[]> {
    const rows = await DbService.repository.tiers.findSelectable();
    return Promise.all(
      rows.map(async (row) => ({
        slug: row.slug,
        displayName: row.displayName,
        allocations: TierService.tierPolicyFromRow(row).allocations,
        purchasable: row.stripePriceId != null,
        price: row.stripePriceId
          ? await StripeService.getPrice(row.stripePriceId)
          : null,
      }))
    );
  }

  /**
   * Mint a hosted Checkout session for `tierSlug` (owner-only). Guards, in
   * contract order: configured 503 → owner 403 → not already subscribed
   * 409 (Q1) → not managed-custom 409 (D5, server-blocked) → tier
   * exists+selectable 404 → priced 400 → lazy customer (D7) → session.
   * Stripe API failure → 502.
   */
  static async createCheckout(
    org: OrganizationSelect,
    callerUserId: string,
    tierSlug: string
  ): Promise<{ url: string }> {
    if (!StripeService.isConfigured()) {
      throw new ApiError(
        503,
        ApiCode.BILLING_NOT_CONFIGURED,
        "Billing is not configured in this environment"
      );
    }
    if (org.ownerUserId !== callerUserId) {
      throw new ApiError(
        403,
        ApiCode.BILLING_NOT_OWNER,
        "Only the organization owner can manage billing"
      );
    }
    if (org.stripeSubscriptionId) {
      throw new ApiError(
        409,
        ApiCode.BILLING_ALREADY_SUBSCRIBED,
        "The organization already has a subscription — manage it in the billing portal"
      );
    }

    // Managed custom tier (D5): no subscription drives the org's tier and
    // the row is unlisted — self-serve checkout would destroy the deal.
    const currentTierRow = await DbService.repository.tiers.findBySlug(
      org.tier
    );
    if (currentTierRow && !currentTierRow.selectable) {
      throw new ApiError(
        409,
        ApiCode.BILLING_TIER_MANAGED,
        "This organization's plan is managed — contact us to make changes"
      );
    }

    const tier = await DbService.repository.tiers.findBySlug(tierSlug);
    if (!tier || !tier.selectable) {
      throw new ApiError(
        404,
        ApiCode.BILLING_TIER_NOT_FOUND,
        `Unknown plan: ${tierSlug}`
      );
    }
    if (!tier.stripePriceId) {
      throw new ApiError(
        400,
        ApiCode.BILLING_TIER_NOT_PURCHASABLE,
        `The ${tier.displayName} plan cannot be purchased`
      );
    }

    try {
      // Lazy customer creation (D7) — persisted before the session so a
      // failed checkout never re-creates the customer.
      let customerId = org.stripeCustomerId;
      if (!customerId) {
        const customer = await StripeService.createCustomer({
          organizationId: org.id,
          name: org.name,
        });
        customerId = customer.id;
        await DbService.repository.organizations.update(org.id, {
          stripeCustomerId: customerId,
          updated: Date.now(),
          updatedBy: callerUserId,
        });
      }

      return await StripeService.createCheckoutSession({
        customerId,
        priceId: tier.stripePriceId,
        successUrl: `${settingsUrl()}?billing=success`,
        cancelUrl: `${settingsUrl()}?billing=cancelled`,
        organizationId: org.id,
      });
    } catch (err) {
      logger.error(
        { err, organizationId: org.id, tierSlug },
        "Stripe checkout session creation failed"
      );
      throw new ApiError(
        502,
        ApiCode.BILLING_CHECKOUT_FAILED,
        "Could not start checkout — please try again"
      );
    }
  }

  /**
   * Mint a hosted Billing Portal session (owner-only). Requires a Stripe
   * customer (409 without one); Stripe failure → 502.
   */
  static async createPortal(
    org: OrganizationSelect,
    callerUserId: string
  ): Promise<{ url: string }> {
    if (!StripeService.isConfigured()) {
      throw new ApiError(
        503,
        ApiCode.BILLING_NOT_CONFIGURED,
        "Billing is not configured in this environment"
      );
    }
    if (org.ownerUserId !== callerUserId) {
      throw new ApiError(
        403,
        ApiCode.BILLING_NOT_OWNER,
        "Only the organization owner can manage billing"
      );
    }
    if (!org.stripeCustomerId) {
      throw new ApiError(
        409,
        ApiCode.BILLING_NO_SUBSCRIPTION,
        "The organization has no billing account yet"
      );
    }

    try {
      return await StripeService.createPortalSession({
        customerId: org.stripeCustomerId,
        returnUrl: settingsUrl(),
      });
    } catch (err) {
      logger.error(
        { err, organizationId: org.id },
        "Stripe portal session creation failed"
      );
      throw new ApiError(
        502,
        ApiCode.BILLING_PORTAL_FAILED,
        "Could not open the billing portal — please try again"
      );
    }
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
