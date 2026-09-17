import { Router, Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import {
  HealthGetResponse,
  HealthReadyResponse,
} from "@portalai/core/contracts";
import { createLogger } from "../utils/logger.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { environment } from "../environment.js";
import { db } from "../db/index.js";
import { getRedisClient } from "../utils/redis.util.js";
import { withTimeout } from "../utils/timeout.util.js";

const logger = createLogger({ module: "health" });

/** Ceiling for a single readiness dependency probe. A healthy DB/Redis
 *  round-trip is sub-millisecond; anything near this is an outage, and a
 *  probe that hangs is worse than one that fails fast. */
export const READINESS_PROBE_TIMEOUT_MS = 2_000;

export const healthRouter = Router();

/** Result of probing the server's backing dependencies. */
export interface ReadinessResult {
  ready: boolean;
  checks: { db: boolean; redis: boolean };
}

/**
 * Probe each backing dependency independently and report which are up.
 *
 * Pure over its injected probes so it is unit-testable without a real DB or
 * Redis: each probe is run to settlement, a rejection meaning that dependency
 * is down. `ready` is the conjunction; `checks` names each one for the body.
 */
export async function checkReadiness(deps: {
  pingDb: () => Promise<unknown>;
  pingRedis: () => Promise<unknown>;
}): Promise<ReadinessResult> {
  const settle = async (probe: () => Promise<unknown>): Promise<boolean> => {
    try {
      await probe();
      return true;
    } catch {
      return false;
    }
  };

  const [dbOk, redisOk] = await Promise.all([
    settle(deps.pingDb),
    settle(deps.pingRedis),
  ]);

  return { ready: dbOk && redisOk, checks: { db: dbOk, redis: redisOk } };
}

/**
 * @openapi
 * /api/health:
 *   get:
 *     tags:
 *       - Health
 *     summary: Health check endpoint
 *     description: Returns the current health status of the API server
 *     responses:
 *       200:
 *         description: Server is healthy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthResponse'
 */
healthRouter.get("/", (_req: Request, res: Response, next: NextFunction) => {
  try {
    logger.info("GET /api/health called");

    const payload: HealthGetResponse = {
      timestamp: new Date().toISOString(),
      version: environment.BUILD_VERSION,
      sha: environment.BUILD_SHA,
    };

    // return next(
    //   new ApiError(500, ApiCode.HEALTH_CHECK_FAILED, "Health check failed")
    // );

    logger.info("Health check OK");
    return HttpService.success(res, payload);
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : "Unknown error" },
      "Health check failed"
    );
    return next(
      new ApiError(500, ApiCode.HEALTH_CHECK_FAILED, "Health check failed")
    );
  }
});

/**
 * @openapi
 * /api/health/ready:
 *   get:
 *     tags:
 *       - Health
 *     summary: Readiness probe
 *     description: >-
 *       Reports whether the server can serve traffic by probing its backing
 *       dependencies (PostgreSQL and Redis). Unlike the deps-free liveness
 *       check at `/api/health`, this returns 503 when a dependency is
 *       unreachable, naming the failed one in `checks`. Intended as a
 *       Kubernetes readinessProbe target.
 *     responses:
 *       200:
 *         description: All backing dependencies are reachable
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthReadyResponse'
 *       503:
 *         description: One or more backing dependencies are unreachable
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
healthRouter.get(
  "/ready",
  async (_req: Request, res: Response, next: NextFunction) => {
    const result = await checkReadiness({
      pingDb: () =>
        withTimeout(
          db.execute(sql`select 1`),
          READINESS_PROBE_TIMEOUT_MS,
          "database readiness probe"
        ),
      pingRedis: () =>
        withTimeout(
          getRedisClient().ping(),
          READINESS_PROBE_TIMEOUT_MS,
          "redis readiness probe"
        ),
    });

    if (!result.ready) {
      logger.warn({ checks: result.checks }, "Readiness probe failed");
      return next(
        new ApiError(503, ApiCode.HEALTH_NOT_READY, "Service not ready", {
          checks: result.checks,
        })
      );
    }

    const payload: HealthReadyResponse = {
      ready: true,
      checks: result.checks,
    };
    return HttpService.success(res, payload);
  }
);
