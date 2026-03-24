import { Router, Request, Response, NextFunction } from "express";
import { eq, and, ilike, type SQL, type Column } from "drizzle-orm";
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
 *           enum: [active, inactive, error, pending]
 *         description: Filter by instance status
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
      const { limit, offset, sortBy, sortOrder, connectorDefinitionId, status, search, include } =
        ConnectorInstanceListRequestQuerySchema.parse(req.query);

      const filters: SQL[] = [eq(connectorInstances.organizationId, req.application?.metadata.organizationId as string)];

      if (connectorDefinitionId) {
        filters.push(eq(connectorInstances.connectorDefinitionId, connectorDefinitionId));
      }
      if (status) {
        filters.push(eq(connectorInstances.status, status));
      }
      if (search) {
        filters.push(ilike(connectorInstances.name, `%${search}%`));
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

      const { connectorDefinitionId, organizationId, name, config, credentials } = parsed.data;

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
        status: "pending",
        config: config ?? null,
        credentials: credentials ? encryptCredentials(credentials) : null,
        lastSyncAt: null,
        lastErrorMessage: null,
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
