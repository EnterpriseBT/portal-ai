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
import {
  toGeoJsonCandidate,
  extractSourceSrid,
} from "../../adapters/rest-api/geometry.util.js";
import {
  GeometryAuditService,
  type GeometryAuditRow,
} from "../../services/geometry-audit.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import { assertNoRejectedGeometry } from "../../utils/wide-table-rejection.util.js";
import { createLogger } from "../../utils/logger.util.js";

const logger = createLogger({ module: "wide-table-repository" });

/**
 * Outcome of a wide-table upsert (#316). `repaired` counts rows whose geometry
 * was invalid-but-repairable (ST_MakeValid fixed it on write); `rejected`
 * lists rows dropped fail-closed because a geometry value was unparseable —
 * never written as NULL, so an unmappable feature can't masquerade as absent.
 * The sync path surfaces these counts (limits-table rows 5–6).
 */
export interface WideTableUpsertResult {
  repaired: number;
  rejected: WideTableRejection[];
}

/** One row of a `updateMany` call (#761): the keys to write, by normalizedKey. */
export interface WidePartialUpdate {
  entityRecordId: string;
  normalizedData: Record<string, unknown>;
  syncedAt?: number;
  isValid?: boolean;
}

/**
 * One row the geometry audit refused (#316). `code` is the refusal's
 * `ApiCode`, also the prefix of `reason`; `fields` names the geometry
 * columns' normalized keys that caused it, so a manual write can say which
 * field to fix (#757).
 */
export interface WideTableRejection {
  sourceId: string;
  reason: string;
  code: ApiCode.GEOMETRY_INVALID_ON_IMPORT | ApiCode.GIS_SRID_UNSUPPORTED;
  fields: string[];
  /** Every refusal on the row, SRID first; `code`/`fields` summarize them. */
  problems: Array<{ code: WideTableRejection["code"]; fields: string[] }>;
}

/**
 * The one geometry write expression, shared by `upsertMany` and
 * `updatePartial` so the two paths store the same geometry (#757). `row` is
 * an audited row: `row[col]` is shape-normalized GeoJSON and the sidecar
 * holds its source SRID. Stamp that SRID, reproject to 4326 when it differs
 * (e.g. an ArcGIS 102100→3857 web-mercator source), then repair.
 */
function geometryWriteExpr(row: Record<string, unknown>, col: string): SQL {
  const srid = Number(row[geoSridSidecarKey(col)] ?? 4326);
  const json = JSON.stringify(row[col]);
  return srid === 4326
    ? sql`ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${json}), 4326))`
    : sql`ST_MakeValid(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(${json}), ${srid}), 4326))`;
}

/**
 * One wide-table cell as a SQL value, by the column's Postgres type. Shared
 * by `upsertMany` and `updateMany` so both write paths encode a value the
 * same way (#761: the per-record update bound jsonb and text[] values raw,
 * and Postgres refused them). A geometry cell must come from an audited row
 * (`auditGeometry`), which carries the shape-normalized GeoJSON and its SRID.
 */
function wideValueExpr(
  row: Record<string, unknown>,
  col: string,
  pgType: string
): SQL {
  const v = row[col];
  const value = v === undefined ? null : v;
  // A text[] cell binds as ONE parameter: the elements as a JSON array,
  // unpacked in order on the server (#766). Binding each element on its own
  // (`ARRAY[$1, $2, …]`) made a statement's parameter count grow with array
  // length, so 500 rows of 150 references passed PostgreSQL's 65,535 limit.
  // postgres-js won't bind a JS array as a Postgres array, hence the JSON.
  // Date items go through `toISOString()` rather than `String()` so they're
  // locale-independent ISO 8601 strings.
  if (pgType === "text[]") {
    if (value === null || value === undefined) {
      return sql`NULL::text[]`;
    }
    if (!Array.isArray(value) || value.length === 0) {
      return sql`ARRAY[]::text[]`;
    }
    const items = JSON.stringify(
      value.map((item) =>
        item instanceof Date ? item.toISOString() : String(item)
      )
    );
    return sql`ARRAY(SELECT e FROM jsonb_array_elements_text(${items}::jsonb) WITH ORDINALITY AS t(e, n) ORDER BY n)`;
  }
  if (pgType === "jsonb") {
    // The bound parameter goes over the wire as text and is
    // then cast to `jsonb`, so the text must be valid JSON.
    // A bare JS string like `"Language"` would bind as
    // `Language` (no quotes) and the cast fails with
    // `invalid input syntax for type json | Token "Language" is invalid`.
    // `JSON.stringify` produces the right encoding for every
    // JS value — strings → quoted strings, arrays/objects →
    // structural JSON, numbers/booleans → as-is, Dates →
    // ISO 8601 string (via Date.toJSON).
    if (value === null || value === undefined) {
      return sql`NULL::jsonb`;
    }
    return sql`${JSON.stringify(value)}::jsonb`;
  }
  if (pgType.startsWith("geometry")) {
    // #316: `value` is already shape-normalized GeoJSON (or null for an
    // absent geometry) — auditGeometry ran upstream. Rejected rows
    // (unparseable or unknown-SRID) never reach here.
    if (value === null || value === undefined) {
      return sql`NULL`;
    }
    return geometryWriteExpr(row, col);
  }
  // Default path covers `text`, `numeric`, `boolean`, `date`,
  // and `timestamptz`. Pre-coerce Date instances to their ISO
  // string form so postgres-js's wire encoder never ends up
  // calling `Buffer.byteLength` on a Date
  // (`ERR_INVALID_ARG_TYPE: Received an instance of Date`,
  // observed during sync of a Google Sheets connector whose
  // date-formatted cells flow through to typed columns).
  // Postgres implicitly casts ISO strings to date / timestamptz
  // / text columns, so the coercion is loss-free for the
  // columns we currently support; numeric / boolean columns
  // receiving a Date would have failed downstream anyway, so
  // the change only affects the failure shape (server-side
  // type error instead of a Node-side `ERR_INVALID_ARG_TYPE`).
  const bound = value instanceof Date ? value.toISOString() : value;
  return sql`${bound}`;
}

