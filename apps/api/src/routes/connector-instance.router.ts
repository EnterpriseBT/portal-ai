import { Router, Request, Response, NextFunction } from "express";
import { eq, and, ilike, inArray, sql, type SQL, type Column } from "drizzle-orm";
import { ConnectorInstanceModelFactory } from "@portalai/core/models";
import { createLogger } from "../utils/logger.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "../services/db.service.js";
import { connectorInstances } from "../db/schema/index.js";
import {
  ConnectorInstanceListRequestQuerySchema,
  type ConnectorInstanceListResponsePayload,
  type ConnectorInstanceListWithDefinitionResponsePayload,
  type ConnectorInstanceGetResponsePayload,
  ConnectorInstanceCreateRequestBodySchema,
  ConnectorInstancePatchRequestBodySchema,
  type ConnectorInstanceCreateResponsePayload,
  type ConnectorInstanceApi,
  type ConnectorInstanceWithDefinitionApi,
} from "@portalai/core/contracts";
import { encryptCredentials } from "../utils/crypto.util.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";

const logger = createLogger({ module: "connector-instance" });

export const connectorInstanceRouter = Router();

/** Map of sortable field names to their Drizzle columns. */
const SORTABLE_COLUMNS: Record<string, Column> = {
  name: connectorInstances.name,
  status: connectorInstances.status,
  created: connectorInstances.created,
};

/**
 * @openapi
 * /api/connector-instances:
 *   get:
 *     tags:
 *       - Connector Instances
 *     summary: List connector instances
 *     description: Returns a paginated, filterable, and sortable list of connector instances.
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
 *           enum: [name, status, created]
 *           default: created
 *         description: Field to sort by
 *       - in: query
 *         name: connectorDefinitionId
 *         schema:
 *           type: string
 *         description: Filter by connector definition ID
 *       - in: query
 *         name: organizationId
 *         schema:
 *           type: string
 *         description: Filter by organization ID
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Comma-separated list of statuses to filter by (active, inactive, error, pending)
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Case-insensitive search on instance name
 *       - in: query
 *         name: include
 *         schema:
 *           type: string
 *         description: Comma-separated list of related data to include — connectorDefinition
 *       - in: query
 *         name: capability
 *         schema:
 *           type: string
 *         description: Comma-separated list of required capability flags (read, write, sync). Only instances where all specified flags are enabled will be returned.
 *     responses:
 *       200:
 *         description: Paginated list of connector instances
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/ConnectorInstanceListResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
connectorInstanceRouter.get(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { limit, offset, sortBy, sortOrder, connectorDefinitionId, status, search, include, capability } =
        ConnectorInstanceListRequestQuerySchema.parse(req.query);

      const VALID_CAPABILITIES = ["sync", "read", "write", "push"] as const;

      const filters: SQL[] = [eq(connectorInstances.organizationId, req.application?.metadata.organizationId as string)];

      if (connectorDefinitionId) {
        filters.push(eq(connectorInstances.connectorDefinitionId, connectorDefinitionId));
      }
      if (status) {
        const statuses = status.split(",").map((s) => s.trim()).filter(Boolean);
        if (statuses.length === 1) {
          filters.push(eq(connectorInstances.status, statuses[0] as never));
        } else if (statuses.length > 1) {
          filters.push(inArray(connectorInstances.status, statuses as never[]));
        }
      }
      if (search) {
        filters.push(ilike(connectorInstances.name, `%${search}%`));
      }
      if (capability) {
        const caps = capability.split(",").map((s) => s.trim()).filter(Boolean);
        for (const cap of caps) {
          if (VALID_CAPABILITIES.includes(cap as (typeof VALID_CAPABILITIES)[number])) {
            filters.push(sql`${connectorInstances.enabledCapabilityFlags}->>${sql.raw(`'${cap}'`)} = 'true'`);
          }
        }
      }

      const where = and(...filters);
      const column = SORTABLE_COLUMNS[sortBy] ?? SORTABLE_COLUMNS.created;
      const include_ = include?.split(",").map((s) => s.trim()).filter(Boolean);
      const listOpts = { limit, offset, orderBy: { column, direction: sortOrder }, include: include_ };

      const [data, total] = await Promise.all([
        DbService.repository.connectorInstances.findMany(where, listOpts),
        DbService.repository.connectorInstances.count(where),
      ]).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.CONNECTOR_INSTANCE_FETCH_FAILED, error instanceof Error ? error.message : "Failed to list connector instances");
      });

      return HttpService.success<ConnectorInstanceListResponsePayload | ConnectorInstanceListWithDefinitionResponsePayload>(res, {
        connectorInstances: data as unknown as ConnectorInstanceListWithDefinitionResponsePayload["connectorInstances"],
        total,
        limit,
        offset,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to list connector instances"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.CONNECTOR_INSTANCE_FETCH_FAILED, error instanceof Error ? error.message : "Failed to list connector instances"));
    }
  }
);

/**
 * @openapi
 * /api/connector-instances/{id}:
 *   get:
 *     tags:
 *       - Connector Instances
 *     summary: Get a connector instance by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Connector instance ID
 *     responses:
 *       200:
 *         description: Connector instance found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/ConnectorInstanceGetResponse'
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
connectorInstanceRouter.get(
  "/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      logger.info({ id }, "GET /api/connector-instances/:id called");

      const connectorInstance =
        await DbService.repository.connectorInstances.findById(id).catch((error) => {
          if (error instanceof ApiError) throw error;
          throw new ApiError(500, ApiCode.CONNECTOR_INSTANCE_FETCH_FAILED, error instanceof Error ? error.message : "Failed to fetch connector instance");
        });

      if (!connectorInstance) {
        return next(
          new ApiError(
            404,
            ApiCode.CONNECTOR_INSTANCE_NOT_FOUND,
            "Connector instance not found"
          )
        );
      }

      const connectorDefinition = await DbService.repository.connectorDefinitions
        .findById(connectorInstance.connectorDefinitionId)
        .catch(() => null);

      return HttpService.success<ConnectorInstanceGetResponsePayload>(res, {
        connectorInstance: {
          ...connectorInstance,
          connectorDefinition: connectorDefinition ?? null,
        } as unknown as ConnectorInstanceWithDefinitionApi,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to fetch connector instance"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.CONNECTOR_INSTANCE_FETCH_FAILED, error instanceof Error ? error.message : "Failed to fetch connector instance"));
    }
  }
);

/**
 * @openapi
 * /api/connector-instances/{id}/impact:
 *   get:
 *     tags:
 *       - Connector Instances
 *     summary: Get deletion impact for a connector instance
 *     description: >
 *       Returns counts of all associated objects that would be affected
 *       if this connector instance were deleted. Used for pre-flight
 *       confirmation in the delete dialog.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Connector instance ID
 *     responses:
 *       200:
 *         description: Impact counts
 *       404:
 *         description: Connector instance not found
 *       500:
 *         description: Internal server error
 */
