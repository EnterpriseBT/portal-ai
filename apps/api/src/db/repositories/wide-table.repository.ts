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

/**
 * Chunk size for `upsertMany`. A single 13k-row INSERT builds a Drizzle
 * `sql` AST whose join tree is deep enough to overflow V8's call stack
 * when the template is recursively flattened at execute time. 500 rows
 * keeps each statement's AST shallow + the parameter count comfortably
 * under PostgreSQL's 65k bind limit (500 rows × ~50 cols = 25k params
 * worst-case, well under the cap).
 */
const WIDE_TABLE_UPSERT_CHUNK_SIZE = 500;

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
   * Project a subset of typed columns from `er__<connector_entity_id>`
   * keyed by `normalizedKey`, scoped to the organization and live
   * (non-soft-deleted) rows. Used by Phase 3's math methods to pull
   * exactly the columns they need without loading the whole table.
   *
   * `columns` are field-mapping `normalized_key` strings; the helper
   * resolves them to the underlying `c_*` columns via the statement
   * cache. Unknown keys throw a focused error so the math layer can
   * surface a clear message to the LLM.
   *
   * Returned rows are keyed by `normalizedKey` (not `columnName`) so
   * math callers can use their existing `row.amount` / `row.age` etc.
   * accessors unchanged.
   */
  async fetchProjectedRows(
    connectorEntityId: string,
    columns: ReadonlyArray<string>,
    opts: {
      organizationId: string;
      where?: SQL;
      limit?: number;
    },
    client: DbClient = db
  ): Promise<Record<string, unknown>[]> {
    const stmt = await this.statementCache.get(connectorEntityId, client);

    // Resolve each requested normalizedKey to its typed column.
    const projection: { normalizedKey: string; columnName: string }[] = [];
    const unknown: string[] = [];
    for (const key of columns) {
      const cached = stmt.columns.find((c) => c.normalizedKey === key);
      if (!cached) {
        unknown.push(key);
        continue;
      }
      projection.push({
        normalizedKey: key,
        columnName: cached.columnName,
      });
    }
    if (unknown.length > 0) {
      throw new Error(
        `fetchProjectedRows: unknown columns for entity ${connectorEntityId}: ${unknown.join(", ")}`
      );
    }

    const tableName = `"${this.tableName(connectorEntityId)}"`;
    const colRefs = projection.map(
      (p) => `w."${p.columnName}" AS "${p.normalizedKey}"`
    );
    const colList =
      colRefs.length > 0
        ? `w."entity_record_id" AS "_record_id", ${colRefs.join(", ")}`
        : `w."entity_record_id" AS "_record_id"`;

    const limitClause =
      opts.limit !== undefined ? sql` LIMIT ${opts.limit}` : sql``;
    const whereExtra = opts.where ? sql` AND (${opts.where})` : sql``;

    const rows = await (client as typeof db).execute(sql`
      SELECT ${sql.raw(colList)}
      FROM ${sql.raw(tableName)} w
      JOIN entity_records er ON er.id = w."entity_record_id"
      WHERE w."organization_id" = ${opts.organizationId}
        AND er.deleted IS NULL
        ${whereExtra}
      ${limitClause}
    `);
    return rows as unknown as Record<string, unknown>[];
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
   * Large batches are chunked into `WIDE_TABLE_UPSERT_CHUNK_SIZE`-row
   * statements. A single 13k-row INSERT builds a `sql` AST whose join
   * chain is deep enough to overflow the V8 call stack when Drizzle
   * recursively flattens the template chunks; chunking keeps each
   * statement's AST shallow and round-trip-cheap.
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

    // Per-column type info so we can format Postgres arrays correctly.
    // Metadata columns have known types; data columns come from the cache.
    const pgTypeByColumn = new Map<string, string>([
      ["entity_record_id", "text"],
      ["organization_id", "text"],
      ["synced_at", "bigint"],
      ["is_valid", "boolean"],
      ["source_id", "text"],
      ...stmt.columns.map((c) => [c.columnName, c.pgType] as const),
    ]);

    const setClauses = colsInOrder
      .filter((c) => c !== "entity_record_id")
      .map((c) => `"${c}" = EXCLUDED."${c}"`)
      .join(", ");

    for (let i = 0; i < rows.length; i += WIDE_TABLE_UPSERT_CHUNK_SIZE) {
      const chunk = rows.slice(i, i + WIDE_TABLE_UPSERT_CHUNK_SIZE);
      const tuples = chunk.map((row) => {
        const valueExprs = colsInOrder.map((col) => {
          const v = row[col];
          const value = v === undefined ? null : v;
          const pgType = pgTypeByColumn.get(col) ?? "text";
          // postgres-js doesn't auto-serialize JS arrays as Postgres
          // array literals when bound as a single parameter. Build an
          // ARRAY[...]-style expression so each element binds as its
          // own param (`text[]` → `ARRAY[$n, $n+1]::text[]`).
          if (pgType === "text[]") {
            if (value === null || value === undefined) {
              return sql`NULL::text[]`;
            }
            if (!Array.isArray(value) || value.length === 0) {
              return sql`ARRAY[]::text[]`;
            }
            const items = sql.join(
              value.map((item) => sql`${String(item)}`),
              sql`, `
            );
            return sql`ARRAY[${items}]::text[]`;
          }
          if (pgType === "jsonb") {
            // The bound parameter goes over the wire as text and is
            // then cast to `jsonb`, so the text must be valid JSON.
            // A bare JS string like `"Language"` would bind as
            // `Language` (no quotes) and the cast fails with
            // `invalid input syntax for type json | Token "Language" is invalid`.
            // `JSON.stringify` produces the right encoding for every
            // JS value — strings → quoted strings, arrays/objects →
            // structural JSON, numbers/booleans → as-is.
            if (value === null || value === undefined) {
              return sql`NULL::jsonb`;
            }
            return sql`${JSON.stringify(value)}::jsonb`;
          }
          return sql`${value}`;
        });
        return sql`(${sql.join(valueExprs, sql`, `)})`;
      });

      const statement = sql`INSERT INTO ${sql.raw(tableName)} (${sql.raw(insertColList)}) VALUES ${sql.join(
        tuples,
        sql`, `
      )} ON CONFLICT ("entity_record_id") DO UPDATE SET ${sql.raw(setClauses)}`;

      await (client as typeof db).execute(statement);
    }
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
