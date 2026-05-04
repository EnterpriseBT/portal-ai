/**
 * Redis-backed cache for the Google access token attached to a
 * `ConnectorInstance`'s credentials. Refreshes lazily on miss.
 *
 * - Cache key: `connector:access:google-sheets:{connectorInstanceId}`.
 * - TTL: `expiresIn - 600s` (10-min safety margin so an in-flight call
 *   doesn't hold a token that expires mid-request). Floored at 60s.
 * - Single-flight de-dup via in-memory Map: concurrent misses wait on
 *   the same in-flight refresh promise. Sufficient for one API process;
 *   cross-process coordination via Redis SET NX is the next step if
 *   we scale beyond a single worker.
 *
 * On refresh failure (`invalid_grant` etc.), marks the instance
 * `status="error"` with `lastErrorMessage` so Phase E's reconnect flow
 * can surface a Reconnect button.
 *
 * See `docs/GOOGLE_SHEETS_CONNECTOR.phase-B.plan.md` §Slice 3.
 */

import { DbService } from "./db.service.js";
import {
  GoogleAuthError,
  GoogleAuthService,
} from "./google-auth.service.js";
import { accessTokenCacheKey } from "../utils/connector-cache-keys.util.js";
import { getRedisClient } from "../utils/redis.util.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "google-access-token-cache" });

const SLUG = "google-sheets";
const TTL_SAFETY_MARGIN_SEC = 600;
const TTL_FLOOR_SEC = 60;

function cacheKey(connectorInstanceId: string): string {
  return accessTokenCacheKey(SLUG, connectorInstanceId);
}

const inflight = new Map<string, Promise<string>>();

export const GoogleAccessTokenCacheService = {
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

async function refreshAndStore(
  connectorInstanceId: string
): Promise<string> {
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

  let refreshed: { accessToken: string; expiresIn: number };
  try {
    refreshed = await GoogleAuthService.refreshAccessToken(refreshToken);
  } catch (err) {
    if (err instanceof GoogleAuthError && err.kind === "refresh_failed") {
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
        "Google refresh_token rejected — marked instance status=error"
      );
    }
    throw err;
  }

  const ttl = Math.max(refreshed.expiresIn - TTL_SAFETY_MARGIN_SEC, TTL_FLOOR_SEC);
  const redis = getRedisClient();
  await redis.set(cacheKey(connectorInstanceId), refreshed.accessToken, "EX", ttl);
  logger.info(
    {
      connectorInstanceId,
      ttlSec: ttl,
      event: "gsheets.access.refreshed",
    },
    "Google access token refreshed and cached"
  );
  return refreshed.accessToken;
}