connectorInstanceRouter.get(
  "/:id/impact",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      const existing = await DbService.repository.connectorInstances.findById(id);
      if (!existing) {
        return next(
          new ApiError(404, ApiCode.CONNECTOR_INSTANCE_NOT_FOUND, "Connector instance not found")
        );
      }

      const entities = await DbService.repository.connectorEntities.findByConnectorInstanceId(id);
      const entityIds = entities.map((e) => e.id);

      const [entityRecords, fieldMappings, entityTagAssignments, entityGroupMembers, stations] =
        await Promise.all([
          DbService.repository.entityRecords.countByConnectorEntityIds(entityIds),
          DbService.repository.fieldMappings.countByConnectorEntityIds(entityIds),
          DbService.repository.entityTagAssignments.countByConnectorEntityIds(entityIds),
          DbService.repository.entityGroupMembers.countByConnectorEntityIds(entityIds),
          DbService.repository.stationInstances.countByConnectorInstanceId(id),
        ]);

      return HttpService.success(res, {
        connectorEntities: entities.length,
        entityRecords,
        fieldMappings,
        entityTagAssignments,
        entityGroupMembers,
        stations,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to fetch connector instance impact"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(500, ApiCode.CONNECTOR_INSTANCE_FETCH_FAILED, error instanceof Error ? error.message : "Failed to fetch connector instance impact")
      );
    }
  }
);

