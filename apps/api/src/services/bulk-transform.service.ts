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
import { parseProjections } from "../utils/sql-projection.util.js";
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
   * Run one batch's INSERT-SELECT. Returns the committed-row count AND
   * the row data (via INSERT ... RETURNING), so the processor can
   * include the rows in its per-batch SSE event.
   *
   * The processor calls this in a loop, advancing `offset` by
   * `batchSize` each iteration. Per-batch work is its own transaction
   * so a mid-job failure leaves committed batches in place.
   */
  static async runBatch(
    opts: BulkTransformBatchOptions
  ): Promise<{ rowsCommitted: number; rows: Array<Record<string, unknown>> }> {
    const sourceTable = quoteIdent(
      wideTableRepo.tableName(opts.sourceConnectorEntityId)
    );
    const targetTable = quoteIdent(
      wideTableRepo.tableName(opts.targetConnectorEntityId)
    );

    // Build the per-row source_id (upsert key on the target). The
    // agent supplies `keyField` as the wide-column name on the source;
    // we pass its value through to the target's `source_id` so
    // subsequent re-runs of the same job idempotently UPDATE.
    const keyCol = quoteIdent(opts.keyField);
    const orgLit = `'${opts.organizationId.replace(/'/g, "''")}'`;
    const now = Date.now();

    // Split the agent's projection into `{ value, alias }` pairs so
    // the INSERT column list gets the alias *names* (PG won't parse
    // expressions there) and the SELECT row gets the *values*. The
    // pre-flight EXPLAIN already validated each value as a legal PG
    // expression — here we just slice the string.
    const projections = parseProjections(opts.expression);
    const aliasList = projections
      .map((p) => quoteIdent(p.alias))
      .join(", ");
    const valueList = projections.map((p) => p.value).join(", ");

    // SET clause for the upsert: every derived column refreshes on
    // conflict; synced_at always advances. The wide-table conflict
    // target is `entity_record_id` (the PK) because the entity_records
    // CTE returns the existing record id on its own conflict, so the
    // wide-table INSERT references an already-present PK on re-runs.
    const setClause = projections
      .map(
        (p) =>
          `${quoteIdent(p.alias)} = EXCLUDED.${quoteIdent(p.alias)}`
      )
      .concat([`"synced_at" = EXCLUDED."synced_at"`])
      .join(", ");

    const targetEntityIdLit = `'${opts.targetConnectorEntityId.replace(/'/g, "''")}'`;
    const userIdLit = `'${opts.userId.replace(/'/g, "''")}'`;

    // The wide table's `entity_record_id` is a FK to entity_records.id,
    // so we can't just gen_random_uuid() for it — entity_records must
    // exist first. Do both in a single CTE-chained statement so the
    // batch is atomic:
    //   1. Read the batch window of source rows.
    //   2. Upsert one entity_records row per source row (keyed by
    //      (connector_entity_id, source_id) per the partial unique
    //      index that ignores soft-deleted rows). RETURNING the
    //      resulting id+source_id, whether inserted or updated.
    //   3. Upsert the wide-table row referencing the entity_record_id
    //      from step 2 + the derived columns from the source batch.
    // `batch_deduped` is the last-wins dedupe of `batch` by keyField.
    // Without it, PG's ON CONFLICT DO UPDATE on the target wide table
    // throws 21000 when the source has duplicate keyField values
    // (e.g., NASA NEO entities where one asteroid `c_id` repeats
    // across multiple close-approach dates).
    const insertSql =
      `WITH batch AS (` +
      `  SELECT * FROM ${sourceTable} ` +
      `  WHERE "organization_id" = ${orgLit} ` +
      `  ORDER BY "entity_record_id" ` +
      `  LIMIT ${opts.batchSize} OFFSET ${opts.offset}` +
      `), ` +
      `batch_deduped AS (` +
      `  SELECT DISTINCT ON (${keyCol}) * FROM batch ` +
      `  ORDER BY ${keyCol}, "entity_record_id" DESC` +
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
      `    ${keyCol}::text, ` +
      `    md5(${keyCol}::text || '|' || ${now}::text), ` +
      `    ${now}, ` +
      `    'portal'::entity_record_origin, ` +
      `    true, ` +
      `    ${now}, ` +
      `    ${userIdLit} ` +
      `  FROM batch_deduped ` +
      `  ON CONFLICT ("connector_entity_id", "source_id") WHERE "deleted" IS NULL DO UPDATE SET ` +
      `    "synced_at" = EXCLUDED."synced_at", ` +
      `    "updated" = EXCLUDED."created", ` +
      `    "updated_by" = EXCLUDED."created_by" ` +
      `  RETURNING "id", "source_id"` +
      `) ` +
      `INSERT INTO ${targetTable} ` +
      `("entity_record_id", "organization_id", "synced_at", "is_valid", "source_id", ${aliasList}) ` +
      `SELECT ` +
      `  ur."id", ` +
      `  ${orgLit}, ` +
      `  ${now}, ` +
      `  true, ` +
      `  ur."source_id", ` +
      `  ${valueList} ` +
      `FROM upserted_records ur ` +
      `JOIN batch_deduped b ON b.${keyCol}::text = ur."source_id" ` +
      `ON CONFLICT ("entity_record_id") DO UPDATE SET ${setClause} ` +
      `RETURNING *`;

    const result = await db.execute(sql.raw(insertSql));
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
      return `'${String(v).replace(/'/g, "''")}'`;
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
      ...cols.map((_c, i) => `ir."v_${i}"`),
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