/** Every wide-table column's Postgres type: the metadata columns, then the mapped ones. */
function wideColumnPgTypes(
  columns: ReadonlyArray<{ columnName: string; pgType: string }>
): Map<string, string> {
  return new Map<string, string>([
    ["entity_record_id", "text"],
    ["organization_id", "text"],
    ["synced_at", "bigint"],
    ["is_valid", "boolean"],
    ["source_id", "text"],
    ...columns.map((c) => [c.columnName, c.pgType] as const),
  ]);
}

/**
 * Rows / ids per statement for every chunked wide-table builder.
 *
 * Named for the table rather than for `upsertMany` because #436 extended it
 * to the DELETE, SELECT and UPDATE id-list builders: `sql.join` allocates one
 * AST node per element and Drizzle flattens that chain recursively when the
 * statement is serialised, so any unbounded list overflows the V8 stack.
 * Keeping each statement's AST shallow is the remedy in all four cases.
 *
 * 500 also keeps the bind count comfortably under PostgreSQL's 65,535 limit:
 * every cell binds at most two parameters (a geometry's GeoJSON and SRID; a
 * text[] array is one, #766), so 500 rows × ~50 columns stays near 25k.
 */
export const WIDE_TABLE_CHUNK_SIZE = 500;

/**
 * Per-row sidecar key carrying a geometry column's source SRID from
 * `auditGeometry` to the tuple builder (#316). Not a wide-table column — it's
 * absent from `colsInOrder`, so it's never bound or written; it only conveys
 * which SRID to reproject from on write. Reserved prefix avoids colliding with
 * sanitised `c_*` column names.
 */
function geoSridSidecarKey(columnName: string): string {
  return `__geo_srid__${columnName}`;
}

/** Wide-table column name → the normalized key it stores (#757). */
function normalizedKeyByColumn(
  columns: ReadonlyArray<{ columnName: string; normalizedKey: string }>
): Map<string, string> {
  return new Map(columns.map((c) => [c.columnName, c.normalizedKey]));
}

export class WideTableRepository {
  constructor(
    private readonly statementCache: WideTableStatementCache = wideTableStatementCache
  ) {}

  /** Canonical wide-table name for a connector entity. */
  tableName(connectorEntityId: string): string {
    return `er__${connectorEntityId}`;
  }

  /**
   * #802: ids of entities soft-deleted before `cutoffMs` whose `er__<id>`
   * table still exists — left behind by a delete whose `entity_data_delete`
   * job never ran, or by a single-entity delete from before #802, which never
   * dropped it. Read from `pg_tables`, not the column catalog, so a table
   * with no catalog rows is found too.
   */
  async findEntityIdsWithTableDeletedBefore(
    cutoffMs: number,
    limit: number,
    /** Ids to skip — the ones a run already failed to drop. */
    excludeIds: string[] = [],
    client: DbClient = db
  ): Promise<string[]> {
    // A list of bound params, not a bound JS array: drizzle's sql`` won't
    // bind one as a Postgres array.
    const exclude =
      excludeIds.length > 0
        ? sql`AND e."id" NOT IN (${sql.join(
            excludeIds.map((id) => sql`${id}`),
            sql`, `
          )})`
        : sql``;
    const rows = await (client as typeof db).execute<{ id: string }>(sql`
      SELECT e."id"
      FROM "connector_entities" e
      JOIN pg_tables t
        ON t.schemaname = 'public' AND t.tablename = 'er__' || e."id"
      WHERE e."deleted" IS NOT NULL AND e."deleted" < ${cutoffMs}
        ${exclude}
      ORDER BY e."deleted", e."id"
      LIMIT ${limit}
    `);
    return rows.map((r) => r.id);
  }

