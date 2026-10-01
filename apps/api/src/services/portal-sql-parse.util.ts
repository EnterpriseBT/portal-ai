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

/** Functions Postgres 17's grammar emits as `pg_catalog.<fn>` for SQL-standard
 *  syntax (verified against libpg-query): EXTRACT, substring(… FROM … FOR …),
 *  substring(… SIMILAR … ESCAPE …), position(… IN …), trim(both/leading/
 *  trailing FROM …), AT TIME ZONE / AT LOCAL, overlay(… placing …), SIMILAR TO,
 *  normalize / IS NORMALIZED. */
const GRAMMAR_GENERATED_FUNCTIONS = new Set([
  "extract",
  "substring",
  "position",
  "btrim",
  "ltrim",
  "rtrim",
  "timezone",
  "overlay",
  "similar_to_escape",
  "normalize",
  "is_normalized",
]);

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
  /** Any SELECT (at any depth) carries `INTO` or a locking clause (FOR UPDATE/SHARE…). */
  intoOrLocking: boolean;
  /** A sub-select appears anywhere (`SubLink` in an expression, or a derived table). */
  hasSubquery: boolean;
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
  intoOrLocking: boolean;
  hasSubquery: boolean;
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
      const parts = (fc.funcname ?? []).map(str).map((p) => p.toLowerCase());
      // #660: the grammar rewrites SQL-standard syntax (EXTRACT, substring
      // FROM/FOR, trim(both FROM …), AT TIME ZONE, SIMILAR TO, …) into
      // `pg_catalog.<fn>` calls. Those are ordinary SQL, not a user qualifying
      // a function, so report them by bare name for the allowlist. Only this
      // closed set is unwrapped; any other qualified call stays qualified (and
      // is rejected).
      const name =
        parts.length === 2 &&
        parts[0] === "pg_catalog" &&
        GRAMMAR_GENERATED_FUNCTIONS.has(parts[1])
          ? parts[1]
          : parts.join(".");
      if (name) out.functions.add(name);
      walk(value, scope, out); // args, filter, over
      continue;
    }
    if (key === "SubLink" || key === "RangeSubselect") out.hasSubquery = true;
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
  if (select.intoClause || select.lockingClause) out.intoOrLocking = true;

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
    // #660: a set operation's branches arrive as bare select objects (no
    // `SelectStmt` wrapper), so walk them as SELECTs — each opens its own CTE
    // scope and has INTO / locking clauses checked.
    if (
      (key === "larg" || key === "rarg") &&
      value &&
      typeof value === "object"
    ) {
      walkSelect(value as Node, all, out);
      continue;
    }
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
    intoOrLocking: false,
    hasSubquery: false,
  };
  walk(statement, new Set(), out);
  return {
    statement,
    statementType: Object.keys(statement)[0] ?? "",
    relations: out.relations,
    qualifiedRelations: out.qualified,
    functions: out.functions,
    needsImplicitLimit: computeNeedsImplicitLimit(statement),
    intoOrLocking: out.intoOrLocking,
    hasSubquery: out.hasSubquery,
  };
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
  "overlay",
  "similar_to_escape",
  "normalize",
  "is_normalized",
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
  "timezone",
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

/**
 * #660: PostGIS functions agent SQL may call — an explicit list of **pure
 * geometry** functions (value in, value out). It replaced an `st_*` family
 * rule, which admitted functions that take a *table name as text* and read that
 * table with the API role's privileges — `st_findextent` / `st_estimatedextent`
 * — bypassing the relation gate, plus the postgis_topology `st_*` functions
 * that read (and write) topology tables by name. Anything not listed is
 * rejected by name; adding one is a reviewed, one-line change with a test.
 *
 * `st_geometrytype`, `st_simplify` and `st_srid` also have postgis_topology
 * overloads (for a `topogeometry` argument); they are kept for their geometry
 * use — the topology overloads only read topology tables, which hold no tenant
 * data — and the DB reader role (#660 PR 2) removes that residue entirely.
 */
