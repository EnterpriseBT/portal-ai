/**
 * TierGrantService (#565) — the commercial write-path seam for
 * `organizations.tier`.
 *
 * `organizations.tier` is the single runtime entitlement source (read by
 * {@link TierService.resolveTier} → cost gate / entitlement / agent-turn
 * ceiling, with zero commerce dependency). It is written from a commercial
 * event in one place. This service lifts that write out of the Stripe webhook
 * so Stripe is one {@link TierGrantSource} among several (a cloud marketplace
 * is the next), each mapping a signed event to the same column write.
 *
 * A source only `resolve`s an event to an outcome; `apply` owns the D2
 * transaction (the dedup insert + the org UPDATE commit or roll back
 * together) and the outcome vocabulary. The dedup store is `commercial_events`
 * (generalized in #568), keyed on `(source, external_id)`.
 */

import type Stripe from "stripe";

import { DbService } from "./db.service.js";
import { StripeService } from "./stripe.service.js";
import { BillingService } from "./billing.service.js";
import {
  MarketplaceService,
  type MarketplaceNotification,
} from "./marketplace.service.js";
import { SystemUtilities } from "../utils/system.util.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "tier-grant" });

/** Outcome vocabulary — unchanged from the Stripe webhook handler. */
export type TierGrantOutcome =
  | "applied"
  | "noop"
  | "unmatched"
  | "duplicate"
  | "foreign";

/** The dedup row a source records for an event (a `commercial_events` row). */
type EventRow = ReturnType<typeof BillingService.eventRow>;

/** The column-generic partial write `apply` applies to `organizations`. */
type OrgUpdate = Parameters<
  typeof DbService.repository.organizations.update
>[1];

/**
 * What a source's `resolve` hands `apply` — a tagged union over the outcome:
 *
 * - `unmatched` — no org matches the event; record and resolve (never retry).
 * - `foreign` — the org tracks a different entitlement (#230; the marketplace
 *   rail since #939 — Stripe converges per customer instead); record + skip.
 * - `grant` — a real grant: the org to write, whether anything `changed`, the
 *   column write, and the dedup row (built with the applied/noop outcome).
 */
export type GrantResolution =
  | { outcome: "unmatched"; eventRow: EventRow }
  | { outcome: "foreign"; eventRow: EventRow }
  | {
      outcome: "grant";
      organizationId: string;
      changed: boolean;
      orgUpdate: OrgUpdate;
      eventRow: EventRow;
    };

/**
 * A source of tier grants — one commercial channel that maps a signed event
 * to a write against `organizations.tier`. Pure of the transaction: it
 * resolves an event; {@link TierGrantService.apply} does the writing.
 */
export interface TierGrantSource<E> {
  /** The event's dedup identity (Stripe `event.id` today). */
  idempotencyKey(event: E): string;
  /** Map the event to what to write, without touching the DB write path. */
  resolve(event: E): Promise<GrantResolution>;
}

export class TierGrantService {
  /**
   * Apply a resolved grant, source-agnostic. Preserves D2: the dedup insert
   * and the org UPDATE commit or roll back together, so a redelivered event
   * is always a single row and returns `duplicate`. `unmatched` / `foreign`
   * record their row and resolve without an org write.
   */
  static async apply<E>(
    source: TierGrantSource<E>,
    event: E
  ): Promise<TierGrantOutcome> {
    return TierGrantService.applyResolution(await source.resolve(event));
  }

  /**
   * The write half of {@link apply}, for a resolution built without an event
   * (#939's sync). The dedup row and the org write still commit together.
   */
  static async applyResolution(
    resolution: GrantResolution
  ): Promise<TierGrantOutcome> {
    if (
      resolution.outcome === "unmatched" ||
      resolution.outcome === "foreign"
    ) {
      const inserted = await DbService.repository.commercialEvents.insertIfNew(
        resolution.eventRow
      );
      return inserted ? resolution.outcome : "duplicate";
    }

    // grant — dedup row + org write commit or roll back together (D2).
    const { organizationId, changed, orgUpdate, eventRow } = resolution;
    return DbService.transaction(async (tx) => {
      const inserted = await DbService.repository.commercialEvents.insertIfNew(
        eventRow,
        tx
      );
      if (!inserted) return "duplicate";
      if (!changed) return "noop";

      await DbService.repository.organizations.update(
        organizationId,
        orgUpdate,
        tx
      );
      logger.info({ organizationId }, "Applied tier grant to organization");
      return "applied";
    });
  }
}

/**
 * StripeGrantSource (#565) — the Stripe subscription webhook as a
 * {@link TierGrantSource}. Holds the Stripe-specific `resolve`: the D2
 * converge re-fetch (out-of-order delivery can't regress the tier), the
 * customer→org lookup, per-customer convergence (#939, which replaced the
 * #230 foreign-subscription guard), and the pure
 * {@link BillingService.deriveTierFromSubscription} status table — untouched.
 */
