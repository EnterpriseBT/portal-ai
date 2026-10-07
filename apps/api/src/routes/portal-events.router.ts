import { Router, Request, Response, NextFunction } from "express";
import { createLogger } from "../utils/logger.util.js";
import { ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "../services/db.service.js";
import {
  PortalService,
  buildStationContext,
} from "../services/portal.service.js";
import { PortalTurnGuardService } from "../services/portal-turn-guard.service.js";
import { SseUtil } from "../utils/sse.util.js";
import { sseAuth } from "../middleware/sse-auth.middleware.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { PortalAccessService } from "../services/portal-access.service.js";

const logger = createLogger({ module: "portal-events" });

/**
 * SSE router for portal streaming — uses query-param auth instead of the
 * Authorization header. Mounted outside the protectedRouter alongside
 * the existing jobEventsRouter.
 */
export const portalEventsRouter = Router();

/**
 * @openapi
 * /api/sse/portals/{portalId}/stream:
 *   get:
 *     tags:
 *       - Portal Events
 *     summary: Stream portal AI response
 *     description: >
 *       Opens a Server-Sent Events (SSE) stream that drives the AI response for the most
 *       recent user message. Authenticates via a `token` query parameter instead of the
 *       Authorization header.
 *       Events, in the order a tool-calling turn produces them:
 *       `delta` (text chunk),
 *       `tool_call` (a tool started — carries `toolCallId` + `toolName` so the client can
 *       show which phase the turn is in),
 *       `tool_call_end` (that tool finished — emitted for every tool, including those whose
 *       result has no display shape),
 *       `tool_result` (a renderable block — emitted only when the result has a display
 *       shape, so a scalar-result tool produces none),
 *       `done` (stream complete),
 *       `stream_error` (the turn failed; the stream ends).
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
 *               $ref: '#/components/schemas/PortalStreamEvent'
 *       403:
 *         description: The caller can read the portal but not run a turn on it (#685)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Portal or station not found, or the portal isn't readable by the caller (#685)
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
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    let sse: SseUtil | null = null;

    try {
      const { portalId } = req.params;
      // #685: the caller must be able to read the portal (unreadable or
      // another org's == absent, 404), and the turn runs as the caller.
      const caller = req.application!.metadata;
      const { set: callerSet, portal: accessible } =
        await PortalAccessService.load(caller, portalId);

      // Load portal + message history in one pass. The newest row tells us the
      // turn's state (#504): an `assistant` row means the turn is already
      // answered; a `user` row means a turn is pending.
      const { portal, messages, coreMessages } =
        await PortalService.getPortal(portalId);
      const last = messages[messages.length - 1];

      // #504: already answered. This GET is an EventSource reconnect that
      // landed after the original (orphaned) stream persisted its reply.
      // Replay the stored assistant message — never call the model again.
      if (last?.role === "assistant") {
        sse = new SseUtil(res);
        PortalService.replayTurn(sse, last, portalId);
        sse.end();
        return;
      }

      // Pending user turn. Claim it so a concurrent reconnect can't fire a
      // second Anthropic call for the same turn (cross-instance via Redis).
      const pendingUserMessageId = last?.id ?? "unknown";
      const lockKey = PortalTurnGuardService.turnLockKey(
        portalId,
        pendingUserMessageId
      );
      const acquired = await PortalTurnGuardService.acquireTurnLock(lockKey);

      // #504: another connection is already generating this turn. Wait,
      // bounded, for its persisted answer and replay it — don't re-generate.
      if (!acquired) {
        sse = new SseUtil(res);
        const answer = await PortalTurnGuardService.waitForAnswer(portalId);
        if (answer) {
          PortalService.replayTurn(sse, answer, portalId);
          sse.end();
        } else {
          sse.sendError(
            "This message is still being answered — reopen the portal to see the reply."
          );
        }
        return;
      }

      try {
        // Fresh turn — this connection owns it. Running a turn writes to
        // the portal, so it needs write as well as read (403 otherwise).
        callerSet.check(
          "resource.write",
          PortalAccessService.object(accessible)
        );
        // #685: the turn answers the pending message, so it runs with its
        // author's data access (who posted it via POST /messages). The
        // stream caller only claims the turn. An owner/admin who can open any
        // portal must not answer a member's question with rows the member
        // can't see, saved into the member's portal.
        const turnUserId = last?.createdBy ?? caller.userId;

        // Load station data (re-populates in-memory AlaSQL tables)
        const station = await DbService.repository.stations.findById(
          portal.stationId
        );
        if (!station) {
          return next(
            new ApiError(404, ApiCode.STATION_NOT_FOUND, "Station not found")
          );
        }

        // Rebuild context per message so newly-attached connectors,
        // updated entity capabilities, and freshly-synced entities show
        // up in this turn's system prompt (#95). The station's packs are read
        // from `station_toolpacks` inside (#307).
        const stationContext = await buildStationContext({
          station: { id: station.id, name: station.name },
          organizationId: portal.organizationId,
          // #599 / #685: scope the roster to the identity the session runs
          // as: the pending message's author, never the portal's creator.
          userId: turnUserId,
        });

        sse = new SseUtil(res);

        await PortalService.streamResponse({
          portalId,
          messages: coreMessages,
          stationContext,
          organizationId: portal.organizationId,
          userId: turnUserId,
          sse,
        });

        // Close the SSE connection after the stream completes so the
        // browser's EventSource does not auto-reconnect and trigger
        // duplicate Anthropic API calls.
        sse.end();
      } finally {
        // Release the turn the moment it ends (success or error); the TTL is
        // only a backstop for a holder that dies mid-turn.
        await PortalTurnGuardService.releaseTurnLock(lockKey);
      }
    } catch (error) {
      // #687: a 500's message is the caught error's text (possibly SQL), so
      // it stays in the log, like on a JSON response; other ApiErrors carry
      // copy written for the user.
      const message =
        error instanceof ApiError && (error.status ?? 500) !== 500
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

/**
 * @openapi
 * /api/sse/portals/{portalId}/events:
 *   get:
 *     tags:
 *       - Portal Events
 *     summary: Portal-level event stream
 *     description: >
 *       SSE channel for events bound to a portal (rather than a single job).
 *       Today emits `bulk_job_terminal` when a bulk_transform job tied to
 *       this portal reaches terminal status (#85 Phase 2). Heartbeats every
 *       25s. Query-param auth via the `token` parameter.
 *     parameters:
 *       - in: path
 *         name: portalId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: SSE stream of portal events
 *         content:
 *           text/event-stream:
 *             schema:
 *               $ref: '#/components/schemas/BulkJobTerminalEvent'
 *       404:
 *         description: Portal not found, or not readable by the caller (#685)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
portalEventsRouter.get(
  "/:portalId/events",
  sseAuth,
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { portalId } = req.params;

      // #685: readable by the caller, else 404.
      await PortalAccessService.load(req.application!.metadata, portalId);

      const { PORTAL_EVENTS_CHANNEL_PREFIX } =
        await import("../services/portal.service.js");
      const { getRedisClient } = await import("../utils/redis.util.js");

      const channel = `${PORTAL_EVENTS_CHANNEL_PREFIX}${portalId}`;
      const subscriber = getRedisClient().duplicate();
      // #391: an unhandled ioredis `error` event crashes the process.
      subscriber.on("error", (err) => {
        logger.warn({ err }, "Portal-events SSE subscriber error (staying up)");
      });

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
