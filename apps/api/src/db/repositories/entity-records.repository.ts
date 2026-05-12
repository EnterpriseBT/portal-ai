/**
 * Repository for the `entity_records` table.
 *
 * Extends the generic {@link Repository} with entity-scoped queries
 * and source-ID-based upserts for the sync/import workflow.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  eq,
  and,
  lt,
  sql,
  inArray,
  isNull,
  type SQL,
  Column,
  asc,
  desc,
} from "drizzle-orm";
import type { IndexColumn } from "drizzle-orm/pg-core";

import { entityRecords } from "../schema/index.js";
import { db } from "../client.js";
import {
  Repository,
  type DbClient,
  type ListOptions,
} from "./base.repository.js";
import type { EntityRecordSelect, EntityRecordInsert } from "../schema/zod.js";
import { wideTableStatementCache } from "../../services/wide-table-statement.cache.js";

/**
 * Repository read shape after Phase 2: same transactional fields plus
 * a `normalizedData` blob rebuilt from the typed wide-table columns at
 * SELECT projection time.
 *
 * After slice 6 drops `entity_records.normalized_data`, the Drizzle
 * inference no longer carries the field — the rehydration via the
 * wide-table JOIN is the only path.
 */
export type EntityRecordHydrated = EntityRecordSelect & {
  normalizedData: Record<string, unknown>;
};

/**
 * Per-statement row cap for the bulk methods. Sized to stay well under
 * Postgres' 65,535 parameter limit (entity_records insert binds ~16
 * params/row → 1000 × 16 = 16,000) and to keep the Drizzle SQL builder
 * out of recursion-depth territory it hits on huge `inArray` /
 * `values()` arrays — both surface as "Maximum call stack size
 * exceeded" on ~400k-row uploads.
 */
