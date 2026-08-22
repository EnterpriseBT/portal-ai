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
import { EntityRecordCountCache } from "../../services/entity-record-count.cache.js";

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
 * A hydrated record without the raw `data` payload (#433) — what the list
 * endpoint projects. See `findHydratedMany`'s `includeData` option.
 */
export type EntityRecordHydratedListItem = Omit<EntityRecordHydrated, "data">;

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
          checksum: data.checksum,
          syncedAt: data.syncedAt,
          validationErrors: data.validationErrors,
          isValid: data.isValid,
          updated: data.updated ?? Date.now(),
          updatedBy: data.updatedBy,
        } as never,
      })
      .returning();
    await invalidateCounts([data.connectorEntityId]);
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
    await invalidateCounts(data.map((d) => d.connectorEntityId));
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
    // #423: count from the driver — `RETURNING` here streamed every
    // matched row (with its payload) into Node just to call `.length`.
    const result = await (client as typeof db)
      .update(this.table)
      .set({ deleted: now, deletedBy } as any)
      .where(
        and(
          eq(entityRecords.connectorEntityId, connectorEntityId),
          this.notDeleted()
        )
      );
    await invalidateCounts([connectorEntityId]);
    return result.count;
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
   * synced_at)` for the index scan.
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
    await invalidateCounts([connectorEntityId]);
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
    // #423: count from the driver — `RETURNING` here streamed every
    // matched row (with its payload) into Node just to call `.length`.
    const result = await (client as typeof db)
      .update(this.table)
      .set({ deleted: now, deletedBy } as any)
      .where(
        and(
          inArray(entityRecords.connectorEntityId, connectorEntityIds),
          this.notDeleted()
        )
      );
    await invalidateCounts(connectorEntityIds);
    return result.count;
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
   *
   * `includeData: false` drops the raw `data` payload from the projection
   * (#433). It is the connector's pre-mapping blob — ~2KB/row — and
   * selecting it made the hashed side of this join 1101 bytes wide, which
   * spilled it to 64 disk batches (19.9s of temp I/O) before the LIMIT
   * discarded all but ten rows. The list endpoint passes `false` because
   * the table renders from `normalizedData`; the default stays `true` so
   * the other callers — which load whole entities for cross-entity
   * comparison, and the entity-group resolve endpoint, which returns
   * `data` in its response — are unaffected.
   */
  async findHydratedMany(
    connectorEntityId: string,
    opts: ListOptions & {
      where?: SQL;
      normalizedDataProjection?: SQL;
      includeData: false;
    },
    client?: DbClient
  ): Promise<EntityRecordHydratedListItem[]>;
  async findHydratedMany(
    connectorEntityId: string,
    opts?: ListOptions & {
      where?: SQL;
      normalizedDataProjection?: SQL;
      includeData?: true;
    },
    client?: DbClient
  ): Promise<EntityRecordHydrated[]>;
  async findHydratedMany(
    connectorEntityId: string,
    opts: ListOptions & {
      where?: SQL;
      normalizedDataProjection?: SQL;
      includeData?: boolean;
    } = {},
    client: DbClient = db
  ): Promise<EntityRecordHydrated[] | EntityRecordHydratedListItem[]> {
    const stmt = await wideTableStatementCache.get(connectorEntityId, client);
    const tableName = `er__${connectorEntityId}`;
    const rehydrationExpr =
      opts.normalizedDataProjection ??
      sql.raw(stmt.normalizedDataJsonbExpr("w"));

    // Soft-delete guard on entity_records (the wide table has no `deleted` column).
    const filters = opts.where
      ? and(opts.where, this.notDeleted())
      : and(
          eq(entityRecords.connectorEntityId, connectorEntityId),
          this.notDeleted()
        );
    // #433: a keyset anchor narrows the WHERE instead of skipping rows.
    const baseWhere = opts.keyset
      ? and(
          filters,
          buildKeysetPredicate({
            ...opts.keyset,
            direction: opts.orderBy?.direction,
          })
        )
      : filters;

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
    // A keyset seek already encodes the position, so OFFSET would skip a
    // second time on top of it.
    const offsetClause =
      opts.offset !== undefined && !opts.keyset
        ? sql` OFFSET ${opts.offset}`
        : sql``;

    const includeData = opts.includeData ?? true;
    // Omitting `data` is what keeps the hashed side narrow — see the doc
    // comment. Everything else in the projection is fixed-width metadata.
    const dataColumn = includeData ? sql`"entity_records".data,` : sql``;

    const rows = await (client as typeof db).execute(sql`
      SELECT
        "entity_records".id, "entity_records".organization_id,
        "entity_records".connector_entity_id, "entity_records".source_id,
        "entity_records".checksum, "entity_records".synced_at,
        "entity_records".origin, "entity_records".validation_errors,
        "entity_records".is_valid, ${dataColumn}
        "entity_records".created, "entity_records".created_by,
        "entity_records".updated, "entity_records".updated_by,
        "entity_records".deleted, "entity_records".deleted_by,
        ${rehydrationExpr} AS "normalized_data"
      FROM ${entityRecords}
      JOIN ${sql.raw(`"${tableName}"`)} w
        ON w."entity_record_id" = "entity_records".id
      WHERE ${baseWhere}
      ${orderByClause}
      ${limitClause}
      ${offsetClause}
    `);
    const typedRows = rows as unknown as Record<string, unknown>[];
    return includeData
      ? rowsToHydrated(typedRows)
      : typedRows.map(rowToListItem);
  }

  /**
   * Count records matching `where`, with the same wide-table JOIN
   * `findHydratedMany` uses. Required because `where` may reference
   * the `w` alias (typed wide-table columns) for filter / search,
   * which the base `count` doesn't know about.
   *
   * `requiresWideTable: false` drops the JOIN (#433). Only search and the
   * advanced filters reference `w`; an unfiltered count doesn't, and joining
   * the whole wide table to count rows it cannot exclude is pure work — it
   * doubled the scan on app-dev (3,780ms with the join, 3,472ms without,
   * both against 283K rows). The caller knows which conditions it built, so
   * it declares this rather than having the SQL inspected.
   */
  async countHydrated(
    connectorEntityId: string,
    where?: SQL,
    client: DbClient = db,
    opts: { requiresWideTable?: boolean } = {}
  ): Promise<number> {
    const { requiresWideTable = true } = opts;
    const tableName = `er__${connectorEntityId}`;
    const baseWhere = where
      ? and(where, this.notDeleted())
      : and(
          eq(entityRecords.connectorEntityId, connectorEntityId),
          this.notDeleted()
        );
    const joinClause = requiresWideTable
      ? sql`JOIN ${sql.raw(`"${tableName}"`)} w
        ON w."entity_record_id" = "entity_records".id`
      : sql``;
    const result = (await (client as typeof db).execute(sql`
      SELECT count(*) AS count
      FROM ${entityRecords}
      ${joinClause}
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
        ${sql.raw(stmt.normalizedDataJsonbExpr("w"))} AS "normalized_data"
      FROM ${entityRecords}
      JOIN ${sql.raw(`"${tableName}"`)} w
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
 * Convert raw rows from `client.execute` (snake_case columns) into the
 * camelCased `EntityRecordHydrated` shape Drizzle returns elsewhere.
 */
