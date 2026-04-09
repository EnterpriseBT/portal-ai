/**
 * Entity Records router.
 *
 * Mounted under `/api/connector-entities/:connectorEntityId/records`.
 * Provides paginated record listing, count, bulk import, sync, and clear.
 */

import { Router, Request, Response, NextFunction } from "express";
import { eq, and, sql, type SQL } from "drizzle-orm";

import { EntityRecordModelFactory, SORTABLE_COLUMN_TYPES } from "@portalai/core/models";
import { UUIDv4Factory } from "@portalai/core/utils";
import {
  EntityRecordListRequestQuerySchema,
  type EntityRecordListResponsePayload,
  type EntityRecordCountResponsePayload,
  type EntityRecordGetResponsePayload,
  EntityRecordImportRequestBodySchema,
  type EntityRecordImportResponsePayload,
  type EntityRecordSyncResponsePayload,
  EntityRecordCreateRequestBodySchema,
  type EntityRecordCreateResponsePayload,
  EntityRecordPatchRequestBodySchema,
  type EntityRecordPatchResponsePayload,
  type EntityRecordDeleteOneResponsePayload,
  type EntityRecordDeleteResponsePayload,
} from "@portalai/core/contracts";
import { createLogger } from "../utils/logger.util.js";
import { parseAndBuildFilterSQL, isFilterError } from "../utils/filter-sql.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "../services/db.service.js";
import { entityRecords } from "../db/schema/index.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { assertWriteCapability } from "../utils/resolve-capabilities.util.js";
import { SyncService } from "../services/sync.service.js";
import { RevalidationService } from "../services/revalidation.service.js";
import { fieldMappingsRepo } from "../db/repositories/field-mappings.repository.js";
import { columnDefinitionsRepo } from "../db/repositories/column-definitions.repository.js";
import type { ResolvedColumn } from "../adapters/adapter.interface.js";
import type { ColumnDataType } from "@portalai/core/models";
import type { Column } from "drizzle-orm";

const logger = createLogger({ module: "entity-record" });

// mergeParams: true allows access to :connectorEntityId from the parent router
export const entityRecordRouter = Router({ mergeParams: true });

/** Map of sortable field names to their Drizzle columns. */
const SORTABLE_COLUMNS: Record<string, Column> = {
  created: entityRecords.created,
  syncedAt: entityRecords.syncedAt,
  sourceId: entityRecords.sourceId,
};

/**
 * Build a SQL expression that extracts a JSONB field with safe, type-aware
 * casting.  Values that cannot be cast to the target type resolve to NULL
 * rather than raising a query error.
 */
