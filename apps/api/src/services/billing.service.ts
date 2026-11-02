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
import { and, eq, isNull, sql } from "drizzle-orm";
import { CommercialEventModelFactory } from "@portalai/core/models";
import type {
  BillingSyncResponse,
  BillingTier,
} from "@portalai/core/contracts";
import { DbService } from "./db.service.js";
import { StripeService } from "./stripe.service.js";
import { TierService } from "./tier.service.js";
import { RebuildDispatchService } from "./rebuild-dispatch.service.js";
import { BILLING_CHECKOUT_LOCK_NAMESPACE } from "./sync-lock.service.js";
import { ApiError } from "./http.service.js";
import {
  PermissionService,
  type PermissionContext,
} from "./permission.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { environment } from "../environment.js";
import { SystemUtilities } from "../utils/system.util.js";
import { createLogger } from "../utils/logger.util.js";
import type { OrganizationSelect } from "../db/schema/zod.js";
import { organizations } from "../db/schema/index.js";
import type { DbClient } from "../db/repositories/base.repository.js";
import type { GrantResolution } from "./tier-grant.service.js";

const logger = createLogger({ module: "billing-service" });

/** Stripe price-catalog events (#311). Recorded `ignored` like any other
 *  unhandled type — they change no tier state — but they DO move amounts
 *  the marketing site has baked into static HTML, so each one first-delivery
 *  fires a site rebuild.
 *
 *  Exported (#385) so the webhook-event guard can assert the runbook lists
 *  these alongside the subscription types. They change no tier state, which
 *  makes them the ones an operator is most likely to leave off the live
 *  endpoint's subscription — and then the pricing page silently never
 *  republishes. Do not un-export to "tidy up". */
export const STRIPE_PRICE_EVENTS = new Set([
  "price.created",
  "price.updated",
  "price.deleted",
]);

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

/** #939: a subscription in any of these states refuses a new checkout —
 *  everything but the two that can never bill again. */
export const BLOCKING_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "trialing",
  "past_due",
  "incomplete",
  "unpaid",
  "paused",
]);

/** #939: the states in which a subscription can govern the org's plan. */
export const GOVERNING_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "trialing",
  "past_due",
]);

/** The fields a `commercial_events` row carries beyond its event identity. */
export interface EventRowFields {
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  organizationId: string | null;
  resultingTier: string | null;
  outcome:
    | "applied"
    | "noop"
    | "unmatched"
    | "ignored"
    | "foreign"
    | "duplicate_subscription";
}