/**
 * Drop cached list totals for every entity a write touched (#433).
 *
 * Placed in the repository rather than at the ~15 call sites that write
 * records — adapters, agent tools, the commit and import services, the
 * routes. Scattering it is precisely what the next writer would miss, and a
 * miss is silent.
 *
 * Best-effort by design: `EntityRecordCountCache.invalidate` swallows its own
 * failures, and a total that outlives its invalidation is wrong for at most
 * the cache TTL — a wrong page count, never wrong rows.
 */
async function invalidateCounts(connectorEntityIds: string[]): Promise<void> {
  const unique = [...new Set(connectorEntityIds.filter(Boolean))];
  await Promise.all(unique.map((id) => EntityRecordCountCache.invalidate(id)));
}

function rowToListItem(
  r: Record<string, unknown>
): EntityRecordHydratedListItem {
  return {
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
    normalizedData: (r.normalized_data ?? {}) as Record<string, unknown>,
    created: r.created as number,
    createdBy: r.created_by as string,
    updated: r.updated as number | null,
    updatedBy: r.updated_by as string | null,
    deleted: r.deleted as number | null,
    deletedBy: r.deleted_by as string | null,
  };
}

function rowsToHydrated(
  rows: Record<string, unknown>[]
): EntityRecordHydrated[] {
  return rows.map((r) => ({
    ...rowToListItem(r),
    data: (r.data ?? {}) as Record<string, unknown>,
  }));
}

