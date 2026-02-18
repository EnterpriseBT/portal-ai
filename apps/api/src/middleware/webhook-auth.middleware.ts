import { Request, Response, NextFunction } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { environment } from "../environment.js";
import { ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { createLogger } from "../utils/logger.util.js";

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

  const signatureHeader = req.headers["x-auth0-webhook-signature"] as
    | string
    | undefined;

  if (!signatureHeader) {
    return next(
      new ApiError(
        401,
        ApiCode.WEBHOOK_MISSING_SIGNATURE,
        "Missing X-Auth0-Webhook-Signature header"
      )
    );
  }

  const parts = signatureHeader.split("=");
  if (parts.length !== 2 || parts[0] !== "sha256") {
    return next(
      new ApiError(
        401,
        ApiCode.WEBHOOK_INVALID_SIGNATURE,
        "Invalid signature format"
      )
    );
  }

  const receivedHex = parts[1];
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;

  if (!rawBody) {
    return next(
      new ApiError(
        401,
        ApiCode.WEBHOOK_INVALID_SIGNATURE,
        "Unable to verify signature: missing raw body"
      )
    );
  }

  const expectedHex = createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const receivedBuf = Buffer.from(receivedHex, "hex");
  const expectedBuf = Buffer.from(expectedHex, "hex");

  if (
    receivedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(receivedBuf, expectedBuf)
  ) {
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
