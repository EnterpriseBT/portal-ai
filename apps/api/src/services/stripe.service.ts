/**
 * StripeService (#176) — the Stripe SDK wrapper and the ONLY file in the
 * codebase that imports `stripe`. Everything else (webhook handler, billing
 * endpoints, org delete) goes through these statics so tests mock one seam
 * and CI never needs keys.
 *
 * See `docs/STRIPE_SUBSCRIPTION_BILLING.spec.md` (D4, Q6/Q7).
 */

import Stripe from "stripe";
import { environment } from "../environment.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "stripe-service" });

/** Pinned Stripe API version — matches the installed SDK major (v22), so
 *  webhook payload shapes never drift under us on a Stripe-side default
 *  change. Bump deliberately, with the SDK. */
export const STRIPE_API_VERSION = "2026-06-24.dahlia";

/** Price display cache TTL (Q7): Stripe is the single price authority; a
 *  60 s in-process cache keeps the plan list off the Stripe API hot path. */
const PRICE_CACHE_TTL_MS = 60_000;

export interface PriceDisplay {
  unitAmount: number; // cents
  currency: string;
  interval: "month" | "year";
}

interface PriceCacheEntry {
  price: PriceDisplay;
  expires: number;
}

export class StripeService {
  private static _client: Stripe | null = null;
  private static priceCache = new Map<string, PriceCacheEntry>();

  /** Both env keys present — the guard every billing surface checks first. */
  static isConfigured(): boolean {
    return Boolean(
      environment.STRIPE_SECRET_KEY && environment.STRIPE_WEBHOOK_SECRET
    );
  }

  /** Lazy singleton, pinned API version. Throws if unconfigured — callers
   *  guard with {@link isConfigured} (503 `BILLING_NOT_CONFIGURED` /
   *  `WEBHOOK_MISSING_SECRET`). */
  static client(): Stripe {
    if (!StripeService._client) {
      if (!environment.STRIPE_SECRET_KEY) {
        throw new Error("Stripe is not configured (STRIPE_SECRET_KEY unset)");
      }
      StripeService._client = new Stripe(environment.STRIPE_SECRET_KEY, {
        apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
      });
    }
    return StripeService._client;
  }

  /**
   * Verify a webhook payload's signature over the EXACT raw bytes and parse
   * it. Fail-closed: any verification failure → 400
   * `WEBHOOK_INVALID_SIGNATURE` (a dropped genuine event is retried by
   * Stripe; a forged accepted event would write tiers).
   */
  static constructEvent(rawBody: Buffer, signature: string): Stripe.Event {
    try {
      return StripeService.client().webhooks.constructEvent(
        rawBody,
        signature,
        environment.STRIPE_WEBHOOK_SECRET as string
      );
    } catch (err) {
      logger.warn({ err }, "Stripe webhook signature verification failed");
      throw new ApiError(
        400,
        ApiCode.WEBHOOK_INVALID_SIGNATURE,
        "Stripe webhook signature verification failed"
      );
    }
  }

  /** The converge read (D2): the subscription's CURRENT state, never the
   *  event snapshot. */
  static async fetchSubscription(id: string): Promise<Stripe.Subscription> {
    return StripeService.client().subscriptions.retrieve(id);
  }

  /** Create the org's Stripe customer (D7 — lazily, at first checkout).
   *  `metadata.organizationId` makes dashboard→org reconciliation trivial. */
  static async createCustomer(args: {
    organizationId: string;
    name: string;
  }): Promise<{ id: string }> {
    const customer = await StripeService.client().customers.create({
      name: args.name,
      metadata: { organizationId: args.organizationId },
    });
    return { id: customer.id };
  }

  /** Mint a hosted Checkout session (D4 — SAQ-A; the webhook, never this
   *  redirect, writes the tier). */
  static async createCheckoutSession(args: {
    customerId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    organizationId: string;
  }): Promise<{ url: string }> {
    const session = await StripeService.client().checkout.sessions.create({
      mode: "subscription",
      customer: args.customerId,
      line_items: [{ price: args.priceId, quantity: 1 }],
      success_url: args.successUrl,
      cancel_url: args.cancelUrl,
      metadata: { organizationId: args.organizationId },
    });
    if (!session.url) {
      throw new Error("Stripe checkout session returned no URL");
    }
    return { url: session.url };
  }

  /** Mint a hosted Billing Portal session (plan changes, payment methods,
   *  cancellation — all Stripe-hosted). */
  static async createPortalSession(args: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    const session = await StripeService.client().billingPortal.sessions.create({
      customer: args.customerId,
      return_url: args.returnUrl,
    });
    return { url: session.url };
  }

  /** Immediate cancel — the org-delete path (Q4, best-effort at the call
   *  site; this throws so the caller can log-and-continue). */
  static async cancelSubscription(id: string): Promise<void> {
    await StripeService.client().subscriptions.cancel(id);
  }

  /**
   * Display price for a tier's `stripe_price_id`, TTL-cached (Q7). Returns
   * `null` — never throws — when Stripe is unreachable or the price isn't a
   * plain recurring amount: the plan list renders without the number, and
   * `purchasable` stays truthful. Failures are not cached (next read
   * retries).
   */
  static async getPrice(
    priceId: string,
    now: number = Date.now()
  ): Promise<PriceDisplay | null> {
    const hit = StripeService.priceCache.get(priceId);
    if (hit && hit.expires > now) return hit.price;

    try {
      const price = await StripeService.client().prices.retrieve(priceId);
      const interval = price.recurring?.interval;
      if (
        price.unit_amount == null ||
        (interval !== "month" && interval !== "year")
      ) {
        logger.warn(
          { priceId, interval },
          "Stripe price is not a recurring month/year amount; degrading display"
        );
        return null;
      }
      const display: PriceDisplay = {
        unitAmount: price.unit_amount,
        currency: price.currency,
        interval,
      };
      StripeService.priceCache.set(priceId, {
        price: display,
        expires: now + PRICE_CACHE_TTL_MS,
      });
      return display;
    } catch (err) {
      logger.warn(
        { err, priceId },
        "Stripe price fetch failed; degrading display"
      );
      return null;
    }
  }

  /** Test seam: drop the lazy client + price cache (env stubs change
   *  between cases). */
  static resetForTests(): void {
    StripeService._client = null;
    StripeService.priceCache.clear();
  }
}
