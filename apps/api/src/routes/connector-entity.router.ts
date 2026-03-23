import { Router, Request, Response, NextFunction } from "express";
import { eq, and, or, ilike, type SQL, type Column } from "drizzle-orm";

import { ConnectorEntityModelFactory } from "@portalai/core/models";
import {
  ConnectorEntityListRequestQuerySchema,
  type ConnectorEntityListResponsePayload,
  type ConnectorEntityListWithMappingsResponsePayload,
  type ConnectorEntityListWithInstanceResponsePayload,
  type ConnectorEntityListWithTagsResponsePayload,
  type ConnectorEntityGetResponsePayload,
  ConnectorEntityCreateRequestBodySchema,
  type ConnectorEntityCreateResponsePayload,
} from "@portalai/core/contracts";
import { createLogger } from "../utils/logger.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "../services/db.service.js";
import { connectorEntities } from "../db/schema/index.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { entityRecordRouter } from "./entity-record.router.js";
import { entityTagAssignmentRouter } from "./entity-tag-assignment.router.js";

const logger = createLogger({ module: "connector-entity" });

export const connectorEntityRouter = Router();

// Nest the entity records router under /:connectorEntityId/records
connectorEntityRouter.use("/:connectorEntityId/records", entityRecordRouter);

// Nest the entity tag assignments router under /:connectorEntityId/tags
connectorEntityRouter.use("/:connectorEntityId/tags", entityTagAssignmentRouter);

/** Map of sortable field names to their Drizzle columns. */
const SORTABLE_COLUMNS: Record<string, Column> = {
  key: connectorEntities.key,
  label: connectorEntities.label,
  created: connectorEntities.created,
};

