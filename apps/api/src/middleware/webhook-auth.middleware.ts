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
 * Expects the `X-Auth0-Webhook-Signature` header carrying **bare lowercase
 * hex** — NOT `sha256=<hex>`. An earlier version of this comment claimed the
 * prefixed form; the comparison below is against a bare `digest("hex")`, so the
 * prefix would never match. Worse, `timingSafeEqual` throws on a length
 * mismatch rather than returning false, so a prefixed signature surfaces as a
 * 500 instead of a 401 — it reads as a server fault, not a signing mismatch.
 *
 * The HMAC key is the secret as a literal string (a base64-looking secret is
 * NOT decoded first), and the payload is the exact raw body captured by the
 * custom JSON parser's `verify` callback, available on `req.rawBody`.
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

  const signature = req.headers["x-auth0-webhook-signature"] as string;
  if (!signature) {
    return next(
      new ApiError(
        401,
        ApiCode.WEBHOOK_MISSING_SIGNATURE,
        "Missing X-Auth0-Webhook-Signature header"
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
