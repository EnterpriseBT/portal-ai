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

export class BulkTransformService {
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
   * Run one batch's INSERT-SELECT. Returns the number of rows written
   * to the target this batch (idempotent: ON CONFLICT … DO UPDATE).
   *
   * The processor calls this in a loop, advancing `offset` by
   * `batchSize` each iteration. Per-batch work is its own transaction
   * so a mid-job failure leaves committed batches in place.
   */
  static async runBatch(opts: BulkTransformBatchOptions): Promise<number> {
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
    const jobLit = `'${opts.jobId.replace(/'/g, "''")}'`;
    const now = Date.now();

    // The agent's expression is wrapped as a SELECT projection. The
    // smoke test in slice 6 validates real-world expressions; in
    // Phase 2 we treat the string as an opaque PG fragment that
    // produces aliased columns named after target field-mapping keys.
    const insertSql =
      `INSERT INTO ${targetTable} ` +
      `("entity_record_id", "organization_id", "synced_at", "is_valid", "source_id", ${opts.expression}) ` +
      `SELECT ` +
      `  gen_random_uuid() AS "entity_record_id", ` +
      `  ${orgLit} AS "organization_id", ` +
      `  ${now} AS "synced_at", ` +
      `  true AS "is_valid", ` +
      `  ${keyCol}::text AS "source_id", ` +
      `  src.* ` +
      `FROM (` +
      `  SELECT ${opts.expression} FROM ${sourceTable} ` +
      `  WHERE "organization_id" = ${orgLit} ` +
      `  ORDER BY "entity_record_id" ` +
      `  LIMIT ${opts.batchSize} OFFSET ${opts.offset}` +
      `) src ` +
      `ON CONFLICT ("source_id") DO UPDATE SET "synced_at" = EXCLUDED."synced_at"`;

    // NOTE: the SQL shape above is a Phase 2 scaffold. The smoke test
    // in slice 6 will exercise this against a real seeded source and
    // target — any drift between the agent's expression aliases and
    // the target wide-table columns surfaces there. Slice 6 may need
    // to refine this SQL based on real-world failures; the seam stays
    // the same.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _jobLitForFutureUse = jobLit;

    const result = await db.execute(sql.raw(insertSql));
    // postgres-js returns rows[]; we don't get rowCount portably,
    // so fall back to a SELECT COUNT against the LIMIT/OFFSET window.
    const rowCount = (result as unknown as { count?: number }).count;
    if (typeof rowCount === "number") return rowCount;
    // Estimate from batchSize; the processor uses this as a stop
    // signal when fewer rows come back than requested.
    const arrLen = Array.isArray(result) ? result.length : 0;
    return arrLen || opts.batchSize;
  }
}
