import { Router, Request, Response, NextFunction } from "express";
import express from "express";
import { createLogger } from "../utils/logger.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { WebhookService } from "../services/webhook.service.js";
import { StripeService } from "../services/stripe.service.js";
import { BillingService } from "../services/billing.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { verifyWebhookSignature } from "../middleware/webhook-auth.middleware.js";
import {
  Auth0PostLoginWebhookPayloadSchema,
  type Auth0PostLoginWebhookSyncResponse,
} from "@portalai/core/contracts";

const logger = createLogger({ module: "webhook-router" });

export const webhookRouter = Router();

/**
 * Custom JSON parser that preserves the raw body for HMAC verification.
 * Must be applied before `verifyWebhookSignature`.
 */
const jsonWithRawBody = express.json({
  verify: (req: Request, _res: Response, buf: Buffer) => {
    (req as Request).rawBody = buf;
  },
});

/**
 * @openapi
 * /api/webhooks/auth0/sync:
 *   post:
 *     tags:
 *       - Webhooks
 *     summary: Sync user from Auth0 webhook
 *     description: >
 *       Receives Auth0 Action webhook events (post_login, post_user_registration)
 *       and creates or updates the corresponding user in the local database.
 *       Authenticated via HMAC-SHA256 signature verification.
 *     parameters:
 *       - in: header
 *         name: X-Auth0-Webhook-Signature
 *         required: true
 *         schema:
 *           type: string
 *         description: "HMAC-SHA256 signature in the format: sha256=<hex>"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - event_type
 *               - user
 *               - timestamp
 *             properties:
 *               event_type:
 *                 type: string
 *                 enum: [post_login, post_user_registration]
 *               user:
 *                 type: object
 *                 required:
 *                   - user_id
 *                 properties:
 *                   user_id:
 *                     type: string
 *                   email:
 *                     type: string
 *                   name:
 *                     type: string
 *                   picture:
 *                     type: string
 *               timestamp:
 *                 type: string
 *     responses:
 *       200:
 *         description: User synced successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   type: object
 *                   properties:
 *                     action:
 *                       type: string
 *                       enum: [created, updated, unchanged]
 *                     userId:
 *                       type: string
 *       401:
 *         description: Unauthorized - Missing or invalid webhook signature
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       400:
 *         description: Bad Request - Invalid webhook payload
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
webhookRouter.post(
  "/auth0/sync",
  jsonWithRawBody,
  verifyWebhookSignature,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = Auth0PostLoginWebhookPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.WEBHOOK_INVALID_PAYLOAD,
            "Invalid webhook payload"
          )
        );
      }

      logger.info(
        { eventType: "post_login", userId: parsed.data.user_id },
        "Processing Auth0 webhook"
      );

      const result = await WebhookService.syncUser(parsed.data).catch(
        (error) => {
          throw new ApiError(
            500,
            ApiCode.WEBHOOK_SYNC_FAILED,
            error instanceof Error
              ? error.message
              : "Failed to sync user from webhook"
          );
        }
      );

      return HttpService.success<Auth0PostLoginWebhookSyncResponse>(
        res,
        result
      );
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Webhook sync failed"
      );
      return next(
        new ApiError(
          500,
          ApiCode.WEBHOOK_SYNC_FAILED,
          error instanceof Error
            ? error.message
            : "Failed to sync user from webhook"
        )
      );
    }
  }
);

/** Subscription lifecycle events the tier writer handles (#176 D3); every
 *  other verified type is recorded as `ignored`. */
const STRIPE_SUBSCRIPTION_EVENTS = new Set([
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