  /** #802: does the entity's wide table exist? (`to_regclass` is null for a
   *  missing relation rather than an error.) */
  async tableExists(
    connectorEntityId: string,
    client: DbClient = db
  ): Promise<boolean> {
    const name = `public."${this.tableName(connectorEntityId)}"`;
    const rows = await (client as typeof db).execute<{ exists: boolean }>(
      sql`SELECT to_regclass(${name}) IS NOT NULL AS "exists"`
    );
    return rows[0]?.exists === true;
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

    // #450: filter on the wide row's own `deleted` — no `JOIN entity_records`
    // (see resolveViewsForSession). Every delete path marks it atomically with the
    // record soft-delete.
    const rows = await (client as typeof db).execute(sql`
      SELECT ${sql.raw(colList)}
      FROM ${sql.raw(tableName)} w
      WHERE w."organization_id" = ${opts.organizationId}
        AND w."deleted" IS NULL
        ${whereExtra}
      ${limitClause}
    `);
    return rows as unknown as Record<string, unknown>[];
  }

  /**
   * Read specific rows by `entity_record_id`. Order of the input ids
   * is not preserved — Postgres decides.
   *
   * Chunked at `WIDE_TABLE_CHUNK_SIZE` for the same reason as
   * `markDeletedByEntityRecordIds` (#436). Every chunk's rows are
   * accumulated before returning, so the caller still sees one complete
   * result set — a partial read would be wrong, not merely slower.
   */
  async selectByEntityRecordIds(
    connectorEntityId: string,
    ids: ReadonlyArray<string>,
    client: DbClient = db
  ): Promise<Record<string, unknown>[]> {
    if (ids.length === 0) return [];
    const stmt = await this.statementCache.get(connectorEntityId, client);
    const out: Record<string, unknown>[] = [];
    for (let i = 0; i < ids.length; i += WIDE_TABLE_CHUNK_SIZE) {
      const chunk = ids.slice(i, i + WIDE_TABLE_CHUNK_SIZE);
      const idList = sql.join(
        chunk.map((id) => sql`${id}`),
        sql`, `
      );
      const rows = await (client as typeof db).execute(
        sql`${sql.raw(stmt.selectAllSql)} WHERE "entity_record_id" IN (${idList})`
      );
      out.push(...(rows as unknown as Record<string, unknown>[]));
    }
    return out;
  }