type EventRow = ReturnType<typeof BillingService.eventRow>;

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
   * - `incomplete` → keep `currentTier` and don't track it (#939): Stripe
   *   creates it before the first payment, and tracking it would show the
   *   org as subscribed for a payment that may never come. Its `updated`
   *   event on payment adopts it then.
   * - Anything else (`paused`, future statuses) → keep `currentTier`;
   *   never grants, never revokes.
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

    if (sub.status === "incomplete") {
      return { tier: currentTier, subscriptionLive: false, anchorDay: null };
    }

    // past_due (Stripe dunning owns grace) and any unrecognized status:
    // hold the line — keep the current tier and the anchor.
    return { tier: currentTier, subscriptionLive: true, anchorDay };
  }

  /**
   * PURE (#939) — which of a customer's subscriptions governs the org's plan:
   * the tracked one while its status governs, else the governing one created
   * most recently. With none governing, the tracked subscription (or the
   * `fallback`, the event's) is the basis, so its end reverts the plan
   * exactly as before. A listed copy wins over the fallback, which is the
   * same subscription read earlier. `governingCount` > 1 is a duplicate.
   */
  static selectGoverningSubscription(
    subscriptions: Stripe.Subscription[],
    trackedId: string | null,
    fallback: Stripe.Subscription | null
  ): { basis: Stripe.Subscription | null; governingCount: number } {
    const governing = subscriptions.filter((sub) =>
      GOVERNING_SUBSCRIPTION_STATUSES.has(sub.status)
    );
    const tracked = trackedId
      ? (subscriptions.find((sub) => sub.id === trackedId) ??
        (fallback?.id === trackedId ? fallback : undefined))
      : undefined;

    let basis: Stripe.Subscription | null;
    if (tracked && GOVERNING_SUBSCRIPTION_STATUSES.has(tracked.status)) {
      basis = tracked;
    } else if (governing.length > 0) {
      basis = governing.reduce((newest, sub) =>
        sub.created > newest.created ? sub : newest
      );
    } else {
      basis =
        tracked ??
        (fallback
          ? (subscriptions.find((sub) => sub.id === fallback.id) ?? fallback)
          : null);
    }
    return { basis, governingCount: governing.length };
  }

  /**
   * #939: converge an org from its customer's current subscriptions. The
   * caller supplies how its ledger row is identified (`row`): a webhook keys
   * it on the Stripe event, a sync on its own id. A caller that already
   * listed the customer's `subscriptions` passes them, and one inside a
   * transaction passes its `client`, so the price index doesn't take a
   * second pooled connection. Builds the resolution only; the caller writes
   * it.
   */
  static async resolveCustomer(
    org: Pick<
      OrganizationSelect,
      "id" | "tier" | "stripeSubscriptionId" | "billingAnchorDay"
    >,
    customerId: string,
    fallback: Stripe.Subscription | null,
    row: (fields: EventRowFields) => EventRow,
    subscriptions?: Stripe.Subscription[],
    client?: DbClient
  ): Promise<GrantResolution & { outcome: "grant" }> {
    subscriptions ??= await StripeService.listSubscriptions(customerId);
    const { basis, governingCount } =
      BillingService.selectGoverningSubscription(
        subscriptions,
        org.stripeSubscriptionId,
        fallback
      );

    const derived: DerivedTierState = basis
      ? BillingService.deriveTierFromSubscription(
          {
            status: basis.status,
            priceId: basis.items.data[0]?.price?.id ?? null,
            billingCycleAnchor: basis.billing_cycle_anchor,
          },
          await DbService.repository.tiers.priceIndex(client),
          org.tier
        )
      : // Nothing to go by (a sync for a customer with no subscription, or
        // one whose tracked subscription isn't listed): leave the org as it
        // is. Only a subscription's own end reverts the plan, so a tier an
        // operator set by hand survives.
        {
          tier: org.tier,
          subscriptionLive: org.stripeSubscriptionId != null,
          anchorDay: org.billingAnchorDay,
        };

    const nextSubscriptionId = basis
      ? derived.subscriptionLive
        ? basis.id
        : null
      : org.stripeSubscriptionId;
    const changed =
      org.tier !== derived.tier ||
      org.stripeSubscriptionId !== nextSubscriptionId ||
      org.billingAnchorDay !== derived.anchorDay;

    const duplicate = governingCount > 1;
    if (duplicate) {
      logger.warn(
        {
          organizationId: org.id,
          customerId,
          governingSubscriptionId: basis?.id ?? null,
          liveSubscriptionIds: subscriptions
            .filter((sub) => GOVERNING_SUBSCRIPTION_STATUSES.has(sub.status))
            .map((sub) => sub.id),
        },
        "Customer has more than one live Stripe subscription — cancel the extra one in Stripe"
      );
    }

    return {
      outcome: "grant",
      organizationId: org.id,
      changed,
      orgUpdate: {
        tier: derived.tier,
        stripeSubscriptionId: nextSubscriptionId,
        billingAnchorDay: derived.anchorDay,
        updated: Date.now(),
        updatedBy: SystemUtilities.id.system,
      },
      eventRow: row({
        stripeCustomerId: customerId,
        stripeSubscriptionId: basis?.id ?? null,
        organizationId: org.id,
        resultingTier: changed ? derived.tier : null,
        outcome: duplicate
          ? "duplicate_subscription"
          : changed
            ? "applied"
            : "noop",
      }),
    };
  }

  /**
   * #939: `POST /api/billing/sync` — converge the caller's org from Stripe
   * now, instead of waiting for a webhook that may be late or failing. The
   * checkout return page calls it. Stripe is read before the org row is
   * locked, so the lock never waits on Stripe; the plan is then derived from
   * the locked row, and a change writes a `billing.sync` ledger row with it.
   */
  static async syncFromStripe(
    org: OrganizationSelect,
    caller: PermissionContext
  ): Promise<BillingSyncResponse> {
    if (!StripeService.isConfigured()) {
      throw new ApiError(
        503,
        ApiCode.BILLING_NOT_CONFIGURED,
        "Billing is not configured in this environment"
      );
    }
    await PermissionService.check(caller, "billing.manage");
    const customerId = org.stripeCustomerId;
    if (!customerId) return { tier: org.tier, subscription: "none" };

    let subscriptions: Stripe.Subscription[];
    try {
      subscriptions = await StripeService.listSubscriptions(customerId);
    } catch (err) {
      logger.error(
        { err, organizationId: org.id },
        "Stripe subscription list failed during billing sync"
      );
      throw new ApiError(
        502,
        ApiCode.BILLING_SYNC_FAILED,
        "Could not reach Stripe — your plan will update shortly"
      );
    }

    const tier = await DbService.transaction(async (tx) => {
      const locked =
        (await DbService.repository.organizations.findByIdForUpdate(
          org.id,
          tx
        )) ?? org;
      const resolution = await BillingService.resolveCustomer(
        locked,
        customerId,
        null,
        BillingService.syncRow,
        subscriptions,
        tx
      );
      if (!resolution.changed) return locked.tier;
      await DbService.repository.commercialEvents.insertIfNew(
        resolution.eventRow,
        tx
      );
      await DbService.repository.organizations.update(
        org.id,
        resolution.orgUpdate,
        tx
      );
      logger.info(
        { organizationId: org.id, tier: resolution.orgUpdate.tier },
        "Billing sync converged the organization's plan from Stripe"
      );
      return resolution.orgUpdate.tier as string;
    });

    const subscription = subscriptions.some((sub) =>
      GOVERNING_SUBSCRIPTION_STATUSES.has(sub.status)
    )
      ? "live"
      : subscriptions.some((sub) =>
            BLOCKING_SUBSCRIPTION_STATUSES.has(sub.status)
          )
        ? "pending"
        : "none";
    return { tier, subscription };
  }

  /** #939: a pull convergence's ledger row. It has no Stripe event, so it
   *  gets its own id; it's written only when it changes the org, under the
   *  org row lock, so there is nothing to dedupe. */
  static syncRow(fields: EventRowFields): EventRow {
    return new CommercialEventModelFactory()
      .create(SystemUtilities.id.system)
      .update({
        source: "stripe",
        externalId: `sync:${SystemUtilities.id.v4.generate()}`,
        type: "billing.sync",
        ...fields,
      })
      .parse();
  }

  /**
   * Record a signature-verified event of a type we don't handle —
   * dedup'd like everything else, so redeliveries stay one row.
   *
   * `price.*` events keep this exact outcome (`ignored`) — no tier
   * convergence happens here; `portalops tier apply` owns price↔tier
   * pointing. They additionally fire a site rebuild (#311) so the marketing
   * site's baked amounts catch up with Stripe. The dispatch runs only on
   * first delivery (a redelivery is a `duplicate` and would rebuild for
   * nothing) and can never fail the webhook — see `RebuildDispatchService`.
   */
  static async recordIgnoredEvent(
    event: Stripe.Event
  ): Promise<"ignored" | "duplicate"> {
    const obj = event.data.object as {
      customer?: unknown;
      subscription?: unknown;
    };
    const inserted = await DbService.repository.commercialEvents.insertIfNew(
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

    if (inserted && STRIPE_PRICE_EVENTS.has(event.type)) {
      // Awaited for determinism, but guarded: the dispatch service swallows
      // its own failures, and this `.catch` makes the webhook immune even if
      // that contract is ever broken upstream. A rejection here would 500 a
      // successfully-recorded event and provoke a Stripe retry.
      await RebuildDispatchService.fireSiteRebuild(
        `stripe:${event.type}`
      ).catch((error) => {
        logger.warn(
          {
            eventId: event.id,
            type: event.type,
            error: error instanceof Error ? error.message : "Unknown error",
          },
          "Site-rebuild dispatch threw; webhook unaffected"
        );
      });
    }

    return inserted ? "ignored" : "duplicate";
  }

  /**
   * The self-serve plan list (`GET /api/billing/tiers`): `selectable` rows
   * **visible to `organizationId`** (public rows + this org's private custom
   * tiers, #241) mapped to whole-tier objects. Each carries the full assembled
   * policy (#241), the operator blurb, and the single-source-of-truth `cta`.
   * `cta` stays truthful under a Stripe outage — only `price` null-degrades.
   */
  static async listBillingTiers(
    organizationId: string
  ): Promise<BillingTier[]> {
    const rows =
      await DbService.repository.tiers.findSelectableForOrg(organizationId);
    return Promise.all(
      rows.map(async (row) => ({
        slug: row.slug,
        displayName: row.displayName,
        policy: TierService.tierPolicyFromRow(row),
        description: row.description,
        cta: row.cta as BillingTier["cta"],
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
   * exists+selectable 404 → priced 400 → under the per-org checkout lock
   * (#939): no live subscription in Stripe 409 → expire open sessions or
   * lazily create the customer (D7) → session. Stripe failure → 502.
   */
  static async createCheckout(
    org: OrganizationSelect,
    caller: PermissionContext,
    tierSlug: string
  ): Promise<{ url: string }> {
    if (!StripeService.isConfigured()) {
      throw new ApiError(
        503,
        ApiCode.BILLING_NOT_CONFIGURED,
        "Billing is not configured in this environment"
      );
    }
    // Gated on `billing.manage` (#576); a refusal is PERMISSION_DENIED (#711),
    // preserving the contract; runs after the configured-503 guard so the
    // documented order (configured → owner) is unchanged.
    await PermissionService.check(caller, "billing.manage");
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

    const priceId = tier.stripePriceId;
    // #939: one checkout at a time per org, for the whole read-Stripe →
    // expire → create sequence; otherwise two tabs each find nothing and
    // each mint a payable session. A transaction-scoped advisory lock, not
    // the org row lock, so renames and default-station writes don't wait on
    // it — except on a first checkout, where storing the customer id
    // row-locks the org until the session call returns (about a second). The transaction commits whatever it wrote: a Stripe failure is
    // returned, not thrown, so a new customer id persists (D7) and a retry
    // never re-creates the customer.
    const result = await DbService.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${BILLING_CHECKOUT_LOCK_NAMESPACE}::int, hashtext(${org.id}))`
      );
      // The row as of the lock: a checkout that held it before us may have
      // stored the customer, and the webhook may have stored a subscription.
      const current =
        (await DbService.repository.organizations.findById(org.id, tx)) ?? org;
      if (current.stripeSubscriptionId) {
        throw new ApiError(
          409,
          ApiCode.BILLING_ALREADY_SUBSCRIBED,
          "The organization already has a subscription — manage it in the billing portal"
        );
      }

      try {
        let customerId = current.stripeCustomerId;
        let createdNow = false;
        if (!customerId) {
          ({ customerId, created: createdNow } =
            await BillingService.createAndStoreCustomer(current, caller, tx));
        }
        if (!createdNow) {
          // The newest checkout wins: expire the older tabs' sessions first,
          // so none can complete after the subscription check below. One
          // that can no longer be expired was just paid — refuse.
          for (const id of await StripeService.listOpenCheckoutSessions(
            customerId
          )) {
            if (!(await StripeService.expireCheckoutSession(id))) {
              return { refused: true as const };
            }
          }
          // #939: the column is written by the webhook, which may be late or
          // failing — Stripe's own state is what says the org already pays.
          const subscriptions =
            await StripeService.listSubscriptions(customerId);
          if (
            subscriptions.some((sub) =>
              BLOCKING_SUBSCRIPTION_STATUSES.has(sub.status)
            )
          ) {
            return { refused: true as const };
          }
        }

        const session = await StripeService.createCheckoutSession({
          customerId,
          priceId,
          // #939: land on the billing tab, where a still-processing payment
          // is shown.
          successUrl: `${settingsUrl()}?tab=billing&billing=success`,
          cancelUrl: `${settingsUrl()}?tab=billing&billing=cancelled`,
          organizationId: org.id,
        });
        return { url: session.url };
      } catch (failure) {
        return { failure };
      }
    });

    if ("refused" in result) {
      throw new ApiError(
        409,
        ApiCode.BILLING_ALREADY_SUBSCRIBED,
        "The organization already has a subscription in Stripe — manage it in the billing portal"
      );
    }
    if ("failure" in result) {
      logger.error(
        { err: result.failure, organizationId: org.id, tierSlug },
        "Stripe checkout session creation failed"
      );
      throw new ApiError(
        502,
        ApiCode.BILLING_CHECKOUT_FAILED,
        "Could not start checkout — please try again"
      );
    }
    return { url: result.url };
  }

  /**
   * Lazy customer creation (D7), under the checkout lock. The id is stored
   * only while none is (#939): a writer that skipped the lock can't orphan a
   * customer silently — the loser deletes its own and uses the stored one.
   */
  private static async createAndStoreCustomer(
    org: OrganizationSelect,
    caller: PermissionContext,
    tx: DbClient
  ): Promise<{ customerId: string; created: boolean }> {
    const { id: customerId } = await StripeService.createCustomer({
      organizationId: org.id,
      name: org.name,
    });
    const [stored] = await DbService.repository.organizations.updateWhere(
      and(
        eq(organizations.id, org.id),
        isNull(organizations.stripeCustomerId)
      )!,
      {
        stripeCustomerId: customerId,
        updated: Date.now(),
        updatedBy: caller.userId,
      },
      tx
    );

    if (!stored) {
      logger.warn(
        { organizationId: org.id, stripeCustomerId: customerId },
        "Another checkout stored a Stripe customer first — deleting the one this checkout created"
      );
      await StripeService.deleteCustomer(customerId).catch((error) => {
        logger.warn(
          {
            organizationId: org.id,
            stripeCustomerId: customerId,
            error: error instanceof Error ? error.message : "Unknown error",
          },
          "Failed to delete an unused Stripe customer — delete it manually"
        );
      });
      const winner = await DbService.repository.organizations.findById(
        org.id,
        tx
      );
      if (!winner?.stripeCustomerId) {
        throw new Error(
          "Organization has no Stripe customer after a lost write"
        );
      }
      // An existing customer: the caller runs its subscription and open-
      // session checks against it.
      return { customerId: winner.stripeCustomerId, created: false };
    }

    // #938: a rename committed since `org` was read found no customer to
    // sync. This UPDATE waits for a rename holding the row and returns the
    // committed name, so a mismatch here is exactly that case; a rename
    // committing after it sees the customer id and syncs itself. The name
    // goes to the customer this checkout created, never one re-read from
    // the row, which a concurrent first checkout may have overwritten.
    // Best effort, like the rename's own sync: a failure never fails the
    // checkout.
    if (stored.name !== org.name) {
      logger.info(
        { organizationId: org.id, stripeCustomerId: customerId },
        "Organization renamed during customer creation — syncing the Stripe customer name"
      );
      try {
        await StripeService.updateCustomerName(customerId, stored.name);
      } catch (error) {
        logger.warn(
          {
            organizationId: org.id,
            stripeCustomerId: customerId,
            error: error instanceof Error ? error.message : "Unknown error",
          },
          "Failed to update the Stripe customer name after an organization rename — reconcile manually"
        );
      }
    }
    return { customerId, created: true };
  }

  /**
   * Mint a hosted Billing Portal session (owner-only). Requires a Stripe
   * customer (409 without one); Stripe failure → 502.
   */
  static async createPortal(
    org: OrganizationSelect,
    caller: PermissionContext,
    tierSlug?: string
  ): Promise<{ url: string }> {
    if (!StripeService.isConfigured()) {
      throw new ApiError(
        503,
        ApiCode.BILLING_NOT_CONFIGURED,
        "Billing is not configured in this environment"
      );
    }
    // Gated on `billing.manage` (#576); a refusal is PERMISSION_DENIED (#711),
    // preserving the contract; runs after the configured-503 guard so the
    // documented order (configured → owner) is unchanged.
    await PermissionService.check(caller, "billing.manage");
    if (!org.stripeCustomerId) {
      throw new ApiError(
        409,
        ApiCode.BILLING_NO_SUBSCRIPTION,
        "The organization has no billing account yet"
      );
    }

    // #260: a target tier opens the portal's subscription-update flow —
    // requires a live subscription + a selectable, priced target tier (the
    // same guards as checkout). The webhook reconciles the tier on confirm.
    let subscriptionUpdate:
      | { subscriptionId: string; itemId: string; priceId: string }
      | undefined;
    if (tierSlug) {
      if (!org.stripeSubscriptionId) {
        throw new ApiError(
          409,
          ApiCode.BILLING_NO_SUBSCRIPTION,
          "The organization has no active subscription to change"
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
          `The ${tier.displayName} plan cannot be switched to`
        );
      }
      const sub = await StripeService.fetchSubscription(
        org.stripeSubscriptionId
      );
      const itemId = sub.items.data[0]?.id;
      if (!itemId) {
        throw new ApiError(
          502,
          ApiCode.BILLING_PORTAL_FAILED,
          "Could not resolve the current subscription item"
        );
      }
      subscriptionUpdate = {
        subscriptionId: org.stripeSubscriptionId,
        itemId,
        priceId: tier.stripePriceId,
      };
    }

    try {
      return await StripeService.createPortalSession({
        customerId: org.stripeCustomerId,
        returnUrl: settingsUrl(),
        ...(subscriptionUpdate ? { subscriptionUpdate } : {}),
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

  /**
   * Build a `commercial_events` dedup row for the Stripe rail (#176/#565).
   * Public so `StripeGrantSource` records the same rows this service's
   * `recordIgnoredEvent` does. The row is `source: "stripe"`, keyed on the
   * Stripe `event.id` as its `externalId`.
   */
  static eventRow(event: Stripe.Event, fields: EventRowFields) {
    return new CommercialEventModelFactory()
      .create(SystemUtilities.id.system)
      .update({
        source: "stripe",
        externalId: event.id,
        type: event.type,
        ...fields,
      })
      .parse();
  }
}