export class StripeGrantSource implements TierGrantSource<Stripe.Event> {
  idempotencyKey(event: Stripe.Event): string {
    return event.id;
  }

  async resolve(event: Stripe.Event): Promise<GrantResolution> {
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
      return {
        outcome: "unmatched",
        eventRow: BillingService.eventRow(event, {
          stripeCustomerId: customerId,
          stripeSubscriptionId: sub.id,
          organizationId: null,
          resultingTier: null,
          outcome: "unmatched",
        }),
      };
    }

    // #939: the event says when to converge, never what. The plan follows
    // the customer's governing subscription, so a live duplicate is adopted
    // when the tracked one ends instead of being skipped as foreign (#230's
    // guard), and an ended duplicate can't clobber the tracked one.
    return BillingService.resolveCustomer(org, customerId, sub, (fields) =>
      BillingService.eventRow(event, fields)
    );
  }
}

/**
 * AwsMarketplaceGrantSource (#568) — an AWS Marketplace entitlement as a
 * {@link TierGrantSource}. Idempotency keys on the SNS `MessageId`; `resolve`
 * does a converge read of the current entitlement (not the notification
 * payload), resolves the single-tenant residency org, applies the #230-analog
 * foreign guard on `marketplaceEntitlementId`, and writes the tier + term.
 *
 * A lapsed / absent entitlement degrades the org to **read-only** by setting
 * `entitlementThrough` to now (derived read-only) — the tier is left
 * unchanged, so no data is lost; renewal restores the future term.
 */
export class AwsMarketplaceGrantSource implements TierGrantSource<MarketplaceNotification> {
  idempotencyKey(notification: MarketplaceNotification): string {
    return notification.MessageId;
  }

  async resolve(
    notification: MarketplaceNotification
  ): Promise<GrantResolution> {
    // Converge read — the authoritative current entitlement, not the payload.
    const entitlement = await MarketplaceService.getEntitlement();

    // Single-tenant residency: the entitlement grants to the install's one org.
    const org = await DbService.repository.organizations.findSole();
    if (!org) {
      logger.warn(
        { messageId: notification.MessageId },
        "Marketplace event with no sole organization; recording unmatched"
      );
      return {
        outcome: "unmatched",
        eventRow: MarketplaceService.eventRow(notification, {
          organizationId: null,
          resultingTier: null,
          outcome: "unmatched",
        }),
      };
    }

    // Foreign-guard (#230 analog): once an org tracks an entitlement, only that
    // entitlement may move its state.
    if (
      entitlement &&
      org.marketplaceEntitlementId &&
      org.marketplaceEntitlementId !== entitlement.customerIdentifier
    ) {
      logger.warn(
        {
          messageId: notification.MessageId,
          organizationId: org.id,
          tracked: org.marketplaceEntitlementId,
          event: entitlement.customerIdentifier,
        },
        "Ignoring a foreign marketplace entitlement (org tracks a different one)"
      );
      return {
        outcome: "foreign",
        eventRow: MarketplaceService.eventRow(notification, {
          organizationId: org.id,
          resultingTier: null,
          outcome: "foreign",
        }),
      };
    }

    // Term lapsed / unsubscribed: flip read-only via a now-dated term, tier
    // UNCHANGED (never data loss). Idempotent — a no-op once already expired,
    // and a no-op for an org that was never marketplace-granted.
    if (!entitlement) {
      const now = Date.now();
      const wasGranted =
        org.marketplaceEntitlementId != null || org.entitlementThrough != null;
      const alreadyExpired =
        org.entitlementThrough != null && org.entitlementThrough <= now;
      const changed = wasGranted && !alreadyExpired;
      return {
        outcome: "grant",
        organizationId: org.id,
        changed,
        orgUpdate: {
          entitlementThrough: now,
          updated: Date.now(),
          updatedBy: SystemUtilities.id.system,
        },
        eventRow: MarketplaceService.eventRow(notification, {
          organizationId: org.id,
          resultingTier: null,
          outcome: changed ? "applied" : "noop",
        }),
      };
    }

    const tier = MarketplaceService.dimensionToTier(entitlement.dimension);
    const changed =
      org.tier !== tier ||
      org.marketplaceEntitlementId !== entitlement.customerIdentifier ||
      org.entitlementThrough !== entitlement.expirationDate;

    return {
      outcome: "grant",
      organizationId: org.id,
      changed,
      orgUpdate: {
        tier,
        marketplaceEntitlementId: entitlement.customerIdentifier,
        entitlementThrough: entitlement.expirationDate,
        updated: Date.now(),
        updatedBy: SystemUtilities.id.system,
      },
      eventRow: MarketplaceService.eventRow(notification, {
        organizationId: org.id,
        resultingTier: changed ? tier : null,
        outcome: changed ? "applied" : "noop",
      }),
    };
  }
}