/**
 * @openapi
 * /api/connector-instances:
 *   post:
 *     tags:
 *       - Connector Instances
 *     summary: Create a connector instance
 *     description: Creates a new connector instance for a given definition and organization.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - connectorDefinitionId
 *               - organizationId
 *               - name
 *             properties:
 *               connectorDefinitionId:
 *                 type: string
 *               organizationId:
 *                 type: string
 *               name:
 *                 type: string
 *               config:
 *                 type: object
 *                 nullable: true
 *               credentials:
 *                 type: object
 *                 nullable: true
 *     responses:
 *       201:
 *         description: Connector instance created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/ConnectorInstanceCreateResponse'
 *       400:
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Connector definition not found
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
connectorInstanceRouter.post(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = ConnectorInstanceCreateRequestBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.CONNECTOR_INSTANCE_INVALID_PAYLOAD,
            "Invalid connector instance payload"
          )
        );
      }

      const { connectorDefinitionId, organizationId, name, status, enabledCapabilityFlags, config, credentials } = parsed.data;

      // Verify the connector definition exists
      const definition = await DbService.repository.connectorDefinitions.findById(connectorDefinitionId).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.CONNECTOR_DEFINITION_FETCH_FAILED, error instanceof Error ? error.message : "Failed to fetch connector definition");
      });
      if (!definition) {
        return next(
          new ApiError(
            404,
            ApiCode.CONNECTOR_DEFINITION_NOT_FOUND,
            "Connector definition not found"
          )
        );
      }

      const auth0Id = req.auth?.payload.sub as string;
      const user = await DbService.repository.users.findByAuth0Id(auth0Id).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.CONNECTOR_INSTANCE_USER_NOT_FOUND, error instanceof Error ? error.message : "Failed to fetch user");
      });
      if (!user) {
        return next(
          new ApiError(
            404,
            ApiCode.CONNECTOR_INSTANCE_USER_NOT_FOUND,
            "User not found"
          )
        );
      }

      const factory = new ConnectorInstanceModelFactory();
      const model = factory.create(user.id);
      model.update({
        connectorDefinitionId,
        organizationId,
        name,
        status,
        config: config ?? null,
        credentials: credentials ? encryptCredentials(credentials) : null,
        lastSyncAt: null,
        lastErrorMessage: null,
        enabledCapabilityFlags,
      });

      const connectorInstance = await DbService.repository.connectorInstances.create(
        model.parse()
      ).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.CONNECTOR_INSTANCE_CREATE_FAILED, error instanceof Error ? error.message : "Failed to create connector instance");
      });

      logger.info(
        { id: connectorInstance.id, connectorDefinitionId, organizationId },
        "Connector instance created"
      );

      return HttpService.success<ConnectorInstanceCreateResponsePayload>(
        res,
        { connectorInstance: connectorInstance as unknown as ConnectorInstanceApi },
        201
      );
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to create connector instance"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.CONNECTOR_INSTANCE_CREATE_FAILED, error instanceof Error ? error.message : "Failed to create connector instance"));
    }
  }
);

/**
 * @openapi
 * /api/connector-instances/{id}:
 *   delete:
 *     tags:
 *       - Connector Instances
 *     summary: Delete a connector instance
 *     description: >
 *       Soft-deletes a connector instance and cascades to all associated
 *       connector entities, entity records, field mappings, tag assignments,
 *       and group members. Hard-deletes station_instances join rows.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Connector instance ID
 *     responses:
 *       200:
 *         description: Connector instance deleted
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
 *         description: Connector instance not found
 *       500:
 *         description: Internal server error
 */
connectorInstanceRouter.delete(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { userId } = req.application!.metadata;

      const existing = await DbService.repository.connectorInstances.findById(id);
      if (!existing) {
        return next(
          new ApiError(404, ApiCode.CONNECTOR_INSTANCE_NOT_FOUND, "Connector instance not found")
        );
      }

      await DbService.transaction(async (tx) => {
        // Hard-delete station_instances join rows (unlink from stations)
        await DbService.repository.stationInstances.hardDeleteByConnectorInstanceId(id, tx);

        // Find all connector entities for this instance
        const entities = await DbService.repository.connectorEntities.findByConnectorInstanceId(id, tx);
        const entityIds = entities.map((e) => e.id);

        if (entityIds.length > 0) {
          // Soft-delete leaf records first, then entities
          await Promise.all([
            DbService.repository.entityGroupMembers.softDeleteByConnectorEntityIds(entityIds, userId, tx),
            DbService.repository.entityTagAssignments.softDeleteByConnectorEntityIds(entityIds, userId, tx),
            DbService.repository.fieldMappings.softDeleteByConnectorEntityIds(entityIds, userId, tx),
            DbService.repository.entityRecords.softDeleteByConnectorEntityIds(entityIds, userId, tx),
          ]);

          await DbService.repository.connectorEntities.softDeleteByConnectorInstanceId(id, userId, tx);
        }

        // Soft-delete the connector instance itself
        await DbService.repository.connectorInstances.softDelete(id, userId, tx);
      });

      logger.info({ id }, "Connector instance deleted");
      return HttpService.success(res, { id });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to delete connector instance"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(500, ApiCode.CONNECTOR_INSTANCE_DELETE_FAILED, error instanceof Error ? error.message : "Failed to delete connector instance")
      );
    }
  }
);

