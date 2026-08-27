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
  rejected: Array<{ sourceId: string; reason: string }>;
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
 * 500 also keeps the bind count comfortably under PostgreSQL's 65k limit —
 * 500 rows × ~50 columns = 25k params worst-case on the `upsertMany` path.
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

    // #450: filter on the wide row's own `deleted` — no `JOIN entity_records`
    // (see buildSessionViews). Every delete path marks it atomically with the
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
    const rejected: Array<{ sourceId: string; reason: string }> = [];
    if (geometryColumns.length > 0) {
      const prep = await this.auditGeometry(rows, geometryColumns, client);
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
    // Metadata columns have known types; data columns come from the cache.
    const pgTypeByColumn = new Map<string, string>([
      ["entity_record_id", "text"],
      ["organization_id", "text"],
      ["synced_at", "bigint"],
      ["is_valid", "boolean"],
      ["source_id", "text"],
      ...stmt.columns.map((c) => [c.columnName, c.pgType] as const),
    ]);

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
        const valueExprs = colsInOrder.map((col) => {
          const v = row[col];
          const value = v === undefined ? null : v;
          const pgType = pgTypeByColumn.get(col) ?? "text";
          // postgres-js doesn't auto-serialize JS arrays as Postgres
          // array literals when bound as a single parameter. Build an
          // ARRAY[...]-style expression so each element binds as its
          // own param (`text[]` → `ARRAY[$n, $n+1]::text[]`). Date
          // items go through `toISOString()` rather than `String()`
          // so the bound array elements are locale-independent
          // ISO 8601 strings (Date.toString() is locale-aware and
          // reads garbage in non-UTC environments).
          if (pgType === "text[]") {
            if (value === null || value === undefined) {
              return sql`NULL::text[]`;
            }
            if (!Array.isArray(value) || value.length === 0) {
              return sql`ARRAY[]::text[]`;
            }
            const items = sql.join(
              value.map(
                (item) =>
                  sql`${item instanceof Date ? item.toISOString() : String(item)}`
              ),
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
            const srid = Number(row[geoSridSidecarKey(col)] ?? 4326);
            const json = JSON.stringify(value);
            // Stamp the source SRID, reproject to 4326 when it differs (e.g. an
            // ArcGIS 102100→3857 web-mercator source), then repair.
            return srid === 4326
              ? sql`ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${json}), 4326))`
              : sql`ST_MakeValid(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(${json}), ${srid}), 4326))`;
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
        });
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
    client: DbClient
  ): Promise<{
    rows: Array<Record<string, unknown>>;
    repaired: number;
    rejected: Array<{ sourceId: string; reason: string }>;
  }> {
    // Shallow-copy rows so normalized geometry values don't mutate the caller's
    // objects. Composite audit key `<rowIndex>:<column>` maps each candidate
    // back to its row (a row may carry more than one geometry column).
    const normalized = rows.map((r) => ({ ...r }));
    const auditRows: GeometryAuditRow[] = [];
    const keyToRowIndex = new Map<string, number>();
    const unrecognizedRowIndexes = new Set<number>();
    // Non-4326 SRIDs observed → the row indexes that carry each, so an
    // unknown SRID can reject exactly those rows.
    const rowIndexesBySrid = new Map<number, Set<number>>();

    normalized.forEach((row, i) => {
      for (const col of geometryColumns) {
        const v = row[col];
        if (v === null || v === undefined) continue; // absent → writes NULL
        // Read the source SRID from the RAW value before overwriting it with
        // the shape-normalized GeoJSON candidate.
        const srid = extractSourceSrid(v);
        const candidate = toGeoJsonCandidate(v);
        if (candidate === null) {
          unrecognizedRowIndexes.add(i);
          continue;
        }
        row[col] = candidate;
        row[geoSridSidecarKey(col)] = srid;
        if (srid !== 4326) {
          const set = rowIndexesBySrid.get(srid) ?? new Set<number>();
          set.add(i);
          rowIndexesBySrid.set(srid, set);
        }
        const key = `${i}:${col}`;
        auditRows.push({ sourceId: key, geoJson: candidate });
        keyToRowIndex.set(key, i);
      }
    });

    // Reject rows whose source SRID PostGIS can't reproject (absent from
    // spatial_ref_sys) — fail-closed, never write mislocated geometry.
    const unknownSridRowIndexes = new Set<number>();
    if (rowIndexesBySrid.size > 0) {
      const sridList = sql.join(
        [...rowIndexesBySrid.keys()].map((s) => sql`${s}`),
        sql`, `
      );
      const known = (await client.execute(
        sql`SELECT srid FROM spatial_ref_sys WHERE srid IN (${sridList})`
      )) as unknown as Array<{ srid: number }>;
      const knownSrids = new Set(known.map((r) => Number(r.srid)));
      for (const [srid, indexes] of rowIndexesBySrid) {
        if (!knownSrids.has(srid)) {
          for (const i of indexes) unknownSridRowIndexes.add(i);
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
    const rejectedRowIndexes = new Set<number>(unrecognizedRowIndexes);
    for (const r of audit.rejected) {
      const i = keyToRowIndex.get(r.sourceId);
      if (i !== undefined) rejectedRowIndexes.add(i);
    }

    const outRows: Array<Record<string, unknown>> = [];
    const rejected: Array<{ sourceId: string; reason: string }> = [];
    let repaired = 0;
    normalized.forEach((row, i) => {
      const sourceId = String(row["source_id"] ?? row["entity_record_id"] ?? i);
      if (unknownSridRowIndexes.has(i)) {
        rejected.push({
          sourceId,
          reason: `${ApiCode.GIS_SRID_UNSUPPORTED}: source SRID is not in spatial_ref_sys; the row was not written`,
        });
        return;
      }
      if (rejectedRowIndexes.has(i)) {
        rejected.push({
          sourceId,
          reason: `${ApiCode.GEOMETRY_INVALID_ON_IMPORT}: geometry was unparseable and the row was not written`,
        });
        return;
      }
      if (repairedRowIndexes.has(i)) repaired++;
      outRows.push(row);
    });

    return { rows: outRows, repaired, rejected };
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
      const cachedCol = stmt.columns.find(
        (c) => c.normalizedKey === normalizedKey
      );
      if (!cachedCol) continue;
      // Geometry columns can't take a bound JSON param directly — a GeoJSON
      // value is converted via ST_GeomFromGeoJSON and stamped to WGS84 (4326),
      // matching the import write path (#316). Non-geometry columns bind as-is.
      if (cachedCol.pgType.startsWith("geometry") && value != null) {
        setFragments.push(
          sql`${sql.raw(`"${cachedCol.columnName}"`)} = ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(
            value
          )}), 4326)`
        );
      } else {
        setFragments.push(
          sql`${sql.raw(`"${cachedCol.columnName}"`)} = ${value as never}`
        );
      }
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
          cause: err instanceof Error ? err.message : String(err),
        },
        "Reap mark failed — wide rows for reaped records stay live until the next reap re-marks them (self-heals)"
      );
      return { degraded: true, marked: 0 };
    }
  }
}

export const wideTableRepo = new WideTableRepository();
