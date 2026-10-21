/**
 * #644: the advanced curated-view row filter — a SQL boolean fragment over
 * the entity's column keys, stored as typed.
 *
 * `validateViewFilterSql` is the static security boundary. It parses the
 * fragment with Postgres's own grammar (libpg-query, via the agent sandbox's
 * fragment gate) and refuses anything but a pure boolean expression over this
 * entity's columns: every node kind, operator, cast target and column must be
 * on an allow-list, and the fragment may not leave its parentheses. The reader
 * role the view runs under is the backstop if this ever misses something.
 *
 * `renderViewFilterSql` re-validates, then splices each column key into the
 * wide table's physical column (`w."c_…"`) at the byte range Postgres reported
 * for it, so the author's text (comments, literals, formatting) is executed
 * exactly as written. The spliced text is re-parsed and checked before use: a
 * stored fragment is never trusted just because it was valid when written.
 */
import {
  parsePortalSql,
  parsePortalSqlExpression,
  isAggregateFunction,
  WHERE_FRAGMENT_PREFIX,
} from "./portal-sql-parse.util.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";

export const FILTER_SQL_MAX_LENGTH = 4000;
export const FILTER_SQL_MAX_NODES = 200;

/** Parse-tree node kinds a filter may contain. Anything else — a sub-select
 *  (`SubLink`), a parameter, a subscript, `COLLATE`, `current_user`, a row
 *  constructor — is refused by name. */
export const FILTER_SQL_ALLOWED_NODES: ReadonlySet<string> = new Set([
  "A_Expr",
  "BoolExpr",
  "NullTest",
  "BooleanTest",
  "A_Const",
  "ColumnRef",
  "FuncCall",
  "TypeCast",
  "CaseExpr",
  "CaseWhen",
  "CoalesceExpr",
  "MinMaxExpr",
  "A_ArrayExpr",
  "List",
  "String",
  "Integer",
  "Float",
  "Boolean",
]);

/** `A_Expr` kinds a filter may use. `AEXPR_OP` and `AEXPR_OP_ANY` name an
 *  operator, which must also be allowed; the rest are grammar forms (IN,
 *  LIKE, BETWEEN, IS DISTINCT FROM, NULLIF) whose operator is fixed. */
const ALLOWED_EXPR_KINDS: ReadonlySet<string> = new Set([
  "AEXPR_OP",
  "AEXPR_OP_ANY",
  "AEXPR_IN",
  "AEXPR_LIKE",
  "AEXPR_ILIKE",
  "AEXPR_BETWEEN",
  "AEXPR_NOT_BETWEEN",
  "AEXPR_DISTINCT",
  "AEXPR_NOT_DISTINCT",
  "AEXPR_NULLIF",
]);

/** Comparison, arithmetic, pattern, JSON and spatial operators. */
export const FILTER_SQL_ALLOWED_OPERATORS: ReadonlySet<string> = new Set([
  "=",
  "<>",
  "!=",
  "<",
  "<=",
  ">",
  ">=",
  "+",
  "-",
  "*",
  "/",
  "%",
  "||",
  "~",
  "~*",
  "!~",
  "!~*",
  "->",
  "->>",
  "#>",
  "#>>",
  "@>",
  "<@",
  "?",
  "?|",
  "?&",
  "&&",
  "<->",
]);

/** Cast targets, by the name the grammar resolves (`integer` → `int4`,
 *  `double precision` → `float8`, both under `pg_catalog`). */
export const FILTER_SQL_ALLOWED_CAST_TYPES: ReadonlySet<string> = new Set([
  "text",
  "varchar",
  "bpchar",
  "int2",
  "int4",
  "int8",
  "numeric",
  "float4",
  "float8",
  "bool",
  "date",
  "timestamp",
  "timestamptz",
  "interval",
  "jsonb",
  "json",
  "geometry",
  "geography",
  "uuid",
]);

