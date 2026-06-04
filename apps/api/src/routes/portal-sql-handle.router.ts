/**
 * HTTP surface for the reads-track query handle (#85 Phase 3 slice 1).
 *
 * Two routes, each with its own auth model:
 *
 *   - `GET /api/portal-sql/handle/:handleId` — JSON snapshot, paged.
 *     Uses standard `jwtCheck` (Authorization header).
 *
 *   - `GET /api/sse/portal-sql/handle/:handleId/stream` — SSE stream
 *     of `data` + `complete` events as the producer broadcasts on
 *     `portal-sql:stream:<handleId>`. Uses query-param auth so an
 *     EventSource client can connect without setting headers.
 */

import { Router, Request, Response, NextFunction } from "express";

import { ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { HttpService } from "../services/http.service.js";
import {
  PortalSqlHandleService,
  streamChannelKey,
} from "../services/portal-sql-handle.service.js";
import { getRedisClient } from "../utils/redis.util.js";
import { createLogger } from "../utils/logger.util.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { sseAuth } from "../middleware/sse-auth.middleware.js";

const logger = createLogger({ module: "portal-sql-handle-router" });

// ── Snapshot endpoint (lives under /api/portal-sql/) ─────────────────

export const portalSqlHandleRouter = Router();

portalSqlHandleRouter.get(
  "/handle/:handleId",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { handleId } = req.params;
      const offset = parseQueryInt(req.query.offset, 0);
      const limit = parseQueryInt(req.query.limit, 1_000);

      if (offset < 0 || limit <= 0) {
        throw new ApiError(
          400,
          ApiCode.PORTAL_SQL_FORBIDDEN,
          "offset must be ≥ 0 and limit must be > 0"
        );
      }

      const result = await PortalSqlHandleService.getSnapshot(handleId, {
        offset,
        limit,
      });

      return HttpService.success(res, result);
    } catch (err) {
      return next(err);
    }
  }
);

// ── SSE endpoint (lives under /api/sse/portal-sql/) ──────────────────

export const portalSqlHandleSseRouter = Router();

portalSqlHandleSseRouter.get(
  "/handle/:handleId/stream",
  sseAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { handleId } = req.params;
      const channel = streamChannelKey(handleId);
      const subscriber = getRedisClient().duplicate();

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      await subscriber.subscribe(channel);
      subscriber.on("message", (_chan, message) => {
        // Each Pub/Sub message is already a JSON envelope from the
        // producer ({ type: "data" | "complete", ... }).
        try {
          const parsed = JSON.parse(message);
          const eventName = typeof parsed.type === "string" ? parsed.type : "data";
          res.write(`event: ${eventName}\n`);
          res.write(`data: ${message}\n\n`);
        } catch {
          res.write(`data: ${message}\n\n`);
        }
      });

      // Heartbeat every 25s — keeps proxies from idling out.
      const heartbeat = setInterval(() => {
        res.write(`: heartbeat ${Date.now()}\n\n`);
      }, 25_000);

      req.on("close", async () => {
        clearInterval(heartbeat);
        try {
          await subscriber.unsubscribe(channel);
          await subscriber.quit();
        } catch {
          // ignore
        }
      });
    } catch (err) {
      logger.error(
        { handleId: req.params.handleId, err },
        "Failed to subscribe to portal-sql handle stream"
      );
      return next(err);
    }
  }
);

function parseQueryInt(raw: unknown, fallback: number): number {
  if (typeof raw === "string" && /^\d+$/.test(raw)) {
    return parseInt(raw, 10);
  }
  return fallback;
}
