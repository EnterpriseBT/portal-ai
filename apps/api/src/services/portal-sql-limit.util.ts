/**
 * Implicit-LIMIT wrap for LLM-supplied portal SQL.
 *
 * If the AST is a single `SELECT` without an explicit `LIMIT` and
 * without a top-level aggregation, wrap the query in
 * `SELECT * FROM (<llm>) _q LIMIT <cap + 1>`. The `+1` lets the
 * downstream envelope detect "more rows existed than the cap" honestly.
 *
 * Parser failures fall through with `appliedLimit: null` — the caller
 * still gets the row-cap protection at envelope time.
 */

import { parsePortalSql } from "./portal-sql-parse.util.js";
import { fenceSql } from "./portal-sql-validation.util.js";

export interface ImplicitLimitResult {
  /** Wrapped SQL (or the original if no wrap was needed). */
  sql: string;
  /**
   * The limit actually applied by this wrap (`cap + 1`) or `null` if
   * the query was passed through unchanged (parser failure or
   * already-limited / aggregated input).
   */
  appliedLimit: number | null;
}

export function applyImplicitLimit(
  sql: string,
  rowCap: number
): ImplicitLimitResult {
  try {
    const parsed = parsePortalSql(sql);
    if (parsed.statementType !== "SelectStmt" || !parsed.needsImplicitLimit) {
      return { sql, appliedLimit: null };
    }
    const limit = rowCap + 1;
    return {
      sql: `SELECT * FROM (${fenceSql(sql)}) _q LIMIT ${limit}`,
      appliedLimit: limit,
    };
  } catch {
    return { sql, appliedLimit: null };
  }
}