function buildJsonbSortExpression(
  key: string,
  dataType: ColumnDataType
): SQL {
  const raw = sql`${entityRecords.normalizedData}->>${sql.raw(`'${key}'`)}`;
  const val = sql`NULLIF(${raw}, '')`;

  switch (dataType) {
    case "number":
      // Guard with a regex so non-numeric text becomes NULL
      return sql`CASE WHEN ${raw} ~ '^-?[0-9]*\\.?[0-9]+([eE][+-]?[0-9]+)?$' THEN (${val})::numeric ELSE NULL END`;
    case "date":
      // ISO dates (YYYY-MM-DD) are lexicographically sortable as text
      return val;
    case "datetime":
      // ISO timestamps are lexicographically sortable as text
      return val;
    default:
      return val;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

async function resolveColumns(
  connectorEntityId: string
): Promise<ResolvedColumn[]> {
  const mappings =
    await fieldMappingsRepo.findByConnectorEntityId(connectorEntityId);
  if (mappings.length === 0) return [];

  const colDefIds = [...new Set(mappings.map((m) => m.columnDefinitionId))];
  const colDefs = await Promise.all(
    colDefIds.map((id) => columnDefinitionsRepo.findById(id))
  );

  const colDefMap = new Map(
    colDefs
      .filter((cd): cd is NonNullable<typeof cd> => cd != null)
      .map((cd) => [cd.id, cd])
  );

  return mappings.reduce<ResolvedColumn[]>((acc, m) => {
    const cd = colDefMap.get(m.columnDefinitionId);
    if (!cd) return acc;
    acc.push({
      key: cd.key,
      label: cd.label,
      type: cd.type as ColumnDataType,
      normalizedKey: m.normalizedKey,
      required: m.required,
      enumValues: m.enumValues ?? null,
      defaultValue: m.defaultValue ?? null,
      format: m.format ?? null,
      validationPattern: cd.validationPattern ?? null,
      canonicalFormat: cd.canonicalFormat ?? null,
    });
    return acc;
  }, []);
}

async function resolveEntityOrThrow(
  connectorEntityId: string,
  next: NextFunction
) {
  const entity =
    await DbService.repository.connectorEntities.findById(connectorEntityId);
  if (!entity) {
    next(
      new ApiError(
        404,
        ApiCode.CONNECTOR_ENTITY_NOT_FOUND,
        "Connector entity not found"
      )
    );
    return null;
  }
  return entity;
}

// ── GET / — List records ────────────────────────────────────────────

entityRecordRouter.get(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const connectorEntityId = req.params.connectorEntityId;
      const entity = await resolveEntityOrThrow(connectorEntityId, next);
      if (!entity) return;

      const { limit, offset, sortBy, sortOrder, columns, search, filters, isValid } =
        EntityRecordListRequestQuerySchema.parse(req.query);

      // Resolve column definitions early — needed for JSONB sorting and filter validation
      const columnDefs = await resolveColumns(connectorEntityId);

      const conditions: SQL[] = [
        eq(entityRecords.connectorEntityId, connectorEntityId),
      ];

      if (isValid !== undefined) {
        conditions.push(eq(entityRecords.isValid, isValid === "true"));
      }

      if (search) {
        // Cast normalizedData JSONB values to text and search across all values
        conditions.push(
          sql`EXISTS (
            SELECT 1 FROM jsonb_each_text(${entityRecords.normalizedData}) AS kv
            WHERE kv.value ILIKE ${"%" + search + "%"}
          )`
        );
      }

      // Parse and apply advanced filters from base64-encoded query param
      if (filters) {
        const filterResult = parseAndBuildFilterSQL(filters, columnDefs);
        if (isFilterError(filterResult)) {
          return next(
            new ApiError(
              400,
              ApiCode.ENTITY_RECORD_INVALID_FILTER,
              filterResult.message,
            )
          );
        }
        conditions.push(filterResult.where);
      }

      const where = and(...conditions)!;

      // Determine sort expression: table column or JSONB field with type casting
      let orderByExpr: Column | SQL;
      if (SORTABLE_COLUMNS[sortBy]) {
        orderByExpr = SORTABLE_COLUMNS[sortBy];
      } else {
        const colDef = columnDefs.find(
          (c) => c.key === sortBy && SORTABLE_COLUMN_TYPES.has(c.type)
        );
        orderByExpr = colDef
          ? buildJsonbSortExpression(sortBy, colDef.type)
          : SORTABLE_COLUMNS.created;
      }

      const listOpts = {
        limit,
        offset,
        orderBy: { column: orderByExpr, direction: sortOrder },
      };

      const [records, total] = await Promise.all([
        DbService.repository.entityRecords.findMany(where, listOpts),
        DbService.repository.entityRecords.count(where),
      ]).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(
          500,
          ApiCode.ENTITY_RECORD_FETCH_FAILED,
          error instanceof Error ? error.message : "Failed to list records"
        );
      });

      // If columns param is set, filter to requested columns only
      const requestedKeys = columns
        ? new Set(columns.split(",").map((c) => c.trim()))
        : null;
      const filteredColumns = requestedKeys
        ? columnDefs.filter((c) => requestedKeys.has(c.key))
        : columnDefs;

      // Filter normalizedData to requested columns if specified
      const rows = records.map((r) => {
        if (!requestedKeys) return r;
        const nd = (r.normalizedData ?? {}) as Record<string, unknown>;
        const filtered: Record<string, unknown> = {};
        for (const key of requestedKeys) {
          if (key in nd) filtered[key] = nd[key];
        }
        return { ...r, normalizedData: filtered };
      });

      return HttpService.success<EntityRecordListResponsePayload>(res, {
        records: rows as unknown as EntityRecordListResponsePayload["records"],
        columns: filteredColumns,
        source: "cache",
        total,
        limit,
        offset,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to list entity records"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ENTITY_RECORD_FETCH_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to list entity records"
            )
      );
    }
  }
);

// ── GET /count — Record count ───────────────────────────────────────

entityRecordRouter.get(
  "/count",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const connectorEntityId = req.params.connectorEntityId;
      const entity = await resolveEntityOrThrow(connectorEntityId, next);
      if (!entity) return;

      const where = eq(
        entityRecords.connectorEntityId,
        connectorEntityId
      );
      const total = await DbService.repository.entityRecords
        .count(where)
        .catch((error) => {
          if (error instanceof ApiError) throw error;
          throw new ApiError(
            500,
            ApiCode.ENTITY_RECORD_FETCH_FAILED,
            error instanceof Error ? error.message : "Failed to count records"
          );
        });

      return HttpService.success<EntityRecordCountResponsePayload>(res, {
        total,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to count entity records"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ENTITY_RECORD_FETCH_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to count entity records"
            )
      );
    }
  }
);

