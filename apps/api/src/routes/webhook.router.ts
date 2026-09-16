import { Router, Request, Response, NextFunction } from "express";
import express from "express";
import { createLogger } from "../utils/logger.util.js";
import { ApiError } from "../services/http.service.js";
import { StripeService } from "../services/stripe.service.js";
import { BillingService } from "../services/billing.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";

const logger = createLogger({ module: "webhook-router" });

export const webhookRouter = Router();

// The Auth0 post-login sync webhook (`POST /api/webhooks/auth0/sync`) was
// removed in #577: on-first-token provisioning + the request-path per-login
// re-home (metadata.middleware) make it redundant and drop the Auth0-Action
// dependency. Operator teardown of the Action + AUTH0_WEBHOOK_SECRET is in
// docs/ENTERPRISE_SSO.runbook.md.

/** Subscription lifecycle events the tier writer handles (#176 D3); every
 *  other verified type is recorded as `ignored`. */
/** The event types this endpoint acts on. Exported (#385) so
 *  `stripe-webhook-events.test.ts` can pin it against the runbook that tells
 *  an operator which types to subscribe the live endpoint to — the two have
 *  no other connection. Do not un-export to "tidy up". */
export const STRIPE_SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

/**
 * @openapi
 * /api/webhooks/stripe:
 *   post:
 *     tags:
 *       - Webhooks
 *     summary: Stripe subscription billing webhook
 *     description: >
 *       Receives Stripe events (signature-verified over the exact raw bytes;
 *       JWT-exempt). `customer.subscription.{created,updated,deleted}` events
 *       converge the organization's tier to the subscription's current state,
 *       dedup'd per event id through the `stripe_events` table; other event
 *       types are recorded as `ignored`. Every non-error outcome — applied,
 *       noop, unmatched, duplicate, ignored — returns 200 so Stripe stops
 *       redelivering; processing failures return 500 so Stripe retries.
 *     parameters:
 *       - in: header
 *         name: stripe-signature
 *         required: true
 *         schema:
 *           type: string
 *         description: Stripe's HMAC signature header (t=…,v1=…)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: A Stripe event envelope (raw bytes, not re-parsed)
 *     responses:
 *       200:
 *         description: Event received (any non-error outcome)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 received:
 *                   type: boolean
 *                   example: true
 *       400:
 *         description: Missing or invalid Stripe signature
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       503:
 *         description: Stripe webhook secret not configured (Stripe retries)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       500:
 *         description: Processing failure (Stripe retries)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
webhookRouter.post(
  "/stripe",
  // Raw body — the signature is computed over the exact posted bytes; a
  // parse/re-serialize round-trip would break verification (case 25).
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!StripeService.isConfigured()) {
        return next(
          new ApiError(
            503,
            ApiCode.WEBHOOK_MISSING_SECRET,
            "Stripe webhook is not configured"
          )
        );
      }

      const signature = req.headers["stripe-signature"];
      if (!signature || typeof signature !== "string") {
        return next(
          new ApiError(
            400,
            ApiCode.WEBHOOK_MISSING_SIGNATURE,
            "Missing stripe-signature header"
          )
        );
      }

      // Fail-closed verification (throws ApiError 400 on mismatch).
      const event = StripeService.constructEvent(req.body as Buffer, signature);

      const outcome = STRIPE_SUBSCRIPTION_EVENTS.has(event.type)
        ? await BillingService.handleSubscriptionEvent(event)
        : await BillingService.recordIgnoredEvent(event);

      logger.info(
        { eventId: event.id, type: event.type, outcome },
        "Processed Stripe webhook event"
      );
      return res.status(200).json({ received: true });
    } catch (error) {
      if (error instanceof ApiError) return next(error);
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Stripe webhook processing failed"
      );
      return next(
        new ApiError(
          500,
          ApiCode.WEBHOOK_SYNC_FAILED,
          "Failed to process Stripe webhook event"
        )
      );
    }
  }
);