  /**
   * Bulk upsert into the wide table. `rows` must each carry every
   * metadata column (`entity_record_id`, `organization_id`,
   * `synced_at`, `is_valid`, `source_id`). Data columns are looked up
   * by the cache's column-name set; missing columns bind `NULL`,
   * unknown keys are silently dropped.
   *
   * Large batches are chunked into `WIDE_TABLE_CHUNK_SIZE`-row
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
  ): Promise<WideTableUpsertResult> {
    if (rows.length === 0) return { repaired: 0, rejected: [] };

    const stmt = await this.statementCache.get(connectorEntityId, client);
    const colsInOrder = [
      ...WIDE_TABLE_METADATA_COLUMNS,
      ...stmt.columns.map((c) => c.columnName),
    ];

    // #316: geometry columns get a fail-closed audit before the write —
    // normalize ArcGIS/GeoJSON shapes, classify validity, drop rows whose
    // geometry is unparseable (reported, never written NULL), and repair the
    // invalid-but-fixable ones (ST_MakeValid, applied in the value binding).
    const geometryColumns = stmt.columns
      .filter((c) => c.pgType.startsWith("geometry"))
      .map((c) => c.columnName);
    let repaired = 0;
    const rejected: WideTableRejection[] = [];
    if (geometryColumns.length > 0) {
      const prep = await this.auditGeometry(
        rows,
        geometryColumns,
        client,
        normalizedKeyByColumn(stmt.columns)
      );
      rows = prep.rows;
      repaired = prep.repaired;
      rejected.push(...prep.rejected);
      if (rows.length === 0) return { repaired, rejected };
    }

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
    const pgTypeByColumn = wideColumnPgTypes(stmt.columns);

    const setClauses =
      colsInOrder
        .filter((c) => c !== "entity_record_id")
        .map((c) => `"${c}" = EXCLUDED."${c}"`)
        .join(", ") +
      // Resurrection (#450): a previously soft-deleted `source_id` reappearing
      // in a sync reuses its entity_record PK (see findBySourceIds
      // includeDeleted), so this upsert hits the existing (marked) wide row —
      // clear its tombstone. `deleted` is not an inserted column, so this is a
      // literal, not EXCLUDED.
      `, "deleted" = NULL`;

    for (let i = 0; i < rows.length; i += WIDE_TABLE_CHUNK_SIZE) {
      const chunk = rows.slice(i, i + WIDE_TABLE_CHUNK_SIZE);
      const tuples = chunk.map((row) => {
        const valueExprs = colsInOrder.map((col) =>
          wideValueExpr(row, col, pgTypeByColumn.get(col) ?? "text")
        );
        return sql`(${sql.join(valueExprs, sql`, `)})`;
      });

      const statement = sql`INSERT INTO ${sql.raw(tableName)} (${sql.raw(insertColList)}) VALUES ${sql.join(
        tuples,
        sql`, `
      )} ON CONFLICT ("entity_record_id") DO UPDATE SET ${sql.raw(setClauses)}`;

      await (client as typeof db).execute(statement);
    }

    return { repaired, rejected };
  }

  /**
   * #316: fail-closed geometry preparation for a batch. For every geometry
   * column: shape-normalize each value (ArcGIS/GeoJSON → GeoJSON), audit the
   * batch (one round-trip), then partition rows — an unparseable geometry
   * rejects the whole row (dropped, reported by `source_id`), a repairable one
   * is counted and left for ST_MakeValid on write, and a clean one passes
   * through. An absent (null) geometry is not a rejection — it writes NULL.
   */
  private async auditGeometry(
    rows: ReadonlyArray<Record<string, unknown>>,
    geometryColumns: string[],
    client: DbClient,
    keyByColumn: ReadonlyMap<string, string>
  ): Promise<{
    rows: Array<Record<string, unknown>>;
    repaired: number;
    rejected: WideTableRejection[];
  }> {
    // Shallow-copy rows so normalized geometry values don't mutate the caller's
    // objects. Composite audit key `<rowIndex>:<column>` maps each candidate
    // back to its row (a row may carry more than one geometry column).
    const normalized = rows.map((r) => ({ ...r }));
    const auditRows: GeometryAuditRow[] = [];
    const keyToRowIndex = new Map<string, number>();
    // Row index → the geometry columns that failed it, per refusal kind.
    const invalidColsByRow = new Map<number, Set<string>>();
    const sridColsByRow = new Map<number, Set<string>>();
    const mark = (m: Map<number, Set<string>>, i: number, col: string) =>
      m.set(i, (m.get(i) ?? new Set<string>()).add(col));
    // Non-4326 SRIDs observed → the (row, column) pairs that carry each, so
    // an unknown SRID can reject exactly those rows.
    const cellsBySrid = new Map<number, Array<[number, string]>>();

    normalized.forEach((row, i) => {
      for (const col of geometryColumns) {
        const v = row[col];
        if (v === null || v === undefined) continue; // absent → writes NULL
        // Read the source SRID from the RAW value before overwriting it with
        // the shape-normalized GeoJSON candidate.
        const srid = extractSourceSrid(v);
        const candidate = toGeoJsonCandidate(v);
        if (candidate === null) {
          mark(invalidColsByRow, i, col);
          continue;
        }
        row[col] = candidate;
        row[geoSridSidecarKey(col)] = srid;
        if (srid !== 4326) {
          const cells = cellsBySrid.get(srid) ?? [];
          cells.push([i, col]);
          cellsBySrid.set(srid, cells);
        }
        const key = `${i}:${col}`;
        auditRows.push({ sourceId: key, geoJson: candidate });
        keyToRowIndex.set(key, i);
      }
    });

    // Reject rows whose source SRID PostGIS can't reproject (absent from
    // spatial_ref_sys) — fail-closed, never write mislocated geometry.
    if (cellsBySrid.size > 0) {
      const sridList = sql.join(
        [...cellsBySrid.keys()].map((s) => sql`${s}`),
        sql`, `
      );
      const known = (await client.execute(
        sql`SELECT srid FROM spatial_ref_sys WHERE srid IN (${sridList})`
      )) as unknown as Array<{ srid: number }>;
      const knownSrids = new Set(known.map((r) => Number(r.srid)));
      for (const [srid, cells] of cellsBySrid) {
        if (!knownSrids.has(srid)) {
          for (const [i, col] of cells) mark(sridColsByRow, i, col);
        }
      }
    }

    const audit =
      auditRows.length > 0
        ? await GeometryAuditService.auditBatch(auditRows, { client })
        : { ok: [], repaired: [], rejected: [] };

    const repairedRowIndexes = new Set<number>();
    for (const key of audit.repaired) {
      const i = keyToRowIndex.get(key);
      if (i !== undefined) repairedRowIndexes.add(i);
    }
    for (const r of audit.rejected) {
      const i = keyToRowIndex.get(r.sourceId);
      // The audit key is `<rowIndex>:<column>`.
      if (i !== undefined) {
        mark(
          invalidColsByRow,
          i,
          r.sourceId.slice(r.sourceId.indexOf(":") + 1)
        );
      }
    }

    const fieldsOf = (cols: Iterable<string>) =>
      [...cols].map((c) => keyByColumn.get(c) ?? c);
    const outRows: Array<Record<string, unknown>> = [];
    const rejected: WideTableRejection[] = [];
    let repaired = 0;
    normalized.forEach((row, i) => {
      const sourceId = String(row["source_id"] ?? row["entity_record_id"] ?? i);
      // #757: every problem on the row, SRID first, so the caller can name
      // them all at once rather than one per resubmit.
      const sridCols = sridColsByRow.get(i) ?? new Set<string>();
      const invalidCols = [...(invalidColsByRow.get(i) ?? [])].filter(
        (c) => !sridCols.has(c)
      );
      const problems: WideTableRejection["problems"] = [];
      if (sridCols.size > 0) {
        problems.push({
          code: ApiCode.GIS_SRID_UNSUPPORTED,
          fields: fieldsOf(sridCols),
        });
      }
      if (invalidCols.length > 0) {
        problems.push({
          code: ApiCode.GEOMETRY_INVALID_ON_IMPORT,
          fields: fieldsOf(invalidCols),
        });
      }
      if (problems.length > 0) {
        const { code } = problems[0];
        rejected.push({
          sourceId,
          code,
          fields: problems.flatMap((p) => p.fields),
          problems,
          reason:
            code === ApiCode.GIS_SRID_UNSUPPORTED
              ? `${ApiCode.GIS_SRID_UNSUPPORTED}: source SRID is not in spatial_ref_sys; the row was not written`
              : `${ApiCode.GEOMETRY_INVALID_ON_IMPORT}: geometry was unparseable and the row was not written`,
        });
        return;
      }
      if (repairedRowIndexes.has(i)) repaired++;
      outRows.push(row);
    });

    return { rows: outRows, repaired, rejected };
  }

