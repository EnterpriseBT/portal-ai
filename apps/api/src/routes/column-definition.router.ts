import { Router, Request, Response, NextFunction } from "express";
import { eq, and, or, ilike, inArray, type SQL, type Column } from "drizzle-orm";

import { ColumnDefinitionModelFactory } from "@portalai/core/models";
import {
  ColumnDefinitionListRequestQuerySchema,
  type ColumnDefinitionListResponsePayload,
  type ColumnDefinitionGetResponsePayload,
  ColumnDefinitionCreateRequestBodySchema,
  type ColumnDefinitionCreateResponsePayload,
  ColumnDefinitionUpdateRequestBodySchema,
  type ColumnDefinitionUpdateResponsePayload,
} from "@portalai/core/contracts";
import { createLogger } from "../utils/logger.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "../services/db.service.js";
import { columnDefinitions } from "../db/schema/index.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";

const logger = createLogger({ module: "column-definition" });

export const columnDefinitionRouter = Router();

/** Map of sortable field names to their Drizzle columns. */
const SORTABLE_COLUMNS: Record<string, Column> = {
  key: columnDefinitions.key,
  label: columnDefinitions.label,
  type: columnDefinitions.type,
  created: columnDefinitions.created,
};

/**
 * @openapi
 * /api/column-definitions:
 *   get:
 *     tags:
 *       - Column Definitions
 *     summary: List column definitions
 *     description: Returns a paginated, filterable, and sortable list of column definitions scoped to the authenticated user's organization.
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
 *         description: Case-insensitive search on label or key
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [key, label, type, created]
 *           default: created
 *         description: Field to sort by
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Comma-separated list of column data types to filter by (string, number, boolean, date, datetime, enum, json, array, reference, currency)
 *       - in: query
 *         name: required
 *         schema:
 *           type: string
 *           enum: ["true", "false"]
 *         description: Filter by required flag
 *     responses:
 *       200:
 *         description: Paginated list of column definitions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/ColumnDefinitionListResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
columnDefinitionRouter.get(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { limit, offset, sortBy, sortOrder, search, type, required } =
        ColumnDefinitionListRequestQuerySchema.parse(req.query);

      const organizationId = req.application!.metadata.organizationId;
      const filters: SQL[] = [eq(columnDefinitions.organizationId, organizationId)];

      if (search) {
        filters.push(
          or(
            ilike(columnDefinitions.label, `%${search}%`),
            ilike(columnDefinitions.key, `%${search}%`),
          )!
        );
      }
      if (type) {
        const types = type.split(",").map((t) => t.trim()).filter(Boolean);
        if (types.length === 1) {
          filters.push(eq(columnDefinitions.type, types[0] as never));
        } else if (types.length > 1) {
          filters.push(inArray(columnDefinitions.type, types as never[]));
        }
      }
      if (required !== undefined) {
        filters.push(eq(columnDefinitions.required, required));
      }

      const where = and(...filters);
      const column = SORTABLE_COLUMNS[sortBy] ?? SORTABLE_COLUMNS.created;

      const [data, total] = await Promise.all([
        DbService.repository.columnDefinitions.findMany(where, {
          limit,
          offset,
          orderBy: { column, direction: sortOrder },
        }),
        DbService.repository.columnDefinitions.count(where),
      ]).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.COLUMN_DEFINITION_FETCH_FAILED, error instanceof Error ? error.message : "Failed to list column definitions");
      });

      return HttpService.success<ColumnDefinitionListResponsePayload>(res, {
        columnDefinitions: data as unknown as ColumnDefinitionListResponsePayload["columnDefinitions"],
        total,
        limit,
        offset,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to list column definitions"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.COLUMN_DEFINITION_FETCH_FAILED, error instanceof Error ? error.message : "Failed to list column definitions"));
    }
  }
);

/**
 * @openapi
 * /api/column-definitions/{id}:
 *   get:
 *     tags:
 *       - Column Definitions
 *     summary: Get a column definition by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Column definition ID
 *     responses:
 *       200:
 *         description: Column definition found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/ColumnDefinitionGetResponse'
 *       404:
 *         description: Column definition not found
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
columnDefinitionRouter.get(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      logger.info({ id }, "GET /api/column-definitions/:id called");

      const columnDefinition = await DbService.repository.columnDefinitions.findById(id).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.COLUMN_DEFINITION_FETCH_FAILED, error instanceof Error ? error.message : "Failed to fetch column definition");
      });

      if (!columnDefinition) {
        return next(
          new ApiError(404, ApiCode.COLUMN_DEFINITION_NOT_FOUND, "Column definition not found")
        );
      }

      return HttpService.success<ColumnDefinitionGetResponsePayload>(res, {
        columnDefinition: columnDefinition as unknown as ColumnDefinitionGetResponsePayload["columnDefinition"],
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to fetch column definition"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.COLUMN_DEFINITION_FETCH_FAILED, error instanceof Error ? error.message : "Failed to fetch column definition"));
    }
  }
);

/**
 * @openapi
 * /api/column-definitions:
 *   post:
 *     tags:
 *       - Column Definitions
 *     summary: Create a column definition
 *     description: Creates a new column definition scoped to the authenticated user's organization.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - key
 *               - label
 *               - type
 *             properties:
 *               key:
 *                 type: string
 *                 pattern: '^[a-z][a-z0-9_]*$'
 *                 description: Machine-readable key (lowercase, underscores)
 *               label:
 *                 type: string
 *                 minLength: 1
 *                 description: Human-readable label
 *               type:
 *                 type: string
 *                 enum: [string, number, boolean, date, datetime, enum, json, array, reference, currency]
 *               required:
 *                 type: boolean
 *                 default: false
 *               defaultValue:
 *                 type: string
 *                 nullable: true
 *               format:
 *                 type: string
 *                 nullable: true
 *               enumValues:
 *                 type: array
 *                 items:
 *                   type: string
 *                 nullable: true
 *               description:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       201:
 *         description: Column definition created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/ColumnDefinitionGetResponse'
 *       400:
 *         description: Invalid request body
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
columnDefinitionRouter.post(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = ColumnDefinitionCreateRequestBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(400, ApiCode.COLUMN_DEFINITION_INVALID_PAYLOAD, "Invalid column definition payload")
        );
      }

      const { organizationId, userId } = req.application!.metadata;

      const factory = new ColumnDefinitionModelFactory();
      const model = factory.create(userId);
      model.update({
        organizationId,
        key: parsed.data.key,
        label: parsed.data.label,
        type: parsed.data.type,
        required: parsed.data.required,
        defaultValue: parsed.data.defaultValue,
        format: parsed.data.format,
        enumValues: parsed.data.enumValues,
        description: parsed.data.description,
      });

      const columnDefinition = await DbService.repository.columnDefinitions.create(
        model.parse()
      ).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.COLUMN_DEFINITION_CREATE_FAILED, error instanceof Error ? error.message : "Failed to create column definition");
      });

      logger.info(
        { id: columnDefinition.id, organizationId },
        "Column definition created"
      );

      return HttpService.success<ColumnDefinitionCreateResponsePayload>(
        res,
        { columnDefinition: columnDefinition as unknown as ColumnDefinitionCreateResponsePayload["columnDefinition"] },
        201
      );
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to create column definition"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.COLUMN_DEFINITION_CREATE_FAILED, error instanceof Error ? error.message : "Failed to create column definition"));
    }
  }
);

/**
 * @openapi
 * /api/column-definitions/{id}:
 *   patch:
 *     tags:
 *       - Column Definitions
 *     summary: Update a column definition
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Column definition ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               label:
 *                 type: string
 *                 minLength: 1
 *               type:
 *                 type: string
 *                 enum: [string, number, boolean, date, datetime, enum, json, array, reference, currency]
 *               required:
 *                 type: boolean
 *               defaultValue:
 *                 type: string
 *                 nullable: true
 *               format:
 *                 type: string
 *                 nullable: true
 *               enumValues:
 *                 type: array
 *                 items:
 *                   type: string
 *                 nullable: true
 *               description:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Column definition updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/ColumnDefinitionGetResponse'
 *       400:
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Column definition not found
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
columnDefinitionRouter.patch(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const parsed = ColumnDefinitionUpdateRequestBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(400, ApiCode.COLUMN_DEFINITION_INVALID_PAYLOAD, "Invalid column definition payload")
        );
      }

      const existing = await DbService.repository.columnDefinitions.findById(id);
      if (!existing) {
        return next(
          new ApiError(404, ApiCode.COLUMN_DEFINITION_NOT_FOUND, "Column definition not found")
        );
      }

      const { userId } = req.application!.metadata;

      const columnDefinition = await DbService.repository.columnDefinitions.update(id, {
        ...parsed.data,
        updated: Date.now(),
        updatedBy: userId,
      } as never).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.COLUMN_DEFINITION_UPDATE_FAILED, error instanceof Error ? error.message : "Failed to update column definition");
      });

      logger.info({ id }, "Column definition updated");

      return HttpService.success<ColumnDefinitionUpdateResponsePayload>(res, {
        columnDefinition: columnDefinition as unknown as ColumnDefinitionUpdateResponsePayload["columnDefinition"],
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to update column definition"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.COLUMN_DEFINITION_UPDATE_FAILED, error instanceof Error ? error.message : "Failed to update column definition"));
    }
  }
);

/**
 * @openapi
 * /api/column-definitions/{id}:
 *   delete:
 *     tags:
 *       - Column Definitions
 *     summary: Delete a column definition
 *     description: Soft-deletes a column definition by ID.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Column definition ID
 *     responses:
 *       200:
 *         description: Column definition deleted
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
 *         description: Column definition not found
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
columnDefinitionRouter.delete(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      const existing = await DbService.repository.columnDefinitions.findById(id);
      if (!existing) {
        return next(
          new ApiError(404, ApiCode.COLUMN_DEFINITION_NOT_FOUND, "Column definition not found")
        );
      }

      const { userId } = req.application!.metadata;

      await DbService.repository.columnDefinitions.softDelete(id, userId).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.COLUMN_DEFINITION_DELETE_FAILED, error instanceof Error ? error.message : "Failed to delete column definition");
      });

      logger.info({ id }, "Column definition soft-deleted");

      return HttpService.success(res, { id });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to delete column definition"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.COLUMN_DEFINITION_DELETE_FAILED, error instanceof Error ? error.message : "Failed to delete column definition"));
    }
  }
);
