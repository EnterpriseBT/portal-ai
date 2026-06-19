/**
 * Scoped webhook read/write tokens (#124).
 *
 * When the runtime dispatches a `streaming` webhook tool it mints a short-lived
 * token that grants the third-party webhook server access to **exactly one
 * handle**, for **one direction** (read pages / write staging), in **one org**,
 * for the duration of that call. The token is the only credential that crosses
 * the trust boundary — never the user's JWT.
 *
 * Stored in Redis keyed by the opaque token; the record carries the scope
 * (`organizationId`, `handleId`, `mode`) + an explicit `exp` (ms epoch). The
 * Redis key lives slightly past `exp` (a grace window) so a *late* request gets
 * a clear `WEBHOOK_READ_TOKEN_EXPIRED` rather than an indistinguishable miss;
 * past the grace (or once revoked) the key is gone → `WEBHOOK_READ_TOKEN_INVALID`.
 * Validation is **fail-closed**: any miss / expiry / scope mismatch throws.
 */

import crypto from "crypto";

import { WEBHOOK_READ_TOKEN_TTL_MS } from "@portalai/core/constants";

import { getRedisClient } from "../utils/redis.util.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";

export type WebhookTokenMode = "read" | "write";

interface TokenRecord {
  organizationId: string;
  /** For a read token, the handle to page; for a write token, the staging
   *  session id (no handle exists yet — it's created on finalize). */
  handleId: string;
  mode: WebhookTokenMode;
  /** Owning station — carried on write tokens so the staged handle's meta is
   *  attributed correctly by `produceFromRows`. */
  stationId?: string;
  /** ms-epoch logical expiry; the Redis key outlives this by `GRACE_MS`. */
  exp: number;
}

const TOKEN_PREFIX = "webhook-token:";
/** Maps a staging session → the handle `produceFromRows` created for it, so
 *  the runtime can verify a webhook's `{ resultHandle }` is the one it staged
 *  under this call (not an arbitrary handle id). Short-lived. */
const STAGED_RESULT_PREFIX = "webhook-staged-result:";

function stagedResultKey(sessionId: string): string {
  return `${STAGED_RESULT_PREFIX}${sessionId}`;
}
/** The Redis key survives this long past `exp` so a late request reads as
 *  EXPIRED (not INVALID) before final eviction. */
const GRACE_MS = 60_000;

function tokenKey(token: string): string {
  return `${TOKEN_PREFIX}${token}`;
}

export class WebhookReadTokenService {
  /**
   * Mint a scoped token for `(organizationId, handleId, mode)`. The TTL is
   * `WEBHOOK_READ_TOKEN_TTL_MS`, clamped down to the caller's `ttlMs` (e.g. the
   * handle's remaining lifetime) — never longer than the default ceiling.
   */
  static async mint(opts: {
    organizationId: string;
    handleId: string;
    mode: WebhookTokenMode;
    stationId?: string;
    ttlMs?: number;
    now?: number;
  }): Promise<string> {
    const now = opts.now ?? Date.now();
    const ttlMs = Math.min(
      opts.ttlMs ?? WEBHOOK_READ_TOKEN_TTL_MS,
      WEBHOOK_READ_TOKEN_TTL_MS
    );
    const token = crypto.randomBytes(32).toString("base64url");
    const record: TokenRecord = {
      organizationId: opts.organizationId,
      handleId: opts.handleId,
      mode: opts.mode,
      ...(opts.stationId ? { stationId: opts.stationId } : {}),
      exp: now + ttlMs,
    };
    await getRedisClient().set(
      tokenKey(token),
      JSON.stringify(record),
      "PX",
      ttlMs + GRACE_MS
    );
    return token;
  }

  /**
   * Validate a token against the handle + mode the request targets. Returns the
   * scoped record (the caller reads `organizationId` from it) or throws:
   *   - `WEBHOOK_READ_TOKEN_INVALID` (401) — unknown / evicted / revoked / malformed.
   *   - `WEBHOOK_READ_TOKEN_EXPIRED` (401) — present but past its window.
   *   - `WEBHOOK_HANDLE_SCOPE_MISMATCH` (403) — different handle or mode.
   */
  static async validate(
    token: string | undefined,
    expected: { handleId: string; mode: WebhookTokenMode },
    opts?: { now?: number }
  ): Promise<TokenRecord> {
    const now = opts?.now ?? Date.now();
    const raw = token ? await getRedisClient().get(tokenKey(token)) : null;
    if (!raw) {
      throw new ApiError(
        401,
        ApiCode.WEBHOOK_READ_TOKEN_INVALID,
        "Webhook read/write token is unknown or malformed"
      );
    }
    const record = JSON.parse(raw) as TokenRecord;
    if (now >= record.exp) {
      throw new ApiError(
        401,
        ApiCode.WEBHOOK_READ_TOKEN_EXPIRED,
        "Webhook read/write token has expired"
      );
    }
    if (record.handleId !== expected.handleId || record.mode !== expected.mode) {
      throw new ApiError(
        403,
        ApiCode.WEBHOOK_HANDLE_SCOPE_MISMATCH,
        "Token is scoped to a different handle or mode"
      );
    }
    return record;
  }

  /** Revoke a token (best-effort) — called when the originating tool settles. */
  static async revoke(token: string): Promise<void> {
    await getRedisClient().del(tokenKey(token));
  }

  /** Record the handle a staging session produced (#124 outbound). Short TTL —
   *  it only needs to outlive the in-flight webhook call. */
  static async recordStagedResult(
    sessionId: string,
    handleId: string
  ): Promise<void> {
    await getRedisClient().set(
      stagedResultKey(sessionId),
      handleId,
      "PX",
      WEBHOOK_READ_TOKEN_TTL_MS + GRACE_MS
    );
  }

  /** The handle staged under `sessionId`, or null if none — the runtime uses
   *  this to verify a webhook's returned `{ resultHandle }` is the one it
   *  actually staged this call. */
  static async getStagedResult(sessionId: string): Promise<string | null> {
    return getRedisClient().get(stagedResultKey(sessionId));
  }

  /** Drop the session→handle mapping when the call settles. */
  static async clearStagedResult(sessionId: string): Promise<void> {
    await getRedisClient().del(stagedResultKey(sessionId));
  }
}
