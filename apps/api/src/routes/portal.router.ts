import { Router, Request, Response, NextFunction } from "express";
import { eq, and, type SQL } from "drizzle-orm";

import {
  PortalListRequestQuerySchema,
  CreatePortalBodySchema,
  SendMessageBodySchema,
  type PortalListResponsePayload,
  type PortalGetResponsePayload,
  type PortalCreateResponsePayload,
} from "@portalai/core/contracts";
import { createLogger } from "../utils/logger.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "../services/db.service.js";
import { portals, portalMessages, portalResults } from "../db/schema/index.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { PortalService } from "../services/portal.service.js";

const logger = createLogger({ module: "portal" });

export const portalRouter = Router();

// ── POST /api/portals ─────────────────────────────────────────────────────

/**
 * @openapi
 * /api/portals:
 *   post:
 *     tags:
 *       - Portals
 *     summary: Create a portal
 *     description: Creates a new portal session for the given station. The station must have at least one tool pack configured.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [stationId]
 *             properties:
 *               stationId:
 *                 type: string
 *                 description: ID of the station to open a portal for
 *     responses:
 *       201:
 *         description: Portal created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   type: object
 *                   properties:
 *                     portalId:
 *                       type: string
 *                     stationContext:
 *                       type: object
 *                       additionalProperties: true
 *                     portal:
 *                       $ref: '#/components/schemas/Portal'
 *       400:
 *         description: Invalid payload or station has no tool packs
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Station not found
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
portalRouter.post(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = CreatePortalBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(400, ApiCode.PORTAL_NOT_FOUND, "Invalid portal payload")
        );
      }

      const { organizationId, userId } = req.application!.metadata;
      const { stationId } = parsed.data;

      const result = await PortalService.createPortal({
        stationId,
        organizationId,
        userId,
      });

      logger.info(
        { portalId: result.portalId, stationId, organizationId },
        "Portal created"
      );

      return HttpService.success<PortalCreateResponsePayload & { portalId: string; stationContext: unknown }>(
        res,
        {
          portal: { id: result.portalId } as unknown as PortalCreateResponsePayload["portal"],
          portalId: result.portalId,
          stationContext: result.stationContext,
        },
        201
      );
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to create portal"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(500, ApiCode.PORTAL_NOT_FOUND, "Failed to create portal")
      );
    }
  }
);

// ── GET /api/portals ──────────────────────────────────────────────────────

/**
 * @openapi
 * /api/portals:
 *   get:
 *     tags:
 *       - Portals
 *     summary: List portals
 *     description: Returns portals scoped to the authenticated user's organization, optionally filtered by station.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/limitParam'
 *       - $ref: '#/components/parameters/offsetParam'
 *       - $ref: '#/components/parameters/sortOrderParam'
 *       - in: query
 *         name: stationId
 *         schema:
 *           type: string
 *         description: Filter portals by station ID
 *     responses:
 *       200:
 *         description: Portals retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/PortalListResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
portalRouter.get(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { limit, offset, sortOrder, stationId } =
        PortalListRequestQuerySchema.parse(req.query);
      const { organizationId } = req.application!.metadata;

      const filters: SQL[] = [eq(portals.organizationId, organizationId)];
      if (stationId) {
        filters.push(eq(portals.stationId, stationId));
      }
      const where = and(...filters);

      const listOpts = {
        limit,
        offset,
        orderBy: { column: portals.created, direction: sortOrder },
      };

      const [data, total] = await Promise.all([
        DbService.repository.portals.findMany(where, listOpts),
        DbService.repository.portals.count(where),
      ]);

      return HttpService.success<PortalListResponsePayload>(res, {
        portals: data as unknown as PortalListResponsePayload["portals"],
        total,
        limit,
        offset,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to list portals"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(500, ApiCode.PORTAL_NOT_FOUND, "Failed to list portals")
      );
    }
  }
);

// ── GET /api/portals/:id ──────────────────────────────────────────────────

/**
 * @openapi
 * /api/portals/{id}:
 *   get:
 *     tags:
 *       - Portals
 *     summary: Get a portal
 *     description: Returns a portal with its full message history.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Portal ID
 *     responses:
 *       200:
 *         description: Portal retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/PortalWithMessages'
 *       404:
 *         description: Portal not found
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
portalRouter.get(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { organizationId } = req.application!.metadata;

      const { portal, messages } = await PortalService.getPortal(id);

      if (portal.organizationId !== organizationId) {
        return next(
          new ApiError(404, ApiCode.PORTAL_NOT_FOUND, "Portal not found")
        );
      }

      return HttpService.success<PortalGetResponsePayload>(res, {
        portal: portal as unknown as PortalGetResponsePayload["portal"],
        messages: messages as unknown as PortalGetResponsePayload["messages"],
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to fetch portal"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(500, ApiCode.PORTAL_NOT_FOUND, "Failed to fetch portal")
      );
    }
  }
);

// ── DELETE /api/portals/:id/messages ──────────────────────────────────────

/**
 * @openapi
 * /api/portals/{id}/messages:
 *   delete:
 *     tags:
 *       - Portals
 *     summary: Reset a portal
 *     description: Deletes all messages in the portal, resetting the conversation.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Portal ID
 *     responses:
 *       200:
 *         description: Messages deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   type: object
 *                   properties:
 *                     portalId:
 *                       type: string
 *                     deletedMessages:
 *                       type: number
 *       404:
 *         description: Portal not found
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
portalRouter.delete(
  "/:id/messages",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { organizationId } = req.application!.metadata;

      const portal = await DbService.repository.portals.findById(id);
      if (!portal || portal.organizationId !== organizationId) {
        return next(
          new ApiError(404, ApiCode.PORTAL_NOT_FOUND, "Portal not found")
        );
      }

      const deletedMessages = await PortalService.resetPortal(id);

      logger.info({ portalId: id, deletedMessages }, "Portal reset");

      return HttpService.success(res, { portalId: id, deletedMessages });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to reset portal"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(500, ApiCode.PORTAL_NOT_FOUND, "Failed to reset portal")
      );
    }
  }
);

// ── POST /api/portals/:id/messages ────────────────────────────────────────

/**
 * @openapi
 * /api/portals/{id}/messages:
 *   post:
 *     tags:
 *       - Portals
 *     summary: Send a message
 *     description: Persists a user message to the portal. Connect to the SSE stream endpoint to receive the AI response.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Portal ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message:
 *                 type: string
 *                 example: What is the average revenue per customer?
 *     responses:
 *       200:
 *         description: Message persisted, streaming started
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   type: object
 *                   properties:
 *                     portalId:
 *                       type: string
 *                     status:
 *                       type: string
 *                       example: streaming
 *       400:
 *         description: Invalid payload
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Portal not found
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
// ── PATCH /api/portals/:id ───────────────────────────────────────────────

/**
 * @openapi
 * /api/portals/{id}:
 *   patch:
 *     tags:
 *       - Portals
 *     summary: Rename a portal
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Portal ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *                 example: Updated Portal Name
 *     responses:
 *       200:
 *         description: Portal renamed successfully
 *       400:
 *         description: Invalid payload
 *       404:
 *         description: Portal not found
 *       500:
 *         description: Internal server error
 */
