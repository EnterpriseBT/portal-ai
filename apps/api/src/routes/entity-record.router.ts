/**
 * Entity Records router.
 *
 * Mounted under `/api/connector-entities/:connectorEntityId/records`.
 * Provides paginated record listing, count, bulk import, sync, and clear.
 */

import { Router, Request, Response, NextFunction } from "express";
import { eq, and, sql, type SQL } from "drizzle-orm";

import { EntityRecordModelFactory } from "@portalai/core/models";
import { UUIDv4Factory } from "@portalai/core/utils";
import {
  EntityRecordListRequestQuerySchema,
  type EntityRecordListResponsePayload,
  type EntityRecordCountResponsePayload,
  type EntityRecordGetResponsePayload,
  EntityRecordImportRequestBodySchema,
  type EntityRecordImportResponsePayload,
  EntityRecordCreateRequestBodySchema,
  type EntityRecordCreateResponsePayload,
  EntityRecordPatchRequestBodySchema,
  type EntityRecordPatchResponsePayload,
  type EntityRecordDeleteOneResponsePayload,
  type EntityRecordDeleteResponsePayload,
} from "@portalai/core/contracts";
import { createLogger } from "../utils/logger.util.js";
import {
  parseFilterPayload,
  buildFilterSqlForEntity,
  buildSortExpression,
  isFilterError,
} from "../utils/filter-sql.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "../services/db.service.js";
import { entityRecords } from "../db/schema/index.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { assertWriteCapability } from "../utils/resolve-capabilities.util.js";
import { JobLockService } from "../services/job-lock.service.js";
import { RevalidationService } from "../services/revalidation.service.js";
import { fieldMappingsRepo } from "../db/repositories/field-mappings.repository.js";
import { columnDefinitionsRepo } from "../db/repositories/column-definitions.repository.js";
import {
  buildJsonbObjectExpr,
  wideTableStatementCache,
} from "../services/wide-table-statement.cache.js";
import {
  projectToWideRow,
  buildMappingsForProjection,
} from "../services/wide-table-projection.util.js";
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

      const {
        limit,
        offset,
        sortBy,
        sortOrder,
        columns,
        search,
        filters,
        isValid,
      } = EntityRecordListRequestQuerySchema.parse(req.query);

      // Resolve column definitions and the wide-table statement cache up
      // front — needed for filter / sort / search SQL all of which now
      // reference typed `er__<id>` columns.
      const columnDefs = await resolveColumns(connectorEntityId);
      const stmt = await wideTableStatementCache.get(connectorEntityId);

      const conditions: SQL[] = [
        eq(entityRecords.connectorEntityId, connectorEntityId),
      ];

      if (isValid !== undefined) {
        conditions.push(eq(entityRecords.isValid, isValid === "true"));
      }

      if (search) {
        const concatExpr = stmt.searchableConcatSql("w");
        // Empty searchable set collapses to `''`, which never matches a
        // non-empty pattern. The wrapping `WHERE` is still well-formed.
        conditions.push(
          sql`${sql.raw(concatExpr)} ILIKE ${"%" + search + "%"}`
        );
      }

      // Parse + validate advanced filters; build typed-column WHERE.
      if (filters) {
        const parsed = parseFilterPayload(filters, columnDefs);
        if ("message" in parsed) {
          return next(
            new ApiError(
              400,
              ApiCode.ENTITY_RECORD_INVALID_FILTER,
              parsed.message
            )
          );
        }
        const built = buildFilterSqlForEntity(
          parsed.expression,
          stmt,
          parsed.columnTypes
        );
        if (isFilterError(built)) {
          return next(
            new ApiError(
              400,
              ApiCode.ENTITY_RECORD_INVALID_FILTER,
              built.message
            )
          );
        }
        conditions.push(built.where);
      }

      const where = and(...conditions)!;

      // Sort: transactional fields → entity_records column; normalized
      // keys → typed wide-table column. Unknown sort keys fall back to
      // `created` (existing behaviour).
      let orderByExpr: Column | SQL;
      if (SORTABLE_COLUMNS[sortBy]) {
        orderByExpr = SORTABLE_COLUMNS[sortBy];
      } else {
        const typed = buildSortExpression(stmt, sortBy);
        orderByExpr = typed ?? SORTABLE_COLUMNS.created;
      }

      // Narrow the rehydration projection if the caller asked for a
      // subset of columns. Building the per-request `jsonb_build_object`
      // keeps the network payload tight without a post-fetch filter.
      const requestedKeys = columns
        ? new Set(columns.split(",").map((c) => c.trim()))
        : null;
      const filteredColumns = requestedKeys
        ? columnDefs.filter((c) => requestedKeys.has(c.key))
        : columnDefs;

      let normalizedDataProjection: SQL | undefined;
      if (requestedKeys && requestedKeys.size > 0) {
        const requestedNormalizedKeys = new Set(
          filteredColumns.map((c) => c.normalizedKey)
        );
        const pairs = stmt.columns
          .filter((c) => requestedNormalizedKeys.has(c.normalizedKey))
          .map(
            (c) =>
              `'${c.normalizedKey.replace(/'/g, "''")}', "w"."${c.columnName}"`
          );
        normalizedDataProjection = sql.raw(buildJsonbObjectExpr(pairs));
      }

      const [records, total] = await Promise.all([
        DbService.repository.entityRecords.findHydratedMany(
          connectorEntityId,
          {
            where,
            limit,
            offset,
            orderBy: { column: orderByExpr, direction: sortOrder },
            normalizedDataProjection,
          }
        ),
        DbService.repository.entityRecords.countHydrated(
          connectorEntityId,
          where
        ),
      ]).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(
          500,
          ApiCode.ENTITY_RECORD_FETCH_FAILED,
          error instanceof Error ? error.message : "Failed to list records"
        );
      });

      return HttpService.success<EntityRecordListResponsePayload>(res, {
        records:
          records as unknown as EntityRecordListResponsePayload["records"],
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

      const where = eq(entityRecords.connectorEntityId, connectorEntityId);
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

      const record =
        await DbService.repository.entityRecords.findHydratedById(
          recordId,
          connectorEntityId
        );
      if (!record) {
        return next(
          new ApiError(
            404,
            ApiCode.ENTITY_RECORD_NOT_FOUND,
            "Entity record not found"
          )
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
              error instanceof Error
                ? error.message
                : "Failed to get entity record"
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
      await JobLockService.assertConnectorInstanceUnlocked(
        entity.connectorInstanceId,
        req.application!.metadata.organizationId
      );
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

      const record = await DbService.transaction(async (tx) => {
        const parsed_ = model.parse();
        const inserted = await DbService.repository.entityRecords.create(
          parsed_,
          tx
        );
        const stmt = await wideTableStatementCache.get(connectorEntityId, tx);
        const mappings = buildMappingsForProjection(stmt.columns);
        await DbService.repository.wideTable.upsertMany(
          connectorEntityId,
          [
            projectToWideRow(
              {
                id: inserted.id,
                organizationId: inserted.organizationId,
                sourceId: inserted.sourceId,
                syncedAt: inserted.syncedAt,
                isValid: inserted.isValid,
                normalizedData: parsed_.normalizedData,
              },
              mappings
            ),
          ],
          tx
        );
        // Return the hydrated shape so the response carries
        // `normalizedData` rebuilt from the wide table.
        return {
          ...inserted,
          normalizedData: parsed_.normalizedData,
        };
      }).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(
          500,
          ApiCode.ENTITY_RECORD_CREATE_FAILED,
          error instanceof Error ? error.message : "Failed to create record"
        );
      });

      logger.info(
        { connectorEntityId, recordId: record.id },
        "Entity record created"
      );

      return HttpService.success<EntityRecordCreateResponsePayload>(
        res,
        {
          record:
            record as unknown as EntityRecordCreateResponsePayload["record"],
        },
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

      await JobLockService.assertConnectorInstanceUnlocked(
        entity.connectorInstanceId,
        req.application!.metadata.organizationId
      );
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
      const existing = await DbService.repository.entityRecords.findBySourceIds(
        connectorEntityId,
        sourceIds
      );
      const existingMap = new Map(existing.map((r) => [r.sourceId, r]));

      let created = 0;
      let updated = 0;
      let unchanged = 0;

      const toUpsert: ReturnType<
        ReturnType<EntityRecordModelFactory["create"]>["parse"]
      >[] = [];

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
        await DbService.transaction(async (tx) => {
          await DbService.repository.entityRecords.upsertManyBySourceId(
            toUpsert,
            tx
          );
          const stmt = await wideTableStatementCache.get(
            connectorEntityId,
            tx
          );
          const mappings = buildMappingsForProjection(stmt.columns);
          await DbService.repository.wideTable.upsertMany(
            connectorEntityId,
            toUpsert.map((r) => projectToWideRow(r, mappings)),
            tx
          );
        }).catch((error) => {
          if (error instanceof ApiError) throw error;
          throw new ApiError(
            500,
            ApiCode.ENTITY_RECORD_IMPORT_FAILED,
            error instanceof Error ? error.message : "Failed to import records"
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

      await JobLockService.assertConnectorInstanceUnlocked(
        entity.connectorInstanceId,
        organizationId
      );

      // Prevent duplicate revalidation — returns existing job if one is active
      const job = await RevalidationService.enqueue(
        connectorEntityId,
        organizationId,
        userId
      );

      logger.info(
        { connectorEntityId, jobId: job.id },
        "Revalidation job enqueued"
      );

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
      await JobLockService.assertConnectorInstanceUnlocked(
        entity.connectorInstanceId,
        req.application!.metadata.organizationId
      );
      await RevalidationService.assertNoActiveJob(connectorEntityId);

      const parsed = EntityRecordPatchRequestBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.ENTITY_RECORD_INVALID_PAYLOAD,
            "Invalid entity record payload"
          )
        );
      }

      if (!parsed.data.data && !parsed.data.normalizedData) {
        return next(
          new ApiError(
            400,
            ApiCode.ENTITY_RECORD_INVALID_PAYLOAD,
            "At least one of data or normalizedData must be provided"
          )
        );
      }

      const record =
        await DbService.repository.entityRecords.findById(recordId);
      if (!record || record.connectorEntityId !== connectorEntityId) {
        return next(
          new ApiError(
            404,
            ApiCode.ENTITY_RECORD_NOT_FOUND,
            "Entity record not found"
          )
        );
      }

      const { userId } = req.application!.metadata;

      const updated = await DbService.transaction(async (tx) => {
        await DbService.repository.entityRecords.update(
          recordId,
          {
            ...(parsed.data.data && { data: parsed.data.data }),
            updatedBy: userId,
          },
          tx
        );
        // Partial-merge into the wide table: only the keys present in
        // the patch are written. Unknown keys (no field mapping) are
        // silently dropped by `updatePartial`.
        if (parsed.data.normalizedData) {
          await DbService.repository.wideTable.updatePartial(
            connectorEntityId,
            recordId,
            parsed.data.normalizedData,
            {},
            tx
          );
        }
        // Read back the hydrated record so the response carries
        // `normalizedData` rebuilt from the wide table.
        const hydrated =
          await DbService.repository.entityRecords.findHydratedById(
            recordId,
            connectorEntityId,
            tx
          );
        return hydrated;
      }).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(
          500,
          ApiCode.ENTITY_RECORD_UPDATE_FAILED,
          error instanceof Error ? error.message : "Failed to update record"
        );
      });

      logger.info({ connectorEntityId, recordId }, "Entity record updated");

      return HttpService.success<EntityRecordPatchResponsePayload>(res, {
        record:
          updated as unknown as EntityRecordPatchResponsePayload["record"],
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
              error instanceof Error
                ? error.message
                : "Failed to update entity record"
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
      await JobLockService.assertConnectorInstanceUnlocked(
        entity.connectorInstanceId,
        req.application!.metadata.organizationId
      );
      await RevalidationService.assertNoActiveJob(connectorEntityId);

      const record =
        await DbService.repository.entityRecords.findById(recordId);
      if (!record || record.connectorEntityId !== connectorEntityId) {
        return next(
          new ApiError(
            404,
            ApiCode.ENTITY_RECORD_NOT_FOUND,
            "Entity record not found"
          )
        );
      }

      const { userId } = req.application!.metadata;

      await DbService.transaction(async (tx) => {
        await DbService.repository.entityRecords.softDelete(
          recordId,
          userId,
          tx
        );
        await DbService.repository.wideTable.softDeleteByEntityRecordIds(
          connectorEntityId,
          [recordId],
          tx
        );
      }).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(
          500,
          ApiCode.ENTITY_RECORD_DELETE_FAILED,
          error instanceof Error ? error.message : "Failed to delete record"
        );
      });

      logger.info(
        { connectorEntityId, recordId },
        "Entity record soft-deleted"
      );

      return HttpService.success<EntityRecordDeleteOneResponsePayload>(res, {
        id: recordId,
      });
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
              error instanceof Error
                ? error.message
                : "Failed to delete entity record"
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
      await JobLockService.assertConnectorInstanceUnlocked(
        entity.connectorInstanceId,
        req.application!.metadata.organizationId
      );
      await RevalidationService.assertNoActiveJob(connectorEntityId);

      const { userId } = req.application!.metadata;
      const deleted = await DbService.transaction(async (tx) => {
        // Capture the affected ids so we can cascade to the wide table.
        // softDeleteByConnectorEntityId returns a count today; switch to
        // an inline UPDATE that returns the ids.
        const liveIds = (await tx.execute(
          sql`SELECT id FROM ${entityRecords} WHERE "connector_entity_id" = ${connectorEntityId} AND "deleted" IS NULL`
        )) as unknown as Array<{ id: string }>;
        if (liveIds.length === 0) return 0;
        const ids = liveIds.map((r) => r.id);
        await DbService.repository.entityRecords.softDeleteByConnectorEntityId(
          connectorEntityId,
          userId,
          tx
        );
        await DbService.repository.wideTable.softDeleteByEntityRecordIds(
          connectorEntityId,
          ids,
          tx
        );
        return ids.length;
      }).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(
          500,
          ApiCode.ENTITY_RECORD_DELETE_FAILED,
          error instanceof Error ? error.message : "Failed to delete records"
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
