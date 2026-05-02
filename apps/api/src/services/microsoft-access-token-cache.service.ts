/**
 * Redis-backed cache for the Microsoft access token attached to a
 * `ConnectorInstance`'s credentials, plus persistence of the rotated
 * refresh token back into the credentials column.
 *
 * - Cache key: `connector:access:microsoft-excel:{connectorInstanceId}`.
 * - TTL: `expiresIn - 600s` (10-min safety margin so an in-flight call
 *   doesn't hold a token that expires mid-request). Floored at 60s.
 * - Single-flight de-dup via in-memory Map: concurrent misses wait on
 *   the same in-flight refresh promise. Sufficient for one API process;
 *   cross-process coordination via Redis SET NX is the next step
 *   (Phase E) if scale forces it.
 *
 * **Microsoft-specific divergence from the Google cache:** Microsoft
 * rotates the refresh token on every call. After a successful refresh
 * we MUST update `connector_instances.credentials.refresh_token` (re-
 * encrypted, preserving the other fields) before the next miss reads
 * the now-consumed prior token from the DB. The base repository's
 * `update` accepts the credentials object directly via the standard
 * column path; the encryption layer handles re-encryption on write.
 *
 * On refresh failure (`invalid_grant` etc.), marks the instance
 * `status="error"` with `lastErrorMessage` so Phase E's reconnect flow
 * can surface a Reconnect button.
 */

import { DbService } from "./db.service.js";
import {
  MicrosoftAuthError,
  MicrosoftAuthService,
} from "./microsoft-auth.service.js";
import { accessTokenCacheKey } from "../utils/connector-cache-keys.util.js";
import { getRedisClient } from "../utils/redis.util.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "microsoft-access-token-cache" });

const SLUG = "microsoft-excel";
const TTL_SAFETY_MARGIN_SEC = 600;
const TTL_FLOOR_SEC = 60;

function cacheKey(connectorInstanceId: string): string {
  return accessTokenCacheKey(SLUG, connectorInstanceId);
}

const inflight = new Map<string, Promise<string>>();

export const MicrosoftAccessTokenCacheService = {
  async getOrRefresh(connectorInstanceId: string): Promise<string> {
    const redis = getRedisClient();
    const cached = await redis.get(cacheKey(connectorInstanceId));
    if (cached) return cached;

    const existing = inflight.get(connectorInstanceId);
    if (existing) return existing;

    const promise = (async () => {
      try {
        return await refreshAndStore(connectorInstanceId);
      } finally {
        inflight.delete(connectorInstanceId);
      }
    })();
    inflight.set(connectorInstanceId, promise);
    return promise;
  },

  /** Test seam — clear the in-memory single-flight map between cases. */
  __resetInflightForTests(): void {
    inflight.clear();
  },
};

async function refreshAndStore(connectorInstanceId: string): Promise<string> {
  const instance =
    await DbService.repository.connectorInstances.findById(
      connectorInstanceId
    );
  if (!instance) {
    throw new Error(`ConnectorInstance not found: ${connectorInstanceId}`);
  }

  // The repository decrypts on read, so credentials should be a plain
  // object. Defend against the rare path where it's still a string.
  const credentials =
    instance.credentials && typeof instance.credentials === "object"
      ? (instance.credentials as Record<string, unknown>)
      : null;
  const refreshToken =
    credentials && typeof credentials.refresh_token === "string"
      ? credentials.refresh_token
      : "";
  if (!refreshToken) {
    throw new Error(
      `ConnectorInstance ${connectorInstanceId} has no refresh_token in credentials`
    );
  }

  let refreshed: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    scope: string;
  };
  try {
    refreshed = await MicrosoftAuthService.refreshAccessToken(refreshToken);
  } catch (err) {
    if (err instanceof MicrosoftAuthError && err.kind === "refresh_failed") {
      await DbService.repository.connectorInstances
        .update(connectorInstanceId, {
          status: "error",
          lastErrorMessage: err.message,
        })
        .catch((updateErr) => {
          logger.warn(
            {
              connectorInstanceId,
              err:
                updateErr instanceof Error ? updateErr.message : updateErr,
            },
            "Failed to update connector instance status after refresh failure"
          );
        });
      logger.warn(
        { connectorInstanceId, message: err.message },
        "Microsoft refresh_token rejected — marked instance status=error"
      );
    }
    throw err;
  }

  // Persist the rotated refresh token back to the encrypted credentials
  // column. Spread the existing credentials so we preserve UPN, email,
  // displayName, tenantId, scopes — only refresh_token + lastRefreshedAt
  // change. Last-writer-wins is fine; concurrent rotations are guarded
  // by the in-process inflight Map above.
  const nextCredentials: Record<string, unknown> = {
    ...credentials,
    refresh_token: refreshed.refreshToken,
    lastRefreshedAt: Date.now(),
  };

  await DbService.repository.connectorInstances.update(connectorInstanceId, {
    credentials: nextCredentials as unknown as string,
  });

  const ttl = Math.max(
    refreshed.expiresIn - TTL_SAFETY_MARGIN_SEC,
    TTL_FLOOR_SEC
  );
  const redis = getRedisClient();
  await redis.set(
    cacheKey(connectorInstanceId),
    refreshed.accessToken,
    "EX",
    ttl
  );
  logger.info(
    {
      connectorInstanceId,
      ttlSec: ttl,
      event: "mexcel.access.refreshed",
    },
    "Microsoft access token refreshed and rotated refresh token persisted"
  );
  return refreshed.accessToken;
}