export const POSTGIS_ALLOWED_FUNCTIONS: ReadonlySet<string> = new Set([
  // constructors / input
  "st_point",
  "st_makepoint",
  "st_makepointm",
  "st_makeline",
  "st_makepolygon",
  "st_polygon",
  "st_makeenvelope",
  "st_tileenvelope",
  "st_collect",
  "st_geomfromtext",
  "st_geomfromewkt",
  "st_geomfromwkb",
  "st_geomfromewkb",
  "st_geomfromgeojson",
  "st_geogfromtext",
  "st_geographyfromtext",
  "st_geogfromwkb",
  "st_pointfromgeohash",
  "st_linefromtext",
  "st_polygonfromtext",
  // output
  "st_asgeojson",
  "st_astext",
  "st_asewkt",
  "st_asbinary",
  "st_asewkb",
  "st_askml",
  "st_asgml",
  "st_assvg",
  "st_asmvt",
  "st_asmvtgeom",
  "st_geohash",
  // accessors
  "st_x",
  "st_y",
  "st_z",
  "st_m",
  "st_xmin",
  "st_xmax",
  "st_ymin",
  "st_ymax",
  "st_srid",
  "st_geometrytype",
  "st_dimension",
  "st_ndims",
  "st_npoints",
  "st_numpoints",
  "st_numgeometries",
  "st_geometryn",
  "st_pointn",
  "st_startpoint",
  "st_endpoint",
  "st_exteriorring",
  "st_interiorringn",
  "st_numinteriorrings",
  "st_envelope",
  "st_boundary",
  "st_isempty",
  "st_issimple",
  "st_isclosed",
  "st_isring",
  "st_isvalid",
  "st_isvalidreason",
  // predicates
  "st_intersects",
  "st_contains",
  "st_within",
  "st_covers",
  "st_coveredby",
  "st_crosses",
  "st_disjoint",
  "st_equals",
  "st_overlaps",
  "st_touches",
  "st_dwithin",
  "st_dfullywithin",
  "st_relate",
  "st_containsproperly",
  // measurement
  "st_area",
  "st_length",
  "st_length2d",
  "st_perimeter",
  "st_distance",
  "st_distancesphere",
  "st_distancespheroid",
  "st_maxdistance",
  "st_hausdorffdistance",
  "st_azimuth",
  "st_closestpoint",
  "st_shortestline",
  // processing (pure)
  "st_setsrid",
  "st_transform",
  "st_buffer",
  "st_expand",
  "st_centroid",
  "st_pointonsurface",
  "st_convexhull",
  "st_concavehull",
  "st_intersection",
  "st_union",
  "st_unaryunion",
  "st_difference",
  "st_symdifference",
  "st_simplify",
  "st_simplifypreservetopology",
  "st_simplifyvw",
  "st_snaptogrid",
  "st_snap",
  "st_makevalid",
  "st_multi",
  "st_collectionextract",
  "st_force2d",
  "st_flipcoordinates",
  "st_reverse",
  "st_segmentize",
  "st_subdivide",
  "st_split",
  "st_linemerge",
  "st_linesubstring",
  "st_lineinterpolatepoint",
  "st_linelocatepoint",
  "st_dump",
  "st_dumppoints",
  "st_dumprings",
  "st_minimumboundingcircle",
  "st_orientedenvelope",
  "st_voronoipolygons",
  "st_delaunaytriangles",
  "st_hexagongrid",
  "st_squaregrid",
  "st_generatepoints",
  "st_scale",
  "st_translate",
  "st_rotate",
  "st_affine",
  // aggregates / clustering (over rows the query already reads)
  "st_extent",
  "st_memunion",
  "st_clusterdbscan",
  "st_clusterkmeans",
  "st_clusterintersecting",
  "st_clusterwithin",
]);

const isAllowedFunction = (name: string) =>
  PORTAL_SQL_ALLOWED_FUNCTIONS.has(name) || POSTGIS_ALLOWED_FUNCTIONS.has(name);

/** #660: every function called must be allowlisted and unqualified. */
export function assertFunctionsAllowed(functions: ReadonlySet<string>): void {
  for (const fn of functions) {
    if (fn.includes(".")) {
      throw new ApiError(
        400,
        ApiCode.PORTAL_SQL_FORBIDDEN,
        `schema-qualified function not allowed: ${fn}`
      );
    }
    if (!isAllowedFunction(fn)) {
      throw new ApiError(
        400,
        ApiCode.PORTAL_SQL_FORBIDDEN,
        `function not allowed: ${fn}`
      );
    }
  }
}

/** The synthetic relation a transform fragment is parsed against. */
/**
 * #667: splice validated SQL into a server-built wrapper on its own lines.
 *
 * The invariant every caller keeps: **execute exactly `cleaned`**, the text
 * the regex pre-filter and the AST gate saw, never the raw input. And splice
 * it through this fence, so nothing in it (e.g. a line comment the stripper
 * left for Postgres to honour) can share a line with, and swallow, the
 * wrapper's own text. With both, the stripper's fidelity to Postgres's lexer
 * only affects error messages, never what runs unchecked.
 */
export function fenceSql(cleaned: string): string {
  return `\n${cleaned}\n`;
}

const FRAGMENT_SOURCE = "__source";

/**
 * #660: parse an agent-supplied SQL *fragment* — a `transform_entity_records`
 * projection (`target`: `c_a * 2 AS x, upper(c_b) AS y`) or its source filter
 * (`where`) — as a scalar expression over the source row. It may reference no
 * relation (beyond the synthetic source it is wrapped against) and contain no
 * sub-select, so it can't read another table, let alone another org's; its
 * functions must pass the same allowlist as session SQL. Throws
 * `PORTAL_SQL_FORBIDDEN`.
 */
export function parsePortalSqlExpression(
  fragment: string,
  kind: "target" | "where"
): ParsedPortalSql {
  const wrapped =
    kind === "target"
      ? `SELECT ${fenceSql(fragment)} FROM ${FRAGMENT_SOURCE}`
      : `SELECT 1 FROM ${FRAGMENT_SOURCE} WHERE (${fenceSql(fragment)})`;
  const parsed = parsePortalSql(wrapped);
  assertScalarOver(parsed, FRAGMENT_SOURCE);
  assertFunctionsAllowed(parsed.functions);
  return parsed;
}

/**
 * #660: a statement built around agent SQL may read only `sourceRelation` —
 * a single SELECT, no sub-select, no schema-qualified name, no other relation.
 * Shared by the fragment parser and `BulkTransformService`, which re-checks
 * the exact SQL it is about to run.
 */
export function assertScalarOver(
  parsed: ParsedPortalSql,
  sourceRelation: string
): void {
  const forbidden = (m: string) =>
    new ApiError(400, ApiCode.PORTAL_SQL_FORBIDDEN, m);
  if (parsed.statementType !== "SelectStmt") {
    throw forbidden(`statement not allowed: ${parsed.statementType}`);
  }
  if (parsed.hasSubquery) {
    throw forbidden("subqueries are not allowed in a transform expression");
  }
  const [qualified] = parsed.qualifiedRelations;
  if (qualified) {
    throw forbidden(`schema-qualified relation not allowed: ${qualified}`);
  }
  for (const rel of parsed.relations) {
    if (rel !== sourceRelation) throw forbidden(`unknown entity: ${rel}`);
  }
}