const BULK_CHUNK_SIZE = 1000;

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
   * Bulk upsert records on `(connector_entity_id, source_id)`. Chunked
   * because Postgres caps a single statement at 65,535 parameters and
   * the Drizzle SQL builder will stack-overflow on huge `values()`
   * arrays — both kick in around ~400k-row uploads. Returns the union
   * of `RETURNING` rows across chunks.
   *
   * `onChunkComplete` (when provided) fires with the chunk's row count
   * after each successful upsert. Lets the commit pipeline emit
   * incremental Bull progress so the job list / detail views advance
   * mid-flight instead of jumping from 0% straight to 100%.
   */
  async upsertManyBySourceId(
    data: EntityRecordInsert[],
    client: DbClient = db,
    onChunkComplete?: (rowsThisChunk: number) => void
  ): Promise<EntityRecordSelect[]> {
    if (data.length === 0) return [];

    const out: EntityRecordSelect[] = [];
    for (let i = 0; i < data.length; i += BULK_CHUNK_SIZE) {
      const batch = data.slice(i, i + BULK_CHUNK_SIZE);
      const rows = await (client as typeof db)
        .insert(this.table)
        .values(batch as never[])
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
      for (const r of rows) out.push(r as EntityRecordSelect);
      onChunkComplete?.(batch.length);
    }
    return out;
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
    client: DbClient = db,
    onChunkComplete?: (rowsThisChunk: number) => void
  ): Promise<number> {
    if (ids.length === 0) return 0;
    let total = 0;
    for (let i = 0; i < ids.length; i += BULK_CHUNK_SIZE) {
      const chunk = ids.slice(i, i + BULK_CHUNK_SIZE);
      const result = await (client as typeof db)
        .update(this.table)
        .set({ syncedAt } as any)
        .where(
          and(inArray(entityRecords.id, chunk), isNull(entityRecords.deleted))
        )
        .returning({ id: entityRecords.id });
      total += result.length;
      onChunkComplete?.(chunk.length);
    }
    return total;
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
  ): Promise<string[]> {
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
      .returning({ id: entityRecords.id });
    return (result as Array<{ id: string }>).map((r) => r.id);
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
   * Find records by connector entity ID and source IDs. Chunked so that
   * very large source-id sets (e.g. ~400k-row spreadsheet uploads) stay
   * under Postgres' 65,535 parameter cap and don't recurse the Drizzle
   * SQL builder deep enough to throw "Maximum call stack size exceeded".
   *
   * Pass `includeDeleted: true` from the commit/sync writer so the
   * resurrection branch can see prior soft-deleted rows by
   * `(connector_entity_id, source_id)` and reuse their primary key.
   */
  async findBySourceIds(
    connectorEntityId: string,
    sourceIds: string[],
    opts: { includeDeleted?: boolean } = {},
    client: DbClient = db
  ): Promise<EntityRecordSelect[]> {
    if (sourceIds.length === 0) return [];
    const out: EntityRecordSelect[] = [];
    for (let i = 0; i < sourceIds.length; i += BULK_CHUNK_SIZE) {
      const chunk = sourceIds.slice(i, i + BULK_CHUNK_SIZE);
      const where = opts.includeDeleted
        ? and(
            eq(entityRecords.connectorEntityId, connectorEntityId),
            inArray(entityRecords.sourceId, chunk)
          )
        : and(
            eq(entityRecords.connectorEntityId, connectorEntityId),
            inArray(entityRecords.sourceId, chunk),
            this.notDeleted()
          );
      const rows = await (client as typeof db)
        .select()
        .from(this.table)
        .where(where);
      for (const r of rows) out.push(r as EntityRecordSelect);
    }
    return out;
  }

  // ── Hydrated reads (Phase 2 slice 3) ───────────────────────────

  /**
   * Find records for a connector entity with `normalizedData` rebuilt
   * from the wide table's typed columns via a server-side
   * `jsonb_build_object` projection.
   *
   * `where` may reference `entity_records` columns directly; the SELECT
   * adds the wide-table JOIN and the per-entity rehydration expression.
   * `orderBy.column` may be a raw `SQL` fragment (typed wide-table
   * column) or a transactional column reference.
   *
   * `normalizedDataProjection` lets the caller narrow the rebuilt blob
   * to a subset of keys — used by the `?columns=` REST parameter so the
   * server doesn't ship every column when the client wants two.
   */
  async findHydratedMany(
    connectorEntityId: string,
    opts: ListOptions & {
      where?: SQL;
      normalizedDataProjection?: SQL;
    } = {},
    client: DbClient = db
  ): Promise<EntityRecordHydrated[]> {
    const stmt = await wideTableStatementCache.get(connectorEntityId, client);
    const tableName = `er__${connectorEntityId}`;

    // Transition fallback (Phase 2): if the wide table for this entity
    // doesn't exist yet OR the cache shows zero data columns, read the
    // legacy JSONB column directly. After slice 6 drops the column,
    // every entity has a populated wide table and this branch is
    // unreachable; deletes in that slice.
    const wideAvailable = await wideTableExists(client, tableName);
    if (!wideAvailable || stmt.columns.length === 0) {
      return findHydratedManyFallback(client, connectorEntityId, opts);
    }
    const rehydrationExpr =
      opts.normalizedDataProjection ??
      sql.raw(stmt.normalizedDataJsonbExpr("w"));

    // Soft-delete guard on entity_records (the wide table has no `deleted` column).
    const baseWhere = opts.where
      ? and(opts.where, this.notDeleted())
      : and(
          eq(entityRecords.connectorEntityId, connectorEntityId),
          this.notDeleted()
        );

    // We build the SELECT manually because Drizzle's typed builder
    // doesn't model dynamically-named tables (the wide table is per
    // entity). Explicit column list avoids `normalized_data` colliding
    // with the rehydration alias while the legacy column still exists
    // on `entity_records` (slice 6 drops it).
    const orderByClause = opts.orderBy
      ? buildOrderByClause(opts.orderBy)
      : sql``;
    const limitClause =
      opts.limit !== undefined ? sql` LIMIT ${opts.limit}` : sql``;
    const offsetClause =
      opts.offset !== undefined ? sql` OFFSET ${opts.offset}` : sql``;

    // LEFT JOIN keeps records whose wide row hasn't been written yet
    // (e.g. during the staged Phase 2 cutover, or when a test fixture
    // seeds only `entity_records` directly). After Phase 2 slice 6
    // tightens the contract, an inner JOIN would be safe; for now,
    // missing wide rows fall back to an empty rehydrated blob.
    const rows = await (client as typeof db).execute(sql`
      SELECT
        "entity_records".id, "entity_records".organization_id,
        "entity_records".connector_entity_id, "entity_records".source_id,
        "entity_records".checksum, "entity_records".synced_at,
        "entity_records".origin, "entity_records".validation_errors,
        "entity_records".is_valid, "entity_records".data,
        "entity_records".created, "entity_records".created_by,
        "entity_records".updated, "entity_records".updated_by,
        "entity_records".deleted, "entity_records".deleted_by,
        COALESCE(${rehydrationExpr}, '{}'::jsonb) AS "normalized_data"
      FROM ${entityRecords}
      LEFT JOIN ${sql.raw(`"${tableName}"`)} w
        ON w."entity_record_id" = "entity_records".id
      WHERE ${baseWhere}
      ${orderByClause}
      ${limitClause}
      ${offsetClause}
    `);
    return rowsToHydrated(rows as unknown as Record<string, unknown>[]);
  }

  /**
   * Count records matching `where`, with the same wide-table JOIN
   * `findHydratedMany` uses. Required because `where` may reference
   * the `w` alias (typed wide-table columns) for filter / search,
   * which the base `count` doesn't know about.
   */
  async countHydrated(
    connectorEntityId: string,
    where?: SQL,
    client: DbClient = db
  ): Promise<number> {
    const tableName = `er__${connectorEntityId}`;
    const baseWhere = where
      ? and(where, this.notDeleted())
      : and(
          eq(entityRecords.connectorEntityId, connectorEntityId),
          this.notDeleted()
        );
    const result = (await (client as typeof db).execute(sql`
      SELECT count(*) AS count
      FROM ${entityRecords}
      LEFT JOIN ${sql.raw(`"${tableName}"`)} w
        ON w."entity_record_id" = "entity_records".id
      WHERE ${baseWhere}
    `)) as unknown as Array<{ count: number | string }>;
    return Number(result[0]?.count ?? 0);
  }

  /**
   * Single-row hydrated find — same projection as `findHydratedMany`.
   * Returns `undefined` when the row is missing, soft-deleted, or
   * belongs to a different connector entity.
   */
  async findHydratedById(
    recordId: string,
    connectorEntityId: string,
    client: DbClient = db
  ): Promise<EntityRecordHydrated | undefined> {
    const stmt = await wideTableStatementCache.get(connectorEntityId, client);
    const tableName = `er__${connectorEntityId}`;
    // Same transition fallback as `findHydratedMany`.
    const wideAvailable = await wideTableExists(client, tableName);
    if (!wideAvailable || stmt.columns.length === 0) {
      return findHydratedByIdFallback(client, recordId, connectorEntityId);
    }
    const rows = (await (client as typeof db).execute(sql`
      SELECT
        "entity_records".id, "entity_records".organization_id,
        "entity_records".connector_entity_id, "entity_records".source_id,
        "entity_records".checksum, "entity_records".synced_at,
        "entity_records".origin, "entity_records".validation_errors,
        "entity_records".is_valid, "entity_records".data,
        "entity_records".created, "entity_records".created_by,
        "entity_records".updated, "entity_records".updated_by,
        "entity_records".deleted, "entity_records".deleted_by,
        COALESCE(${sql.raw(stmt.normalizedDataJsonbExpr("w"))}, '{}'::jsonb) AS "normalized_data"
      FROM ${entityRecords}
      LEFT JOIN ${sql.raw(`"${tableName}"`)} w
        ON w."entity_record_id" = "entity_records".id
      WHERE "entity_records".id = ${recordId}
        AND "entity_records"."connector_entity_id" = ${connectorEntityId}
        AND "entity_records".deleted IS NULL
      LIMIT 1
    `)) as unknown as Record<string, unknown>[];
    if (rows.length === 0) return undefined;
    return rowsToHydrated(rows)[0];
  }
}

