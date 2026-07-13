/**
 * HMAC-SHA256 outbound webhook signing — phase 6.
 *
 * Every outbound call to a custom toolpack URL (schema, metadata,
 * runtime) is signed with the toolpack's per-tenant signing secret
 * so the receiving server can verify the request originated from us
 * rather than a captured token replayed by anyone.
 *
 * Signed payload: `<timestamp>.<webhookId>.<body>` joined by `.`.
 * Body is signed verbatim — no canonicalization. Receivers must
 * verify against the raw body before parsing (same model as Stripe,
 * GitHub, Slack).
 *
 * Three headers are emitted per request:
 *   X-Portalai-Timestamp  unix seconds at signing time
 *   X-Portalai-Webhook-Id uuid v4 for receiver-side dedupe
 *   X-Portalai-Signature  "v1=<hex>" — versioned for future swaps
 *
 * The receiver should reject timestamps older than 300s (replay
 * window) and verify the signature with `crypto.timingSafeEqual`.
 * The companion mock-toolpack server (`scripts/mock-toolpack-server.ts`)
 * is the reference verification implementation.
 */

import crypto from "crypto";

export interface SignedRequestHeaders {
  "X-Portalai-Timestamp": string;
  "X-Portalai-Webhook-Id": string;
  "X-Portalai-Signature": string;
}

const SIGNATURE_VERSION = "v1";
const SIGNED_PAYLOAD_SEPARATOR = ".";

/**
 * Compute the HMAC-SHA256 signature over `<timestamp>.<webhookId>.<body>`
 * and produce the three headers an outbound request carries.
 *
 * `opts.now` and `opts.webhookId` exist for deterministic testing;
 * production callers omit both.
 */
export function signRequest(
  secret: string,
  body: string,
  opts?: { now?: number; webhookId?: string }
): SignedRequestHeaders {
  const timestamp = String(Math.floor((opts?.now ?? Date.now()) / 1000));
  const webhookId = opts?.webhookId ?? crypto.randomUUID();
  const payload = [timestamp, webhookId, body].join(SIGNED_PAYLOAD_SEPARATOR);
  const hex = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return {
    "X-Portalai-Timestamp": timestamp,
    "X-Portalai-Webhook-Id": webhookId,
    "X-Portalai-Signature": `${SIGNATURE_VERSION}=${hex}`,
  };
}

/**
 * Generate a fresh signing secret. 32 random bytes, base64url-encoded,
 * prefixed with `whsec_` for out-of-band identification (matches
 * Stripe's whsec_xxx convention).
 */
export function generateSigningSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString("base64url")}`;
}
