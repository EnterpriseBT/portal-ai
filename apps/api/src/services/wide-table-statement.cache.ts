/**
 * Per-entity SQL statement cache for the wide-table storage layer.
 *
 * The reconciler invalidates a cache entry whenever it applies a
 * schema change (add or retire) for that entity; the next `get` call
 * rebuilds the entry from `wide_table_columns`. Callers are expected
 * to re-`get` before each statement build — never hold a reference
 * across awaits.
 */

import { wideTableColumnsRepo } from "../db/repositories/wide-table-columns.repository.js";
import { fieldMappingsRepo } from "../db/repositories/field-mappings.repository.js";
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
  /**
   * Field-mapping `normalized_key` for this column — what the LLM
   * and API surfaces use as the public identifier (e.g. `amount`).
   * The column on the wide table is `c_<sanitized(normalizedKey)>`.
   */
  normalizedKey: string;
}

/**
 * Builder that emits the per-alias SQL fragment, parameterised so the
 * caller can re-target an alias (`w`, `er`, …) without rebuilding the
 * cache entry.
 */
export type AliasedExprBuilder = (alias?: string) => string;

/** A single entity's cached statements + column listing. */
export interface CachedStatements {
  /**
   * `SELECT entity_record_id, organization_id, synced_at, is_valid, source_id, "c_a", "c_b", … FROM "er__<id>"`.
   * Metadata columns first (fixed order), then live data columns sorted by
   * `wide_table_columns.created`, `id`. Retired columns are omitted.
   */
  selectAllSql: string;
  /**
   * `INSERT INTO "er__<id>" (…) VALUES (…) ON CONFLICT (entity_record_id) DO UPDATE SET …`.
   * Single-row template; the bulk N-row template is built on demand via
   * `WideTableStatementCache.buildBulkInsertSql(entityId, batchSize)`.
   * Every live data column appears in both the column list and the
   * ON CONFLICT SET clause; retired columns appear in neither.
   */
  insertSqlTemplate: string;
  /** Live data columns (excludes metadata + retired). Stable order; matches the SQL. */
  columns: ReadonlyArray<WideTableCachedColumn>;
  /** Bumps on every invalidation; lets debug code detect a stale snapshot. */
  schemaVersion: number;

  /**
   * SQL fragment producing a JSONB blob keyed by `normalizedKey`:
   * `jsonb_build_object('<nk1>', "<alias>"."<col1>", '<nk2>', "<alias>"."<col2>", …)`.
   * Alias defaults to `w`. Excludes metadata columns. Empty data-column set
   * returns `'{}'::jsonb`.
   */
  normalizedDataJsonbExpr: AliasedExprBuilder;
  /**
   * Map `normalizedKey` → builder that returns `"<alias>"."<columnName>"`.
   * Used by filter / sort / select-projection callers to resolve a public
   * key to its underlying typed column.
   */
  columnRefByNormalizedKey: Map<string, AliasedExprBuilder>;
  /**
   * ILIKE-able `concat_ws` expression over text-shaped data columns —
   * scalar `text` casts to text, `text[]` uses `array_to_string(col, ' ')`,
   * `jsonb` casts to text. Returns `''` (empty string literal expression)
   * when no text-shaped columns exist.
   */
  searchableConcatSql: AliasedExprBuilder;
}

/**
 * The metadata columns that always exist on every wide table.
 *
 * `source_id` is the denormalised copy of `entity_records.source_id` —
 * lets cross-entity JOINs hit `er__<target>.source_id` directly instead
 * of bouncing through `entity_records`. The reconciler creates it as
 * `text NOT NULL` with a unique index per table.
 */
export const WIDE_TABLE_METADATA_COLUMNS = [
  "entity_record_id",
  "organization_id",
  "synced_at",
  "is_valid",
  "source_id",
] as const;

const METADATA_SET = new Set<string>(WIDE_TABLE_METADATA_COLUMNS);

