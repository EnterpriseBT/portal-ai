/**
 * The single SQL parser for the agent SQL surface (#660): `libpg-query`, i.e.
 * Postgres 17's own grammar compiled to WASM. Using the server's parser means
 * what we inspect is exactly what Postgres will execute — the regex-only gate
 * it replaces missed quoted identifiers (`"pg_catalog"."pg_roles"`) because a
 * regex can only approximate the grammar.
 *
 * `parsePortalSql` reports every relation and function a statement references,
 * wherever it appears (FROM, JOIN, LATERAL, sub-selects, CTE bodies, set
 * operations), via a generic walk over the AST — a new syntax position cannot
 * hide a `RangeVar` / `FuncCall`. CTE names are resolved **by scope**, as
 * Postgres does: a non-recursive CTE body sees only the CTEs before it, so a
 * reference to a later sibling's name (or any name outside its WITH) is a real
 * relation and is reported.
 */
import { loadModule, parseSync } from "libpg-query";

import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";

// One-time WASM initialisation (ESM top-level await): every importer — the
// API process and the job workers — gets a ready parser.
await loadModule();

/** Aggregates whose presence as a top-level projection (not a window call)
 *  means the result is bounded and needs no implicit LIMIT. */
const AGGREGATE_FUNCTIONS = new Set([
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
  "array_agg",
  "string_agg",
  "json_agg",
  "jsonb_agg",
  "json_object_agg",
  "jsonb_object_agg",
  "bool_and",
  "bool_or",
  "every",
  "bit_and",
  "bit_or",
  "mode",
  "percentile_cont",
  "percentile_disc",
  "corr",
  "covar_samp",
  "covar_pop",
]);
const isAggregate = (name: string) =>
  AGGREGATE_FUNCTIONS.has(name) || name.startsWith("regr_");

type Node = Record<string, unknown>;

export interface ParsedPortalSql {
  /** The single top-level statement node (e.g. `{ SelectStmt: … }`). */
  statement: Node;
  /** Name of the top-level statement's node type (`SelectStmt`, …). */
  statementType: string;
  /** Every relation referenced (unqualified relname), excluding in-scope CTE names. */
  relations: ReadonlySet<string>;
  /** `schema.relname` for every schema- (or catalog-) qualified relation. */
  qualifiedRelations: ReadonlyArray<string>;
  /** Every function called, lower-cased, as `name` or `schema.name`. */
  functions: ReadonlySet<string>;
  /** Top-level SELECT with no LIMIT and no top-level (non-window) aggregate. */
  needsImplicitLimit: boolean;
}

const str = (n: unknown): string =>
  ((n as { String?: { sval?: string } })?.String?.sval ?? "").toString();

function cteNames(withClause: unknown): string[] {
  const ctes = (withClause as { ctes?: unknown[] } | undefined)?.ctes ?? [];
  return ctes.map(
    (c) =>
      (c as { CommonTableExpr?: { ctename?: string } }).CommonTableExpr
        ?.ctename ?? ""
  );
}

interface Collector {
  relations: Set<string>;
  qualified: string[];
  functions: Set<string>;
}

/** Walk `node`, reporting relations/functions; `scope` = CTE names visible here. */
function walk(node: unknown, scope: ReadonlySet<string>, out: Collector): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, scope, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Node;

  for (const [key, value] of Object.entries(obj)) {
    if (key === "RangeVar") {
      const rv = value as {
        schemaname?: string;
        catalogname?: string;
        relname?: string;
      };
      const relname = rv.relname ?? "";
      if (rv.schemaname || rv.catalogname) {
        out.qualified.push(
          [rv.catalogname, rv.schemaname, relname].filter(Boolean).join(".")
        );
        out.relations.add(relname);
      } else if (!scope.has(relname)) {
        out.relations.add(relname);
      }
      walk(value, scope, out); // alias etc. — no nested relations, harmless
      continue;
    }
    if (key === "FuncCall") {
      const fc = value as { funcname?: unknown[] };
      const name = (fc.funcname ?? []).map(str).join(".").toLowerCase();
      if (name) out.functions.add(name);
      walk(value, scope, out); // args, filter, over
      continue;
    }
    if (key === "SelectStmt") {
      walkSelect(value as Node, scope, out);
      continue;
    }
    walk(value, scope, out);
  }
}

/** A SELECT opens a CTE scope: the main body sees every CTE; a non-recursive
 *  CTE body sees only the CTEs defined before it (a recursive WITH: all). */
function walkSelect(
  select: Node,
  outer: ReadonlySet<string>,
  out: Collector
): void {
  const withClause = select.withClause as
    | { ctes?: unknown[]; recursive?: boolean }
    | undefined;
  const names = cteNames(withClause);
  const all = new Set([...outer, ...names]);

  (withClause?.ctes ?? []).forEach((cte, i) => {
    const visible = withClause?.recursive
      ? all
      : new Set([...outer, ...names.slice(0, i)]);
    walk(
      (cte as { CommonTableExpr?: { ctequery?: unknown } }).CommonTableExpr
        ?.ctequery,
      visible,
      out
    );
  });

  for (const [key, value] of Object.entries(select)) {
    if (key === "withClause") continue;
    walk(value, all, out);
  }
}

function computeNeedsImplicitLimit(stmt: Node): boolean {
  const select = stmt.SelectStmt as Node | undefined;
  if (!select) return true;
  if (select.limitCount) return false;
  const targets = (select.targetList as unknown[] | undefined) ?? [];
  const hasTopAggregate = targets.some((t) => {
    const val = (t as { ResTarget?: { val?: Node } }).ResTarget?.val;
    const fc = val?.FuncCall as
      | { funcname?: unknown[]; over?: unknown }
      | undefined;
    if (!fc || fc.over) return false;
    const name = (fc.funcname ?? []).map(str).pop()?.toLowerCase() ?? "";
    return isAggregate(name);
  });
  return !hasTopAggregate;
}

/** Parse one agent SQL statement with Postgres's own grammar. Throws
 *  `PORTAL_SQL_FORBIDDEN` on a syntax error or more than one statement. */
export function parsePortalSql(sql: string): ParsedPortalSql {
  let tree: { stmts?: Array<{ stmt?: Node }> };
  try {
    tree = parseSync(sql) as typeof tree;
  } catch (err) {
    throw new ApiError(
      400,
      ApiCode.PORTAL_SQL_FORBIDDEN,
      `syntax error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const stmts = tree.stmts ?? [];
  if (stmts.length !== 1 || !stmts[0]?.stmt) {
    throw new ApiError(
      400,
      ApiCode.PORTAL_SQL_FORBIDDEN,
      "exactly one statement is allowed"
    );
  }
  const statement = stmts[0].stmt;
  const out: Collector = {
    relations: new Set(),
    qualified: [],
    functions: new Set(),
  };
  walk(statement, new Set(), out);
  return {
    statement,
    statementType: Object.keys(statement)[0] ?? "",
    relations: out.relations,
    qualifiedRelations: out.qualified,
    functions: out.functions,
    needsImplicitLimit: computeNeedsImplicitLimit(statement),
  };
}
