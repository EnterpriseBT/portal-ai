import { Router, Request, Response, NextFunction } from "express";
import express from "express";
import { createLogger } from "../utils/logger.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { WebhookService } from "../services/webhook.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { verifyWebhookSignature } from "../middleware/webhook-auth.middleware.js";
import {
  Auth0WebhookPayloadSchema,
  type Auth0WebhookSyncResponse,
} from "@mcp-ui/core/contracts";

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
      const parsed = Auth0WebhookPayloadSchema.safeParse(req.body);
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
          logger.error(
            { error: error instanceof Error ? error.message : "Unknown error" },
            "Error syncing user from webhook"
          );
          throw new ApiError(
            500,
            ApiCode.WEBHOOK_SYNC_FAILED,
            "Failed to sync user from webhook"
          );
        }
      );

      return HttpService.success<Auth0WebhookSyncResponse>(res, result);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Webhook sync failed"
      );

      if (error instanceof ApiError) {
        return next(error);
      }
      return next(
        new ApiError(
          500,
          ApiCode.WEBHOOK_SYNC_FAILED,
          "Failed to sync user from webhook"
        )
      );
    }
  }
);
