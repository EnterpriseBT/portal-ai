/**
 * Repository for the `entity_records` table.
 *
 * Extends the generic {@link Repository} with entity-scoped queries
 * and source-ID-based upserts for the sync/import workflow.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { eq, and, lt, sql, inArray, isNull } from "drizzle-orm";
import type { IndexColumn } from "drizzle-orm/pg-core";

import { entityRecords } from "../schema/index.js";
import { db } from "../client.js";
import {
  Repository,
  type DbClient,
  type ListOptions,
} from "./base.repository.js";
import type { EntityRecordSelect, EntityRecordInsert } from "../schema/zod.js";

export class EntityRecordsRepository extends Repository<
  typeof entityRecords,
  EntityRecordSelect,
  EntityRecordInsert
> {
  constructor() {
    super(entityRecords);
  }

  /** Find all records for a given connector entity (soft-delete aware). */
  async findByConnectorEntityId(
    connectorEntityId: string,
    opts: ListOptions = {},
    client: DbClient = db
  ): Promise<EntityRecordSelect[]> {
    const where = eq(entityRecords.connectorEntityId, connectorEntityId);
    return this.findMany(where, opts, client);
  }

  /** Count records across multiple connector entities (soft-delete aware). */
  async countByConnectorEntityIds(
    connectorEntityIds: string[],
    client: DbClient = db
  ): Promise<number> {
    if (connectorEntityIds.length === 0) return 0;
    return this.count(
      inArray(entityRecords.connectorEntityId, connectorEntityIds),
      client
    );
  }

  /** Count records for a given connector entity (soft-delete aware). */
  async countByConnectorEntityId(
    connectorEntityId: string,
    client: DbClient = db
  ): Promise<number> {
    const where = eq(entityRecords.connectorEntityId, connectorEntityId);
    return this.count(where, client);
  }

  /**
   * Insert a record or update it if a row with the same
   * `(connector_entity_id, source_id)` already exists.
   * Returns the resulting row.
   */
  async upsertBySourceId(
    data: EntityRecordInsert,
    client: DbClient = db
  ): Promise<EntityRecordSelect> {
    const [row] = await (client as typeof db)
      .insert(this.table)
      .values(data as never)
      .onConflictDoUpdate({
        target: [
          entityRecords.connectorEntityId,
          entityRecords.sourceId,
        ] as IndexColumn[],
        targetWhere: isNull(entityRecords.deleted),
        set: {
          data: data.data,
          normalizedData: data.normalizedData,
          checksum: data.checksum,
          syncedAt: data.syncedAt,
          validationErrors: data.validationErrors,
          isValid: data.isValid,
          updated: data.updated ?? Date.now(),
          updatedBy: data.updatedBy,
        } as never,
      })
      .returning();
    return row as EntityRecordSelect;
  }

  /**
   * Bulk upsert records on `(connector_entity_id, source_id)`.
   * Executes as a single statement. Returns all resulting rows.
   */
  async upsertManyBySourceId(
    data: EntityRecordInsert[],
    client: DbClient = db
  ): Promise<EntityRecordSelect[]> {
    if (data.length === 0) return [];

    const rows = await (client as typeof db)
      .insert(this.table)
      .values(data as never[])
      .onConflictDoUpdate({
        target: [
          entityRecords.connectorEntityId,
          entityRecords.sourceId,
        ] as IndexColumn[],
        targetWhere: isNull(entityRecords.deleted),
        set: {
          data: sql.raw(`excluded."data"`),
          normalizedData: sql.raw(`excluded."normalized_data"`),
          checksum: sql.raw(`excluded."checksum"`),
          syncedAt: sql.raw(`excluded."synced_at"`),
          validationErrors: sql.raw(`excluded."validation_errors"`),
          isValid: sql.raw(`excluded."is_valid"`),
          updated: sql.raw(`excluded."updated"`),
          updatedBy: sql.raw(`excluded."updated_by"`),
        } as any,
      })
      .returning();
    return rows as EntityRecordSelect[];
  }

  /**
   * Bump `synced_at` for the given rows in a single UPDATE — used by
   * the sync pipeline for "unchanged" rows so the watermark reaper at
   * the end of the run doesn't soft-delete them.
   *
   * The unchanged path in `writeRecords` short-circuits the upsert
   * (avoiding pointless data writes), but if we don't advance
   * `synced_at`, those rows still satisfy `synced_at < runStartedAt`
   * and get reaped. This helper closes that gap with one statement.
   */
  async bulkUpdateSyncedAt(
    ids: string[],
    syncedAt: number,
    client: DbClient = db
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await (client as typeof db)
      .update(this.table)
      .set({ syncedAt } as any)
      .where(
        and(inArray(entityRecords.id, ids), isNull(entityRecords.deleted))
      )
      .returning({ id: entityRecords.id });
    return result.length;
  }

  /**
   * Resurrect previously soft-deleted rows by id and stamp them with new
   * data. Used by the commit/sync pipeline when a `(connector_entity_id,
   * source_id)` reappears in the source after a prior soft-delete (e.g.
   * the user cleared records and then re-synced from the spreadsheet).
   *
   * The bulk upsert can't handle this case: its conflict target is the
   * partial unique index `(connector_entity_id, source_id) WHERE deleted
   * IS NULL`, so soft-deleted rows aren't seen as conflicts. Reusing
   * their `id` in the INSERT then collides on the primary key. So this
   * helper does an explicit per-row UPDATE that intentionally does NOT
   * filter on `deleted IS NULL` (the base repo's `update()` does, which
   * is exactly what we need to bypass).
   *
   * Runs each row's UPDATE individually inside the supplied transaction
   * — the row count for sync is bounded by reapings + new appearances,
   * which is small in practice. Returns the count of rows affected.
   */
  async bulkResurrect(
    payloads: Array<{
      id: string;
      data: Partial<EntityRecordInsert>;
    }>,
    client: DbClient = db
  ): Promise<number> {
    if (payloads.length === 0) return 0;
    let affected = 0;
    for (const { id, data } of payloads) {
      const [row] = await (client as typeof db)
        .update(this.table)
        .set(data as any)
        .where(eq(entityRecords.id, id))
        .returning({ id: entityRecords.id });
      if (row) affected++;
    }
    return affected;
  }

  /**
   * Soft-delete all records for a given connector entity.
   * Returns the number of affected rows.
   */
  async softDeleteByConnectorEntityId(
    connectorEntityId: string,
    deletedBy: string,
    client: DbClient = db
  ): Promise<number> {
    const now = Date.now();
    const result = await (client as typeof db)
      .update(this.table)
      .set({ deleted: now, deletedBy } as any)
      .where(
        and(
          eq(entityRecords.connectorEntityId, connectorEntityId),
          this.notDeleted()
        )
      )
      .returning();
    return result.length;
  }

  /**
   * Soft-delete every live record for `connectorEntityId` whose
   * `syncedAt` is strictly less than `watermarkMs`. The watermark reaper
   * for sync's disappeared-records reconciliation: capture
   * `runStartedAt` at sync entry, stamp every upserted row with
   * `syncedAt = runStartedAt`, then call this with the same watermark
   * to soft-delete anything the run didn't touch.
   *
   * Strict `<` (not `<=`) so a row that was just upserted at the
   * watermark stays live. Returns the rowcount the route can surface
   * as the "X removed" half of the sync result.
   *
   * Uses `entity_records_entity_synced_at_idx (connector_entity_id,
   * synced_at)` for the index scan. See
   * `docs/GOOGLE_SHEETS_CONNECTOR.phase-D.plan.md` §Slice 1.
   */
  async softDeleteBeforeWatermark(
    connectorEntityId: string,
    watermarkMs: number,
    deletedBy: string,
    client: DbClient = db
  ): Promise<number> {
    const now = Date.now();
    const result = await (client as typeof db)
      .update(this.table)
      .set({ deleted: now, deletedBy } as never)
      .where(
        and(
          eq(entityRecords.connectorEntityId, connectorEntityId),
          lt(entityRecords.syncedAt, watermarkMs),
          this.notDeleted()
        )
      )
      .returning();
    return result.length;
  }

  /**
   * Soft-delete all records across multiple connector entities.
   * Returns the number of affected rows.
   */
  async softDeleteByConnectorEntityIds(
    connectorEntityIds: string[],
    deletedBy: string,
    client: DbClient = db
  ): Promise<number> {
    if (connectorEntityIds.length === 0) return 0;
    const now = Date.now();
    const result = await (client as typeof db)
      .update(this.table)
      .set({ deleted: now, deletedBy } as any)
      .where(
        and(
          inArray(entityRecords.connectorEntityId, connectorEntityIds),
          this.notDeleted()
        )
      )
      .returning();
    return result.length;
  }

  /**
   * Find records by connector entity ID and source IDs.
   * Useful for checking existing records before an import.
   */
  async findBySourceIds(
    connectorEntityId: string,
    sourceIds: string[],
    client: DbClient = db
  ): Promise<EntityRecordSelect[]> {
    if (sourceIds.length === 0) return [];

    const { inArray } = await import("drizzle-orm");
    return (await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(entityRecords.connectorEntityId, connectorEntityId),
          inArray(entityRecords.sourceId, sourceIds),
          this.notDeleted()
        )
      )) as EntityRecordSelect[];
  }
}

/** Singleton instance. */
export const entityRecordsRepo = new EntityRecordsRepository();
