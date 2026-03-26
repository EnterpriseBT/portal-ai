import { Router, Request, Response, NextFunction } from "express";
import type { ModelMessage } from "ai";

import { createLogger } from "../utils/logger.util.js";
import { ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "../services/db.service.js";
import { PortalService, type StationContext } from "../services/portal.service.js";
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
    try {
      const { portalId } = req.params;

      // Load portal and verify it exists
      const { portal, messages: dbMessages } =
        await PortalService.getPortal(portalId);

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

      const stationContext: StationContext = {
        stationId: station.id,
        stationName: station.name,
        entities: stationData.entities,
        entityGroups: stationData.entityGroups,
      };

      // Convert DB messages to AI SDK ModelMessage format
      const aiMessages: ModelMessage[] = dbMessages.map((msg) => {
        const blocks = msg.blocks as Array<{ type: string; content: unknown }>;
        const textContent = blocks
          .filter((b) => b.type === "text")
          .map((b) => String(b.content))
          .join("");
        return {
          role: msg.role as "user" | "assistant",
          content: textContent || " ",
        };
      });

      const sse = new SseUtil(res);

      await PortalService.streamResponse({
        portalId,
        messages: aiMessages,
        stationContext,
        organizationId: portal.organizationId,
        sse,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to stream portal response"
      );
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