/** Allowed by the agent sandbox, but meaningless or an error in a WHERE. */
const WINDOW_FUNCTIONS: ReadonlySet<string> = new Set([
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
]);
const SET_RETURNING_FUNCTIONS: ReadonlySet<string> = new Set([
  "unnest",
  "generate_series",
  "jsonb_array_elements",
  "jsonb_array_elements_text",
  "json_array_elements",
  "jsonb_each",
  "jsonb_object_keys",
  "regexp_matches",
]);

export interface FilterSqlColumnRef {
  key: string;
  /** Byte range of the identifier in the fragment's UTF-8 encoding. */
  byteStart: number;
  byteEnd: number;
}

export interface ValidatedFilterSql {
  /** The column keys referenced, unique and sorted. */
  keys: string[];
  /** Every column reference, in text order. */
  refs: FilterSqlColumnRef[];
}

type Node = Record<string, unknown>;

/** Bytes the wrapper puts before the fragment: the prefix and the fence's
 *  leading newline (`fenceSql`). */
const PREFIX_BYTES = Buffer.byteLength(`${WHERE_FRAGMENT_PREFIX}\n`, "utf8");

const str = (n: unknown): string =>
  ((n as { String?: { sval?: string } })?.String?.sval ?? "").toString();

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Walk state for one fragment. `onColumn` decides what a column reference
 *  may be: a key while validating, `w.<column>` once rendered. */
interface WalkContext {
  fragment: Buffer;
  nodes: number;
  refuse(message: string, location?: number): never;
  onColumn(fields: unknown[], location: number): void;
}

function walk(value: unknown, ctx: WalkContext): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, ctx);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, body] of Object.entries(value as Node)) {
    // Node wrappers are capitalised (`{ A_Expr: {…} }`); lower-case keys are
    // a node's own fields (`lexpr`, `args`, an `A_Const`'s `sval`).
    if (!/^[A-Z]/.test(key)) {
      walk(body, ctx);
      continue;
    }
    visitNode(key, (body ?? {}) as Node, ctx);
    walk(body, ctx);
  }
}

function visitNode(kind: string, node: Node, ctx: WalkContext): void {
  const location =
    typeof node.location === "number" ? node.location : undefined;
  ctx.nodes += 1;
  if (ctx.nodes > FILTER_SQL_MAX_NODES) {
    ctx.refuse(
      `the filter is too complex: at most ${FILTER_SQL_MAX_NODES} nodes`
    );
  }
  if (kind === "SubLink") {
    ctx.refuse("subqueries are not allowed in a filter", location);
  }
  if (!FILTER_SQL_ALLOWED_NODES.has(kind)) {
    ctx.refuse(`not allowed: ${kind}`, location);
  }
  switch (kind) {
    case "ColumnRef":
      ctx.onColumn((node.fields as unknown[]) ?? [], location ?? -1);
      return;
    case "A_Expr": {
      const exprKind = String(node.kind ?? "");
      if (!ALLOWED_EXPR_KINDS.has(exprKind)) {
        ctx.refuse(`expression not allowed: ${exprKind}`, location);
      }
      if (exprKind === "AEXPR_OP" || exprKind === "AEXPR_OP_ANY") {
        const name = ((node.name as unknown[]) ?? []).map(str);
        const op = name.join(".");
        if (name.length !== 1 || !FILTER_SQL_ALLOWED_OPERATORS.has(op)) {
          ctx.refuse(`operator not allowed: ${op}`, location);
        }
      }
      return;
    }
    case "FuncCall": {
      const parts = ((node.funcname as unknown[]) ?? []).map(str);
      const name = (parts[parts.length - 1] ?? "").toLowerCase();
      if (node.over) {
        ctx.refuse("window functions are not allowed in a filter", location);
      }
      if (
        node.agg_star ||
        node.agg_distinct ||
        node.agg_order ||
        node.agg_filter ||
        isAggregateFunction(name)
      ) {
        ctx.refuse(
          `aggregate functions are not allowed in a filter: ${name}`,
          location
        );
      }
      if (WINDOW_FUNCTIONS.has(name)) {
        ctx.refuse(
          `window functions are not allowed in a filter: ${name}`,
          location
        );
      }
      if (SET_RETURNING_FUNCTIONS.has(name)) {
        ctx.refuse(
          `set-returning function not allowed in a filter: ${name}`,
          location
        );
      }
      // The allow-list and schema qualification are the shared fragment
      // gate's (`parsePortalSqlExpression`), run after this walk.
      return;
    }
    case "TypeCast": {
      const typeName = (node.typeName ?? {}) as {
        names?: unknown[];
        arrayBounds?: unknown[];
        location?: number;
      };
      const names = (typeName.names ?? []).map(str);
      const resolved =
        names.length === 2 && names[0] === "pg_catalog" ? [names[1]] : names;
      const target = resolved.join(".");
      if (
        resolved.length !== 1 ||
        typeName.arrayBounds?.length ||
        !FILTER_SQL_ALLOWED_CAST_TYPES.has(target)
      ) {
        ctx.refuse(
          `cast not allowed: ${target}`,
          typeName.location ?? location
        );
      }
      return;
    }
  }
}

