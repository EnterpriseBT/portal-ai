/**
 * SQL execution layer for the bulk_transform job processor (#85,
 * Phase 2). Owns the per-batch INSERT-SELECT pattern that copies
 * derived values from the source wide table to the target.
 *
 * Phase 2 implements `expression.kind === "sql"` only. The
 * `expression.kind === "tool"` path is dispatched separately by Phase
 * 4's tool-dispatcher.
 *
 * The processor (bulk-transform.processor.ts) drives the loop;
 * cancel-flag handling and SSE event emission live there. This service
 * is the SQL seam — tests mock it to verify the processor's control
 * flow without standing up a real database.
 */

import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { wideTableRepo } from "../db/repositories/wide-table.repository.js";
import { wideTableStatementCache } from "./wide-table-statement.cache.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "bulk-transform-service" });

export interface BulkTransformBatchOptions {
  sourceConnectorEntityId: string;
  targetConnectorEntityId: string;
  organizationId: string;
  /** The SQL projection / scalar expression. Aliases on its SELECT list
   *  must match target wide-column names (`c_<normalized_key>`). */
  expression: string;
  /** Wide-column name (`c_<normalized_key>`) used as the upsert key on
   *  the target's `source_id` column. */
  keyField: string;
  batchSize: number;
  offset: number;
  jobId: string;
  /** User id stamped into the created entity_records audit columns. */
  userId: string;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export interface FetchSourceBatchOptions {
  sourceConnectorEntityId: string;
  organizationId: string;
  keyField: string;
  batchSize: number;
  offset: number;
  /** Optional source-side WHERE fragment (#85 Phase 4 retry-failed-only). */
  whereSqlFragment?: string;
}

export interface UpsertSuccessesOptions {
  targetConnectorEntityId: string;
  organizationId: string;
  jobId: string;
  successes: Array<{ sourceKey: string; value: Record<string, unknown> }>;
  /** User id stamped into the created entity_records audit columns
   *  (same FK-aware pattern runBatch uses). */
  userId: string;
}

export interface UpsertSuccessesResult {
  /** Number of rows actually upserted into the target wide table. */
  rowsUpserted: number;
  /** Tool-output keys that didn't exist on the target's wide table and
   *  were dropped (#85 Phase 4 — defense-in-depth until #98 lands the
   *  proper pre-flight). Empty array on a clean batch. */
  droppedKeys: string[];
}

export class BulkTransformService {
  /**
   * Pre-flight: run an EXPLAIN against the SELECT that the processor
   * will eventually execute, with a `LIMIT 1` so it touches as little
   * as possible. Surfaces PG syntax / type errors as a typed throw
   * (`BULK_JOB_EXPRESSION_INVALID`) before the job is enqueued.
   *
   * The tool calls this from its pre-flight; integration tests in
   * slice 6 verify the EXPLAIN catches malformed expressions.
   */
  static async explainExpression(
    sourceConnectorEntityId: string,
    organizationId: string,
    expression: string
  ): Promise<void> {
    const sourceTable = quoteIdent(
      wideTableRepo.tableName(sourceConnectorEntityId)
    );
    const orgLit = `'${organizationId.replace(/'/g, "''")}'`;
    const sqlText =
      `EXPLAIN SELECT ${expression} FROM ${sourceTable} ` +
      `WHERE "organization_id" = ${orgLit} LIMIT 1`;
    await db.execute(sql.raw(sqlText));
  }

