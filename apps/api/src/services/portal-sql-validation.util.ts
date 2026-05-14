/**
 * Static deny-list validator for LLM-supplied SQL.
 *
 * The portal's `sql_query` tool feeds this validator before any
 * statement reaches Postgres. The check is a three-stage pipeline:
 *
 *   1. Strip comments (line-by-line state machine over `--` and block
 *      comments). Stripping happens first so a reserved verb inside a
 *      `/_* … *_/` comment is not deny-listed by the regex sweep below.
 *   2. Scan for `;` outside string literals → reject as multi-statement.
 *   3. Run the reserved-verb / system-catalog regex sweep over the
 *      stripped text.
 *
 * The deny-list is intentionally aggressive — every DML / DDL verb,
 * every server-side side-effect verb, every `pg_*` / `information_schema`
 * reference, every set-/get-config-style verb. Callers run the cleaned
 * SQL inside a `READ ONLY` transaction with `statement_timeout` set;
 * the validator is the first wall, the transaction-level guard is the
 * belt-and-suspenders.
 *
 * Throws `ApiError(PORTAL_SQL_FORBIDDEN, …)` on violation with the
 * offending construct in the message so the LLM can self-correct.
 */

// node-sql-parser is CommonJS — pull the class off the default export so
// the import works under both ESM (tests) and the bundled tsx runtime.
import nodeSqlParser from "node-sql-parser";

import { ApiCode } from "../constants/api-codes.constants.js";
import { ApiError } from "./http.service.js";

const { Parser } = nodeSqlParser as unknown as {
  Parser: typeof import("node-sql-parser").Parser;
};

export interface PortalSqlValidationResult {
  /** Comment-free, multi-statement-rejected, deny-list-passed SQL. */
  cleaned: string;
  /**
   * True iff the parsed AST is a single `SELECT` with neither an
   * explicit `LIMIT` nor a top-level aggregation in the projection.
   * Callers wrap such queries in `SELECT * FROM (…) LIMIT <cap>` so an
   * unconstrained scan can't blow past the response envelope.
   *
   * Parser failure on otherwise-valid SQL flips this to `true` so the
   * caller still applies the cap — a parser bug should not let an
   * unbounded scan through.
   */
  needsImplicitLimit: boolean;
}

const RESERVED_VERBS = new RegExp(
  "\\b(" +
    [
      "INSERT",
      "UPDATE",
      "DELETE",
      "MERGE",
      "UPSERT",
      "REPLACE",
      "TRUNCATE",
      "ALTER",
      "CREATE",
      "DROP",
      "GRANT",
      "REVOKE",
      "VACUUM",
      "ANALYZE",
      "CLUSTER",
      "REINDEX",
      "LOCK",
      "COPY",
      "LISTEN",
      "NOTIFY",
      "UNLISTEN",
      "CALL",
      "DO",
      "SET",
      "RESET",
      "EXPLAIN",
      "BEGIN",
      "COMMIT",
      "ROLLBACK",
      "SAVEPOINT",
      "RELEASE",
      "PREPARE",
      "EXECUTE",
      "DEALLOCATE",
      "REFRESH",
      "IMPORT",
      "FETCH",
      "CLOSE",
      "DECLARE",
    ].join("|") +
    ")\\b",
  "i"
);

const SYSTEM_CATALOG = new RegExp(
  "\\b(" +
    [
      "pg_catalog",
      "pg_toast",
      "pg_temp",
      "pg_class",
      "pg_attribute",
      "pg_namespace",
      "pg_proc",
      "pg_stats",
      "pg_locks",
      "pg_settings",
      "pg_user",
      "pg_database",
      "pg_tablespace",
      "pg_stat",
      "pg_index",
      "pg_operator",
      "pg_trigger",
      "pg_inherits",
      "pg_policies",
      "pg_policy",
      "pg_publication",
      "pg_subscription",
      "pg_sequences",
      "pg_tables",
      "pg_views",
      "pg_matviews",
      "pg_partitioned_table",
      "pg_authid",
      "pg_roles",
      "information_schema",
    ].join("|") +
    ")\\b",
  "i"
);

const SIDE_EFFECT_FUNCTIONS = /\b(pg_|lo_|dblink|query_to_)/i;

const parser = new Parser();

export function validatePortalSql(sql: string): PortalSqlValidationResult {
  const cleaned = stripComments(sql);
  assertNoMultiStatement(cleaned);

  // Mask string literals out of the regex-scan input so a reserved
  // verb / catalog name *inside* a literal doesn't trip the deny-list.
  // The cleaned SQL still goes to Postgres as-is.
  const scanInput = maskStringLiterals(cleaned);

  const reserved = RESERVED_VERBS.exec(scanInput);
  if (reserved) {
    throw new ApiError(
      400,
      ApiCode.PORTAL_SQL_FORBIDDEN,
      `reserved verb: ${reserved[1]!.toUpperCase()}`
    );
  }
  const sysCat = SYSTEM_CATALOG.exec(scanInput);
  if (sysCat) {
    throw new ApiError(
      400,
      ApiCode.PORTAL_SQL_FORBIDDEN,
      `system catalog access: ${sysCat[1]!.toLowerCase()}`
    );
  }
  if (SIDE_EFFECT_FUNCTIONS.test(scanInput)) {
    throw new ApiError(
      400,
      ApiCode.PORTAL_SQL_FORBIDDEN,
      "side-effect function call (pg_*, lo_*, dblink*, query_to_*) not allowed"
    );
  }

  const needsImplicitLimit = computeNeedsImplicitLimit(cleaned);
  return { cleaned, needsImplicitLimit };
}

