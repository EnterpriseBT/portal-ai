/**
 * Generic access layer for the dynamic per-connector-entity wide tables
 * (`er__<connector_entity_id>`).
 *
 * The wide tables themselves are *not* declared in Drizzle's static
 * schema — they are created at runtime by the reconciler. Every read
 * here therefore goes through `client.execute(sql.raw(...))` with
 * identifiers built from the cache (and ultimately from
 * `wide_table_columns`, which is the source of truth for column names
 * and types).
 */

import { sql, type SQL } from "drizzle-orm";

import { db } from "../client.js";
import type { DbClient } from "./base.repository.js";
import {
  wideTableStatementCache,
  WIDE_TABLE_METADATA_COLUMNS,
  type WideTableStatementCache,
} from "../../services/wide-table-statement.cache.js";

export class WideTableRepository {
  constructor(
    private readonly statementCache: WideTableStatementCache = wideTableStatementCache
  ) {}

  /** Canonical wide-table name for a connector entity. */
  tableName(connectorEntityId: string): string {
    return `er__${connectorEntityId}`;
  }

  /**
   * Read every row from the entity's wide table. Used by analytics
   * loaders and reconciler self-tests; not a hot path. Returns rows
   * keyed by Postgres column name (metadata columns + `c_*`).
   */
  async selectAll(
    connectorEntityId: string,
    client: DbClient = db
  ): Promise<Record<string, unknown>[]> {
    const stmt = await this.statementCache.get(connectorEntityId, client);
    const result = await (client as typeof db).execute(
      sql.raw(stmt.selectAllSql)
    );
    return result as unknown as Record<string, unknown>[];
  }

