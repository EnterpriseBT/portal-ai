/**
 * Per-entity SQL statement cache for the wide-table storage layer.
 *
 * The reconciler invalidates a cache entry whenever it applies a
 * schema change (add or retire) for that entity; the next `get` call
 * rebuilds the entry from `wide_table_columns`. Callers are expected
 * to re-`get` before each statement build — never hold a reference
 * across awaits.
 *
 * Phase 1 builds the cache and exposes it; phase 2's sync write path
 * is the consumer.
 */

import { wideTableColumnsRepo } from "../db/repositories/wide-table-columns.repository.js";
import type { DbClient } from "../db/repositories/base.repository.js";
import { db } from "../db/client.js";

/** Wide-table column information used to build statements. */
export interface WideTableCachedColumn {
  /** Sanitised column name as it appears on the wide table (e.g. `c_amount`). */
  columnName: string;
  /** Postgres type (`numeric`, `text`, `boolean`, …). */
  pgType: string;
  /** Source field-mapping id — useful for callers that need to project values back. */
  fieldMappingId: string;
}

/** A single entity's cached statements + column listing. */
export interface CachedStatements {
  /**
   * `SELECT entity_record_id, organization_id, synced_at, is_valid, "c_a", "c_b", … FROM "er__<id>"`.
   * Metadata columns first (fixed order), then live data columns sorted by
   * `wide_table_columns.created`, `id`. Retired columns are omitted.
   */
  selectAllSql: string;
  /**
   * `INSERT INTO "er__<id>" (…) VALUES (…) ON CONFLICT (entity_record_id) DO UPDATE SET …`.
   * The VALUES placeholder list is intentionally a `${…}` slot the caller fills in
   * (`$1, $2, …`); this cache produces a template, not a fully-bound statement.
   * Every live data column appears in both the column list and the
   * ON CONFLICT SET clause; retired columns appear in neither.
   */
  insertSqlTemplate: string;
  /** Live data columns (excludes metadata + retired). Stable order; matches the SQL. */
  columns: ReadonlyArray<WideTableCachedColumn>;
  /** Bumps on every invalidation; lets debug code detect a stale snapshot. */
  schemaVersion: number;
}

/** The four metadata columns that always exist on every wide table. */
export const WIDE_TABLE_METADATA_COLUMNS = [
  "entity_record_id",
  "organization_id",
  "synced_at",
  "is_valid",
] as const;

/** Quote a Postgres identifier. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Wide-table table name for an entity. Mirrored from `WideTableRepository.tableName` (slice 4). */
function tableNameFor(connectorEntityId: string): string {
  return `er__${connectorEntityId}`;
}

export class WideTableStatementCache {
  private readonly entries = new Map<string, CachedStatements>();
  private readonly versions = new Map<string, number>();

  constructor(
    private readonly columnsRepo: typeof wideTableColumnsRepo = wideTableColumnsRepo
  ) {}

  /** Get (and lazily build) the cached statements for an entity. */
  async get(
    connectorEntityId: string,
    client: DbClient = db
  ): Promise<CachedStatements> {
    const cached = this.entries.get(connectorEntityId);
    if (cached) return cached;
    const built = await this.build(connectorEntityId, client);
    this.entries.set(connectorEntityId, built);
    return built;
  }

  /** Mark the entity's cache stale; next `get` rebuilds. */
  invalidate(connectorEntityId: string): void {
    this.entries.delete(connectorEntityId);
    this.versions.set(
      connectorEntityId,
      (this.versions.get(connectorEntityId) ?? 0) + 1
    );
  }

  /** Drop every cached entry. Used by tests and shutdown paths. */
  clear(): void {
    this.entries.clear();
    this.versions.clear();
  }

  // ── Internal ────────────────────────────────────────────────────

  private async build(
    connectorEntityId: string,
    client: DbClient
  ): Promise<CachedStatements> {
    // Live (non-retired, non-soft-deleted) columns, ordered by created, id.
    const rows = await this.columnsRepo.findByConnectorEntityId(
      connectorEntityId,
      {},
      client
    );

    const cols: WideTableCachedColumn[] = rows.map((r) => ({
      columnName: r.columnName,
      pgType: r.pgType,
      fieldMappingId: r.fieldMappingId,
    }));

    const tableName = quoteIdent(tableNameFor(connectorEntityId));

    // SELECT — metadata columns first, then data columns.
    const selectColList = [
      ...WIDE_TABLE_METADATA_COLUMNS,
      ...cols.map((c) => c.columnName),
    ]
      .map(quoteIdent)
      .join(", ");
    const selectAllSql = `SELECT ${selectColList} FROM ${tableName}`;

    // INSERT — placeholder template.
    // (entity_record_id, organization_id, synced_at, is_valid, c_a, c_b, …)
    const insertCols = [
      ...WIDE_TABLE_METADATA_COLUMNS,
      ...cols.map((c) => c.columnName),
    ];
    const insertColList = insertCols.map(quoteIdent).join(", ");
    const valuesList = insertCols.map((_, i) => `$${i + 1}`).join(", ");

    // ON CONFLICT SET only updates non-PK columns.
    const setClauses = [
      ...WIDE_TABLE_METADATA_COLUMNS.filter((c) => c !== "entity_record_id"),
      ...cols.map((c) => c.columnName),
    ]
      .map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`)
      .join(", ");

    const insertSqlTemplate =
      `INSERT INTO ${tableName} (${insertColList}) VALUES (${valuesList})` +
      ` ON CONFLICT (${quoteIdent("entity_record_id")}) DO UPDATE SET ${setClauses}`;

    return {
      selectAllSql,
      insertSqlTemplate,
      columns: Object.freeze(cols),
      schemaVersion: this.versions.get(connectorEntityId) ?? 0,
    };
  }
}

/** Process-wide singleton. */
export const wideTableStatementCache = new WideTableStatementCache();
