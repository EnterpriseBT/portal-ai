/**
 * publicRateLimit (#311) — per-IP fixed-window throttle for the anonymous
 * `/api/public` router, wrapping the cost gate's Redis counter
 * (`incrementRateWindow`) as Express middleware.
 *
 * Fail-OPEN on a Redis error — conscious and recorded (discovery →
 * Enterprise-scale considerations): a marketing-page fetch must not 500 on
 * a Redis blip, and the endpoint's TTL caches bound upstream load to one
 * round-trip per window regardless of request rate. This mirrors the cost
 * gate's own documented fail-open posture (`rate-limit.util.ts`).
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

const logger = createLogger({ module: "public-rate-limit" });

/** Per-IP fixed-window limiter. `limitPerMinute` comes from
 *  `environment.PUBLIC_SITE_RATE_LIMIT_PER_MIN` at the mount site. */
export function publicRateLimit(limitPerMinute: number) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const now = Date.now();
      const count = await incrementRateWindow(`public-site:${req.ip}`, now);
      if (count > limitPerMinute) {
        // #705: say exactly when the window the request was counted in ends,
        // so a client can back off instead of retrying into the limit.
        const retryAfterSeconds = secondsUntilWindowEnd(RATE_WINDOW_MS, now);
        res.setHeader("Retry-After", String(retryAfterSeconds));
        return next(
          new ApiError(
            429,
            ApiCode.SITE_CONFIG_RATE_LIMITED,
            `Too many requests. Try again in ${inSeconds(retryAfterSeconds)}.`,
            { retryAfterSeconds }
          )
        );
      }
    } catch (error) {
      // Fail open — see module doc.
      logger.warn(
        { error, ip: req.ip },
        "Public rate-limit counter unavailable; allowing request"
      );
    }
    next();
  };
}