portalRouter.patch(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { organizationId, userId } = req.application!.metadata;

      const { name } = req.body as { name?: string };
      if (!name || typeof name !== "string" || name.trim() === "") {
        return next(
          new ApiError(400, ApiCode.PORTAL_NOT_FOUND, "name is required")
        );
      }

      const existing = await DbService.repository.portals.findById(id);
      if (!existing || existing.organizationId !== organizationId) {
        return next(
          new ApiError(404, ApiCode.PORTAL_NOT_FOUND, "Portal not found")
        );
      }

      const portal = await DbService.repository.portals.update(
        id,
        { name: name.trim(), updated: Date.now(), updatedBy: userId } as never
      );

      logger.info({ id }, "Portal renamed");

      return HttpService.success(res, { portal });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to rename portal"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(500, ApiCode.PORTAL_NOT_FOUND, "Failed to rename portal")
      );
    }
  }
);

// ── DELETE /api/portals/:id ───────────────────────────────────────────────

portalRouter.delete(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { organizationId, userId } = req.application!.metadata;

      const portal = await DbService.repository.portals.findById(id);
      if (!portal || portal.organizationId !== organizationId) {
        return next(
          new ApiError(404, ApiCode.PORTAL_NOT_FOUND, "Portal not found")
        );
      }

      await DbService.transaction(async (tx) => {
        // Detach pinned results — keep them but remove the portal link
        await tx
          .update(portalResults)
          .set({ portalId: null, updated: Date.now(), updatedBy: userId })
          .where(eq(portalResults.portalId, id));

        // Hard-delete messages — no value without the portal
        await tx
          .delete(portalMessages)
          .where(eq(portalMessages.portalId, id));

        // Soft-delete the portal
        await DbService.repository.portals.softDelete(id, userId, tx);
      });

      logger.info({ id }, "Portal deleted with messages cleaned up");

      return HttpService.success(res, { id });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to delete portal"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(500, ApiCode.PORTAL_NOT_FOUND, "Failed to delete portal")
      );
    }
  }
);

// ── POST /api/portals/:id/messages ───────────────────────────────────────

portalRouter.post(
  "/:id/messages",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { organizationId } = req.application!.metadata;

      const parsed = SendMessageBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(400, ApiCode.PORTAL_NOT_FOUND, "Invalid message payload")
        );
      }

      // Verify portal belongs to org
      const portal = await DbService.repository.portals.findById(id);
      if (!portal || portal.organizationId !== organizationId) {
        return next(
          new ApiError(404, ApiCode.PORTAL_NOT_FOUND, "Portal not found")
        );
      }

      await PortalService.addMessage(id, {
        role: "user",
        content: parsed.data.message,
      });

      logger.info({ portalId: id }, "User message added");

      return HttpService.success(res, { portalId: id, status: "streaming" });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to add portal message"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(500, ApiCode.PORTAL_NOT_FOUND, "Failed to add message")
      );
    }
  }
);
