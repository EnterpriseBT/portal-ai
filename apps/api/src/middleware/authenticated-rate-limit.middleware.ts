/**
 * authenticatedRateLimit (#574) — per-user fixed-window throttle for the
 * authenticated API, wrapping the cost gate's Redis counter
 * (`incrementRateWindow`) as Express middleware. Mounted on `protectedRouter`
 * right after `jwtCheck`, so SSE, health, and the anonymous `/api/public`
 * router (all mounted outside `protectedRouter`) are naturally exempt.
 *
 * Two buckets per user (#705). Map tiles count in `tiles`, everything else
 * in `api`. A single pan fans out 6-10 tile requests, so with one shared
 * bucket a user exploring a map spent their whole API budget and every list,
 * save and chat 429'd with it. The tile bucket is mounted ahead of the API
 * limiter, so a tile request never reaches `api`; the tile admission gate
 * (#698) separately bounds the database.
 *
 * Keyed by the Auth0 subject (`req.auth.payload.sub`) — available with no DB
 * lookup at this point in the chain, which keeps the middleware a pure
 * Redis-and-fail-open check. Per-org limiting would need a per-request DB
 * lookup; it is a deliberate deferral (#574), not an omission.
 *
 * A refusal carries `Retry-After` (seconds left in the window the request was
 * counted in) and `details.retryAfterSeconds`, so a client can back off.
 *
 * Fail-OPEN on a Redis error/timeout — conscious and recorded, mirroring the
 * public limiter and the cost gate's own posture (`rate-limit.util.ts`): a
 * Redis blip must degrade to "allow", never to "deny" a paying customer's
 * whole authenticated API.
 */

import { Request, Response, NextFunction } from "express";

import {
  incrementRateWindow,
  secondsUntilWindowEnd,
  RATE_WINDOW_MS,
} from "../utils/rate-limit.util.js";
import { ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { createLogger } from "../utils/logger.util.js";

const inSeconds = (s: number) => (s === 1 ? "1 second" : `${s} seconds`);

const logger = createLogger({ module: "authenticated-rate-limit" });

/** Which per-user window a request counts in (#705). */
export type AuthRateLimitBucket = "api" | "tiles";

const BUCKET_KEY_PREFIX: Record<AuthRateLimitBucket, string> = {
  api: "authed",
  tiles: "authed-tiles",
};

const BUCKET_REFUSAL: Record<AuthRateLimitBucket, string> = {
  api: "Too many requests.",
  tiles: "Too many map tile requests.",
};

/** Per-user fixed-window limiter. `limitPerMinute` comes from
 *  `environment.AUTH_API_RATE_LIMIT_PER_MIN` / `AUTH_TILE_RATE_LIMIT_PER_MIN`
 *  at the mount site — passed in so a future tier-derived limit can slot in
 *  without touching this. */
export function authenticatedRateLimit({
  bucket,
  limitPerMinute,
}: {
  bucket: AuthRateLimitBucket;
  limitPerMinute: number;
}) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const sub = req.auth?.payload.sub;
    // jwtCheck runs before this and guarantees a subject; if it is somehow
    // absent, allow rather than key every such request into one shared bucket.
    if (!sub) {
      return next();
    }

    try {
      const now = Date.now();
      const count = await incrementRateWindow(
        `${BUCKET_KEY_PREFIX[bucket]}:${sub}`,
        now
      );
      if (count > limitPerMinute) {
        // #705: say exactly when the window the request was counted in ends,
        // so a client can back off instead of retrying into the limit.
        const retryAfterSeconds = secondsUntilWindowEnd(RATE_WINDOW_MS, now);
        res.setHeader("Retry-After", String(retryAfterSeconds));
        return next(
          new ApiError(
            429,
            ApiCode.API_RATE_LIMITED,
            `${BUCKET_REFUSAL[bucket]} Try again in ${inSeconds(retryAfterSeconds)}.`,
            { retryAfterSeconds }
          )
        );
      }
    } catch (error) {
      // Fail open — see module doc.
      logger.warn(
        { error, sub, bucket },
        "Authenticated rate-limit counter unavailable; allowing request"
      );
    }
    next();
  };
}