  /**
   * Read specific rows by `entity_record_id`. Order of the input ids
   * is not preserved — Postgres decides.
   */
  async selectByEntityRecordIds(
    connectorEntityId: string,
    ids: ReadonlyArray<string>,
    client: DbClient = db
  ): Promise<Record<string, unknown>[]> {
    if (ids.length === 0) return [];
    const stmt = await this.statementCache.get(connectorEntityId, client);
    const idList = sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `
    );
    const rows = await (client as typeof db).execute(
      sql`${sql.raw(stmt.selectAllSql)} WHERE "entity_record_id" IN (${idList})`
    );
    return rows as unknown as Record<string, unknown>[];
  }

  /**
   * Bulk upsert into the wide table. `rows` must each carry every
   * metadata column (`entity_record_id`, `organization_id`,
   * `synced_at`, `is_valid`, `source_id`). Data columns are looked up
   * by the cache's column-name set; missing columns bind `NULL`,
   * unknown keys are silently dropped.
   *
   * Caller is expected to hold the per-entity advisory lock — the
   * reconciler relies on this to keep DDL/DML serialised.
   */
  async upsertMany(
    connectorEntityId: string,
    rows: ReadonlyArray<Record<string, unknown>>,
    client: DbClient = db
  ): Promise<void> {
    if (rows.length === 0) return;

    const stmt = await this.statementCache.get(connectorEntityId, client);
    const colsInOrder = [
      ...WIDE_TABLE_METADATA_COLUMNS,
      ...stmt.columns.map((c) => c.columnName),
    ];

    // Validate metadata presence — the wide table's NOT NULL
    // constraints would catch this, but a typed error here is
    // strictly better than a Postgres error from inside the bind.
    for (const row of rows) {
      for (const meta of WIDE_TABLE_METADATA_COLUMNS) {
        const v = row[meta];
        if (v === undefined || v === null) {
          throw new Error(
            `WideTableRepository.upsertMany: row missing metadata column "${meta}" — ` +
              `entity=${connectorEntityId} record=${String(row["entity_record_id"] ?? "(missing)")}`
          );
        }
      }
    }

    // Build the bulk INSERT inline via a single `sql` template so
    // Drizzle/postgres-js handle parameter binding. (The cache's
    // `buildBulkInsertSql` returns a raw string with $1..$N; we
    // re-build here using `sql` chunks for binding safety.)
    const tableName = `"${this.tableName(connectorEntityId)}"`;
    const insertColList = colsInOrder.map((c) => `"${c}"`).join(", ");

    const tuples = rows.map((row) => {
      const valueExprs = colsInOrder.map((col) => {
        const v = row[col];
        return v === undefined ? null : v;
      });
      return sql`(${sql.join(
        valueExprs.map((v) => sql`${v}`),
        sql`, `
      )})`;
    });

    const setClauses = colsInOrder
      .filter((c) => c !== "entity_record_id")
      .map((c) => `"${c}" = EXCLUDED."${c}"`)
      .join(", ");

    const statement = sql`INSERT INTO ${sql.raw(tableName)} (${sql.raw(insertColList)}) VALUES ${sql.join(
      tuples,
      sql`, `
    )} ON CONFLICT ("entity_record_id") DO UPDATE SET ${sql.raw(setClauses)}`;

    await (client as typeof db).execute(statement);
  }

  /**
   * Partial update of a single wide-table row. Only the supplied
   * `normalizedKey` entries are written; columns not in the patch
   * retain their previous values. Use this from the REST PATCH path
   * where the user is updating a few keys, not replacing the whole
   * row (which is `upsertMany`'s semantics).
   *
   * Metadata columns (`synced_at`, `is_valid`) may also be supplied
   * via `metadataPatch` — these are typed differently from the
   * normalizedData keys and don't go through the cache lookup.
   *
   * Silently no-ops if `normalizedDataPatch` is empty and
   * `metadataPatch` is unset.
   */
  async updatePartial(
    connectorEntityId: string,
    entityRecordId: string,
    normalizedDataPatch: Record<string, unknown>,
    metadataPatch: { syncedAt?: number; isValid?: boolean } = {},
    client: DbClient = db
  ): Promise<void> {
    const stmt = await this.statementCache.get(connectorEntityId, client);
    const setFragments: SQL[] = [];

    for (const [normalizedKey, value] of Object.entries(normalizedDataPatch)) {
      const refBuilder = stmt.columnRefByNormalizedKey.get(normalizedKey);
      if (!refBuilder) continue; // unknown key — drop silently
      // Strip the alias when used in SET (column name only, not "w"."col").
      const cachedCol = stmt.columns.find((c) => c.normalizedKey === normalizedKey);
      if (!cachedCol) continue;
      setFragments.push(
        sql`${sql.raw(`"${cachedCol.columnName}"`)} = ${value as never}`
      );
    }
    if (metadataPatch.syncedAt !== undefined) {
      setFragments.push(sql`"synced_at" = ${metadataPatch.syncedAt}`);
    }
    if (metadataPatch.isValid !== undefined) {
      setFragments.push(sql`"is_valid" = ${metadataPatch.isValid}`);
    }

    if (setFragments.length === 0) return;

    const tableName = `"${this.tableName(connectorEntityId)}"`;
    const setClause = sql.join(setFragments, sql`, `);
    await (client as typeof db).execute(
      sql`UPDATE ${sql.raw(tableName)} SET ${setClause} WHERE "entity_record_id" = ${entityRecordId}`
    );
  }

  /**
   * Hard-delete rows from the wide table by `entity_record_id`.
   *
   * The wide-table side has no `deleted` column — soft-deletes on
   * `entity_records` are represented by absence on the wide side. The
   * `entity_records → er__<id>` FK is `ON DELETE CASCADE`; if the
   * transactional row is hard-deleted, the wide row goes with it. This
   * method is for the watermark-sweep path where the transactional row
   * stays (soft-deleted) but the wide row should disappear so analytic
   * SELECTs no longer see it.
   *
   * Caller is expected to hold the per-entity advisory lock.
   */
  async softDeleteByEntityRecordIds(
    connectorEntityId: string,
    ids: ReadonlyArray<string>,
    client: DbClient = db
  ): Promise<void> {
    if (ids.length === 0) return;
    const tableName = `"${this.tableName(connectorEntityId)}"`;
    const idList = sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `
    );
    await (client as typeof db).execute(
      sql`DELETE FROM ${sql.raw(tableName)} WHERE "entity_record_id" IN (${idList})`
    );
  }
}

export const wideTableRepo = new WideTableRepository();