/**
 * Phase-2 transitional helper: check whether the wide table for an
 * entity exists. Returns false in the rare case it's been pre-created
 * by a route but the per-entity reconcile hasn't run yet, OR the
 * entity was inserted directly (test fixtures). Slice 6 deletes this
 * helper alongside the JSONB fallback.
 */
async function wideTableExists(
  client: DbClient,
  tableName: string
): Promise<boolean> {
  const rows = (await (client as typeof db).execute(
    sql`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ${tableName} LIMIT 1`
  )) as unknown as Array<{ "?column?": number }>;
  return rows.length > 0;
}

/**
 * Fallback path that reads `normalizedData` directly from
 * `entity_records.normalized_data` (the legacy JSONB column). Used
 * when the wide table is missing or empty during Phase 2's staged
 * cutover. Deleted in slice 6.
 */
async function findHydratedManyFallback(
  client: DbClient,
  connectorEntityId: string,
  opts: ListOptions & { where?: SQL }
): Promise<EntityRecordHydrated[]> {
  const baseWhere = opts.where
    ? and(opts.where, isNull(entityRecords.deleted))
    : and(
        eq(entityRecords.connectorEntityId, connectorEntityId),
        isNull(entityRecords.deleted)
      );
  const orderByClause = opts.orderBy
    ? buildOrderByClause(opts.orderBy)
    : sql``;
  const limitClause =
    opts.limit !== undefined ? sql` LIMIT ${opts.limit}` : sql``;
  const offsetClause =
    opts.offset !== undefined ? sql` OFFSET ${opts.offset}` : sql``;
  const rows = (await (client as typeof db).execute(sql`
    SELECT
      "entity_records".id, "entity_records".organization_id,
      "entity_records".connector_entity_id, "entity_records".source_id,
      "entity_records".checksum, "entity_records".synced_at,
      "entity_records".origin, "entity_records".validation_errors,
      "entity_records".is_valid, "entity_records".data,
      "entity_records".created, "entity_records".created_by,
      "entity_records".updated, "entity_records".updated_by,
      "entity_records".deleted, "entity_records".deleted_by,
      COALESCE("entity_records"."normalized_data", '{}'::jsonb) AS "normalized_data"
    FROM ${entityRecords}
    WHERE ${baseWhere}
    ${orderByClause}
    ${limitClause}
    ${offsetClause}
  `)) as unknown as Record<string, unknown>[];
  return rowsToHydrated(rows);
}