/** Postgres types that the searchable-concat expression projects. */
const SEARCHABLE_PG_TYPES = new Set<string>(["text", "text[]", "jsonb"]);

/** Quote a Postgres identifier. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Single-quoted SQL string literal. */
function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Postgres caps every function call at 100 arguments. `jsonb_build_object`
 * takes 2 args per key/value pair, so we chunk at 49 pairs (98 args, with
 * headroom) and concatenate the chunks with `||` — `jsonb || jsonb` is
 * key-wise merge, identical in result to a single `jsonb_build_object` call
 * with all the pairs. Without this, any wide-table entity with more than 50
 * columns trips `42883: cannot pass more than 100 arguments to a function`
 * on every hydrated read.
 */
const JSONB_BUILD_OBJECT_PAIR_CHUNK = 49;

export function buildJsonbObjectExpr(pairs: string[]): string {
  if (pairs.length === 0) return `'{}'::jsonb`;
  if (pairs.length <= JSONB_BUILD_OBJECT_PAIR_CHUNK) {
    return `jsonb_build_object(${pairs.join(", ")})`;
  }
  const chunks: string[] = [];
  for (let i = 0; i < pairs.length; i += JSONB_BUILD_OBJECT_PAIR_CHUNK) {
    const slice = pairs.slice(i, i + JSONB_BUILD_OBJECT_PAIR_CHUNK);
    chunks.push(`jsonb_build_object(${slice.join(", ")})`);
  }
  return chunks.join(" || ");
}

/** Wide-table table name for an entity. Mirrored from `WideTableRepository.tableName`. */
function tableNameFor(connectorEntityId: string): string {
  return `er__${connectorEntityId}`;
}

/**
 * Emit the per-column searchable fragment given the column's pgType.
 * Caller wraps the result list inside `concat_ws(' ', …)`.
 */
function searchableFragment(
  columnName: string,
  pgType: string,
  alias: string
): string {
  const ref = `${quoteIdent(alias)}.${quoteIdent(columnName)}`;
  switch (pgType) {
    case "text[]":
      return `array_to_string(${ref}, ' ')`;
    case "jsonb":
    case "text":
    default:
      return `${ref}::text`;
  }
}

export class WideTableStatementCache {
  private readonly entries = new Map<string, CachedStatements>();
  private readonly versions = new Map<string, number>();