// ── GET /:recordId — Get single record ──────────────────────────────

entityRecordRouter.get(
  "/:recordId",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { connectorEntityId, recordId } = req.params;
      const entity = await resolveEntityOrThrow(connectorEntityId, next);
      if (!entity) return;

      const record = await DbService.repository.entityRecords.findById(recordId);
      if (!record || record.connectorEntityId !== connectorEntityId) {
        return next(
          new ApiError(404, ApiCode.ENTITY_RECORD_NOT_FOUND, "Entity record not found")
        );
      }

      const columns = await resolveColumns(connectorEntityId);

      return HttpService.success<EntityRecordGetResponsePayload>(res, {
        record: record as unknown as EntityRecordGetResponsePayload["record"],
        columns,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to get entity record"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ENTITY_RECORD_FETCH_FAILED,
              error instanceof Error ? error.message : "Failed to get entity record"
            )
      );
    }
  }
);

// ── POST / — Create single record ───────────────────────────────────

/**
 * @openapi
 * /api/connector-entities/{connectorEntityId}/records:
 *   post:
 *     tags:
 *       - Entity Records
 *     summary: Create a single entity record
 *     description: >
 *       Creates a new entity record with the provided normalizedData.
 *       Requires write capability on the connector instance.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: connectorEntityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Connector entity ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - normalizedData
 *             properties:
 *               normalizedData:
 *                 type: object
 *                 additionalProperties: true
 *                 description: Record data mapped through field mappings
 *               sourceId:
 *                 type: string
 *                 description: Optional source identifier (auto-generated UUID if omitted)
 *     responses:
 *       201:
 *         description: Record created
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
 *                     record:
 *                       $ref: '#/components/schemas/EntityRecord'
 *       400:
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Connector entity not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       422:
 *         description: Write capability disabled on the connector instance
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
entityRecordRouter.post(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const connectorEntityId = req.params.connectorEntityId;
      const entity = await resolveEntityOrThrow(connectorEntityId, next);
      if (!entity) return;

      await assertWriteCapability(connectorEntityId);
      await RevalidationService.assertNoActiveJob(connectorEntityId);

      const parsed = EntityRecordCreateRequestBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.ENTITY_RECORD_INVALID_PAYLOAD,
            "Invalid entity record payload"
          )
        );
      }

      const { userId, organizationId } = req.application!.metadata;
      const factory = new EntityRecordModelFactory();
      const idFactory = new UUIDv4Factory();
      const model = factory.create(userId);
      model.update({
        organizationId,
        connectorEntityId,
        data: parsed.data.normalizedData,
        normalizedData: parsed.data.normalizedData,
        sourceId: parsed.data.sourceId ?? idFactory.generate(),
        checksum: "manual",
        syncedAt: Date.now(),
        origin: "manual",
        validationErrors: null,
        isValid: true,
      });

      const record = await DbService.repository.entityRecords
        .create(model.parse())
        .catch((error) => {
          if (error instanceof ApiError) throw error;
          throw new ApiError(
            500,
            ApiCode.ENTITY_RECORD_CREATE_FAILED,
            error instanceof Error ? error.message : "Failed to create record"
          );
        });

      logger.info({ connectorEntityId, recordId: record.id }, "Entity record created");

      return HttpService.success<EntityRecordCreateResponsePayload>(
        res,
        { record: record as unknown as EntityRecordCreateResponsePayload["record"] },
        201
      );
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to create entity record"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ENTITY_RECORD_CREATE_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to create entity record"
            )
      );
    }
  }
);

// ── POST /import — Bulk import ──────────────────────────────────────

entityRecordRouter.post(
  "/import",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const connectorEntityId = req.params.connectorEntityId;
      const entity = await resolveEntityOrThrow(connectorEntityId, next);
      if (!entity) return;

      await RevalidationService.assertNoActiveJob(connectorEntityId);

      const parsed = EntityRecordImportRequestBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.ENTITY_RECORD_INVALID_PAYLOAD,
            "Invalid import payload"
          )
        );
      }

      const { userId, organizationId } = req.application!.metadata;
      const now = Date.now();
      const factory = new EntityRecordModelFactory();

      // Look up existing records by sourceId for change detection
      const sourceIds = parsed.data.records.map((r) => r.sourceId);
      const existing =
        await DbService.repository.entityRecords.findBySourceIds(
          connectorEntityId,
          sourceIds
        );
      const existingMap = new Map(existing.map((r) => [r.sourceId, r]));

      let created = 0;
      let updated = 0;
      let unchanged = 0;

      const toUpsert = [];

      for (const row of parsed.data.records) {
        const prev = existingMap.get(row.sourceId);
        if (prev && prev.checksum === row.checksum) {
          unchanged++;
          continue;
        }

        if (prev) {
          updated++;
        } else {
          created++;
        }

        const model = factory.create(userId);
        model.update({
          id: prev?.id ?? model.toJSON().id,
          organizationId,
          connectorEntityId,
          data: row.data,
          normalizedData: row.normalizedData,
          sourceId: row.sourceId,
          checksum: row.checksum,
          syncedAt: now,
          origin: "sync",
          updated: prev ? now : null,
          updatedBy: prev ? userId : null,
        });

        toUpsert.push(model.parse());
      }

      if (toUpsert.length > 0) {
        await DbService.repository.entityRecords
          .upsertManyBySourceId(toUpsert)
          .catch((error) => {
            if (error instanceof ApiError) throw error;
            throw new ApiError(
              500,
              ApiCode.ENTITY_RECORD_IMPORT_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to import records"
            );
          });
      }

      logger.info(
        { connectorEntityId, created, updated, unchanged },
        "Entity records imported"
      );

      return HttpService.success<EntityRecordImportResponsePayload>(
        res,
        { created, updated, unchanged },
        201
      );
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to import entity records"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ENTITY_RECORD_IMPORT_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to import entity records"
            )
      );
    }
  }
);

// ── POST /sync — Trigger sync ───────────────────────────────────────

entityRecordRouter.post(
  "/sync",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const connectorEntityId = req.params.connectorEntityId;
      const entity = await resolveEntityOrThrow(connectorEntityId, next);
      if (!entity) return;

      await RevalidationService.assertNoActiveJob(connectorEntityId);

      const { userId } = req.application!.metadata;
      const result = await SyncService.syncEntity(
        connectorEntityId,
        userId
      );

      return HttpService.success<EntityRecordSyncResponsePayload>(res, result);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to sync entity records"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ENTITY_RECORD_SYNC_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to sync entity records"
            )
      );
    }
  }
);

// ── POST /revalidate — Trigger async re-validation ─────────────────

entityRecordRouter.post(
  "/revalidate",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const connectorEntityId = req.params.connectorEntityId;
      const entity = await resolveEntityOrThrow(connectorEntityId, next);
      if (!entity) return;

      const { userId, organizationId } = req.application!.metadata;

      // Prevent duplicate revalidation — returns existing job if one is active
      const job = await RevalidationService.enqueue(
        connectorEntityId,
        organizationId,
        userId,
      );

      logger.info({ connectorEntityId, jobId: job.id }, "Revalidation job enqueued");

      return HttpService.success(res, { job }, 202);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to enqueue revalidation job"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ENTITY_RECORD_FETCH_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to enqueue revalidation job"
            )
      );
    }
  }
);

// ── PATCH /:recordId — Update single record ────────────────────────

/**
 * @openapi
 * /api/connector-entities/{connectorEntityId}/records/{recordId}:
 *   patch:
 *     tags:
 *       - Entity Records
 *     summary: Update a single entity record
 *     description: >
 *       Partially updates an entity record's data and/or normalizedData.
 *       Requires write capability on the connector instance.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: connectorEntityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Connector entity ID
 *       - in: path
 *         name: recordId
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity record ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               data:
 *                 type: object
 *                 additionalProperties: true
 *                 description: Raw source data
 *               normalizedData:
 *                 type: object
 *                 additionalProperties: true
 *                 description: Normalized data mapped through field mappings
 *     responses:
 *       200:
 *         description: Record updated
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
 *                     record:
 *                       $ref: '#/components/schemas/EntityRecord'
 *       404:
 *         description: Entity record not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       422:
 *         description: Write capability disabled on the connector instance
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
entityRecordRouter.patch(
  "/:recordId",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { connectorEntityId, recordId } = req.params;
      const entity = await resolveEntityOrThrow(connectorEntityId, next);
      if (!entity) return;

      await assertWriteCapability(connectorEntityId);
      await RevalidationService.assertNoActiveJob(connectorEntityId);

      const parsed = EntityRecordPatchRequestBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(400, ApiCode.ENTITY_RECORD_INVALID_PAYLOAD, "Invalid entity record payload")
        );
      }

      if (!parsed.data.data && !parsed.data.normalizedData) {
        return next(
          new ApiError(400, ApiCode.ENTITY_RECORD_INVALID_PAYLOAD, "At least one of data or normalizedData must be provided")
        );
      }

      const record = await DbService.repository.entityRecords.findById(recordId);
      if (!record || record.connectorEntityId !== connectorEntityId) {
        return next(
          new ApiError(404, ApiCode.ENTITY_RECORD_NOT_FOUND, "Entity record not found")
        );
      }

      const { userId } = req.application!.metadata;

      const updated = await DbService.repository.entityRecords
        .update(recordId, {
          ...(parsed.data.data && { data: parsed.data.data }),
          ...(parsed.data.normalizedData && { normalizedData: parsed.data.normalizedData }),
          updatedBy: userId,
        })
        .catch((error) => {
          if (error instanceof ApiError) throw error;
          throw new ApiError(
            500,
            ApiCode.ENTITY_RECORD_UPDATE_FAILED,
            error instanceof Error ? error.message : "Failed to update record"
          );
        });

      logger.info({ connectorEntityId, recordId }, "Entity record updated");

      return HttpService.success<EntityRecordPatchResponsePayload>(res, {
        record: updated as unknown as EntityRecordPatchResponsePayload["record"],
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to update entity record"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ENTITY_RECORD_UPDATE_FAILED,
              error instanceof Error ? error.message : "Failed to update entity record"
            )
      );
    }
  }
);

// ── DELETE /:recordId — Delete single record ───────────────────────

/**
 * @openapi
 * /api/connector-entities/{connectorEntityId}/records/{recordId}:
 *   delete:
 *     tags:
 *       - Entity Records
 *     summary: Delete a single entity record
 *     description: Soft-deletes a single entity record. Requires write capability on the connector instance.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: connectorEntityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Connector entity ID
 *       - in: path
 *         name: recordId
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity record ID
 *     responses:
 *       200:
 *         description: Record deleted
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
 *         description: Entity record not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       422:
 *         description: Write capability disabled on the connector instance
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
entityRecordRouter.delete(
  "/:recordId",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { connectorEntityId, recordId } = req.params;
      const entity = await resolveEntityOrThrow(connectorEntityId, next);
      if (!entity) return;

      await assertWriteCapability(connectorEntityId);
      await RevalidationService.assertNoActiveJob(connectorEntityId);

      const record = await DbService.repository.entityRecords.findById(recordId);
      if (!record || record.connectorEntityId !== connectorEntityId) {
        return next(
          new ApiError(404, ApiCode.ENTITY_RECORD_NOT_FOUND, "Entity record not found")
        );
      }

      const { userId } = req.application!.metadata;

      await DbService.repository.entityRecords.softDelete(recordId, userId).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(
          500,
          ApiCode.ENTITY_RECORD_DELETE_FAILED,
          error instanceof Error ? error.message : "Failed to delete record"
        );
      });

      logger.info({ connectorEntityId, recordId }, "Entity record soft-deleted");

      return HttpService.success<EntityRecordDeleteOneResponsePayload>(res, { id: recordId });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to delete entity record"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ENTITY_RECORD_DELETE_FAILED,
              error instanceof Error ? error.message : "Failed to delete entity record"
            )
      );
    }
  }
);

// ── DELETE / — Clear all records ────────────────────────────────────

/**
 * @openapi
 * /api/connector-entities/{connectorEntityId}/records:
 *   delete:
 *     tags:
 *       - Entity Records
 *     summary: Clear all entity records
 *     description: Soft-deletes all records for a connector entity. Requires write capability on the connector instance.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: connectorEntityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Connector entity ID
 *     responses:
 *       200:
 *         description: Records deleted
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
 *                     deleted:
 *                       type: integer
 *                       description: Number of records that were soft-deleted
 *       422:
 *         description: Write capability disabled on the connector instance
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
entityRecordRouter.delete(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const connectorEntityId = req.params.connectorEntityId;
      const entity = await resolveEntityOrThrow(connectorEntityId, next);
      if (!entity) return;

      await assertWriteCapability(connectorEntityId);
      await RevalidationService.assertNoActiveJob(connectorEntityId);

      const { userId } = req.application!.metadata;
      const deleted =
        await DbService.repository.entityRecords
          .softDeleteByConnectorEntityId(connectorEntityId, userId)
          .catch((error) => {
            if (error instanceof ApiError) throw error;
            throw new ApiError(
              500,
              ApiCode.ENTITY_RECORD_DELETE_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to delete records"
            );
          });

      logger.info(
        { connectorEntityId, deleted },
        "Entity records soft-deleted"
      );

      return HttpService.success<EntityRecordDeleteResponsePayload>(res, {
        deleted,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to delete entity records"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ENTITY_RECORD_DELETE_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to delete entity records"
            )
      );
    }
  }
);