async function findHydratedByIdFallback(
  client: DbClient,
  recordId: string,
  connectorEntityId: string
): Promise<EntityRecordHydrated | undefined> {
  const rows = (await (client as typeof db).execute(sql`
    SELECT
      "entity_records".id, "entity_records".organization_id,
      "entity_records".connector_entity_id, "entity_records".source_id,
      "entity_records".checksum, "entity_records".synced_at,
      "entity_records".origin, "entity_records".validation_errors,
      "entity_records".is_valid, "entity_records".data,
      "entity_records".created, "entity_records".created_by,
      "entity_records".updated, "entity_records".updated_by,
      "entity_records".deleted, "entity_records".deleted_by,
      COALESCE("entity_records"."normalized_data", '{}'::jsonb) AS "normalized_data"
    FROM ${entityRecords}
    WHERE "entity_records".id = ${recordId}
      AND "entity_records"."connector_entity_id" = ${connectorEntityId}
      AND "entity_records".deleted IS NULL
    LIMIT 1
  `)) as unknown as Record<string, unknown>[];
  if (rows.length === 0) return undefined;
  return rowsToHydrated(rows)[0];
}

/**
 * Convert raw rows from `client.execute` (snake_case columns) into the
 * camelCased `EntityRecordHydrated` shape Drizzle returns elsewhere.
 */
function rowsToHydrated(
  rows: Record<string, unknown>[]
): EntityRecordHydrated[] {
  return rows.map((r) => ({
    id: r.id as string,
    organizationId: r.organization_id as string,
    connectorEntityId: r.connector_entity_id as string,
    sourceId: r.source_id as string,
    checksum: r.checksum as string,
    syncedAt: r.synced_at as number,
    origin: r.origin as EntityRecordSelect["origin"],
    validationErrors:
      r.validation_errors as EntityRecordSelect["validationErrors"],
    isValid: r.is_valid as boolean,
    data: (r.data ?? {}) as Record<string, unknown>,
    normalizedData: (r.normalized_data ?? {}) as Record<string, unknown>,
    created: r.created as number,
    createdBy: r.created_by as string,
    updated: r.updated as number | null,
    updatedBy: r.updated_by as string | null,
    deleted: r.deleted as number | null,
    deletedBy: r.deleted_by as string | null,
  }));
}

function buildOrderByClause(opts: {
  column: Column | SQL;
  direction?: "asc" | "desc";
}): SQL {
  const { column: col, direction = "asc" } = opts;
  if (col instanceof Column) {
    const fn = direction === "desc" ? desc : asc;
    return sql` ORDER BY ${fn(col)} NULLS LAST`;
  }
  return direction === "desc"
    ? sql` ORDER BY ${col} DESC NULLS LAST`
    : sql` ORDER BY ${col} ASC NULLS LAST`;
}

/** Singleton instance. */
export const entityRecordsRepo = new EntityRecordsRepository();