  constructor(
    private readonly columnsRepo: typeof wideTableColumnsRepo = wideTableColumnsRepo,
    private readonly mappingsRepo: typeof fieldMappingsRepo = fieldMappingsRepo
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

  /**
   * Build a multi-row `INSERT … ON CONFLICT DO UPDATE` template for the
   * supplied batch size. Returns the SQL string; callers bind one
   * placeholder per (row × column), in the order returned by
   * `CachedStatements.columns` prefixed by the metadata block.
   *
   * Throws when `batchSize < 1`.
   */
  async buildBulkInsertSql(
    connectorEntityId: string,
    batchSize: number,
    client: DbClient = db
  ): Promise<string> {
    if (batchSize < 1) {
      throw new Error(
        `buildBulkInsertSql: batchSize must be >= 1, got ${batchSize}`
      );
    }
    const stmt = await this.get(connectorEntityId, client);
    const tableName = quoteIdent(tableNameFor(connectorEntityId));
    const insertCols = [
      ...WIDE_TABLE_METADATA_COLUMNS,
      ...stmt.columns.map((c) => c.columnName),
    ];
    const insertColList = insertCols.map(quoteIdent).join(", ");

    const colsPerRow = insertCols.length;
    const tuples: string[] = [];
    for (let r = 0; r < batchSize; r++) {
      const placeholders: string[] = [];
      for (let c = 0; c < colsPerRow; c++) {
        placeholders.push(`$${r * colsPerRow + c + 1}`);
      }
      tuples.push(`(${placeholders.join(", ")})`);
    }
    const valuesClause = tuples.join(", ");

    const setClauses = [
      ...WIDE_TABLE_METADATA_COLUMNS.filter((c) => c !== "entity_record_id"),
      ...stmt.columns.map((c) => c.columnName),
    ]
      .map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`)
      .join(", ");

    return (
      `INSERT INTO ${tableName} (${insertColList}) VALUES ${valuesClause}` +
      ` ON CONFLICT (${quoteIdent("entity_record_id")}) DO UPDATE SET ${setClauses}`
    );
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

    // Join in normalized_key per field-mapping. (Cheap — one read; field
    // mappings are bounded by N data columns.)
    const mappings = await this.mappingsRepo.findByConnectorEntityId(
      connectorEntityId,
      client
    );
    const normalizedKeyByMappingId = new Map(
      mappings.map((m) => [m.id, m.normalizedKey])
    );

    const cols: WideTableCachedColumn[] = rows
      .map((r) => {
        const normalizedKey = normalizedKeyByMappingId.get(r.fieldMappingId);
        // If the field-mapping is missing or soft-deleted but the wide
        // column hasn't been retired yet, fall back to the column name
        // sans the `c_` prefix. The next reconcile call will retire it.
        return {
          columnName: r.columnName,
          pgType: r.pgType,
          fieldMappingId: r.fieldMappingId,
          normalizedKey: normalizedKey ?? r.columnName.replace(/^c_/, ""),
        };
      })
      // Defensive: collapse duplicate normalizedKeys (shouldn't happen given
      // the unique index on (entity, normalized_key)) by keeping the first.
      .filter(
        (c, i, arr) =>
          arr.findIndex((c2) => c2.normalizedKey === c.normalizedKey) === i
      );

    const tableName = quoteIdent(tableNameFor(connectorEntityId));

    // SELECT — metadata columns first, then data columns.
    const selectColList = [
      ...WIDE_TABLE_METADATA_COLUMNS,
      ...cols.map((c) => c.columnName),
    ]
      .map(quoteIdent)
      .join(", ");
    const selectAllSql = `SELECT ${selectColList} FROM ${tableName}`;

    // INSERT — placeholder template (single row).
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

    // ── New helpers ────────────────────────────────────────────────

    const normalizedDataJsonbExpr: AliasedExprBuilder = (alias = "w") => {
      const pairs = cols.map(
        (c) =>
          `${quoteLiteral(c.normalizedKey)}, ${quoteIdent(alias)}.${quoteIdent(c.columnName)}`
      );
      return buildJsonbObjectExpr(pairs);
    };

    const columnRefByNormalizedKey = new Map<string, AliasedExprBuilder>();
    for (const c of cols) {
      const columnName = c.columnName;
      columnRefByNormalizedKey.set(
        c.normalizedKey,
        (alias = "w") => `${quoteIdent(alias)}.${quoteIdent(columnName)}`
      );
    }

    const searchableCols = cols.filter((c) => SEARCHABLE_PG_TYPES.has(c.pgType));
    const searchableConcatSql: AliasedExprBuilder = (alias = "w") => {
      if (searchableCols.length === 0) return `''`;
      const frags = searchableCols.map((c) =>
        searchableFragment(c.columnName, c.pgType, alias)
      );
      return `concat_ws(' ', ${frags.join(", ")})`;
    };

    // Sanity: any caller that passes a metadata column as a normalizedKey
    // gets a focused error rather than a silent miss. (Unlikely in practice
    // — METADATA_SET is fixed and disjoint from sanitized user keys.)
    for (const meta of METADATA_SET) {
      if (columnRefByNormalizedKey.has(meta)) {
        columnRefByNormalizedKey.delete(meta);
      }
    }

    return {
      selectAllSql,
      insertSqlTemplate,
      columns: Object.freeze(cols),
      schemaVersion: this.versions.get(connectorEntityId) ?? 0,
      normalizedDataJsonbExpr,
      columnRefByNormalizedKey,
      searchableConcatSql,
    };
  }
}

/** Process-wide singleton. */
export const wideTableStatementCache = new WideTableStatementCache();