/**
 * @openapi
 * /api/connector-entities:
 *   get:
 *     tags:
 *       - Connector Entities
 *     summary: List connector entities
 *     description: Returns a paginated, filterable, and sortable list of connector entities scoped to the authenticated user's organization.
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
 *           enum: [key, label, created]
 *           default: created
 *         description: Field to sort by
 *       - in: query
 *         name: connectorInstanceId
 *         schema:
 *           type: string
 *         description: Filter by connector instance ID
 *       - in: query
 *         name: include
 *         schema:
 *           type: string
 *           enum: [fieldMappings, connectorInstance, tags]
 *         description: Include related data in each result — fieldMappings (with column definitions), connectorInstance, or tags
 *       - in: query
 *         name: tagIds
 *         schema:
 *           type: string
 *         description: Comma-separated list of entity tag IDs to filter by; returns only entities assigned at least one of the given tags (composable with include=tags)
 *     responses:
 *       200:
 *         description: Paginated list of connector entities
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/ConnectorEntityListResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
connectorEntityRouter.get(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { limit, offset, sortBy, sortOrder, search, connectorInstanceId, include, tagIds: tagIdsRaw } =
        ConnectorEntityListRequestQuerySchema.parse(req.query);

      const organizationId = req.application!.metadata.organizationId;
      const filters: SQL[] = [eq(connectorEntities.organizationId, organizationId)];

      if (connectorInstanceId) {
        filters.push(eq(connectorEntities.connectorInstanceId, connectorInstanceId));
      }

      if (search) {
        filters.push(or(
          ilike(connectorEntities.key, `%${search}%`),
          ilike(connectorEntities.label, `%${search}%`),
        )!);
      }

      const tagIds = tagIdsRaw ? tagIdsRaw.split(",").map((id) => id.trim()).filter(Boolean) : undefined;

      const where = and(...filters);
      const column = SORTABLE_COLUMNS[sortBy] ?? SORTABLE_COLUMNS.created;
      const listOpts = { limit, offset, orderBy: { column, direction: sortOrder } };

      const fetchEntities = async () => {
        if (tagIds && tagIds.length > 0) {
          // Filter by tag IDs — fetch only entities assigned any of the given tags
          const filtered = await DbService.repository.connectorEntities.findManyByTagIds(
            organizationId,
            tagIds,
            listOpts
          );
          if (include === "tags" && filtered.length > 0) {
            const ids = filtered.map((e) => e.id);
            const tagsByEntity = await DbService.repository.entityTagAssignments.findByConnectorEntityIds(ids);
            return filtered.map((entity) => ({ ...entity, tags: tagsByEntity.get(entity.id) ?? [] }));
          }
          return filtered;
        }
        if (include === "fieldMappings") {
          return DbService.repository.connectorEntities.findManyWithFieldMappings(where, listOpts);
        }
        if (include === "connectorInstance") {
          return DbService.repository.connectorEntities.findManyWithInstance(where, listOpts);
        }
        if (include === "tags") {
          return DbService.repository.connectorEntities.findManyWithTags(where, listOpts);
        }
        return DbService.repository.connectorEntities.findMany(where, listOpts);
      };

      const [data, total] = await Promise.all([
        fetchEntities(),
        tagIds && tagIds.length > 0
          ? Promise.resolve(0) // resolved below from data.length
          : DbService.repository.connectorEntities.count(where),
      ]).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.CONNECTOR_ENTITY_FETCH_FAILED, error instanceof Error ? error.message : "Failed to list connector entities");
      });

      // When filtering by tagIds, total reflects the filtered result set length
      const resolvedTotal = tagIds && tagIds.length > 0 ? data.length : total;

      type ResponsePayload = ConnectorEntityListResponsePayload | ConnectorEntityListWithMappingsResponsePayload | ConnectorEntityListWithInstanceResponsePayload | ConnectorEntityListWithTagsResponsePayload;
      return HttpService.success<ResponsePayload>(res, {
        connectorEntities: data as unknown as ConnectorEntityListWithMappingsResponsePayload["connectorEntities"],
        total: resolvedTotal,
        limit,
        offset,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to list connector entities"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.CONNECTOR_ENTITY_FETCH_FAILED, error instanceof Error ? error.message : "Failed to list connector entities"));
    }
  }
);

/**
 * @openapi
 * /api/connector-entities/{id}:
 *   get:
 *     tags:
 *       - Connector Entities
 *     summary: Get a connector entity by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Connector entity ID
 *     responses:
 *       200:
 *         description: Connector entity found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/ConnectorEntityGetResponse'
 *       404:
 *         description: Connector entity not found
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
connectorEntityRouter.get(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      logger.info({ id }, "GET /api/connector-entities/:id called");

      const connectorEntity = await DbService.repository.connectorEntities.findById(id).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.CONNECTOR_ENTITY_FETCH_FAILED, error instanceof Error ? error.message : "Failed to fetch connector entity");
      });

      if (!connectorEntity) {
        return next(
          new ApiError(404, ApiCode.CONNECTOR_ENTITY_NOT_FOUND, "Connector entity not found")
        );
      }

      return HttpService.success<ConnectorEntityGetResponsePayload>(res, {
        connectorEntity: connectorEntity as unknown as ConnectorEntityGetResponsePayload["connectorEntity"],
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to fetch connector entity"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.CONNECTOR_ENTITY_FETCH_FAILED, error instanceof Error ? error.message : "Failed to fetch connector entity"));
    }
  }
);

/**
 * @openapi
 * /api/connector-entities:
 *   post:
 *     tags:
 *       - Connector Entities
 *     summary: Create a connector entity
 *     description: Creates a new connector entity scoped to the authenticated user's organization.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - connectorInstanceId
 *               - key
 *               - label
 *             properties:
 *               connectorInstanceId:
 *                 type: string
 *                 description: ID of the parent connector instance
 *               key:
 *                 type: string
 *                 pattern: '^[a-z][a-z0-9_]*$'
 *                 description: Machine-readable key (lowercase, underscores)
 *               label:
 *                 type: string
 *                 minLength: 1
 *                 description: Human-readable label
 *     responses:
 *       201:
 *         description: Connector entity created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/ConnectorEntityGetResponse'
 *       400:
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Connector instance not found
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
connectorEntityRouter.post(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = ConnectorEntityCreateRequestBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(400, ApiCode.CONNECTOR_ENTITY_INVALID_PAYLOAD, "Invalid connector entity payload")
        );
      }

      // Verify connector instance exists
      const connectorInstance = await DbService.repository.connectorInstances.findById(
        parsed.data.connectorInstanceId
      );
      if (!connectorInstance) {
        return next(
          new ApiError(404, ApiCode.CONNECTOR_INSTANCE_NOT_FOUND, "Connector instance not found")
        );
      }

      const { userId, organizationId } = req.application!.metadata;

      const factory = new ConnectorEntityModelFactory();
      const model = factory.create(userId);
      model.update({
        organizationId,
        connectorInstanceId: parsed.data.connectorInstanceId,
        key: parsed.data.key,
        label: parsed.data.label,
      });

      const connectorEntity = await DbService.repository.connectorEntities.create(
        model.parse()
      ).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.CONNECTOR_ENTITY_CREATE_FAILED, error instanceof Error ? error.message : "Failed to create connector entity");
      });

      logger.info(
        { id: connectorEntity.id, connectorInstanceId: parsed.data.connectorInstanceId },
        "Connector entity created"
      );

      return HttpService.success<ConnectorEntityCreateResponsePayload>(
        res,
        { connectorEntity: connectorEntity as unknown as ConnectorEntityCreateResponsePayload["connectorEntity"] },
        201
      );
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to create connector entity"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.CONNECTOR_ENTITY_CREATE_FAILED, error instanceof Error ? error.message : "Failed to create connector entity"));
    }
  }
);

/**
 * @openapi
 * /api/connector-entities/{id}:
 *   delete:
 *     tags:
 *       - Connector Entities
 *     summary: Delete a connector entity
 *     description: Soft-deletes a connector entity by ID.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Connector entity ID
 *     responses:
 *       200:
 *         description: Connector entity deleted
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
 *         description: Connector entity not found
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
connectorEntityRouter.delete(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      const existing = await DbService.repository.connectorEntities.findById(id);
      if (!existing) {
        return next(
          new ApiError(404, ApiCode.CONNECTOR_ENTITY_NOT_FOUND, "Connector entity not found")
        );
      }

      const { userId } = req.application!.metadata;

      await DbService.repository.connectorEntities.softDelete(id, userId).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.CONNECTOR_ENTITY_DELETE_FAILED, error instanceof Error ? error.message : "Failed to delete connector entity");
      });

      logger.info({ id }, "Connector entity soft-deleted");

      return HttpService.success(res, { id });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to delete connector entity"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.CONNECTOR_ENTITY_DELETE_FAILED, error instanceof Error ? error.message : "Failed to delete connector entity"));
    }
  }
);
