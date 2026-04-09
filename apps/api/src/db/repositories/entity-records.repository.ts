/**
 * Repository for the `entity_records` table.
 *
 * Extends the generic {@link Repository} with entity-scoped queries
 * and source-ID-based upserts for the sync/import workflow.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { eq, and, sql, inArray, isNull } from "drizzle-orm";
import type { IndexColumn } from "drizzle-orm/pg-core";

import { entityRecords } from "../schema/index.js";
import { db } from "../client.js";
import {
  Repository,
  type DbClient,
  type ListOptions,
} from "./base.repository.js";
import type {
  EntityRecordSelect,
  EntityRecordInsert,
} from "../schema/zod.js";

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
    return this.count(inArray(entityRecords.connectorEntityId, connectorEntityIds), client);
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
