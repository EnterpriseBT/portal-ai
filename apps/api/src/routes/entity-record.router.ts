/**
 * Entity Records router.
 *
 * Mounted under `/api/connector-entities/:connectorEntityId/records`.
 * Provides paginated record listing, count, bulk import, sync, and clear.
 */

import { Router, Request, Response, NextFunction } from "express";
import { eq, type Column } from "drizzle-orm";

import { EntityRecordModelFactory } from "@portalai/core/models";
import {
  EntityRecordListRequestQuerySchema,
  type EntityRecordListResponsePayload,
  type EntityRecordCountResponsePayload,
  EntityRecordImportRequestBodySchema,
  type EntityRecordImportResponsePayload,
  type EntityRecordSyncResponsePayload,
  type EntityRecordDeleteResponsePayload,
} from "@portalai/core/contracts";
import { createLogger } from "../utils/logger.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "../services/db.service.js";
import { entityRecords } from "../db/schema/index.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { SyncService } from "../services/sync.service.js";
import { fieldMappingsRepo } from "../db/repositories/field-mappings.repository.js";
import { columnDefinitionsRepo } from "../db/repositories/column-definitions.repository.js";
import type { ColumnDefinitionSummary } from "../adapters/adapter.interface.js";
import type { ColumnDataType } from "@portalai/core/models";

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
): Promise<ColumnDefinitionSummary[]> {
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

  return mappings
    .map((m) => {
      const cd = colDefMap.get(m.columnDefinitionId);
      if (!cd) return null;
      return { key: cd.key, label: cd.label, type: cd.type as ColumnDataType };
    })
    .filter((c): c is ColumnDefinitionSummary => c != null);
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

      const { limit, offset, sortBy, sortOrder, columns } =
        EntityRecordListRequestQuerySchema.parse(req.query);

      const where = eq(
        entityRecords.connectorEntityId,
        connectorEntityId
      );
      const column = SORTABLE_COLUMNS[sortBy] ?? SORTABLE_COLUMNS.created;
      const listOpts = {
        limit,
        offset,
        orderBy: { column, direction: sortOrder },
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

      const columnDefs = await resolveColumns(connectorEntityId);

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

// ── POST /import — Bulk import ──────────────────────────────────────

entityRecordRouter.post(
  "/import",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const connectorEntityId = req.params.connectorEntityId;
      const entity = await resolveEntityOrThrow(connectorEntityId, next);
      if (!entity) return;

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

// ── DELETE / — Clear all records ────────────────────────────────────

entityRecordRouter.delete(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const connectorEntityId = req.params.connectorEntityId;
      const entity = await resolveEntityOrThrow(connectorEntityId, next);
      if (!entity) return;

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
