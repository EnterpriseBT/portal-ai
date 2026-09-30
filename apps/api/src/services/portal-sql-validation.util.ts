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

import { ApiCode } from "../constants/api-codes.constants.js";
import { ApiError } from "./http.service.js";
import {
  parsePortalSql,
  type ParsedPortalSql,
} from "./portal-sql-parse.util.js";

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
  /** #660: every relation the statement references (by relname, CTE names
   *  excluded) — checked against the session's allowed relations once the
   *  views are resolved. Empty when the statement doesn't parse. */
  relations: ReadonlySet<string>;
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

  // #660: the AST gate — Postgres's own grammar decides what the statement
  // actually does, so quoted identifiers and new syntax can't slip past the
  // regex pre-filter above. Fail closed: a statement that doesn't parse is
  // rejected (Postgres would reject it too).
  const parsed = parsePortalSql(cleaned);
  assertAllowedShape(parsed);
  return {
    cleaned,
    needsImplicitLimit: parsed.needsImplicitLimit,
    relations: parsed.relations,
  };
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

/**
 * #660: the functions agent SQL may call. Everything else is rejected by name,
 * so a missing legitimate function is a one-line, reviewed addition (with a
 * test). PostGIS `st_*` is allowed as a family (`postgis_*` admin/introspection
 * functions are not). Schema-qualified calls are rejected outright.
 */
export const PORTAL_SQL_ALLOWED_FUNCTIONS: ReadonlySet<string> = new Set([
  // aggregates
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "stddev",
  "stddev_samp",
  "stddev_pop",
  "variance",
  "var_samp",
  "var_pop",
  "mode",
  "percentile_cont",
  "percentile_disc",
  "corr",
  "covar_samp",
  "covar_pop",
  "regr_slope",
  "regr_intercept",
  "regr_r2",
  "regr_count",
  "regr_avgx",
  "regr_avgy",
  "regr_sxx",
  "regr_syy",
  "regr_sxy",
  "array_agg",
  "string_agg",
  "json_agg",
  "jsonb_agg",
  "json_object_agg",
  "jsonb_object_agg",
  "bool_and",
  "bool_or",
  "every",
  // math
  "abs",
  "round",
  "ceil",
  "ceiling",
  "floor",
  "trunc",
  "power",
  "sqrt",
  "cbrt",
  "exp",
  "ln",
  "log",
  "log10",
  "mod",
  "sign",
  "greatest",
  "least",
  "width_bucket",
  "random",
  "pi",
  "degrees",
  "radians",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  // text
  "lower",
  "upper",
  "initcap",
  "length",
  "char_length",
  "substring",
  "substr",
  "left",
  "right",
  "trim",
  "btrim",
  "ltrim",
  "rtrim",
  "lpad",
  "rpad",
  "replace",
  "translate",
  "concat",
  "concat_ws",
  "split_part",
  "position",
  "strpos",
  "starts_with",
  "regexp_replace",
  "regexp_match",
  "regexp_matches",
  "regexp_split_to_array",
  "format",
  "to_char",
  "md5",
  "reverse",
  "repeat",
  // date / time
  "now",
  "date_trunc",
  "date_part",
  "extract",
  "age",
  "to_timestamp",
  "to_date",
  "make_date",
  "make_timestamp",
  "make_interval",
  "justify_interval",
  // window
  "row_number",
  "rank",
  "dense_rank",
  "percent_rank",
  "cume_dist",
  "ntile",
  "lag",
  "lead",
  "first_value",
  "last_value",
  "nth_value",
  // JSON
  "json_build_object",
  "jsonb_build_object",
  "json_build_array",
  "jsonb_build_array",
  "to_json",
  "to_jsonb",
  "row_to_json",
  "json_extract_path_text",
  "jsonb_extract_path_text",
  "jsonb_array_length",
  "json_array_length",
  "jsonb_typeof",
  "json_typeof",
  "jsonb_array_elements",
  "jsonb_array_elements_text",
  "json_array_elements",
  "jsonb_each",
  "jsonb_object_keys",
  // arrays / sets / misc
  "array_length",
  "cardinality",
  "unnest",
  "array_to_string",
  "string_to_array",
  "generate_series",
  "num_nulls",
  "num_nonnulls",
  "gen_random_uuid",
]);

const isAllowedFunction = (name: string) =>
  PORTAL_SQL_ALLOWED_FUNCTIONS.has(name) ||
  (/^st_[a-z0-9_]+$/.test(name) && !name.startsWith("postgis_"));

function forbidden(message: string): ApiError {
  return new ApiError(400, ApiCode.PORTAL_SQL_FORBIDDEN, message);
}

/** #660: a single plain SELECT, no schema-qualified relation or function, and
 *  only allowlisted functions. Relations themselves are checked against the
 *  session's views once they are resolved ({@link assertRelationsAllowed}). */
function assertAllowedShape(parsed: ParsedPortalSql): void {
  if (parsed.statementType !== "SelectStmt") {
    throw forbidden(`statement not allowed: ${parsed.statementType}`);
  }
  if (parsed.intoOrLocking) {
    throw forbidden("SELECT INTO / FOR UPDATE not allowed");
  }
  const [qualified] = parsed.qualifiedRelations;
  if (qualified) {
    throw forbidden(`schema-qualified relation not allowed: ${qualified}`);
  }
  for (const fn of parsed.functions) {
    if (fn.includes(".")) {
      throw forbidden(`schema-qualified function not allowed: ${fn}`);
    }
    if (!isAllowedFunction(fn)) {
      throw forbidden(`function not allowed: ${fn}`);
    }
  }
}
