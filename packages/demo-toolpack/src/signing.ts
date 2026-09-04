/**
 * HMAC verification for inbound Portals AI webhook calls (#510).
 *
 * Mirrors the receiver side of the signing contract documented in
 * `docs/CUSTOM_TOOLPACK_INTEGRATION.md` and implemented by the app in
 * `apps/api/src/utils/webhook-signing.util.ts`. Every signed request carries:
 *
 *   X-Portalai-Timestamp   unix seconds
 *   X-Portalai-Webhook-Id  uuid
 *   X-Portalai-Signature   v1=<hex HMAC-SHA256 over `<ts>.<id>.<rawBody>`>
 *
 * Because one shared endpoint serves several demo environments and each env's
 * registration mints its own signing secret, {@link verifySignature} checks the
 * request against an **allow-list** of secrets with a timing-safe compare.
 */

import crypto from "node:crypto";

export const REPLAY_WINDOW_SEC = 300;
export const FORWARD_SKEW_SEC = 60;

export type SignatureFailure =
  | "SIGNATURE_MISSING"
  | "TIMESTAMP_STALE"
  | "SIGNATURE_INVALID";

export type SignatureResult =
  | { ok: true }
  | { ok: false; status: 401; error: SignatureFailure };

export interface VerifyInput {
  timestamp: string | undefined;
  webhookId: string | undefined;
  signature: string | undefined;
  /** The exact body bytes as a UTF-8 string (empty string for GET). */
  rawBody: string;
  /** Allow-list of signing secrets; the request matches if any verifies. */
  secrets: string[];
  /** Current time in unix seconds (injected for deterministic tests). */
  nowSec: number;
}

/** The canonical signed string: `<timestamp>.<webhookId>.<rawBody>`. */
export function signingPayload(
  timestamp: string,
  webhookId: string,
  rawBody: string
): string {
  return `${timestamp}.${webhookId}.${rawBody}`;
}

/** Produce a `v1=<hex>` signature — used by tests and any signing client. */
export function sign(
  secret: string,
  timestamp: string,
  webhookId: string,
  rawBody: string
): string {
  const hex = crypto
    .createHmac("sha256", secret)
    .update(signingPayload(timestamp, webhookId, rawBody))
    .digest("hex");
  return `v1=${hex}`;
}

export function verifySignature(input: VerifyInput): SignatureResult {
  const { timestamp, webhookId, signature, rawBody, secrets, nowSec } = input;

  if (!timestamp || !webhookId || !signature) {
    return { ok: false, status: 401, error: "SIGNATURE_MISSING" };
  }

  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) {
    return { ok: false, status: 401, error: "SIGNATURE_MISSING" };
  }

  const ageSec = nowSec - tsNum;
  if (ageSec > REPLAY_WINDOW_SEC || ageSec < -FORWARD_SKEW_SEC) {
    return { ok: false, status: 401, error: "TIMESTAMP_STALE" };
  }

  const providedHex = signature.startsWith("v1=") ? signature.slice(3) : "";
  const providedBuf = Buffer.from(providedHex, "hex");
  if (providedBuf.length === 0) {
    return { ok: false, status: 401, error: "SIGNATURE_INVALID" };
  }

  for (const secret of secrets) {
    if (!secret) continue;
    const expectedBuf = Buffer.from(
      crypto
        .createHmac("sha256", secret)
        .update(signingPayload(timestamp, webhookId, rawBody))
        .digest("hex"),
      "hex"
    );
    if (
      expectedBuf.length === providedBuf.length &&
      crypto.timingSafeEqual(expectedBuf, providedBuf)
    ) {
      return { ok: true };
    }
  }

  return { ok: false, status: 401, error: "SIGNATURE_INVALID" };
}
