import { Router, Request, Response, NextFunction } from "express";
import { eq, ilike, and, inArray, type SQL } from "drizzle-orm";

import { StationModelFactory } from "@portalai/core/models";
import {
  StationListRequestQuerySchema,
  CreateStationBodySchema,
  UpdateStationBodySchema,
  type StationListResponsePayload,
  type StationGetResponsePayload,
  type StationCreateResponsePayload,
  type StationUpdateResponsePayload,
} from "@portalai/core/contracts";
import { createLogger } from "../utils/logger.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "../services/db.service.js";
import { stations, organizations, portalResults } from "../db/schema/index.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { SystemUtilities } from "../utils/system.util.js";

const logger = createLogger({ module: "station" });

export const stationRouter = Router();

// ── GET /api/stations ─────────────────────────────────────────────────────

/**
 * @openapi
 * /api/stations:
 *   get:
 *     tags:
 *       - Stations
 *     summary: List stations
 *     description: Returns a paginated list of stations scoped to the authenticated user's organization.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/limitParam'
 *       - $ref: '#/components/parameters/offsetParam'
 *       - $ref: '#/components/parameters/sortOrderParam'
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [name, created]
 *           default: created
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Filter stations by name (case-insensitive)
 *     responses:
 *       200:
 *         description: Stations retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/StationListResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
stationRouter.get(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { limit, offset, sortBy, sortOrder, search } =
        StationListRequestQuerySchema.parse(req.query);
      const { organizationId } = req.application!.metadata;

      const filters: SQL[] = [eq(stations.organizationId, organizationId)];
      if (search) {
        filters.push(ilike(stations.name, `%${search}%`));
      }
      const where = and(...filters);

      const column =
        sortBy === "name" ? stations.name : stations.created;
      const listOpts = {
        limit,
        offset,
        orderBy: { column, direction: sortOrder },
      };

      const [data, total] = await Promise.all([
        DbService.repository.stations.findMany(where, listOpts),
        DbService.repository.stations.count(where),
      ]);

      return HttpService.success<StationListResponsePayload>(res, {
        stations: data as unknown as StationListResponsePayload["stations"],
        total,
        limit,
        offset,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to list stations"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(500, ApiCode.STATION_NOT_FOUND, "Failed to list stations")
      );
    }
  }
);

// ── GET /api/stations/:id ─────────────────────────────────────────────────

/**
 * @openapi
 * /api/stations/{id}:
 *   get:
 *     tags:
 *       - Stations
 *     summary: Get a station
 *     description: Returns a single station with its connector instances.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Station ID
 *     responses:
 *       200:
 *         description: Station retrieved successfully
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
 *                     station:
 *                       $ref: '#/components/schemas/StationWithInstances'
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
stationRouter.get(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { organizationId } = req.application!.metadata;

      const station = await DbService.repository.stations.findById(id);
      if (!station || station.organizationId !== organizationId) {
        return next(
          new ApiError(404, ApiCode.STATION_NOT_FOUND, "Station not found")
        );
      }

      const instances =
        await DbService.repository.stationInstances.findByStationId(id);

      return HttpService.success<StationGetResponsePayload>(res, {
        station: {
          ...station,
          instances,
        } as unknown as StationGetResponsePayload["station"],
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to fetch station"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(500, ApiCode.STATION_NOT_FOUND, "Failed to fetch station")
      );
    }
  }
);

// ── POST /api/stations ────────────────────────────────────────────────────

/**
 * @openapi
 * /api/stations:
 *   post:
 *     tags:
 *       - Stations
 *     summary: Create a station
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, toolPacks]
 *             properties:
 *               name:
 *                 type: string
 *                 example: Sales Analytics
 *               description:
 *                 type: string
 *                 nullable: true
 *               toolPacks:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: [data_query]
 *               connectorInstanceIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Connector instances to link to this station
 *     responses:
 *       201:
 *         description: Station created successfully
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
 *                     station:
 *                       $ref: '#/components/schemas/Station'
 *       400:
 *         description: Invalid payload
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
stationRouter.post(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = CreateStationBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(400, ApiCode.STATION_NOT_FOUND, "Invalid station payload")
        );
      }

      const { organizationId, userId } = req.application!.metadata;
      const { name, description, connectorInstanceIds, toolPacks } = parsed.data;

      const factory = new StationModelFactory();
      const model = factory.create(userId);
      model.update({
        organizationId,
        name,
        description: description ?? null,
        toolPacks: toolPacks ?? ["data_query"],
      });

      const station = await DbService.repository.stations.create(
        model.parse()
      );

      if (connectorInstanceIds && connectorInstanceIds.length > 0) {
        const now = Date.now();
        await Promise.all(
          connectorInstanceIds.map((connectorInstanceId) =>
            DbService.repository.stationInstances.create({
              id: SystemUtilities.id.v4.generate(),
              stationId: station.id,
              connectorInstanceId,
              created: now,
              createdBy: userId,
              updated: null,
              updatedBy: null,
              deleted: null,
              deletedBy: null,
            })
          )
        );
      }

      logger.info({ id: station.id, organizationId }, "Station created");

      return HttpService.success<StationCreateResponsePayload>(
        res,
        { station: station as unknown as StationCreateResponsePayload["station"] },
        201
      );
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to create station"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(500, ApiCode.STATION_NOT_FOUND, "Failed to create station")
      );
    }
  }
);

// ── PATCH /api/stations/:id ───────────────────────────────────────────────

/**
 * @openapi
 * /api/stations/{id}:
 *   patch:
 *     tags:
 *       - Stations
 *     summary: Update a station
 *     description: Updates station fields. Providing connectorInstanceIds replaces all existing instances.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *                 nullable: true
 *               toolPacks:
 *                 type: array
 *                 items:
 *                   type: string
 *               connectorInstanceIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Replaces all linked connector instances
 *     responses:
 *       200:
 *         description: Station updated successfully
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
 *                     station:
 *                       $ref: '#/components/schemas/Station'
 *       400:
 *         description: Invalid payload
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
stationRouter.patch(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { organizationId, userId } = req.application!.metadata;

      const parsed = UpdateStationBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(400, ApiCode.STATION_NOT_FOUND, "Invalid station payload")
        );
      }

      const existing = await DbService.repository.stations.findById(id);
      if (!existing || existing.organizationId !== organizationId) {
        return next(
          new ApiError(404, ApiCode.STATION_NOT_FOUND, "Station not found")
        );
      }

      const { name, description, connectorInstanceIds, toolPacks } = parsed.data;
      const updates: Record<string, unknown> = {
        updated: Date.now(),
        updatedBy: userId,
      };
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (toolPacks !== undefined) updates.toolPacks = toolPacks;

      const station = await DbService.repository.stations.update(
        id,
        updates as never
      );

      if (connectorInstanceIds !== undefined) {
        const existingInstances =
          await DbService.repository.stationInstances.findByStationId(id);
        await Promise.all(
          existingInstances.map((si) =>
            DbService.repository.stationInstances.hardDelete(si.id)
          )
        );
        if (connectorInstanceIds.length > 0) {
          const now = Date.now();
          await Promise.all(
            connectorInstanceIds.map((connectorInstanceId) =>
              DbService.repository.stationInstances.create({
                id: SystemUtilities.id.v4.generate(),
                stationId: id,
                connectorInstanceId,
                created: now,
                createdBy: userId,
                updated: null,
                updatedBy: null,
                deleted: null,
                deletedBy: null,
              })
            )
          );
        }
      }

      logger.info({ id }, "Station updated");

      return HttpService.success<StationUpdateResponsePayload>(res, {
        station: station as unknown as StationUpdateResponsePayload["station"],
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to update station"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(500, ApiCode.STATION_NOT_FOUND, "Failed to update station")
      );
    }
  }
);

// ── DELETE /api/stations/:id ──────────────────────────────────────────────

/**
 * @openapi
 * /api/stations/{id}:
 *   delete:
 *     tags:
 *       - Stations
 *     summary: Delete a station
 *     description: Soft-deletes a station.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Station deleted successfully
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
stationRouter.delete(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { organizationId, userId } = req.application!.metadata;

      const existing = await DbService.repository.stations.findById(id);
      if (!existing || existing.organizationId !== organizationId) {
        return next(
          new ApiError(404, ApiCode.STATION_NOT_FOUND, "Station not found")
        );
      }

      await DbService.transaction(async (tx) => {
        const stationPortals = await DbService.repository.portals.findByStation(id, {}, tx);

        if (stationPortals.length > 0) {
          const portalIds = stationPortals.map((p) => p.id);

          // Detach pinned results — keep them but remove the portal link
          await tx
            .update(portalResults)
            .set({ portalId: null, updated: Date.now(), updatedBy: userId })
            .where(inArray(portalResults.portalId, portalIds));

          // Hard-delete messages — no value without the portal
          for (const portalId of portalIds) {
            await DbService.repository.portalMessages.deleteByPortal(portalId, tx);
          }

          // Soft-delete all portals
          await DbService.repository.portals.softDeleteMany(portalIds, userId, tx);
        }

        // Clear the org's defaultStationId if it points to this station
        await DbService.repository.organizations.updateWhere(
          and(eq(organizations.id, organizationId), eq(organizations.defaultStationId, id)) as SQL,
          { defaultStationId: null },
          tx
        );

        await DbService.repository.stations.softDelete(id, userId, tx);
      });
      logger.info({ id }, "Station soft-deleted");

      return HttpService.success(res, { id });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to delete station"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(500, ApiCode.STATION_NOT_FOUND, "Failed to delete station")
      );
    }
  }
);
