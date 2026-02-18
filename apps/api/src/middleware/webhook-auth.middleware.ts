import { Request, Response, NextFunction } from "express";
import { environment } from "../environment.js";
import { ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { createLogger } from "../utils/logger.util.js";
import crypto from "crypto";

const logger = createLogger({ module: "webhook-auth" });

/**
 * Express middleware that verifies Auth0 webhook HMAC-SHA256 signatures.
 *
 * Expects the `X-Auth0-Webhook-Signature` header in the format `sha256=<hex>`.
 * The raw request body (captured by the custom JSON parser's `verify` callback)
 * must be available on `req.rawBody`.
 */
export function verifyWebhookSignature(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const secret = environment.AUTH0_WEBHOOK_SECRET;
  if (!secret) {
    logger.error("AUTH0_WEBHOOK_SECRET is not configured");
    return next(
      new ApiError(
        500,
        ApiCode.WEBHOOK_MISSING_SECRET,
        "Webhook secret is not configured"
      )
    );
  }

  const signatureHeader = req.headers["x-auth0-webhook-signature"] as string;
  if (!signatureHeader) {
    return next(
      new ApiError(
        401,
        ApiCode.WEBHOOK_MISSING_SIGNATURE,
        "Missing X-Auth0-Webhook-Signature header"
      )
    );
  }

  if (!signatureHeader.startsWith("sha256=")) {
    return next(
      new ApiError(
        401,
        ApiCode.WEBHOOK_INVALID_SIGNATURE,
        "Invalid webhook signature format"
      )
    );
  }

  const payload = req.rawBody;
  if (!payload) {
    return next(
      new ApiError(
        401,
        ApiCode.WEBHOOK_INVALID_SIGNATURE,
        "Unable to verify signature: missing raw body"
      )
    );
  }

  const signature = signatureHeader.slice(7);
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  const trusted = Buffer.from(expectedSignature, "ascii");
  const untrusted = Buffer.from(signature, "ascii");

  if (!crypto.timingSafeEqual(trusted, untrusted)) {
    logger.error("Error comparing webhook signatures");
    return next(
      new ApiError(
        401,
        ApiCode.WEBHOOK_INVALID_SIGNATURE,
        "Invalid webhook signature"
      )
    );
  }

  next();
}