/** @see ConnectorInstancePatchRequestBodySchema in @portalai/core/contracts */

/**
 * @openapi
 * /api/connector-instances/{id}:
 *   patch:
 *     tags:
 *       - Connector Instances
 *     summary: Update a connector instance
 *     description: Partially updates a connector instance (e.g. rename).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Connector instance ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 1
 *               enabledCapabilityFlags:
 *                 type: object
 *                 nullable: true
 *                 properties:
 *                   read:
 *                     type: boolean
 *                   write:
 *                     type: boolean
 *     responses:
 *       200:
 *         description: Connector instance updated
 *       400:
 *         description: Invalid request body
 *       404:
 *         description: Connector instance not found
 *       500:
 *         description: Internal server error
 */
connectorInstanceRouter.patch(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { userId } = req.application!.metadata;

      const parsed = ConnectorInstancePatchRequestBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(400, ApiCode.CONNECTOR_INSTANCE_INVALID_PAYLOAD, "Invalid connector instance payload")
        );
      }

      const existing = await DbService.repository.connectorInstances.findById(id);
      if (!existing) {
        return next(
          new ApiError(404, ApiCode.CONNECTOR_INSTANCE_NOT_FOUND, "Connector instance not found")
        );
      }

      // Validate enabledCapabilityFlags against the definition's ceiling
      if (parsed.data.enabledCapabilityFlags) {
        const definition = await DbService.repository.connectorDefinitions.findById(
          existing.connectorDefinitionId
        );
        const defFlags = definition?.capabilityFlags;

        if (parsed.data.enabledCapabilityFlags.read && !defFlags?.read) {
          return next(
            new ApiError(
              400,
              ApiCode.CONNECTOR_INSTANCE_CAPABILITY_NOT_SUPPORTED,
              "This connector type does not support reads"
            )
          );
        }
        if (parsed.data.enabledCapabilityFlags.write && !defFlags?.write) {
          return next(
            new ApiError(
              400,
              ApiCode.CONNECTOR_INSTANCE_CAPABILITY_NOT_SUPPORTED,
              "This connector type does not support writes"
            )
          );
        }
        if (parsed.data.enabledCapabilityFlags.sync && !defFlags?.sync) {
          return next(
            new ApiError(
              400,
              ApiCode.CONNECTOR_INSTANCE_CAPABILITY_NOT_SUPPORTED,
              "This connector type does not support sync"
            )
          );
        }
        if (parsed.data.enabledCapabilityFlags.push && !defFlags?.push) {
          return next(
            new ApiError(
              400,
              ApiCode.CONNECTOR_INSTANCE_CAPABILITY_NOT_SUPPORTED,
              "This connector type does not support push"
            )
          );
        }
      }

      const updateData: Record<string, unknown> = { name: parsed.data.name, updatedBy: userId };
      if (parsed.data.enabledCapabilityFlags !== undefined) {
        updateData.enabledCapabilityFlags = parsed.data.enabledCapabilityFlags;
      }

      const updated = await DbService.repository.connectorInstances.update(id, updateData);

      logger.info({ id }, "Connector instance updated");
      return HttpService.success(res, { connectorInstance: updated as unknown as ConnectorInstanceApi });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to update connector instance"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(500, ApiCode.CONNECTOR_INSTANCE_UPDATE_FAILED, error instanceof Error ? error.message : "Failed to update connector instance")
      );
    }
  }
);
