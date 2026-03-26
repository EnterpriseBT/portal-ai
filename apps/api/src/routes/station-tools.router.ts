import { Router, Request, Response, NextFunction } from "express";

import {
  AssignStationToolBodySchema,
  type StationToolListResponsePayload,
  type StationToolAssignResponsePayload,
} from "@portalai/core/contracts";
import { createLogger } from "../utils/logger.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "../services/db.service.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { SystemUtilities } from "../utils/system.util.js";

const logger = createLogger({ module: "station-tools" });

/**
 * Built-in pack tool names — used to detect shadow conflicts when assigning
 * a custom webhook tool to a station.
 */
const PACK_TOOL_NAMES = new Set([
  "sql_query",
  "visualize",
  "resolve_identity",
  "describe_column",
  "correlate",
  "detect_outliers",
  "cluster",
  "regression",
  "trend",
  "technical_indicator",
  "npv",
  "irr",
  "amortize",
  "sharpe_ratio",
  "max_drawdown",
  "rolling_returns",
  "web_search",
]);

export const stationToolsRouter = Router();

// ── GET /api/stations/:stationId/tools ────────────────────────────────────

/**
 * @openapi
 * /api/stations/{stationId}/tools:
 *   get:
 *     tags:
 *       - Station Tools
 *     summary: List station tools
 *     description: Returns all custom tool assignments for the given station, including the full organization tool definition.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: stationId
 *         required: true
 *         schema:
 *           type: string
 *         description: Station ID
 *     responses:
 *       200:
 *         description: Station tools retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/StationToolListResponse'
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
stationToolsRouter.get(
  "/:stationId/tools",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { stationId } = req.params;
      const { organizationId } = req.application!.metadata;

      const station = await DbService.repository.stations.findById(stationId);
      if (!station || station.organizationId !== organizationId) {
        return next(
          new ApiError(404, ApiCode.STATION_NOT_FOUND, "Station not found")
        );
      }

      const stationTools =
        await DbService.repository.stationTools.findByStationId(stationId);

      return HttpService.success<StationToolListResponsePayload>(res, {
        stationTools:
          stationTools as unknown as StationToolListResponsePayload["stationTools"],
        total: stationTools.length,
        limit: stationTools.length,
        offset: 0,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to list station tools"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.STATION_NOT_FOUND,
              "Failed to list station tools"
            )
      );
    }
  }
);

// ── POST /api/stations/:stationId/tools ───────────────────────────────────

/**
 * @openapi
 * /api/stations/{stationId}/tools:
 *   post:
 *     tags:
 *       - Station Tools
 *     summary: Assign a tool to a station
 *     description: >
 *       Links an organization tool to a station. The tool's name must not shadow a
 *       built-in pack tool name (e.g. `sql_query`, `visualize`). Returns 409 if a
 *       name conflict is detected.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: stationId
 *         required: true
 *         schema:
 *           type: string
 *         description: Station ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [organizationToolId]
 *             properties:
 *               organizationToolId:
 *                 type: string
 *                 description: ID of the organization tool to assign
 *     responses:
 *       201:
 *         description: Tool assigned successfully
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
 *                     stationTool:
 *                       $ref: '#/components/schemas/StationTool'
 *       400:
 *         description: Invalid payload
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Station or organization tool not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       409:
 *         description: Tool name shadows a built-in pack tool
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
stationToolsRouter.post(
  "/:stationId/tools",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { stationId } = req.params;
      const { organizationId, userId } = req.application!.metadata;

      const parsed = AssignStationToolBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.STATION_NOT_FOUND,
            "Invalid station tool assignment payload"
          )
        );
      }

      const { organizationToolId } = parsed.data;

      // Verify station exists and belongs to org
      const station = await DbService.repository.stations.findById(stationId);
      if (!station || station.organizationId !== organizationId) {
        return next(
          new ApiError(404, ApiCode.STATION_NOT_FOUND, "Station not found")
        );
      }

      // Verify org tool exists and belongs to org
      const orgTool =
        await DbService.repository.organizationTools.findById(organizationToolId);
      if (!orgTool || orgTool.organizationId !== organizationId) {
        return next(
          new ApiError(404, ApiCode.ORG_TOOL_NOT_FOUND, "Organization tool not found")
        );
      }

      // Validate name does not shadow a built-in pack tool
      if (PACK_TOOL_NAMES.has(orgTool.name)) {
        return next(
          new ApiError(
            409,
            ApiCode.STATION_TOOL_NAME_SHADOW,
            `Tool name "${orgTool.name}" shadows a built-in pack tool`
          )
        );
      }

      const now = Date.now();
      const stationTool = await DbService.repository.stationTools.create({
        id: SystemUtilities.id.v4.generate(),
        stationId,
        organizationToolId,
        created: now,
        createdBy: userId,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      });

      logger.info(
        { stationId, organizationToolId, id: stationTool.id },
        "Station tool assigned"
      );

      return HttpService.success<StationToolAssignResponsePayload>(
        res,
        {
          stationTool:
            stationTool as unknown as StationToolAssignResponsePayload["stationTool"],
        },
        201
      );
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to assign station tool"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.STATION_NOT_FOUND,
              "Failed to assign station tool"
            )
      );
    }
  }
);

// ── DELETE /api/stations/:stationId/tools/:assignmentId ───────────────────

/**
 * @openapi
 * /api/stations/{stationId}/tools/{assignmentId}:
 *   delete:
 *     tags:
 *       - Station Tools
 *     summary: Unassign a tool from a station
 *     description: Permanently removes a custom tool assignment from a station (hard delete).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: stationId
 *         required: true
 *         schema:
 *           type: string
 *         description: Station ID
 *       - in: path
 *         name: assignmentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Station tool assignment ID
 *     responses:
 *       200:
 *         description: Tool unassigned successfully
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
 *         description: Station or assignment not found
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
stationToolsRouter.delete(
  "/:stationId/tools/:assignmentId",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { stationId, assignmentId } = req.params;
      const { organizationId } = req.application!.metadata;

      // Verify station exists and belongs to org
      const station = await DbService.repository.stations.findById(stationId);
      if (!station || station.organizationId !== organizationId) {
        return next(
          new ApiError(404, ApiCode.STATION_NOT_FOUND, "Station not found")
        );
      }

      // Verify assignment exists and belongs to this station
      const assignment =
        await DbService.repository.stationTools.findById(assignmentId);
      if (!assignment || assignment.stationId !== stationId) {
        return next(
          new ApiError(404, ApiCode.STATION_NOT_FOUND, "Station tool assignment not found")
        );
      }

      await DbService.repository.stationTools.hardDelete(assignmentId);
      logger.info({ assignmentId, stationId }, "Station tool unassigned");

      return HttpService.success(res, { id: assignmentId });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to unassign station tool"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.STATION_NOT_FOUND,
              "Failed to unassign station tool"
            )
      );
    }
  }
);
