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
import { PortalSqlHandleService } from "../services/portal-sql-handle.service.js";
import { PortalVizRefreshService } from "../services/portal-viz-refresh.service.js";
import { incrementRateWindow } from "../utils/rate-limit.util.js";
import { VIZ_REFRESH_RATE_PER_MIN } from "@portalai/core/constants";
import { createLogger } from "../utils/logger.util.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";

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
 *         description: Handle expired or unknown, or belonging to another org or user (#685; the same response, so it reveals nothing)
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

      // #685: a handle is readable only by its own org, and by its own user
      // when it records one (the agent's query handles do). Anything else is
      // the same 404 as an expired handle, so the check reveals nothing.
      const { organizationId, userId } = req.application!.metadata;
      const meta = await PortalSqlHandleService.getMeta(handleId);
      if (
        meta._organizationId !== organizationId ||
        (meta._userId !== undefined && meta._userId !== userId)
      ) {
        throw new ApiError(
          404,
          ApiCode.READ_HANDLE_EXPIRED,
          "Query handle not found or expired"
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

/**
 * @openapi
 * /api/portal-sql/widget-refresh:
 *   post:
 *     tags:
 *       - Portal SQL
 *     summary: Re-execute a d3 widget's durable pipeline for fresh data
 *     description: >
 *       Reference-based, org-scoped re-execution of a persisted `d3` widget's
 *       pipeline (#270). The client sends only `{ messageId, blockIndex }`; the
 *       server loads the persisted SQL from the block and re-runs it read-only
 *       under the caller's organization — the client never supplies SQL.
 *       Returns a fresh delivery (inline rows or a new query-handle envelope) by
 *       the same size thresholds as the original mint. Free and unmetered;
 *       guarded by a per-org rate limit.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/WidgetRefreshRequest'
 *     responses:
 *       200:
 *         description: A fresh delivery for the widget
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 payload:
 *                   $ref: '#/components/schemas/WidgetRefreshResponse'
 *       404:
 *         description: No refreshable widget for this reference (or cross-org)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       422:
 *         description: The widget has no durable pipeline (pre-#270)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       429:
 *         description: Per-org rate limit exceeded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
portalSqlHandleRouter.post(
  "/widget-refresh",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.application!.metadata.organizationId;

      const { messageId, blockIndex } = req.body ?? {};
      if (
        typeof messageId !== "string" ||
        messageId.length === 0 ||
        typeof blockIndex !== "number" ||
        !Number.isInteger(blockIndex) ||
        blockIndex < 0
      ) {
        throw new ApiError(
          400,
          ApiCode.PORTAL_SQL_FORBIDDEN,
          "widget-refresh requires { messageId: string, blockIndex: integer ≥ 0 }"
        );
      }

      // Per-org rate limit (abuse backstop). Fail-open on a Redis blip — the
      // re-execution is already bounded (read-only + statement_timeout + LIMIT).
      try {
        const count = await incrementRateWindow(
          `viz-refresh:${organizationId}`
        );
        if (count > VIZ_REFRESH_RATE_PER_MIN) {
          throw new ApiError(
            429,
            ApiCode.VIZ_REFRESH_RATE_LIMITED,
            "Too many widget refreshes this minute."
          );
        }
      } catch (err) {
        if (err instanceof ApiError) throw err; // the 429 propagates
        logger.warn(
          { err },
          "viz-refresh rate limiter unavailable; failing open"
        );
      }

      const payload = await PortalVizRefreshService.refresh({
        messageId,
        blockIndex,
        organizationId,
        userId: req.application!.metadata.userId,
      });
      return HttpService.success(res, payload);
    } catch (err) {
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
