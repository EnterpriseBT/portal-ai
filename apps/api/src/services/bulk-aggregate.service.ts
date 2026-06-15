/**
 * SQL execution layer for the bulk_aggregate job processor (#100).
 *
 * bulk_aggregate reduces N source records to a single value via ONE SQL
 * aggregate. Unlike bulk_transform there is no per-record loop, no
 * target write, and no lock — the source is scanned read-only. The
 * processor (`bulk-aggregate.processor.ts`) wraps these methods as a
 * job so the heavy scan runs off the API request thread, under a
 * `statement_timeout`, and is auditable.
 *
 * SQL-only by design — see `docs/BULK_AGGREGATE.discovery.md` Decision 1
 * (`fold_tool` rejected on tool-purity grounds). The execution mirrors
 * `portal-sql.service.ts`'s READ ONLY + `statement_timeout` pattern and
 * `bulk-transform.service.ts`'s EXPLAIN pre-flight + org-scope guard.
 */

import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { wideTableRepo } from "../db/repositories/wide-table.repository.js";
import { ApiError } from "./http.service.js";
import { ApiCode, ApiCodeDefaultRecommendation } from "../constants/api-codes.constants.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "bulk-aggregate-service" });

/** Alias the COUNT(*) is projected under so `recordsProcessed` can be
 *  derived from the same one-shot query. Stripped out of `result`
 *  before persistence so the envelope carries only the agent's
 *  aggregate. */
export const RECORDS_PROCESSED_ALIAS = "__records_processed";

/** Wall-clock cap on the aggregate scan. Larger than interactive
 *  `sql_query`'s 30s because this is the async/large-dataset path; it
 *  also bounds the tool's inline await (slice 3). */
export const BULK_AGGREGATE_STATEMENT_TIMEOUT = "120s";

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export interface BulkAggregateSqlOptions {
  sourceConnectorEntityId: string;
  organizationId: string;
  /** SQL aggregate projection, e.g. "SUM(c_area) AS total, AVG(c_age) AS
   *  avg_age". Spliced verbatim after EXPLAIN validation. */
  expression: string;
  /** Optional source-side WHERE fragment, injected as ` AND (<frag>)`. */
  whereSqlFragment?: string;
}

/**
 * Assemble the one-shot aggregate SELECT. Pure (no I/O) so it can be
 * unit-tested without a database. The COUNT(*) rides along so the
 * scanned-row count comes from the same scan.
 */
export function buildAggregateSql(opts: BulkAggregateSqlOptions): string {
  const sourceTable = quoteIdent(
    wideTableRepo.tableName(opts.sourceConnectorEntityId)
  );
  const orgLit = `'${opts.organizationId.replace(/'/g, "''")}'`;
  const filterClause = opts.whereSqlFragment
    ? ` AND (${opts.whereSqlFragment})`
    : "";
  return (
    `SELECT ${opts.expression}, COUNT(*) AS ${RECORDS_PROCESSED_ALIAS} ` +
    `FROM ${sourceTable} ` +
    `WHERE "organization_id" = ${orgLit}${filterClause}`
  );
}

/** EXPLAIN wrapper over the same query the processor will run. */
export function buildExplainSql(opts: BulkAggregateSqlOptions): string {
  return `EXPLAIN ${buildAggregateSql(opts)}`;
}

/**
 * True when a thrown error is Postgres' statement-timeout / query-cancel
 * (SQLSTATE 57014). Checks the error and its `cause` chain plus the
 * canonical message text so it works across pg / drizzle wrapping.
 */
export function isStatementTimeoutError(err: unknown): boolean {
  const codes: Array<string | undefined> = [
    (err as { code?: string })?.code,
    (err as { cause?: { code?: string } })?.cause?.code,
  ];
  if (codes.includes("57014")) return true;
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return /statement timeout|canceling statement due to/i.test(message);
}

export class BulkAggregateService {
  /**
   * Pre-flight: EXPLAIN the aggregate query so PG syntax / type / unknown
   * column errors surface as a typed throw before the job is enqueued.
   */
  static async explainExpression(opts: BulkAggregateSqlOptions): Promise<void> {
    try {
      await db.execute(sql.raw(buildExplainSql(opts)));
    } catch (err) {
      const pgError = err instanceof Error ? err.message : String(err);
      logger.info({ pgError }, "bulk_aggregate expression failed EXPLAIN");
      throw new ApiError(
        400,
        ApiCode.BULK_AGGREGATE_EXPRESSION_INVALID,
        "The aggregate expression is not valid SQL against the source.",
        {
          recommendation:
            ApiCodeDefaultRecommendation[
              ApiCode.BULK_AGGREGATE_EXPRESSION_INVALID
            ],
          details: { pgError },
        }
      );
    }
  }

  /**
   * Run the aggregate in a READ ONLY transaction with a
   * `statement_timeout`. Returns the computed value (the projection's
   * columns, an object keyed by the agent's aliases) plus the scanned
   * row count derived from the injected COUNT(*).
   */
  static async runAggregate(
    opts: BulkAggregateSqlOptions
  ): Promise<{ result: unknown; recordsProcessed: number }> {
    try {
      return await db.transaction(async (tx) => {
        await tx.execute(
          sql.raw(
            `SET LOCAL statement_timeout = '${BULK_AGGREGATE_STATEMENT_TIMEOUT}'`
          )
        );
        await tx.execute(sql.raw("SET LOCAL transaction_read_only = on"));

        const res = await tx.execute(sql.raw(buildAggregateSql(opts)));
        const rows = Array.isArray(res)
          ? (res as unknown as Array<Record<string, unknown>>)
          : [];
        const row = rows[0] ?? {};
        const recordsProcessed = Number(row[RECORDS_PROCESSED_ALIAS] ?? 0);
        const { [RECORDS_PROCESSED_ALIAS]: _omit, ...result } = row;
        return { result, recordsProcessed };
      });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (isStatementTimeoutError(err)) {
        throw new ApiError(
          400,
          ApiCode.BULK_AGGREGATE_TIMEOUT,
          `The aggregate exceeded the ${BULK_AGGREGATE_STATEMENT_TIMEOUT} statement timeout.`,
          {
            recommendation:
              ApiCodeDefaultRecommendation[ApiCode.BULK_AGGREGATE_TIMEOUT],
          }
        );
      }
      throw err;
    }
  }
}
