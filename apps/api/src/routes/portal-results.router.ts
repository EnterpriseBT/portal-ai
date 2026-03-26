import { Router, Request, Response, NextFunction } from "express";
import { eq, and, ilike, type SQL } from "drizzle-orm";

import {
  PinResultBodySchema,
  PortalListRequestQuerySchema,
} from "@portalai/core/contracts";
import { createLogger } from "../utils/logger.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "../services/db.service.js";
import { portalResults } from "../db/schema/index.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { SystemUtilities } from "../utils/system.util.js";

const logger = createLogger({ module: "portal-results" });

export const portalResultsRouter = Router();

// ── POST /api/portal-results ──────────────────────────────────────────────

/**
 * @openapi
 * /api/portal-results:
 *   post:
 *     tags:
 *       - Portal Results
 *     summary: Pin a result
 *     description: Pins a content block from the most recent assistant message in a portal as a named result.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [portalId, blockIndex, name]
 *             properties:
 *               portalId:
 *                 type: string
 *                 description: Portal to pin from
 *               blockIndex:
 *                 type: integer
 *                 description: Index of the content block in the last assistant message
 *                 example: 0
 *               name:
 *                 type: string
 *                 description: Display name for the pinned result
 *                 example: Q1 Revenue Chart
 *     responses:
 *       201:
 *         description: Result pinned successfully
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
 *                     portalResult:
 *                       $ref: '#/components/schemas/PortalResult'
 *       400:
 *         description: Invalid payload or block index out of range
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Portal or assistant message not found
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
portalResultsRouter.post(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = PinResultBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(400, ApiCode.PORTAL_RESULT_NOT_FOUND, "Invalid pin result payload")
        );
      }

      const { organizationId, userId } = req.application!.metadata;
      const { portalId, messageId, blockIndex, name } = parsed.data;

      // Load portal to get stationId + verify org
      const portal = await DbService.repository.portals.findById(portalId);
      if (!portal || portal.organizationId !== organizationId) {
        return next(
          new ApiError(404, ApiCode.PORTAL_NOT_FOUND, "Portal not found")
        );
      }

      // Find the target assistant message
      const messages =
        await DbService.repository.portalMessages.findByPortal(portalId);

      let targetMsg;
      if (messageId) {
        targetMsg = messages.find((m) => m.id === messageId && m.role === "assistant");
      } else {
        const assistantMessages = messages.filter((m) => m.role === "assistant");
        targetMsg = assistantMessages[assistantMessages.length - 1];
      }

      if (!targetMsg) {
        return next(
          new ApiError(
            404,
            ApiCode.PORTAL_RESULT_NOT_FOUND,
            "No assistant message found in portal"
          )
        );
      }

      const blocks = targetMsg.blocks as Array<{
        type: string;
        content: unknown;
      }>;
      if (blockIndex >= blocks.length) {
        return next(
          new ApiError(
            400,
            ApiCode.PORTAL_RESULT_NOT_FOUND,
            "Block index out of range"
          )
        );
      }

      const block = blocks[blockIndex];
      const type =
        block.type === "vega-lite"
          ? ("vega-lite" as const)
          : ("text" as const);
      const content =
        typeof block.content === "object" && block.content !== null
          ? (block.content as Record<string, unknown>)
          : { value: block.content };

      const now = Date.now();
      const portalResult = await DbService.repository.portalResults.create({
        id: SystemUtilities.id.v4.generate(),
        organizationId,
        stationId: portal.stationId,
        portalId,
        name,
        type,
        content,
        created: now,
        createdBy: userId,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      });

      logger.info(
        { id: portalResult.id, portalId, stationId: portal.stationId },
        "Portal result pinned"
      );

      return HttpService.success(res, { portalResult }, 201);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to pin portal result"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
            500,
            ApiCode.PORTAL_RESULT_NOT_FOUND,
            "Failed to pin result"
          )
      );
    }
  }
);

// ── GET /api/portal-results ───────────────────────────────────────────────

/**
 * @openapi
 * /api/portal-results:
 *   get:
 *     tags:
 *       - Portal Results
 *     summary: List pinned results
 *     description: Returns pinned portal results scoped to the organization, optionally filtered by station.
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
 *         description: Filter results by station ID
 *     responses:
 *       200:
 *         description: Portal results retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/PortalResultListResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
portalResultsRouter.get(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { limit, offset, sortOrder, search, stationId } =
        PortalListRequestQuerySchema.parse(req.query);
      const { organizationId } = req.application!.metadata;

      const filters: SQL[] = [
        eq(portalResults.organizationId, organizationId),
      ];
      if (stationId) {
        filters.push(eq(portalResults.stationId, stationId));
      }
      if (search) {
        filters.push(ilike(portalResults.name, `%${search}%`));
      }
      const where = and(...filters);

      const listOpts = {
        limit,
        offset,
        orderBy: { column: portalResults.created, direction: sortOrder },
      };

      const [data, total] = await Promise.all([
        DbService.repository.portalResults.findMany(where, listOpts),
        DbService.repository.portalResults.count(where),
      ]);

      return HttpService.success(res, {
        portalResults: data,
        total,
        limit,
        offset,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to list portal results"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
            500,
            ApiCode.PORTAL_RESULT_NOT_FOUND,
            "Failed to list portal results"
          )
      );
    }
  }
);

// ── GET /api/portal-results/:id ───────────────────────────────────────────

portalResultsRouter.get(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { organizationId } = req.application!.metadata;

      const portalResult = await DbService.repository.portalResults.findById(id);
      if (!portalResult || portalResult.organizationId !== organizationId) {
        return next(
          new ApiError(404, ApiCode.PORTAL_RESULT_NOT_FOUND, "Portal result not found")
        );
      }

      return HttpService.success(res, { portalResult });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to get portal result"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
            500,
            ApiCode.PORTAL_RESULT_NOT_FOUND,
            "Failed to get portal result"
          )
      );
    }
  }
);

// ── PATCH /api/portal-results/:id ─────────────────────────────────────────

/**
 * @openapi
 * /api/portal-results/{id}:
 *   patch:
 *     tags:
 *       - Portal Results
 *     summary: Rename a pinned result
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Portal result ID
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
 *                 example: Updated Chart Name
 *     responses:
 *       200:
 *         description: Portal result renamed successfully
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
 *                     portalResult:
 *                       $ref: '#/components/schemas/PortalResult'
 *       400:
 *         description: Invalid payload
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Portal result not found
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
portalResultsRouter.patch(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { organizationId, userId } = req.application!.metadata;

      const { name } = req.body as { name?: string };
      if (!name || typeof name !== "string" || name.trim() === "") {
        return next(
          new ApiError(400, ApiCode.PORTAL_RESULT_NOT_FOUND, "name is required")
        );
      }

      const existing = await DbService.repository.portalResults.findById(id);
      if (!existing || existing.organizationId !== organizationId) {
        return next(
          new ApiError(404, ApiCode.PORTAL_RESULT_NOT_FOUND, "Portal result not found")
        );
      }

      const portalResult = await DbService.repository.portalResults.update(
        id,
        { name, updated: Date.now(), updatedBy: userId } as never
      );

      logger.info({ id }, "Portal result renamed");

      return HttpService.success(res, { portalResult });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to rename portal result"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
            500,
            ApiCode.PORTAL_RESULT_NOT_FOUND,
            "Failed to rename portal result"
          )
      );
    }
  }
);

// ── DELETE /api/portal-results/:id ────────────────────────────────────────

/**
 * @openapi
 * /api/portal-results/{id}:
 *   delete:
 *     tags:
 *       - Portal Results
 *     summary: Delete a pinned result
 *     description: Soft-deletes a pinned portal result.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Portal result ID
 *     responses:
 *       200:
 *         description: Portal result deleted successfully
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
 *                     id:
 *                       type: string
 *       404:
 *         description: Portal result not found
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
portalResultsRouter.delete(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { organizationId, userId } = req.application!.metadata;

      const existing = await DbService.repository.portalResults.findById(id);
      if (!existing || existing.organizationId !== organizationId) {
        return next(
          new ApiError(404, ApiCode.PORTAL_RESULT_NOT_FOUND, "Portal result not found")
        );
      }

      await DbService.repository.portalResults.softDelete(id, userId);
      logger.info({ id }, "Portal result soft-deleted");

      return HttpService.success(res, { id });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to delete portal result"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
            500,
            ApiCode.PORTAL_RESULT_NOT_FOUND,
            "Failed to delete portal result"
          )
      );
    }
  }
);