  /**
   * Partial update of a single wide-table row: `updateMany` with one row.
   * Only the supplied `normalizedKey` entries are written; columns not in
   * the patch keep their values. Use this from the REST PATCH path, where the
   * user updates a few keys rather than replacing the whole row (which is
   * `upsertMany`'s semantics).
   *
   * Metadata columns (`synced_at`, `is_valid`) may also be supplied via
   * `metadataPatch`. A geometry the audit refuses (#757) is handled as
   * `updateMany` describes.
   */
  async updatePartial(
    connectorEntityId: string,
    entityRecordId: string,
    normalizedDataPatch: Record<string, unknown>,
    metadataPatch: { syncedAt?: number; isValid?: boolean } = {},
    client: DbClient = db,
    opts: { onRejectedGeometry?: "throw" | "skip" } = {}
  ): Promise<WideTableRejection[]> {
    return this.updateMany(
      connectorEntityId,
      [
        {
          entityRecordId,
          normalizedData: normalizedDataPatch,
          ...metadataPatch,
        },
      ],
      client,
      opts
    );
  }

  /**
   * Partial update of many wide-table rows (#761). Each row writes only the
   * keys it carries (unknown keys are dropped), plus `synced_at` / `is_valid`
   * when given. Rows are chunked at `WIDE_TABLE_CHUNK_SIZE`; a chunk costs one
   * geometry audit and one `UPDATE … FROM (VALUES …)` per distinct set of
   * written columns, instead of a round trip or two per row. Rows that
   * write different keys therefore take separate statements: a caller whose
   * rows share their keys (revalidation writes every mapped column) gets one
   * per chunk. Two updates for one record merge in order, later keys winning.
   *
   * A geometry value that fails the audit (#757), by default, throws a 400
   * (`GEOMETRY_INVALID_ON_IMPORT` / `GIS_SRID_UNSUPPORTED`) before anything
   * in the call is written: a user or agent is there to fix it. A background
   * caller passes `onRejectedGeometry: "skip"` instead (as sync does with
   * `upsertMany`): that row's geometry columns keep their values, the rest of
   * its patch is written, and the refusal is returned for the caller to
   * report.
   */
  async updateMany(
    connectorEntityId: string,
    rows: ReadonlyArray<WidePartialUpdate>,
    client: DbClient = db,
    opts: { onRejectedGeometry?: "throw" | "skip" } = {}
  ): Promise<WideTableRejection[]> {
    if (rows.length === 0) return [];
    const stmt = await this.statementCache.get(connectorEntityId, client);
    const columnByKey = new Map(stmt.columns.map((c) => [c.normalizedKey, c]));
    const pgTypeByColumn = wideColumnPgTypes(stmt.columns);
    const isGeometry = (columnName: string) =>
      pgTypeByColumn.get(columnName)?.startsWith("geometry") ?? false;

    // Each row as wide-table cells: column name → value. Two updates for one
    // record merge in order, so the later one wins key by key, as separate
    // calls would (one VALUES list can't update a row twice).
    const byId = new Map<
      string,
      { entityRecordId: string; cells: Record<string, unknown> }
    >();
    for (const r of rows) {
      const entry = byId.get(r.entityRecordId) ?? {
        entityRecordId: r.entityRecordId,
        cells: {},
      };
      for (const [key, value] of Object.entries(r.normalizedData)) {
        const col = columnByKey.get(key);
        if (col) entry.cells[col.columnName] = value;
      }
      if (r.syncedAt !== undefined) entry.cells["synced_at"] = r.syncedAt;
      if (r.isValid !== undefined) entry.cells["is_valid"] = r.isValid;
      byId.set(r.entityRecordId, entry);
    }
    const prepared = [...byId.values()];

    // #757: geometry gets the same fail-closed audit as `upsertMany` (#316),
    // one audit per chunk. Every chunk is audited before any is written, so a
    // refusal in "throw" mode leaves the whole call unwritten.
    const geometryColumns = stmt.columns
      .filter((c) => isGeometry(c.columnName))
      .map((c) => c.columnName);
    const rejected: WideTableRejection[] = [];
    if (geometryColumns.length > 0) {
      const keyByColumn = normalizedKeyByColumn(stmt.columns);
      for (let i = 0; i < prepared.length; i += WIDE_TABLE_CHUNK_SIZE) {
        const chunk = prepared
          .slice(i, i + WIDE_TABLE_CHUNK_SIZE)
          .filter((p) => geometryColumns.some((c) => p.cells[c] != null));
        if (chunk.length === 0) continue;
        const prep = await this.auditGeometry(
          chunk.map((p) => ({ source_id: p.entityRecordId, ...p.cells })),
          geometryColumns,
          client,
          keyByColumn
        );
        rejected.push(...prep.rejected);
        // Audited cells carry the normalized GeoJSON and its SRID sidecar.
        const audited = new Map(
          prep.rows.map((row) => [row["source_id"] as string, row])
        );
        for (const p of chunk) {
          const row = audited.get(p.entityRecordId);
          if (row) {
            const { source_id: _sourceId, ...cells } = row;
            p.cells = cells;
          } else {
            // Refused: keep the row's geometry as it is ("skip" mode).
            for (const c of geometryColumns) {
              if (p.cells[c] != null) delete p.cells[c];
            }
          }
        }
      }
      if (rejected.length > 0 && opts.onRejectedGeometry !== "skip") {
        assertNoRejectedGeometry({ rejected }, { batch: rows.length > 1 });
      }
    }

    const tableName = sql.raw(`"${this.tableName(connectorEntityId)}"`);
    const columnOrder = [
      "synced_at",
      "is_valid",
      ...stmt.columns.map((c) => c.columnName),
    ];
    for (let i = 0; i < prepared.length; i += WIDE_TABLE_CHUNK_SIZE) {
      // Rows that write the same columns share one statement.
      const groups = new Map<
        string,
        { cols: string[]; rows: typeof prepared }
      >();
      for (const p of prepared.slice(i, i + WIDE_TABLE_CHUNK_SIZE)) {
        const cols = columnOrder.filter((c) => c in p.cells);
        if (cols.length === 0) continue;
        const key = cols.join(",");
        const group = groups.get(key) ?? { cols, rows: [] };
        group.rows.push(p);
        groups.set(key, group);
      }
      for (const { cols, rows: groupRows } of groups.values()) {
        // A VALUES list has no target column to take types from, so every
        // value is cast to its column's type.
        const quoted = cols.map((c) => `"${c}"`);
        const setClause = quoted.map((q) => `${q} = v.${q}`).join(", ");
        const tuples = groupRows.map((p) => {
          const values = cols.map((c) => {
            const pgType = pgTypeByColumn.get(c) ?? "text";
            return sql`CAST(${wideValueExpr(p.cells, c, pgType)} AS ${sql.raw(pgType)})`;
          });
          return sql`(${sql`${p.entityRecordId}`}, ${sql.join(values, sql`, `)})`;
        });
        await (client as typeof db).execute(
          sql`UPDATE ${tableName} AS w SET ${sql.raw(setClause)} FROM (VALUES ${sql.join(tuples, sql`, `)}) AS v("entity_record_id", ${sql.raw(quoted.join(", "))}) WHERE w."entity_record_id" = v."entity_record_id"`
        );
      }
    }
    return rejected;
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
  /**
   * Delete the wide rows for the given `entity_records` ids — the #327
   * cascade, since soft-deleting a record is an UPDATE and never fires
   * `ON DELETE CASCADE`.
   *
   * Chunked at `WIDE_TABLE_CHUNK_SIZE` (#436). `sql.join` allocates
   * one AST node per id and Drizzle flattens that chain recursively when the
   * statement is serialised, so a single unbounded `IN (…)` overflows the V8
   * stack — a 317,000-id reap did exactly that, *after* the `entity_records`
   * half had committed, stranding 317,000 orphaned wide rows.
   *
   * The chunks run on whatever client is passed and are deliberately NOT
   * wrapped in a new transaction: `softDeleteBeforeWatermark` has already
   * committed by the time a reap caller gets here, so atomicity across the
   * two was never available. A partial cascade leaves orphans the next reap
   * re-attempts, matching this mirror's documented best-effort posture.
   */
  /**
   * Of the given `entity_records` ids, which have **no** row in `er__<id>`
   * (#440).
   *
   * Replaces the sync loop's blind per-record mirror re-upsert. That existed
   * to backfill rows present in `entity_records` but missing from the wide
   * table — common right after landing field mappings on an already-synced
   * entity — but it paid ~398,000 speculative upserts, each carrying a
   * geometry audit, on every sync to catch a handful of gaps. One anti-join
   * per batch locates them directly.
   *
   * Chunked at `WIDE_TABLE_CHUNK_SIZE` (#436), accumulating across chunks:
   * a partial answer would silently skip a backfill.
   */
  async selectMissingWideRowIds(
    connectorEntityId: string,
    entityRecordIds: ReadonlyArray<string>,
    client: DbClient = db
  ): Promise<string[]> {
    if (entityRecordIds.length === 0) return [];
    const tableName = `"${this.tableName(connectorEntityId)}"`;
    const missing: string[] = [];
    for (let i = 0; i < entityRecordIds.length; i += WIDE_TABLE_CHUNK_SIZE) {
      const chunk = entityRecordIds.slice(i, i + WIDE_TABLE_CHUNK_SIZE);
      const idList = sql.join(
        chunk.map((id) => sql`${id}`),
        sql`, `
      );
      // Ask which of the chunk's ids ARE present and diff in memory. A
      // SQL-side anti-join would need the requested ids as a VALUES relation;
      // the chunk is capped at WIDE_TABLE_CHUNK_SIZE, so the set difference is
      // trivial here and the statement stays a plain indexed lookup.
      const found = (await (client as typeof db).execute(
        sql`SELECT "entity_record_id" AS id FROM ${sql.raw(tableName)}
            WHERE "entity_record_id" IN (${idList})`
      )) as unknown as Array<{ id: string }>;
      const present = new Set(found.map((r) => r.id));
      for (const id of chunk) if (!present.has(id)) missing.push(id);
    }
    return missing;
  }

  /**
   * Mark the wide rows for the given entity-record ids soft-deleted, chunked
   * (#436, #450). An `UPDATE … SET "deleted" = <deletedAt>` rather than a
   * `DELETE`: the row persists as a tombstone so the session view can filter
   * `w.deleted IS NULL` locally instead of joining `entity_records` (#450).
   *
   * Throws on failure. The **bounded request paths** (UI delete, layout) call
   * this inside the same transaction as the `entity_records` soft-delete, so
   * record + wide state commit together — zero orphan window. The unbounded
   * **reap** uses `markDeletedFromRecordsBestEffort` below instead, to avoid a
   * giant transaction.
   */
  async markDeletedByEntityRecordIds(
    connectorEntityId: string,
    ids: ReadonlyArray<string>,
    deletedAt: number,
    client: DbClient = db
  ): Promise<void> {
    if (ids.length === 0) return;
    const tableName = `"${this.tableName(connectorEntityId)}"`;
    for (let i = 0; i < ids.length; i += WIDE_TABLE_CHUNK_SIZE) {
      const chunk = ids.slice(i, i + WIDE_TABLE_CHUNK_SIZE);
      const idList = sql.join(
        chunk.map((id) => sql`${id}`),
        sql`, `
      );
      await (client as typeof db).execute(
        sql`UPDATE ${sql.raw(tableName)} SET "deleted" = ${deletedAt}
            WHERE "entity_record_id" IN (${idList}) AND "deleted" IS NULL`
      );
    }
  }

  /**
   * Mark **every** wide row for `connectorEntityId` whose `entity_records`
   * row is soft-deleted, in a single server-side join `UPDATE … FROM
   * entity_records` — ids never leave Postgres (#451). This is the bounded
   * delete-all cascade: the caller soft-deletes the entity's records
   * (`entityRecords.softDeleteByConnectorEntityId`) and then calls this inside
   * the **same transaction**, so record + wide state commit together with a
   * zero orphan window (#450). The wide tombstone inherits `er.deleted`, so
   * both sides carry the same timestamp.
   *
   * One statement, not chunked — it mirrors the record side, whose
   * `softDeleteByConnectorEntityId` is itself one unbounded `UPDATE`; both run
   * in the caller's tx, so locks are held until commit regardless of chunking.
   * (The out-of-transaction reap that runs standalone is
   * `markDeletedFromRecords` below, which chunks for exactly that reason.)
   *
   * Distinct from `markDeletedByEntityRecordIds`, which stays for the reap /
   * layout callers that legitimately hold a bounded id list.
   */
  async markDeletedByConnectorEntity(
    connectorEntityId: string,
    client: DbClient = db
  ): Promise<void> {
    const tableName = `"${this.tableName(connectorEntityId)}"`;
    await (client as typeof db).execute(
      sql`UPDATE ${sql.raw(tableName)} w
          SET "deleted" = er."deleted"
          FROM "entity_records" er
          WHERE er."id" = w."entity_record_id"
            AND er."connector_entity_id" = ${connectorEntityId}
            AND er."deleted" IS NOT NULL
            AND w."deleted" IS NULL`
    );
  }

  /**
   * Self-healing reap mark (#450): mark every wide row whose `entity_records`
   * row is soft-deleted but whose own `deleted` is still NULL, in chunks, by a
   * server-side join `UPDATE … FROM entity_records` — ids never leave Postgres.
   *
   * This is NOT keyed to a specific reap's id set: it re-marks *any* unmarked
   * orphan each run, so a failed mark (or a pre-existing best-effort-cascade
   * orphan from before #450) converges on the next reap. It is deliberately
   * not wrapped in the watermark soft-delete transaction — that reap can touch
   * 100Ks of rows, and #440/#441/#456 split it from the cascade to avoid a
   * giant transaction. Residual window: sub-second within the reap flow.
   *
   * Terminates for the same reason as `softDeleteBeforeWatermark`: each chunk
   * sets `deleted`, and the candidate predicate requires `deleted IS NULL`, so
   * every pass strictly shrinks the remaining set.
   */
  async markDeletedFromRecords(
    connectorEntityId: string,
    client: DbClient = db
  ): Promise<number> {
    const tableName = `"${this.tableName(connectorEntityId)}"`;
    let total = 0;
    for (;;) {
      const marked = (await (client as typeof db).execute(
        sql`UPDATE ${sql.raw(tableName)} w
            SET "deleted" = er."deleted"
            FROM "entity_records" er
            WHERE er."id" = w."entity_record_id"
              AND er."deleted" IS NOT NULL
              AND w."deleted" IS NULL
              AND w."entity_record_id" IN (
                SELECT w2."entity_record_id"
                FROM ${sql.raw(tableName)} w2
                JOIN "entity_records" er2 ON er2."id" = w2."entity_record_id"
                WHERE er2."deleted" IS NOT NULL AND w2."deleted" IS NULL
                LIMIT ${WIDE_TABLE_CHUNK_SIZE}
              )
            RETURNING w."entity_record_id"`
      )) as unknown as Array<{ entity_record_id: string }>;
      if (marked.length === 0) break;
      total += marked.length;
    }
    return total;
  }

  /**
   * Best-effort wrapper over `markDeletedFromRecords` for the reap path
   * (#441/#456 posture): a sync whose data landed must not report `failed`
   * because the mirror mark could not complete. `degraded: true` surfaces the
   * staleness on the result; the next reap's self-healing mark re-attempts.
   */
  async markDeletedFromRecordsBestEffort(
    connectorEntityId: string,
    client: DbClient = db
  ): Promise<{ degraded: boolean; marked: number }> {
    try {
      const marked = await this.markDeletedFromRecords(
        connectorEntityId,
        client
      );
      return { degraded: false, marked };
    } catch (err) {
      logger.error(
        {
          event: "wide-table.reap-mark-failed",
          connectorEntityId,
          err,
        },
        "Reap mark failed — wide rows for reaped records stay live until the next reap re-marks them (self-heals)"
      );
      return { degraded: true, marked: 0 };
    }
  }
}

export const wideTableRepo = new WideTableRepository();
