import { Router, Request, Response, NextFunction } from "express";
import { createLogger } from "../utils/logger.util.js";
import { ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "../services/db.service.js";
import {
  PortalService,
  loadOrganizationTimezone,
  type StationContext,
} from "../services/portal.service.js";
import { AnalyticsService } from "../services/analytics.service.js";
import { SseUtil } from "../utils/sse.util.js";
import { sseAuth } from "../middleware/sse-auth.middleware.js";

const logger = createLogger({ module: "portal-events" });

/**
 * SSE router for portal streaming — uses query-param auth instead of the
 * Authorization header. Mounted outside the protectedRouter alongside
 * the existing jobEventsRouter.
 */
export const portalEventsRouter = Router();

/**
 * @openapi
 * /api/portals/{portalId}/stream:
 *   get:
 *     tags:
 *       - Portal Events
 *     summary: Stream portal AI response
 *     description: >
 *       Opens a Server-Sent Events (SSE) stream that drives the AI response for the most
 *       recent user message. Authenticates via a `token` query parameter instead of the
 *       Authorization header. Events: `delta` (text chunk), `tool_result` (tool call output),
 *       `done` (stream complete).
 *     parameters:
 *       - in: path
 *         name: portalId
 *         required: true
 *         schema:
 *           type: string
 *         description: Portal ID
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Auth0 JWT access token (query-param auth for SSE)
 *     responses:
 *       200:
 *         description: SSE stream opened successfully
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 *               description: >
 *                 Newline-delimited SSE events. Each event is `data: <JSON>\n\n`.
 *                 Possible event shapes: `{ type: "delta", content: string }`,
 *                 `{ type: "tool_result", name: string, result: unknown }`,
 *                 `{ type: "done" }`.
 *       404:
 *         description: Portal or station not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
portalEventsRouter.get(
  "/:portalId/stream",
  sseAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    let sse: SseUtil | null = null;

    try {
      const { portalId } = req.params;

      // Load portal and verify it exists
      const { portal, coreMessages } = await PortalService.getPortal(portalId);

      // Load station data (re-populates in-memory AlaSQL tables)
      const station = await DbService.repository.stations.findById(
        portal.stationId
      );
      if (!station) {
        return next(
          new ApiError(404, ApiCode.STATION_NOT_FOUND, "Station not found")
        );
      }

      const stationData = await AnalyticsService.loadStation(
        portal.stationId,
        portal.organizationId
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolPacks = ((station as any).toolPacks as string[]) ?? [];

      const organizationTimezone = await loadOrganizationTimezone(
        portal.organizationId
      );

      const stationContext: StationContext = {
        stationId: station.id,
        stationName: station.name,
        organizationTimezone,
        entities: stationData.entities,
        entityGroups: stationData.entityGroups,
        toolPacks,
      };

      sse = new SseUtil(res);

      await PortalService.streamResponse({
        portalId,
        messages: coreMessages,
        stationContext,
        organizationId: portal.organizationId,
        userId: portal.createdBy,
        sse,
      });

      // Close the SSE connection after the stream completes so the
      // browser's EventSource does not auto-reconnect and trigger
      // duplicate Anthropic API calls.
      sse.end();
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Failed to stream portal response";

      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to stream portal response"
      );

      // If SSE headers have already been sent, propagate the error over the
      // event stream so the client can display it. Otherwise fall through to
      // the Express error handler.
      if (sse) {
        sse.sendError(message);
        return;
      }

      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.PORTAL_STREAM_FAILED,
              "Failed to stream portal response"
            )
      );
    }
  }
);

// ── GET /api/sse/portals/:portalId/events ────────────────────────────────
//
// Portal-level Pub/Sub channel for events that aren't bound to a single
// job (#85 Phase 2 slice 3). Today: `bulk_job_terminal` lands here when
// a bulk_transform job tied to this portal reaches terminal. The
// frontend hook (slice 5) subscribes to this channel to release the
// chat-input lock as soon as the worker fires its terminal hook.

portalEventsRouter.get(
  "/:portalId/events",
  sseAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { portalId } = req.params;

      const portal = await DbService.repository.portals.findById(portalId);
      if (!portal) {
        return next(
          new ApiError(404, ApiCode.PORTAL_NOT_FOUND, "Portal not found")
        );
      }

      const { PORTAL_EVENTS_CHANNEL_PREFIX } = await import(
        "../services/portal.service.js"
      );
      const { getRedisClient } = await import("../utils/redis.util.js");

      const channel = `${PORTAL_EVENTS_CHANNEL_PREFIX}${portalId}`;
      const subscriber = getRedisClient().duplicate();

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      await subscriber.subscribe(channel);
      subscriber.on("message", (_chan, message) => {
        res.write(`data: ${message}\n\n`);
      });

      // Heartbeat every 25s to keep proxies from idling out.
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
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to subscribe to portal events"
      );
      return next(error);
    }
  }
);
