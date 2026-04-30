/**
 * Short-lived signed `state` token for the Google OAuth2 callback.
 *
 * Binds the consent redirect to its requester so a redirect can't be
 * replayed by another user or org. Format: `<base64url(payload)>.<base64url(hmac)>`.
 *
 * See `docs/GOOGLE_SHEETS_CONNECTOR.phase-A.plan.md` §Slice 2.
 */

import crypto from "crypto";
import { environment } from "../environment.js";

export const STATE_TTL_MS = 5 * 60 * 1000;

export type OAuthStateErrorKind = "invalid" | "expired";

export class OAuthStateError extends Error {
  override readonly name = "OAuthStateError" as const;
  readonly kind: OAuthStateErrorKind;

  constructor(kind: OAuthStateErrorKind, message?: string) {
    super(message ?? kind);
    this.kind = kind;
  }
}

export interface OAuthStatePayload {
  userId: string;
  organizationId: string;
}

interface SignedPayload extends OAuthStatePayload {
  /** ms since epoch when the token was minted. */
  iat: number;
  /** Base64url random nonce — guarantees freshness across rapid mints. */
  nonce: string;
}

interface SignOptions {
  now?: () => number;
}

interface VerifyOptions {
  now?: () => number;
}

function getSecret(): Buffer {
  const secret = environment.OAUTH_STATE_SECRET;
  if (!secret) {
    throw new Error(
      "OAUTH_STATE_SECRET is not configured. Generate one with: openssl rand -base64 32"
    );
  }
  return Buffer.from(secret, "utf8");
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString("base64url");
}

function b64urlDecode(str: string): Buffer {
  return Buffer.from(str, "base64url");
}

function hmac(key: Buffer, payload: string): Buffer {
  return crypto.createHmac("sha256", key).update(payload).digest();
}

export function signState(
  payload: OAuthStatePayload,
  opts: SignOptions = {}
): string {
  if (!payload.userId) throw new Error("signState: userId is required");
  if (!payload.organizationId)
    throw new Error("signState: organizationId is required");

  const now = opts.now ?? Date.now;
  const signed: SignedPayload = {
    userId: payload.userId,
    organizationId: payload.organizationId,
    iat: now(),
    nonce: b64urlEncode(crypto.randomBytes(12)),
  };
  const encoded = b64urlEncode(Buffer.from(JSON.stringify(signed), "utf8"));
  const sig = b64urlEncode(hmac(getSecret(), encoded));
  return `${encoded}.${sig}`;
}

export function verifyState(
  token: string,
  opts: VerifyOptions = {}
): OAuthStatePayload {
  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new OAuthStateError("invalid", "malformed token");
  }
  const [encoded, sig] = parts as [string, string];
  if (!encoded || !sig) {
    throw new OAuthStateError("invalid", "malformed token");
  }

  const expectedSig = hmac(getSecret(), encoded);
  let providedSig: Buffer;
  try {
    providedSig = b64urlDecode(sig);
  } catch {
    throw new OAuthStateError("invalid", "signature decode failed");
  }
  if (
    providedSig.length !== expectedSig.length ||
    !crypto.timingSafeEqual(providedSig, expectedSig)
  ) {
    throw new OAuthStateError("invalid", "signature mismatch");
  }

  let parsed: SignedPayload;
  try {
    parsed = JSON.parse(b64urlDecode(encoded).toString("utf8")) as SignedPayload;
  } catch {
    throw new OAuthStateError("invalid", "payload decode failed");
  }

  if (
    typeof parsed.userId !== "string" ||
    typeof parsed.organizationId !== "string" ||
    typeof parsed.iat !== "number"
  ) {
    throw new OAuthStateError("invalid", "payload shape");
  }

  const now = (opts.now ?? Date.now)();
  if (now - parsed.iat > STATE_TTL_MS) {
    throw new OAuthStateError("expired");
  }

  return { userId: parsed.userId, organizationId: parsed.organizationId };
}