/** The byte just past the identifier starting at `start` (quoted or not). */
function identifierEnd(
  fragment: Buffer,
  start: number,
  refuse: (message: string) => never
): number {
  const at = (i: number) => fragment[i];
  if (at(start) === 0x22 /* " */) {
    let i = start + 1;
    while (i < fragment.length) {
      if (at(i) === 0x22) {
        if (at(i + 1) === 0x22) {
          i += 2;
          continue;
        }
        return i + 1;
      }
      i += 1;
    }
    return refuse("unterminated quoted identifier");
  }
  if ((at(start) === 0x55 || at(start) === 0x75) && at(start + 1) === 0x26) {
    return refuse("unicode-escaped identifiers are not supported in a filter");
  }
  let i = start;
  while (i < fragment.length) {
    const b = at(i)!;
    const isIdent =
      (b >= 0x30 && b <= 0x39) ||
      (b >= 0x41 && b <= 0x5a) ||
      (b >= 0x61 && b <= 0x7a) ||
      b === 0x5f ||
      b === 0x24 ||
      b >= 0x80;
    if (!isIdent) break;
    i += 1;
  }
  return i;
}

/** A parse-tree location (bytes into the wrapped statement) as a string index
 *  into the fragment, or undefined when it falls outside the fragment. */
function fragmentPosition(
  fragment: Buffer,
  location?: number
): number | undefined {
  if (location === undefined || location < PREFIX_BYTES) return undefined;
  const byte = location - PREFIX_BYTES;
  if (byte > fragment.length) return undefined;
  return fragment.subarray(0, byte).toString("utf8").length;
}

function invalid(message: string, position?: number): ApiError {
  return new ApiError(
    400,
    ApiCode.CURATED_VIEW_INVALID_FILTER_SQL,
    message,
    position === undefined ? undefined : { position }
  );
}

/** Run `fn`, re-throwing the shared parser's `PORTAL_SQL_FORBIDDEN` as this
 *  surface's code. */
function asFilterError<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof ApiError && err.code === ApiCode.PORTAL_SQL_FORBIDDEN) {
      throw invalid(err.message);
    }
    throw err;
  }
}

/**
 * Validate a filter fragment against an entity's column keys. Throws
 * `400 CURATED_VIEW_INVALID_FILTER_SQL` naming the refused construct, with
 * `details.position` (a string index into the fragment) when it has one.
 */
export function validateViewFilterSql(
  sql: string,
  columnKeys: ReadonlySet<string>
): ValidatedFilterSql {
  return asFilterError(() =>
    checkFragment(sql, (fields, location, ctx) => {
      const names = fields.map(str);
      if (fields.length !== 1 || !names[0]) {
        ctx.refuse(
          `column reference not allowed: ${names.join(".") || "*"}`,
          location
        );
      }
      if (!columnKeys.has(names[0]!)) {
        ctx.refuse(`unknown column: ${names[0]}`, location);
      }
      return names[0]!;
    })
  );
}