  /**
   * Pre-flight cast check for #99's `constant`-kind writes. Returns
   * `true` if PG can cast the value to the target column's pgType,
   * `false` otherwise. Uses a parameterized `SELECT $1::<pgType>`
   * round-trip — cheap (no rows, no plan).
   *
   * `pgType` comes from `wideTableStatementCache` (`columns[].pgType`),
   * which sources it from `wide_table_columns` — safe to `sql.raw`.
   * `value` is bound as a parameter so the agent's literal can't
   * inject SQL.
   */
  static async canCastConstant(
    value: unknown,
    pgType: string
  ): Promise<boolean> {
    try {
      await db.execute(
        sql`SELECT ${value as never}::${sql.raw(pgType)} AS _check`
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Count rows visible in the source wide table for the given org.
   * Used by the processor to derive `totalRecords` for the per-batch
   * SSE event.
   */
  static async countSourceRows(
    sourceConnectorEntityId: string,
    organizationId: string
  ): Promise<number> {
    const tableName = quoteIdent(
      wideTableRepo.tableName(sourceConnectorEntityId)
    );
    const result = await db.execute(
      sql.raw(
        `SELECT COUNT(*)::bigint AS count FROM ${tableName} ` +
          `WHERE "organization_id" = '${organizationId.replace(/'/g, "''")}'`
      )
    );
    const rows = result as unknown as Array<{ count: string | number }>;
    return Number(rows[0]?.count ?? 0);
  }

  /**
   * Read one batch's source rows + projected aliases (#99 slice 4).
   *
   * Slice 4 (#99) split the prior INSERT-SELECT into two stages:
   * `runBatch` now SELECTs the source batch with the agent's
   * projection applied, returning one row per source record. The
   * processor's per-target fan-out (via
   * `BulkTransformService.upsertSuccesses`) is what actually writes to
   * the wide table(s) — that's how the same job can land values into
   * N target columns spanning K target entities.
   *
   * Each returned row has:
   *   - `__src_key`: the source row's keyField value as text (the
   *     upsert key on every target's wide table).
   *   - `__source_row`: a JSON object containing every source column,
   *     so `valueFrom.kind === "source_column"` writes can look up
   *     values without a second query.
   *   - …the projection's `AS aliases` as top-level fields, consumed
   *     by `valueFrom.kind === "sql_alias"` writes.
   *
   * `batch_deduped` is the last-wins dedupe of `batch` by keyField
   * (NEO-style sources can repeat one asteroid across close-approach
   * rows; dedupe avoids PG 21000 in the downstream UPSERT).
   */
  static async runBatch(
    opts: BulkTransformBatchOptions
  ): Promise<{ rowsCommitted: number; rows: Array<Record<string, unknown>> }> {
    const sourceTable = quoteIdent(
      wideTableRepo.tableName(opts.sourceConnectorEntityId)
    );

    const keyCol = quoteIdent(opts.keyField);
    const orgLit = `'${opts.organizationId.replace(/'/g, "''")}'`;

    // The agent's projection — passed through to the SELECT verbatim.
    // The pre-flight EXPLAIN already validated each segment as a legal
    // PG expression with a usable alias; here we just splice.
    const projection = opts.expression.trim();
    const projectionClause = projection.length > 0 ? `, ${projection}` : "";

    const selectSql =
      `WITH batch AS (` +
      `  SELECT * FROM ${sourceTable} ` +
      `  WHERE "organization_id" = ${orgLit} ` +
      `  ORDER BY "entity_record_id" ` +
      `  LIMIT ${opts.batchSize} OFFSET ${opts.offset}` +
      `), ` +
      `batch_deduped AS (` +
      `  SELECT DISTINCT ON (${keyCol}) * FROM batch ` +
      `  ORDER BY ${keyCol}, "entity_record_id" DESC` +
      `) ` +
      `SELECT ${keyCol}::text AS "__src_key", ` +
      `row_to_json(batch_deduped.*) AS "__source_row"` +
      projectionClause +
      ` FROM batch_deduped`;

    const result = await db.execute(sql.raw(selectSql));
    const rows = Array.isArray(result)
      ? (result as unknown as Array<Record<string, unknown>>)
      : [];
    return { rowsCommitted: rows.length, rows };
  }

  /**
   * Read a paged window of source rows (#85 Phase 4). The
   * tool-dispatch processor calls this per batch to seed the
   * dispatcher's input; for each row, the dispatcher passes the row
   * + the keyField value to the tool's execute.
   */
  static async fetchSourceBatch(
    opts: FetchSourceBatchOptions
  ): Promise<Array<Record<string, unknown>>> {
    const sourceTable = quoteIdent(
      wideTableRepo.tableName(opts.sourceConnectorEntityId)
    );
    const orgLit = `'${opts.organizationId.replace(/'/g, "''")}'`;
    const filterClause = opts.whereSqlFragment
      ? ` AND (${opts.whereSqlFragment})`
      : "";
    const result = await db.execute(
      sql.raw(
        `SELECT * FROM ${sourceTable} ` +
          `WHERE "organization_id" = ${orgLit}${filterClause} ` +
          `ORDER BY "entity_record_id" ` +
          `LIMIT ${opts.batchSize} OFFSET ${opts.offset}`
      )
    );
    return Array.isArray(result)
      ? (result as unknown as Array<Record<string, unknown>>)
      : [];
  }

  /**
   * UPSERT dispatcher successes into the target wide table (#85
   * Phase 4). Each success contributes one target row keyed by
   * `source_id`. The success's `value` provides the per-row c_*
   * column payload.
   *
   * This SQL — like `runBatch` — is a Phase 4 scaffold; the smoke
   * test in slice 4 exercises it against a real wide table.
   */
  static async upsertSuccesses(
    opts: UpsertSuccessesOptions
  ): Promise<UpsertSuccessesResult> {
    if (opts.successes.length === 0) {
      return { rowsUpserted: 0, droppedKeys: [] };
    }
    const targetTable = quoteIdent(
      wideTableRepo.tableName(opts.targetConnectorEntityId)
    );
    const orgLit = `'${opts.organizationId.replace(/'/g, "''")}'`;
    const now = Date.now();

    // Dedupe successes by sourceKey, keeping the LAST occurrence.
    // PG's `ON CONFLICT DO UPDATE` rejects two rows with the same
    // conflict-target in one statement (error 21000). When the source
    // has duplicate keyField values — e.g., the NASA NEO entity where
    // a single asteroid can appear in multiple close-approach rows
    // sharing one `c_id` — the dispatcher produces multiple successes
    // for the same sourceKey. We collapse those before INSERT,
    // last-wins, and log the count so the agent knows.
    const dedupedMap = new Map<
      string,
      { sourceKey: string; value: Record<string, unknown> }
    >();
    for (const s of opts.successes) {
      dedupedMap.set(s.sourceKey, s);
    }
    const successes = Array.from(dedupedMap.values());
    const duplicatesCollapsed = opts.successes.length - successes.length;
    if (duplicatesCollapsed > 0) {
      logger.warn(
        {
          jobId: opts.jobId,
          duplicatesCollapsed,
          inputSuccesses: opts.successes.length,
          afterDedupe: successes.length,
        },
        "bulk_transform upsertSuccesses: duplicate keyField values in batch — collapsed, last-wins"
      );
    }

    // Collect the union of value-keys across the (deduped) batch —
    // that's the c_* column set we write. Tools that return varying
    // shapes get NULLs for missing columns (documented in spec § Risks).
    const colSet = new Set<string>();
    for (const s of successes) {
      for (const k of Object.keys(s.value)) colSet.add(k);
    }

    // Defense-in-depth against tool-output keys that don't exist on
    // the target wide table (#98). Without this filter, a single
    // mismatched key blows up the whole batch with PG 42703. The
    // proper fix is a pre-flight check in the tool; until that lands,
    // we drop unknown keys, log a warning, and surface the dropped
    // names back to the caller so the terminal job result can carry
    // them.
    const targetStmt = await wideTableStatementCache.get(
      opts.targetConnectorEntityId
    );
    const targetWideColumns = new Set(
      targetStmt.columns.map((c) => c.columnName)
    );
    // Per-column PG type — used to cast each VALUES literal to the
    // column's type in the wide-table INSERT (#99). Without the cast
    // PG sees a text literal and refuses to coerce it into a
    // numeric / boolean / timestamp / bigint / etc. column. The
    // SQL-kind path is the canonical victim: postgres.js returns PG
    // `numeric` columns as JS strings, those flow through
    // `valueLiteral` quoted, and the INSERT then fails 22P02.
    const pgTypeByColumn = new Map<string, string>();
    for (const c of targetStmt.columns) {
      pgTypeByColumn.set(c.columnName, c.pgType);
    }
    const droppedKeys: string[] = [];
    const cols: string[] = [];
    for (const k of colSet) {
      if (targetWideColumns.has(k)) {
        cols.push(k);
      } else {
        droppedKeys.push(k);
      }
    }
    if (droppedKeys.length > 0) {
      logger.warn(
        {
          jobId: opts.jobId,
          targetConnectorEntityId: opts.targetConnectorEntityId,
          droppedKeys,
          availableTargetColumns: Array.from(targetWideColumns).sort(),
        },
        "bulk_transform tool returned keys that aren't wide-columns on the target; dropped"
      );
    }

    // Edge case: every key was unknown. Skip the INSERT entirely —
    // nothing to write. The job still reports success at the dispatch
    // layer; the droppedKeys field surfaces the discrepancy.
    if (cols.length === 0) {
      return { rowsUpserted: 0, droppedKeys };
    }

    // Wide-table `entity_record_id` is a FK to `entity_records.id`,
    // so we can't just `gen_random_uuid()` for it. Mirror runBatch's
    // CTE pattern: upsert entity_records first (partial unique index
    // on (connector_entity_id, source_id) WHERE deleted IS NULL),
    // then upsert the wide table referencing the returned ids.
    const targetEntityIdLit = `'${opts.targetConnectorEntityId.replace(/'/g, "''")}'`;
    const userIdLit = `'${opts.userId.replace(/'/g, "''")}'`;

    const valueLiteral = (v: unknown): string => {
      if (v === null || v === undefined) return "NULL";
      if (typeof v === "number" || typeof v === "boolean") return String(v);
      // Objects and arrays serialize as JSON so they can land in
      // jsonb / text columns. Primitives (strings) pass through.
      // The per-column cast in the wide-table INSERT handles the
      // final coercion to the target type (numeric / text / jsonb).
      const serialized =
        typeof v === "string" ? v : JSON.stringify(v);
      return `'${serialized.replace(/'/g, "''")}'`;
    };

    // VALUES list for the input rows CTE: one row per success.
    const colAliases = ["src_id", ...cols.map((_, i) => `v_${i}`)];
    const valuesTuples = successes
      .map(
        (s) =>
          `(${valueLiteral(s.sourceKey)}, ${cols
            .map((c) => valueLiteral(s.value[c]))
            .join(", ")})`
      )
      .join(", ");

    const wideColList = [
      `"entity_record_id"`,
      `"organization_id"`,
      `"synced_at"`,
      `"is_valid"`,
      `"source_id"`,
      ...cols.map((c) => quoteIdent(c)),
    ].join(", ");

    const wideValueList = [
      `ur."id"`,
      `${orgLit}`,
      `${now}`,
      `true`,
      `ur."source_id"`,
      // Explicit per-column cast — `v_${i}` lives in the input_rows
      // VALUES CTE as a text literal; PG won't implicitly cast text
      // to numeric/bigint/boolean/timestamp/etc. on INSERT. Falls
      // back to `text` (no-op) when a column's pgType is unknown.
      ...cols.map(
        (c, i) =>
          `ir."v_${i}"::${pgTypeByColumn.get(c) ?? "text"}`
      ),
    ].join(", ");

    const setClause = cols
      .map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`)
      .concat([`"synced_at" = EXCLUDED."synced_at"`])
      .join(", ");

    const sqlText =
      `WITH input_rows(${colAliases.map((a) => `"${a}"`).join(", ")}) AS (` +
      `  VALUES ${valuesTuples}` +
      `), ` +
      `upserted_records AS (` +
      `  INSERT INTO "entity_records" (` +
      `    "id", "organization_id", "connector_entity_id", "data", "source_id", ` +
      `    "checksum", "synced_at", "origin", "is_valid", "created", "created_by"` +
      `  ) ` +
      `  SELECT ` +
      `    gen_random_uuid(), ` +
      `    ${orgLit}, ` +
      `    ${targetEntityIdLit}, ` +
      `    '{}'::jsonb, ` +
      `    "src_id"::text, ` +
      `    md5("src_id"::text || '|' || ${now}::text), ` +
      `    ${now}, ` +
      `    'portal'::entity_record_origin, ` +
      `    true, ` +
      `    ${now}, ` +
      `    ${userIdLit} ` +
      `  FROM input_rows ` +
      `  ON CONFLICT ("connector_entity_id", "source_id") WHERE "deleted" IS NULL DO UPDATE SET ` +
      `    "synced_at" = EXCLUDED."synced_at", ` +
      `    "updated" = EXCLUDED."created", ` +
      `    "updated_by" = EXCLUDED."created_by" ` +
      `  RETURNING "id", "source_id"` +
      `) ` +
      `INSERT INTO ${targetTable} (${wideColList}) ` +
      `SELECT ${wideValueList} ` +
      `FROM upserted_records ur ` +
      `JOIN input_rows ir ON ir."src_id"::text = ur."source_id" ` +
      `ON CONFLICT ("entity_record_id") DO UPDATE SET ${setClause}`;

    await db.execute(sql.raw(sqlText));
    return { rowsUpserted: successes.length, droppedKeys };
  }
}
