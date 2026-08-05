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

import { incrementRateWindow } from "../utils/rate-limit.util.js";
import { ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "public-rate-limit" });

/** Per-IP fixed-window limiter. `limitPerMinute` comes from
 *  `environment.PUBLIC_SITE_RATE_LIMIT_PER_MIN` at the mount site. */
export function publicRateLimit(limitPerMinute: number) {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const count = await incrementRateWindow(`public-site:${req.ip}`);
      if (count > limitPerMinute) {
        return next(
          new ApiError(
            429,
            ApiCode.SITE_CONFIG_RATE_LIMITED,
            "Too many requests. Try again in a minute."
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