/**
 * Build the list ORDER BY clause (#433).
 *
 * Two rules, both load-bearing:
 *
 * - **A unique trailing `id`.** `ORDER BY <key>` alone leaves ties in an
 *   undefined order, and paginating over an undefined order repeats and
 *   skips rows. Ties are routine here — a sync stamps thousands of rows with
 *   the same `synced_at`, and on app-dev that column has exactly one distinct
 *   value across 283K rows. The tiebreaker is also what lets a keyset cursor
 *   seek past a position it can uniquely identify.
 * - **`NULLS LAST` only when the column is nullable.** A plain btree serves
 *   `ASC NULLS LAST` and `DESC NULLS FIRST`, never `DESC NULLS LAST`. On a
 *   NOT NULL column the clause changes no rows and costs the index — 3,294ms
 *   vs 15.7ms for the same query on app-dev.
 *
 * Nullability is read off Drizzle `Column`s directly. A raw `SQL` expression
 * (a typed wide-table `c_*` column, via `buildSortExpression`) carries no
 * such metadata, so the caller declares it; the default is `true`, which
 * preserves the previous behavior for any caller that doesn't.
 *
 * Exported for unit test — rule 2 is invisible behaviorally on a NOT NULL
 * column, where both spellings return identical rows and only the plan
 * differs.
 */
/**
 * Build the "seek past this row" predicate for keyset pagination (#433).
 *
 * For a NOT NULL sort column this is the textbook row-value comparison:
 * `(col, id) > (value, id)` ascending, `<` descending.
 *
 * For a **nullable** column it cannot be. Row-value comparison propagates
 * NULL — `(NULL, 'x') > ('Boston', 'y')` evaluates to NULL, not true or
 * false — so every row in the NULL region fails the predicate and silently
 * disappears from the walk. Since `buildOrderByClause` places NULLs last in
 * *both* directions, the ordering is "all non-null values, then all NULLs",
 * and seeking has to be spelled out against that:
 *
 * - anchored on a real value → the rest of the non-null run, then the whole
 *   NULL region;
 * - anchored inside the NULL region → only the NULL region, by tiebreaker.
 *
 * `c_city` on app-dev is the shape this exists for: 19 distinct values and
 * 3,914 NULLs across 283,000 rows.
 *
 * Exported for unit test.
 */
export function buildKeysetPredicate(opts: {
  column: Column | SQL;
  value: string | number | null;
  id: string;
  direction?: "asc" | "desc";
  nullable: boolean;
}): SQL {
  const { column: col, value, id, direction = "asc", nullable } = opts;
  const ahead = direction === "desc" ? sql`<` : sql`>`;
  const tiebreak = sql`${entityRecords.id} ${ahead} ${id}`;

  if (!nullable) {
    // NULL never reaches here, so the row-value form is safe and lets the
    // planner drive the composite index directly.
    return sql`(${col}, ${entityRecords.id}) ${ahead} (${value}, ${id})`;
  }

  if (value === null) {
    // Already past every non-null value; only the NULL region remains.
    return sql`(${col} IS NULL AND ${tiebreak})`;
  }

  return sql`(${col} ${ahead} ${value} OR (${col} = ${value} AND ${tiebreak}) OR ${col} IS NULL)`;
}

export function buildOrderByClause(opts: {
  column: Column | SQL;
  direction?: "asc" | "desc";
  nullable?: boolean;
}): SQL {
  const { column: col, direction = "asc" } = opts;
  const dir = direction === "desc" ? sql`DESC` : sql`ASC`;

  // Already ordering by the tiebreaker — don't repeat it.
  if (col instanceof Column && col === entityRecords.id) {
    return sql` ORDER BY ${col} ${dir}`;
  }

  const nullable =
    col instanceof Column ? !col.notNull : (opts.nullable ?? true);
  const nulls = nullable ? sql` NULLS LAST` : sql``;

  // The tiebreaker takes the same direction as the sort key: mismatched
  // directions cannot be served by a single index scan.
  return sql` ORDER BY ${col} ${dir}${nulls}, ${entityRecords.id} ${dir}`;
}

/** Singleton instance. */
export const entityRecordsRepo = new EntityRecordsRepository();
