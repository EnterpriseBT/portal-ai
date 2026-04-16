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
  type FieldMappingDeleteResponsePayload,
  type FieldMappingImpactResponsePayload,
  type FieldMappingBidirectionalValidationResponsePayload,
} from "@portalai/core/contracts";
import { createLogger } from "../utils/logger.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "../services/db.service.js";
import { fieldMappings } from "../db/schema/index.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { FieldMappingValidationService } from "../services/field-mapping-validation.service.js";
import { RevalidationService } from "../services/revalidation.service.js";
import { assertWriteCapability } from "../utils/resolve-capabilities.util.js";

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
 *       - in: query
 *         name: include
 *         schema:
 *           type: string
 *         description: "Comma-separated list of related data to include — connectorEntity, columnDefinition"
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
      const include_ = include?.split(",").map((s) => s.trim()).filter(Boolean);
      const listOpts = { limit, offset, orderBy: { column, direction: sortOrder }, include: include_ };

      const [data, total] = await Promise.all([
        DbService.repository.fieldMappings.findMany(where, listOpts),
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

      // Assert write capability on the parent connector instance
      await assertWriteCapability(parsed.data.connectorEntityId);

      // Verify column definition exists
      const columnDefinition = await DbService.repository.columnDefinitions.findById(
        parsed.data.columnDefinitionId
      );
      if (!columnDefinition) {
        return next(
          new ApiError(404, ApiCode.COLUMN_DEFINITION_NOT_FOUND, "Column definition not found")
        );
      }

      // Block if a revalidation job is active for the target entity
      await RevalidationService.assertNoActiveJob(parsed.data.connectorEntityId);

      // Check for duplicate mapping (same entity + column definition)
      const duplicate = await DbService.repository.fieldMappings.findMany(
        and(
          eq(fieldMappings.connectorEntityId, parsed.data.connectorEntityId),
          eq(fieldMappings.columnDefinitionId, parsed.data.columnDefinitionId),
        )
      );
      if (duplicate.length > 0) {
        return next(
          new ApiError(409, ApiCode.FIELD_MAPPING_DUPLICATE_COLUMN, "A field mapping already exists for this column definition on the same connector entity")
        );
      }

      // Validate new fields
      FieldMappingValidationService.validateEnumValues(parsed.data.enumValues);
      FieldMappingValidationService.validateFormat(parsed.data.format, columnDefinition.type);
      await FieldMappingValidationService.validateNormalizedKeyUniqueness(
        parsed.data.connectorEntityId, parsed.data.normalizedKey
      );

      const { userId, organizationId } = req.application!.metadata;

      const factory = new FieldMappingModelFactory();
      const model = factory.create(userId);
      model.update({
        organizationId,
        connectorEntityId: parsed.data.connectorEntityId,
        columnDefinitionId: parsed.data.columnDefinitionId,
        sourceField: parsed.data.sourceField,
        isPrimaryKey: parsed.data.isPrimaryKey,
        normalizedKey: parsed.data.normalizedKey,
        required: parsed.data.required,
        defaultValue: parsed.data.defaultValue,
        format: parsed.data.format,
        enumValues: parsed.data.enumValues,
        refNormalizedKey: parsed.data.refNormalizedKey,
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
 *               columnDefinitionId:
 *                 type: string
 *                 description: Reassign this field mapping to a different column definition
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

      // Assert write capability on the parent connector instance
      await assertWriteCapability(existing.connectorEntityId);

      // Block if a revalidation job is active for this mapping's entity
      await RevalidationService.assertNoActiveJob(existing.connectorEntityId);

      // Validate normalizedKey uniqueness if changed
      if (parsed.data.normalizedKey && parsed.data.normalizedKey !== existing.normalizedKey) {
        await FieldMappingValidationService.validateNormalizedKeyUniqueness(
          existing.connectorEntityId, parsed.data.normalizedKey, id
        );
      }

      // Validate enumValues and format if provided
      FieldMappingValidationService.validateEnumValues(parsed.data.enumValues);

      if (parsed.data.columnDefinitionId) {
        const colDef = await DbService.repository.columnDefinitions.findById(parsed.data.columnDefinitionId);
        if (!colDef) {
          return next(
            new ApiError(404, ApiCode.COLUMN_DEFINITION_NOT_FOUND, "Target column definition not found")
          );
        }

        if (parsed.data.columnDefinitionId !== existing.columnDefinitionId) {
          const duplicate = await DbService.repository.fieldMappings.findMany(
            and(
              eq(fieldMappings.connectorEntityId, existing.connectorEntityId),
              eq(fieldMappings.columnDefinitionId, parsed.data.columnDefinitionId),
            )
          );
          if (duplicate.length > 0) {
            return next(
              new ApiError(409, ApiCode.FIELD_MAPPING_DUPLICATE_COLUMN, "A field mapping already exists for this column definition on the same entity")
            );
          }
        }
      }

      // Validate format compatibility with column type
      if (parsed.data.format !== undefined) {
        const resolvedColDefId = parsed.data.columnDefinitionId ?? existing.columnDefinitionId;
        const resolvedColDef = await DbService.repository.columnDefinitions.findById(resolvedColDefId);
        if (resolvedColDef) {
          FieldMappingValidationService.validateFormat(parsed.data.format, resolvedColDef.type);
        }
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

      // Trigger revalidation if normalization-affecting fields changed
      const REVALIDATION_FIELDS = ["format", "required", "enumValues", "defaultValue", "normalizedKey"] as const;
      const needsRevalidation = REVALIDATION_FIELDS.some((field) =>
        field in parsed.data && (parsed.data as Record<string, unknown>)[field] !== (existing as Record<string, unknown>)[field]
      );

      if (needsRevalidation) {
        const { organizationId } = req.application!.metadata;
        await RevalidationService.enqueue(existing.connectorEntityId, organizationId, userId).catch((err) => {
          logger.warn({ id, err }, "Failed to enqueue revalidation after field mapping update");
        });
      }

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
 * /api/field-mappings/{id}/impact:
 *   get:
 *     tags:
 *       - Field Mappings
 *     summary: Assess deletion impact of a field mapping
 *     description: Returns counts of dependent resources that would be affected by deleting this field mapping.
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
 *         description: Impact assessment
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
 *                     entityGroupMembers:
 *                       type: integer
 *                       description: Number of entity group members using this field mapping as their link field
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
  "/:id/impact",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      logger.info({ id }, "GET /api/field-mappings/:id/impact called");

      const existing = await DbService.repository.fieldMappings.findById(id);
      if (!existing) {
        return next(
          new ApiError(404, ApiCode.FIELD_MAPPING_NOT_FOUND, "Field mapping not found")
        );
      }

      const [dependentMembers, entityRecordCount] = await Promise.all([
        DbService.repository.entityGroupMembers.findByLinkFieldMappingId(id),
        DbService.repository.entityRecords.countByConnectorEntityId(existing.connectorEntityId),
      ]);

      let counterpartResult: { id: string; sourceField: string; normalizedKey: string } | null = null;
      if (existing.refEntityKey && existing.refNormalizedKey) {
        const entity = await DbService.repository.connectorEntities.findById(existing.connectorEntityId);
        if (entity) {
          const counterpart = await DbService.repository.fieldMappings.findCounterpart(
            existing.organizationId,
            entity.key,
            existing.refEntityKey,
            existing.refNormalizedKey,
          );
          if (counterpart) {
            counterpartResult = {
              id: counterpart.id,
              sourceField: counterpart.sourceField,
              normalizedKey: counterpart.normalizedKey,
            };
          }
        }
      }

      return HttpService.success<FieldMappingImpactResponsePayload>(res, {
        entityGroupMembers: dependentMembers.length,
        entityRecords: entityRecordCount,
        counterpart: counterpartResult,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to assess field mapping impact"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.FIELD_MAPPING_FETCH_FAILED, error instanceof Error ? error.message : "Failed to assess field mapping impact"));
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
 *     description: Soft-deletes a field mapping by ID and cascades to any entity group members that use it as their link field mapping.
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
 *                     cascaded:
 *                       type: object
 *                       properties:
 *                         entityGroupMembers:
 *                           type: integer
 *                           description: Number of entity group members that were cascade-deleted
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
      const { userId } = req.application!.metadata;

      // Block if a revalidation job is active for this mapping's entity
      const mappingToDelete = await DbService.repository.fieldMappings.findById(id);
      if (mappingToDelete) {
        // Assert write capability on the parent connector instance
        await assertWriteCapability(mappingToDelete.connectorEntityId);

        await RevalidationService.assertNoActiveJob(mappingToDelete.connectorEntityId);
      }

      await FieldMappingValidationService.validateDelete(id);

      const result = await FieldMappingValidationService.executeDelete(id, userId)
        .catch((error) => {
          if (error instanceof ApiError) throw error;
          throw new ApiError(500, ApiCode.FIELD_MAPPING_DELETE_FAILED, error instanceof Error ? error.message : "Failed to delete field mapping");
        });

      logger.info({ id, ...result }, "Field mapping soft-deleted with cascade");

      return HttpService.success<FieldMappingDeleteResponsePayload>(res, {
        id,
        cascaded: {
          entityGroupMembers: result.cascadedEntityGroupMembers,
          counterpartCleared: result.counterpartCleared,
        },
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to delete field mapping"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.FIELD_MAPPING_DELETE_FAILED, error instanceof Error ? error.message : "Failed to delete field mapping"));
    }
  }
);

/**
 * @openapi
 * /api/field-mappings/{id}/validate-bidirectional:
 *   get:
 *     tags:
 *       - Field Mappings
 *     summary: Check bidirectional array consistency
 *     description: >
 *       For a `reference-array` field mapping that has a configured back-reference,
 *       scans both entities' records and returns any records whose arrays are out of
 *       sync with the counterpart. Returns `isConsistent: null` when no back-reference
 *       is configured (unidirectional mode).
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
 *         description: Validation result
 *       400:
 *         description: Field mapping is not a reference-array type
 *       404:
 *         description: Field mapping not found
 *       500:
 *         description: Internal server error
 */
fieldMappingRouter.get(
  "/:id/validate-bidirectional",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      // 1. Load mapping
      const mapping = await DbService.repository.fieldMappings.findById(id);
      if (!mapping) {
        return next(new ApiError(404, ApiCode.FIELD_MAPPING_NOT_FOUND, "Field mapping not found"));
      }

      // 2. Load column definition to verify type
      const columnDef = await DbService.repository.columnDefinitions.findById(mapping.columnDefinitionId);
      if (!columnDef || columnDef.type !== "reference-array") {
        return next(new ApiError(400, ApiCode.FIELD_MAPPING_BIDIRECTIONAL_VALIDATION_FAILED, "Field mapping column type must be reference-array"));
      }

      // 3. No back-reference configured — unidirectional mode
      if (!mapping.refEntityKey || !mapping.refNormalizedKey) {
        return HttpService.success<FieldMappingBidirectionalValidationResponsePayload>(res, {
          isConsistent: null,
          inconsistentRecordIds: [],
          totalChecked: 0,
          reason: "no-back-reference-configured",
        });
      }

      // 4. Load counterpart mapping
      const { counterpart } = await DbService.repository.fieldMappings.findBidirectionalPair(id);
      if (!counterpart) {
        return next(new ApiError(400, ApiCode.FIELD_MAPPING_BIDIRECTIONAL_TARGET_NOT_FOUND, "Configured back-reference field mapping no longer exists"));
      }

      const keyA = mapping.normalizedKey;       // e.g. "enrolled_student_ids"
      const keyB = counterpart.normalizedKey;    // e.g. "classes_enrolled_ids"

      // 6. Load all records from both entities
      const [recordsA, recordsB] = await Promise.all([
        DbService.repository.entityRecords.findByConnectorEntityId(mapping.connectorEntityId),
        DbService.repository.entityRecords.findByConnectorEntityId(counterpart.connectorEntityId),
      ]);

      // 7. Build a lookup: entity B sourceId → set of IDs in its reference-array field
      const bArrayBySourceId = new Map<string, Set<string>>();
      for (const rec of recordsB) {
        const normalizedData = rec.normalizedData as Record<string, unknown> | null;
        const arr = normalizedData?.[keyB];
        const ids = Array.isArray(arr) ? arr.map(String) : [];
        bArrayBySourceId.set(rec.sourceId, new Set(ids));
      }

      // 8. For each entity A record, check every ID in its array has a counterpart
      //    in entity B whose array includes entity A's sourceId
      const inconsistentRecordIds: string[] = [];
      for (const recA of recordsA) {
        const normalizedData = recA.normalizedData as Record<string, unknown> | null;
        const arr = normalizedData?.[keyA];
        const idsInA = Array.isArray(arr) ? arr.map(String) : [];
        const isInconsistent = idsInA.some((targetId) => {
          const bSet = bArrayBySourceId.get(targetId);
          return !bSet || !bSet.has(recA.sourceId);
        });
        if (isInconsistent) {
          inconsistentRecordIds.push(recA.id);
        }
      }

      const isConsistent = inconsistentRecordIds.length === 0;
      logger.info({ id, totalChecked: recordsA.length, inconsistentCount: inconsistentRecordIds.length }, "Bidirectional validation complete");

      return HttpService.success<FieldMappingBidirectionalValidationResponsePayload>(res, {
        isConsistent,
        inconsistentRecordIds,
        totalChecked: recordsA.length,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to validate bidirectional field mapping"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.FIELD_MAPPING_BIDIRECTIONAL_VALIDATION_FAILED, error instanceof Error ? error.message : "Failed to validate bidirectional field mapping"));
    }
  }
);
