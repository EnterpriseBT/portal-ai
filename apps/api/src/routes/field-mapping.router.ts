import { Router, Request, Response, NextFunction } from "express";
import { eq, and, ilike, type SQL, type Column } from "drizzle-orm";

import { FieldMappingModelFactory } from "@portalai/core/models";
import {
  FieldMappingListRequestQuerySchema,
  type FieldMappingListResponsePayload,
  type FieldMappingListWithConnectorEntityResponsePayload,
  type FieldMappingGetResponsePayload,
  FieldMappingCreateRequestBodySchema,
  type FieldMappingCreateResponsePayload,
  FieldMappingUpdateRequestBodySchema,
  type FieldMappingUpdateResponsePayload,
} from "@portalai/core/contracts";
import { createLogger } from "../utils/logger.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "../services/db.service.js";
import { fieldMappings } from "../db/schema/index.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";

const logger = createLogger({ module: "field-mapping" });

export const fieldMappingRouter = Router();

/** Map of sortable field names to their Drizzle columns. */
const SORTABLE_COLUMNS: Record<string, Column> = {
  sourceField: fieldMappings.sourceField,
  created: fieldMappings.created,
};

/**
 * @openapi
 * /api/field-mappings:
 *   get:
 *     tags:
 *       - Field Mappings
 *     summary: List field mappings
 *     description: Returns a paginated, filterable, and sortable list of field mappings scoped to the authenticated user's organization.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/limitParam'
 *       - $ref: '#/components/parameters/offsetParam'
 *       - $ref: '#/components/parameters/sortOrderParam'
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Case-insensitive search on source field
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [sourceField, created]
 *           default: created
 *         description: Field to sort by
 *       - in: query
 *         name: connectorEntityId
 *         schema:
 *           type: string
 *         description: Filter by connector entity ID
 *       - in: query
 *         name: columnDefinitionId
 *         schema:
 *           type: string
 *         description: Filter by column definition ID
 *     responses:
 *       200:
 *         description: Paginated list of field mappings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/FieldMappingListResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
fieldMappingRouter.get(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { limit, offset, sortBy, sortOrder, search, connectorEntityId, columnDefinitionId, include } =
        FieldMappingListRequestQuerySchema.parse(req.query);

      const organizationId = req.application!.metadata.organizationId;
      const filters: SQL[] = [
        eq(fieldMappings.organizationId, organizationId),
      ];

      if (search) {
        filters.push(ilike(fieldMappings.sourceField, `%${search}%`));
      }

      if (columnDefinitionId) {
        filters.push(eq(fieldMappings.columnDefinitionId, columnDefinitionId));
      }

      if (connectorEntityId) {
        filters.push(eq(fieldMappings.connectorEntityId, connectorEntityId));
      }

      const where = and(...filters);
      const column = SORTABLE_COLUMNS[sortBy] ?? SORTABLE_COLUMNS.created;
      const listOpts = { limit, offset, orderBy: { column, direction: sortOrder } };

      const fetchMappings = () => {
        if (include === "connectorEntity") {
          return DbService.repository.fieldMappings.findManyWithConnectorEntity(where, listOpts);
        }
        return DbService.repository.fieldMappings.findMany(where, listOpts);
      };

      const [data, total] = await Promise.all([
        fetchMappings(),
        DbService.repository.fieldMappings.count(where),
      ]).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.FIELD_MAPPING_FETCH_FAILED, error instanceof Error ? error.message : "Failed to list field mappings");
      });

      type ResponsePayload = FieldMappingListResponsePayload | FieldMappingListWithConnectorEntityResponsePayload;
      return HttpService.success<ResponsePayload>(res, {
        fieldMappings: data as unknown as FieldMappingListWithConnectorEntityResponsePayload["fieldMappings"],
        total,
        limit,
        offset,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to list field mappings"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.FIELD_MAPPING_FETCH_FAILED, error instanceof Error ? error.message : "Failed to list field mappings"));
    }
  }
);

/**
 * @openapi
 * /api/field-mappings/{id}:
 *   get:
 *     tags:
 *       - Field Mappings
 *     summary: Get a field mapping by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Field mapping ID
 *     responses:
 *       200:
 *         description: Field mapping found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/FieldMappingGetResponse'
 *       404:
 *         description: Field mapping not found
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
fieldMappingRouter.get(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      logger.info({ id }, "GET /api/field-mappings/:id called");

      const fieldMapping = await DbService.repository.fieldMappings.findById(id).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.FIELD_MAPPING_FETCH_FAILED, error instanceof Error ? error.message : "Failed to fetch field mapping");
      });

      if (!fieldMapping) {
        return next(
          new ApiError(404, ApiCode.FIELD_MAPPING_NOT_FOUND, "Field mapping not found")
        );
      }

      return HttpService.success<FieldMappingGetResponsePayload>(res, {
        fieldMapping: fieldMapping as unknown as FieldMappingGetResponsePayload["fieldMapping"],
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to fetch field mapping"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.FIELD_MAPPING_FETCH_FAILED, error instanceof Error ? error.message : "Failed to fetch field mapping"));
    }
  }
);

/**
 * @openapi
 * /api/field-mappings:
 *   post:
 *     tags:
 *       - Field Mappings
 *     summary: Create a field mapping
 *     description: Creates a new field mapping scoped to the authenticated user's organization.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - connectorEntityId
 *               - columnDefinitionId
 *               - sourceField
 *             properties:
 *               connectorEntityId:
 *                 type: string
 *                 description: ID of the connector entity
 *               columnDefinitionId:
 *                 type: string
 *                 description: ID of the column definition
 *               sourceField:
 *                 type: string
 *                 minLength: 1
 *                 description: Source field name from the connector
 *               isPrimaryKey:
 *                 type: boolean
 *                 default: false
 *                 description: Whether this field is a primary key
 *     responses:
 *       201:
 *         description: Field mapping created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/FieldMappingGetResponse'
 *       400:
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Connector entity or column definition not found
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
fieldMappingRouter.post(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = FieldMappingCreateRequestBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(400, ApiCode.FIELD_MAPPING_INVALID_PAYLOAD, "Invalid field mapping payload")
        );
      }

      // Verify connector entity exists
      const connectorEntity = await DbService.repository.connectorEntities.findById(
        parsed.data.connectorEntityId
      );
      if (!connectorEntity) {
        return next(
          new ApiError(404, ApiCode.CONNECTOR_ENTITY_NOT_FOUND, "Connector entity not found")
        );
      }

      // Verify column definition exists
      const columnDefinition = await DbService.repository.columnDefinitions.findById(
        parsed.data.columnDefinitionId
      );
      if (!columnDefinition) {
        return next(
          new ApiError(404, ApiCode.COLUMN_DEFINITION_NOT_FOUND, "Column definition not found")
        );
      }

      const { userId, organizationId } = req.application!.metadata;

      const factory = new FieldMappingModelFactory();
      const model = factory.create(userId);
      model.update({
        organizationId,
        connectorEntityId: parsed.data.connectorEntityId,
        columnDefinitionId: parsed.data.columnDefinitionId,
        sourceField: parsed.data.sourceField,
        isPrimaryKey: parsed.data.isPrimaryKey,
        refColumnDefinitionId: parsed.data.refColumnDefinitionId,
        refEntityKey: parsed.data.refEntityKey,
      });

      const fieldMapping = await DbService.repository.fieldMappings.create(
        model.parse()
      ).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.FIELD_MAPPING_CREATE_FAILED, error instanceof Error ? error.message : "Failed to create field mapping");
      });

      logger.info(
        { id: fieldMapping.id, connectorEntityId: parsed.data.connectorEntityId },
        "Field mapping created"
      );

      return HttpService.success<FieldMappingCreateResponsePayload>(
        res,
        { fieldMapping: fieldMapping as unknown as FieldMappingCreateResponsePayload["fieldMapping"] },
        201
      );
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to create field mapping"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.FIELD_MAPPING_CREATE_FAILED, error instanceof Error ? error.message : "Failed to create field mapping"));
    }
  }
);

/**
 * @openapi
 * /api/field-mappings/{id}:
 *   patch:
 *     tags:
 *       - Field Mappings
 *     summary: Update a field mapping
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Field mapping ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               sourceField:
 *                 type: string
 *                 minLength: 1
 *               isPrimaryKey:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Field mapping updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/FieldMappingGetResponse'
 *       400:
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Field mapping not found
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
fieldMappingRouter.patch(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const parsed = FieldMappingUpdateRequestBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(400, ApiCode.FIELD_MAPPING_INVALID_PAYLOAD, "Invalid field mapping payload")
        );
      }

      const existing = await DbService.repository.fieldMappings.findById(id);
      if (!existing) {
        return next(
          new ApiError(404, ApiCode.FIELD_MAPPING_NOT_FOUND, "Field mapping not found")
        );
      }

      const { userId } = req.application!.metadata;

      const fieldMapping = await DbService.repository.fieldMappings.update(id, {
        ...parsed.data,
        updated: Date.now(),
        updatedBy: userId,
      } as never).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.FIELD_MAPPING_UPDATE_FAILED, error instanceof Error ? error.message : "Failed to update field mapping");
      });

      logger.info({ id }, "Field mapping updated");

      return HttpService.success<FieldMappingUpdateResponsePayload>(res, {
        fieldMapping: fieldMapping as unknown as FieldMappingUpdateResponsePayload["fieldMapping"],
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to update field mapping"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.FIELD_MAPPING_UPDATE_FAILED, error instanceof Error ? error.message : "Failed to update field mapping"));
    }
  }
);

/**
 * @openapi
 * /api/field-mappings/{id}:
 *   delete:
 *     tags:
 *       - Field Mappings
 *     summary: Delete a field mapping
 *     description: Soft-deletes a field mapping by ID.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Field mapping ID
 *     responses:
 *       200:
 *         description: Field mapping deleted
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
 *         description: Field mapping not found
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
fieldMappingRouter.delete(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      const existing = await DbService.repository.fieldMappings.findById(id);
      if (!existing) {
        return next(
          new ApiError(404, ApiCode.FIELD_MAPPING_NOT_FOUND, "Field mapping not found")
        );
      }

      const { userId } = req.application!.metadata;

      await DbService.repository.fieldMappings.softDelete(id, userId).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.FIELD_MAPPING_DELETE_FAILED, error instanceof Error ? error.message : "Failed to delete field mapping");
      });

      logger.info({ id }, "Field mapping soft-deleted");

      return HttpService.success(res, { id });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to delete field mapping"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.FIELD_MAPPING_DELETE_FAILED, error instanceof Error ? error.message : "Failed to delete field mapping"));
    }
  }
);
