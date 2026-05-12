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

import nodeSqlParser from "node-sql-parser";

const { Parser } = nodeSqlParser as unknown as {
  Parser: typeof import("node-sql-parser").Parser;
};
const parser = new Parser();

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
    const ast = parser.astify(sql, { database: "postgresql" });
    const node = Array.isArray(ast) ? ast[0] : ast;
    if (!node || (node as { type?: string }).type !== "select") {
      return { sql, appliedLimit: null };
    }
    const select = node as {
      limit?: { value?: unknown[] } | null;
      columns?: unknown;
    };
    // node-sql-parser emits `limit: {seperator: "", value: []}` for
    // queries without a LIMIT clause — only treat a non-empty value
    // array as "already has a LIMIT".
    if (
      select.limit &&
      Array.isArray(select.limit.value) &&
      select.limit.value.length > 0
    ) {
      return { sql, appliedLimit: null };
    }
    const cols = (select.columns ?? []) as Array<{
      expr?: { type?: string };
    }>;
    if (Array.isArray(cols) && cols.some((c) => c.expr?.type === "aggr_func")) {
      return { sql, appliedLimit: null };
    }
    const limit = rowCap + 1;
    return {
      sql: `SELECT * FROM (${sql}) _q LIMIT ${limit}`,
      appliedLimit: limit,
    };
  } catch {
    return { sql, appliedLimit: null };
  }
}
