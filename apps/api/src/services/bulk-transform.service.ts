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
import { parseProjections } from "../utils/sql-projection.util.js";

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
    // conflict; synced_at always advances.
    const setClause = projections
      .map(
        (p) =>
          `${quoteIdent(p.alias)} = EXCLUDED.${quoteIdent(p.alias)}`
      )
      .concat([`"synced_at" = EXCLUDED."synced_at"`])
      .join(", ");

    const insertSql =
      `INSERT INTO ${targetTable} ` +
      `("entity_record_id", "organization_id", "synced_at", "is_valid", "source_id", ${aliasList}) ` +
      `SELECT ` +
      `  gen_random_uuid(), ` +
      `  ${orgLit}, ` +
      `  ${now}, ` +
      `  true, ` +
      `  ${keyCol}::text, ` +
      `  ${valueList} ` +
      `FROM ${sourceTable} ` +
      `WHERE "organization_id" = ${orgLit} ` +
      `ORDER BY "entity_record_id" ` +
      `LIMIT ${opts.batchSize} OFFSET ${opts.offset} ` +
      `ON CONFLICT ("source_id") DO UPDATE SET ${setClause} ` +
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
  ): Promise<number> {
    if (opts.successes.length === 0) return 0;
    const targetTable = quoteIdent(
      wideTableRepo.tableName(opts.targetConnectorEntityId)
    );
    const orgLit = `'${opts.organizationId.replace(/'/g, "''")}'`;
    const now = Date.now();

    // Collect the union of value-keys across the batch — that's the
    // c_* column set we write. Tools that return varying shapes get
    // NULLs for missing columns (documented in spec § Risks).
    const colSet = new Set<string>();
    for (const s of opts.successes) {
      for (const k of Object.keys(s.value)) colSet.add(k);
    }
    const cols = Array.from(colSet);

    const colList = [
      `"entity_record_id"`,
      `"organization_id"`,
      `"synced_at"`,
      `"is_valid"`,
      `"source_id"`,
      ...cols.map((c) => quoteIdent(c)),
    ].join(", ");

    const valueLiteral = (v: unknown): string => {
      if (v === null || v === undefined) return "NULL";
      if (typeof v === "number" || typeof v === "boolean") return String(v);
      return `'${String(v).replace(/'/g, "''")}'`;
    };

    const valuesSql = opts.successes
      .map(
        (s) =>
          `(gen_random_uuid(), ${orgLit}, ${now}, true, ` +
          `${valueLiteral(s.sourceKey)}, ${cols
            .map((c) => valueLiteral(s.value[c]))
            .join(", ")})`
      )
      .join(", ");

    const setClause = cols
      .map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`)
      .concat([`"synced_at" = EXCLUDED."synced_at"`])
      .join(", ");

    const sqlText =
      `INSERT INTO ${targetTable} (${colList}) ` +
      `VALUES ${valuesSql} ` +
      `ON CONFLICT ("source_id") DO UPDATE SET ${setClause}`;

    await db.execute(sql.raw(sqlText));
    return opts.successes.length;
  }
}