/** The shared walk: bounds, parse, node walk, then the fragment gate. */
function checkFragment(
  sql: string,
  column: (
    fields: unknown[],
    location: number,
    ctx: WalkContext
  ) => string | null
): ValidatedFilterSql {
  if (!sql.trim()) throw invalid("the filter is empty");
  if (sql.length > FILTER_SQL_MAX_LENGTH) {
    throw invalid(
      `the filter must be at most ${FILTER_SQL_MAX_LENGTH} characters`
    );
  }
  const fragment = Buffer.from(sql, "utf8");
  const wrapped = `${WHERE_FRAGMENT_PREFIX}\n${sql}\n)`;
  const parsed = parsePortalSql(wrapped);
  const refs: FilterSqlColumnRef[] = [];
  const ctx: WalkContext = {
    fragment,
    nodes: 0,
    refuse(message, location) {
      throw invalid(message, fragmentPosition(fragment, location));
    },
    onColumn(fields, location) {
      const key = column(fields, location, ctx);
      if (key === null) return;
      const byteStart = location - PREFIX_BYTES;
      if (byteStart < 0 || byteStart >= fragment.length) {
        ctx.refuse("column reference outside the filter");
      }
      const byteEnd = identifierEnd(fragment, byteStart, (m) =>
        ctx.refuse(m, location)
      );
      refs.push({ key, byteStart, byteEnd });
    },
  };
  walk(
    (parsed.statement as { SelectStmt?: { whereClause?: unknown } }).SelectStmt
      ?.whereClause,
    ctx
  );
  // Shape (one condition that can't escape its parentheses), no relation or
  // sub-select, and the shared function allow-list.
  parsePortalSqlExpression(sql, "where");
  refs.sort((a, b) => a.byteStart - b.byteStart);
  return { keys: [...new Set(refs.map((r) => r.key))].sort(), refs };
}

const RENDER_CACHE_LIMIT = 500;
const renderCache = new Map<string, string>();

/**
 * Re-validate a stored fragment and splice its column keys into
 * `w."<physical column>"`. Throws `500 CURATED_VIEW_FILTER_SQL_BROKEN` on any
 * failure: a stored filter that no longer validates or renders fails closed.
 * Memoized on the fragment and the column map it resolves against.
 */
export function renderViewFilterSql(
  sql: string,
  columnNameByKey: ReadonlyMap<string, string>
): string {
  const cacheKey = `${sql}\u0000${JSON.stringify(
    [...columnNameByKey].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  )}`;
  const cached = renderCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let rendered: string;
  try {
    const { refs } = validateViewFilterSql(
      sql,
      new Set(columnNameByKey.keys())
    );
    const fragment = Buffer.from(sql, "utf8");
    const parts: Buffer[] = [];
    let cursor = fragment.length;
    for (const ref of [...refs].reverse()) {
      parts.unshift(fragment.subarray(ref.byteEnd, cursor));
      parts.unshift(
        Buffer.from(`w.${quoteIdent(columnNameByKey.get(ref.key)!)}`, "utf8")
      );
      cursor = ref.byteStart;
    }
    parts.unshift(fragment.subarray(0, cursor));
    rendered = Buffer.concat(parts).toString("utf8");

    // The spliced text must still be the same safe shape, and every column
    // reference must now be exactly `w.<one of this view's columns>`.
    const physical = new Set(columnNameByKey.values());
    asFilterError(() =>
      checkFragment(rendered, (fields, location, ctx) => {
        const names = fields.map(str);
        if (
          names.length !== 2 ||
          names[0] !== "w" ||
          !physical.has(names[1]!)
        ) {
          ctx.refuse(
            `column reference not allowed: ${names.join(".")}`,
            location
          );
        }
        return null;
      })
    );
  } catch (err) {
    throw new ApiError(
      500,
      ApiCode.CURATED_VIEW_FILTER_SQL_BROKEN,
      `curated view filter failed to render: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (renderCache.size >= RENDER_CACHE_LIMIT) {
    renderCache.delete(renderCache.keys().next().value!);
  }
  renderCache.set(cacheKey, rendered);
  return rendered;
}