/**
 * Replace the contents of every string literal in `input` with spaces
 * (preserving the quotes themselves) so a downstream regex scan can't
 * match a reserved verb / catalog name embedded in a literal. The
 * positions of every other character are preserved so error messages
 * (which point at offsets) stay correct.
 */
function maskStringLiterals(input: string): string {
  const out: string[] = [];
  let i = 0;
  const len = input.length;
  while (i < len) {
    const ch = input[i]!;
    if (ch === "'" || ch === '"') {
      out.push(ch);
      const quote = ch;
      i++;
      while (i < len) {
        if (input[i] === quote) {
          // Doubled quote inside a literal — same quote escaping rule.
          if (i + 1 < len && input[i + 1] === quote) {
            out.push(" ", " ");
            i += 2;
            continue;
          }
          out.push(quote);
          i++;
          break;
        }
        out.push(" ");
        i++;
      }
      continue;
    }
    out.push(ch);
    i++;
  }
  return out.join("");
}

/**
 * Strip `--` line comments and block comments from the input.
 * Stops if a block comment is unterminated or a stray close-marker
 * appears, raising `PORTAL_SQL_FORBIDDEN` so the caller doesn't proceed.
 */
function stripComments(input: string): string {
  let out = "";
  let i = 0;
  const len = input.length;
  while (i < len) {
    const ch = input[i]!;
    const next = i + 1 < len ? input[i + 1]! : "";

    // String literals — pass through untouched so a `--` or `;` inside
    // `'…'` isn't mistaken for a comment / statement separator.
    if (ch === "'" || ch === '"') {
      const quote = ch;
      out += ch;
      i++;
      while (i < len) {
        const c2 = input[i]!;
        out += c2;
        if (c2 === quote) {
          // SQL escapes a quote by doubling it (e.g. '' inside '...').
          if (i + 1 < len && input[i + 1] === quote) {
            out += input[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (ch === "-" && next === "-") {
      // Line comment — consume to next \n.
      while (i < len && input[i] !== "\n") i++;
      // Preserve the newline so downstream regex word-boundaries stay
      // intact across statements that should still be one statement.
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      let closed = false;
      while (i < len) {
        if (input[i] === "*" && input[i + 1] === "/") {
          closed = true;
          i += 2;
          break;
        }
        i++;
      }
      if (!closed) {
        throw new ApiError(
          400,
          ApiCode.PORTAL_SQL_FORBIDDEN,
          "unbalanced comment"
        );
      }
      // Replace the comment block with a single space so adjacent
      // tokens don't get glued together (`SELECT/**/1` → `SELECT 1`).
      out += " ";
      continue;
    }
    if (ch === "*" && next === "/") {
      throw new ApiError(
        400,
        ApiCode.PORTAL_SQL_FORBIDDEN,
        "unbalanced comment"
      );
    }
    out += ch;
    i++;
  }
  return out;
}

function assertNoMultiStatement(input: string): void {
  let i = 0;
  const len = input.length;
  while (i < len) {
    const ch = input[i]!;
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      let closed = false;
      while (i < len) {
        if (input[i] === quote) {
          // Doubled-quote escape: `''` or `""` inside the literal.
          if (i + 1 < len && input[i + 1] === quote) {
            i += 2;
            continue;
          }
          closed = true;
          i++;
          break;
        }
        i++;
      }
      if (!closed) {
        throw new ApiError(
          400,
          ApiCode.PORTAL_SQL_FORBIDDEN,
          "unbalanced string literal"
        );
      }
      continue;
    }
    if (ch === ";") {
      // Trailing semicolons would be fine, but the LLM consistently
      // omits them; any `;` is treated as a multi-statement attempt.
      // Skip trailing whitespace-only tail before flagging.
      const rest = input.slice(i + 1).trim();
      if (rest.length > 0) {
        throw new ApiError(
          400,
          ApiCode.PORTAL_SQL_FORBIDDEN,
          "multi-statement input"
        );
      }
      return;
    }
    i++;
  }
}

function computeNeedsImplicitLimit(sql: string): boolean {
  try {
    const ast = parser.astify(sql, { database: "postgresql" });
    const node = Array.isArray(ast) ? ast[0] : ast;
    if (!node || (node as { type?: string }).type !== "select") return true;
    const select = node as {
      type: "select";
      limit?: { value?: unknown[] } | null;
      columns?: unknown;
    };
    if (
      select.limit &&
      Array.isArray(select.limit.value) &&
      select.limit.value.length > 0
    ) {
      return false;
    }
    const cols = (select.columns ?? []) as Array<{
      expr?: { type?: string };
    }>;
    if (!Array.isArray(cols)) return true;
    const hasTopAgg = cols.some((c) => c.expr?.type === "aggr_func");
    return !hasTopAgg;
  } catch {
    // Parser hiccups should not let an unbounded scan through; default
    // to wrapping the query with the implicit LIMIT.
    return true;
  }
}
