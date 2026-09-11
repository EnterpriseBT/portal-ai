/**
 * authenticatedRateLimit (#574) — per-user fixed-window throttle for the
 * authenticated API, wrapping the cost gate's Redis counter
 * (`incrementRateWindow`) as Express middleware. Mounted on `protectedRouter`
 * right after `jwtCheck`, so SSE, health, and the anonymous `/api/public`
 * router (all mounted outside `protectedRouter`) are naturally exempt.
 *
 * Keyed by the Auth0 subject (`req.auth.payload.sub`) — available with no DB
 * lookup at this point in the chain, which keeps the middleware a pure
 * Redis-and-fail-open check. Per-org limiting would need a per-request DB
 * lookup (see docs/AUTH_API_RATE_LIMITING.condensed.md); it is a deliberate
 * deferral, not an omission.
 *
 * Fail-OPEN on a Redis error/timeout — conscious and recorded, mirroring the
 * public limiter and the cost gate's own posture (`rate-limit.util.ts`): a
 * Redis blip must degrade to "allow", never to "deny" a paying customer's
 * whole authenticated API.
 */

import { Request, Response, NextFunction } from "express";

import { incrementRateWindow } from "../utils/rate-limit.util.js";
import { ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "authenticated-rate-limit" });

/** Per-user fixed-window limiter. `limitPerMinute` comes from
 *  `environment.AUTH_API_RATE_LIMIT_PER_MIN` at the mount site — passed as an
 *  argument so a future tier-derived limit can slot in without touching this. */
export function authenticatedRateLimit(limitPerMinute: number) {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction
  ): Promise<void> => {
    const sub = req.auth?.payload.sub;
    // jwtCheck runs before this and guarantees a subject; if it is somehow
    // absent, allow rather than key every such request into one shared bucket.
    if (!sub) {
      return next();
    }

    try {
      const count = await incrementRateWindow(`authed:${sub}`);
      if (count > limitPerMinute) {
        return next(
          new ApiError(
            429,
            ApiCode.API_RATE_LIMITED,
            "Too many requests. Try again in a minute."
          )
        );
      }
    } catch (error) {
      // Fail open — see module doc.
      logger.warn(
        { error, sub },
        "Authenticated rate-limit counter unavailable; allowing request"
      );
    }
    next();
  };
}
