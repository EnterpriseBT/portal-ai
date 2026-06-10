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

/**
 * @openapi
 * /api/portal-sql/handle/{handleId}:
 *   get:
 *     tags:
 *       - Portal SQL
 *     summary: Paged snapshot of a query handle's staged rows
 *     description: >
 *       Returns a paged window of rows the producer staged in Redis
 *       (#85 Phase 3). The handle was issued by `sql_query` / `visualize`
 *       / `visualize_tree` when the result row count exceeded
 *       `INLINE_ROWS_THRESHOLD`. Surfaces `READ_HANDLE_EXPIRED` when the
 *       cache has aged out (24h TTL).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: handleId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, minimum: 0, default: 0 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 5000, default: 1000 }
 *     responses:
 *       200:
 *         description: Paged window of rows
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 payload:
 *                   $ref: '#/components/schemas/QueryHandleSnapshotResponse'
 *       404:
 *         description: Handle expired or unknown
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
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

/**
 * @openapi
 * /api/sse/portal-sql/handle/{handleId}/stream:
 *   get:
 *     tags:
 *       - Portal SQL
 *     summary: SSE stream of staged batches for a query handle
 *     description: >
 *       Subscribes to the producer's `portal-sql:stream:<handleId>` Pub/Sub
 *       channel and forwards each event to the client. Emits named events
 *       `data` (a batch of rows) and `complete` (cursor exhausted). Heartbeat
 *       every 25s. Query-param auth via `token`.
 *     parameters:
 *       - in: path
 *         name: handleId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: SSE stream
 *         content:
 *           text/event-stream:
 *             schema:
 *               $ref: '#/components/schemas/QueryHandleStreamEvent'
 */
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
