/**
 * Advanced filter SQL generation.
 *
 * Phase 2 reworks operator builders to reference typed wide-table
 * columns directly via a `columnRef(normalizedKey)` resolver supplied
 * by the caller — no more JSONB casts, no regex guards.
 *
 * Two public entry points coexist while the read-path migration is in
 * flight:
 *
 *   - `parseAndBuildFilterSQL` (legacy) — builds against JSONB
 *     `entity_records.normalized_data`. Kept until every read site has
 *     migrated; deletes in slice 6.
 *   - `buildFilterSqlForEntity` (new) — builds against typed wide-table
 *     columns via the statement cache's `columnRefByNormalizedKey`.
 *
 * All user-provided values are bound as parameters — never interpolated.
 */

import { sql, type SQL } from "drizzle-orm";

import {
  validateFilterLimits,
  validateOperatorTypeCompat,
  FilterExpressionSchema,
} from "@portalai/core/contracts";
import type {
  FilterGroup,
  FilterCondition,
  FilterOperator,
  ResolvedColumn,
} from "@portalai/core/contracts";
import type { ColumnDataType } from "@portalai/core/models";

import { entityRecords } from "../db/schema/index.js";
import type { CachedStatements } from "../services/wide-table-statement.cache.js";

// ── Public API ──────────────────────────────────────────────────────

export interface FilterSQLResult {
  where: SQL;
}

export interface FilterValidationError {
  message: string;
}

/**
 * Parses a base64-encoded filter expression string, validates it against
 * the provided column definitions, and returns a parameterized SQL WHERE clause.
 *
 * Returns either a FilterSQLResult or a FilterValidationError.
 */
export function parseAndBuildFilterSQL(
  encodedFilters: string,
  columnDefs: ResolvedColumn[]
): FilterSQLResult | FilterValidationError {
  // 1. Decode base64
  let parsed: unknown;
  try {
    const jsonStr = Buffer.from(encodedFilters, "base64").toString("utf-8");
    parsed = JSON.parse(jsonStr);
  } catch {
    return { message: "Invalid filter encoding: expected base64-encoded JSON" };
  }

  // 2. Validate schema
  const schemaResult = FilterExpressionSchema.safeParse(parsed);
  if (!schemaResult.success) {
    return {
      message: `Invalid filter structure: ${schemaResult.error.issues[0]?.message ?? "unknown error"}`,
    };
  }

  const expression = schemaResult.data;

  // 3. Validate limits (depth + condition count)
  const limitsError = validateFilterLimits(expression);
  if (limitsError) {
    return { message: limitsError };
  }

  // 4. Validate operator-type compatibility and field existence.
  // `condition.field` holds the normalizedKey (the JSONB key in normalized_data).
  const columnTypes: Record<string, ColumnDataType> = {};
  for (const col of columnDefs) {
    columnTypes[col.normalizedKey] = col.type;
  }
  const compatErrors = validateOperatorTypeCompat(expression, columnTypes);
  if (compatErrors.length > 0) {
    return { message: compatErrors[0] };
  }

  // 5. Build SQL
  const where = buildGroupSQL(expression, columnTypes);
  return { where };
}

/**
 * Type guard to distinguish result types.
 */
export function isFilterError(
  result: FilterSQLResult | FilterValidationError
): result is FilterValidationError {
  return "message" in result;
}

// ── SQL builders ────────────────────────────────────────────────────

function buildGroupSQL(
  group: FilterGroup,
  columnTypes: Record<string, ColumnDataType>,
  depth: number = 1
): SQL {
  const parts = group.conditions.map((item) => {
    if ("combinator" in item) {
      return buildGroupSQL(item, columnTypes, depth + 1);
    }
    return buildConditionSQL(item, columnTypes[item.field]);
  });

  if (parts.length === 1) return parts[0];

  if (group.combinator === "and") {
    return sql.join(
      parts.map((p) => sql`(${p})`),
      sql` AND `
    );
  }
  return sql`(${sql.join(
    parts.map((p) => sql`(${p})`),
    sql` OR `
  )})`;
}

function buildConditionSQL(
  condition: FilterCondition,
  dataType: ColumnDataType
): SQL {
  const { field, operator, value } = condition;

  // Extract JSONB text value: normalized_data->>'field_key'
  const jsonbText = sql`${entityRecords.normalizedData}->>${sql.raw(`'${escapeSqlIdentifier(field)}'`)}`;

  // Handle empty/not-empty first — they don't need a value
  if (operator === "is_empty") {
    return sql`(${jsonbText} IS NULL OR ${jsonbText} = '')`;
  }
  if (operator === "is_not_empty") {
    return sql`(${jsonbText} IS NOT NULL AND ${jsonbText} <> '')`;
  }

  // Delegate to type-specific builders
  switch (dataType) {
    case "number":
      return buildNumericCondition(jsonbText, operator, value);
    case "boolean":
      return buildBooleanCondition(jsonbText, operator, value);
    case "date":
    case "datetime":
      return buildDateCondition(jsonbText, operator, value);
    case "enum":
      return buildEnumCondition(jsonbText, operator, value);
    case "array":
      return buildArrayCondition(jsonbText, field, operator, value);
    case "string":
    case "reference":
    case "json":
    default:
      return buildStringCondition(jsonbText, operator, value);
  }
}

// ── Type-specific SQL builders ──────────────────────────────────────

function buildStringCondition(
  jsonbText: SQL,
  operator: FilterOperator,
  value: unknown
): SQL {
  const val = String(value ?? "");

  switch (operator) {
    case "eq":
      return sql`${jsonbText} = ${val}`;
    case "neq":
      return sql`(${jsonbText} IS NULL OR ${jsonbText} <> ${val})`;
    case "contains":
      return sql`${jsonbText} ILIKE ${"%" + val + "%"}`;
    case "not_contains":
      return sql`(${jsonbText} IS NULL OR ${jsonbText} NOT ILIKE ${"%" + val + "%"})`;
    case "starts_with":
      return sql`${jsonbText} ILIKE ${val + "%"}`;
    case "ends_with":
      return sql`${jsonbText} ILIKE ${"%" + val}`;
    default:
      return sql`TRUE`;
  }
}

function buildNumericCondition(
  jsonbText: SQL,
  operator: FilterOperator,
  value: unknown
): SQL {
  // Cast with regex guard (same pattern as buildJsonbSortExpression)
  const numericExpr = sql`CASE WHEN ${jsonbText} ~ '^-?[0-9]*\\.?[0-9]+([eE][+-]?[0-9]+)?$' THEN (NULLIF(${jsonbText}, ''))::numeric ELSE NULL END`;

  const numVal = Number(value);

  switch (operator) {
    case "eq":
      return sql`${numericExpr} = ${numVal}`;
    case "neq":
      return sql`(${numericExpr} IS NULL OR ${numericExpr} <> ${numVal})`;
    case "gt":
      return sql`${numericExpr} > ${numVal}`;
    case "gte":
      return sql`${numericExpr} >= ${numVal}`;
    case "lt":
      return sql`${numericExpr} < ${numVal}`;
    case "lte":
      return sql`${numericExpr} <= ${numVal}`;
    case "between": {
      const [lo, hi] = parseBetweenValue(value);
      return sql`${numericExpr} >= ${Number(lo)} AND ${numericExpr} <= ${Number(hi)}`;
    }
    default:
      return sql`TRUE`;
  }
}

function buildBooleanCondition(
  jsonbText: SQL,
  operator: FilterOperator,
  value: unknown
): SQL {
  const boolStr = String(value) === "true" ? "true" : "false";

  switch (operator) {
    case "eq":
      return sql`${jsonbText} = ${boolStr}`;
    case "neq":
      return sql`(${jsonbText} IS NULL OR ${jsonbText} <> ${boolStr})`;
    default:
      return sql`TRUE`;
  }
}

function buildDateCondition(
  jsonbText: SQL,
  operator: FilterOperator,
  value: unknown
): SQL {
  // ISO dates/datetimes are lexicographically sortable as text
  const val = sql`NULLIF(${jsonbText}, '')`;
  const dateStr = String(value ?? "");

  switch (operator) {
    case "eq":
      return sql`${val} = ${dateStr}`;
    case "neq":
      return sql`(${val} IS NULL OR ${val} <> ${dateStr})`;
    case "gt":
      return sql`${val} > ${dateStr}`;
    case "gte":
      return sql`${val} >= ${dateStr}`;
    case "lt":
      return sql`${val} < ${dateStr}`;
    case "lte":
      return sql`${val} <= ${dateStr}`;
    case "between": {
      const [lo, hi] = parseBetweenValue(value);
      return sql`${val} >= ${String(lo)} AND ${val} <= ${String(hi)}`;
    }
    default:
      return sql`TRUE`;
  }
}

function buildEnumCondition(
  jsonbText: SQL,
  operator: FilterOperator,
  value: unknown
): SQL {
  switch (operator) {
    case "eq":
      return sql`${jsonbText} = ${String(value)}`;
    case "neq":
      return sql`(${jsonbText} IS NULL OR ${jsonbText} <> ${String(value)})`;
    case "in": {
      const arr = Array.isArray(value) ? value.map(String) : [String(value)];
      return sql`${jsonbText} = ANY(${arr})`;
    }
    case "not_in": {
      const arr = Array.isArray(value) ? value.map(String) : [String(value)];
      return sql`(${jsonbText} IS NULL OR ${jsonbText} <> ALL(${arr}))`;
    }
    default:
      return sql`TRUE`;
  }
}

function buildArrayCondition(
  jsonbText: SQL,
  field: string,
  operator: FilterOperator,
  value: unknown
): SQL {
  // For array columns, use JSONB containment operators on the raw JSONB value (not text extraction)
  const jsonbVal = sql`${entityRecords.normalizedData}->${sql.raw(`'${escapeSqlIdentifier(field)}'`)}`;
  const val = String(value ?? "");

  switch (operator) {
    case "contains":
      // Check if JSONB array contains the value: jsonb @> '"value"'
      return sql`${jsonbVal} @> ${`"${val}"`}::jsonb`;
    case "not_contains":
      return sql`NOT (${jsonbVal} @> ${`"${val}"`}::jsonb)`;
    default:
      return sql`TRUE`;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Parses a `between` value. Expects either a two-element array or
 * a comma-separated string. Returns [low, high].
 */
function parseBetweenValue(value: unknown): [string, string] {
  if (Array.isArray(value) && value.length >= 2) {
    return [String(value[0]), String(value[1])];
  }
  const parts = String(value).split(",");
  return [parts[0]?.trim() ?? "", parts[1]?.trim() ?? ""];
}

/**
 * Escapes a JSONB field key for use in a raw SQL identifier context.
 * Prevents SQL injection by allowing only alphanumeric and underscore chars.
 */
function escapeSqlIdentifier(key: string): string {
  return key.replace(/[^a-z0-9_]/gi, "");
}

// ── Phase 2: typed-column filter builders ───────────────────────────

/**
 * Build a parameterised WHERE fragment against typed wide-table
 * columns. Resolves each `condition.field` to a `"w"."c_*"` reference
 * via the statement cache. Throws `FilterValidationError` for unknown
 * fields (`message: "unknown column: <key>"`).
 *
 * Phase 2's slice-4 router calls this after `parseFilterPayload` has
 * decoded + validated the expression's structure and operator-type
 * compatibility against the resolved columns.
 */
export function buildFilterSqlForEntity(
  expression: FilterGroup,
  stmt: CachedStatements,
  columnTypes: Record<string, ColumnDataType>
): FilterSQLResult | FilterValidationError {
  try {
    const where = buildTypedGroupSQL(expression, stmt, columnTypes);
    return { where };
  } catch (err) {
    if (err instanceof FilterError) return { message: err.message };
    throw err;
  }
}

/**
 * Decode + validate a base64-encoded filter expression without
 * building any SQL. Used by the new router path that wants to validate
 * first, then build typed SQL via `buildFilterSqlForEntity`.
 */
export function parseFilterPayload(
  encodedFilters: string,
  columnDefs: ResolvedColumn[]
):
  | {
      expression: FilterGroup;
      columnTypes: Record<string, ColumnDataType>;
    }
  | FilterValidationError {
  let parsed: unknown;
  try {
    const jsonStr = Buffer.from(encodedFilters, "base64").toString("utf-8");
    parsed = JSON.parse(jsonStr);
  } catch {
    return { message: "Invalid filter encoding: expected base64-encoded JSON" };
  }

  const schemaResult = FilterExpressionSchema.safeParse(parsed);
  if (!schemaResult.success) {
    return {
      message: `Invalid filter structure: ${schemaResult.error.issues[0]?.message ?? "unknown error"}`,
    };
  }
  const expression = schemaResult.data;

  const limitsError = validateFilterLimits(expression);
  if (limitsError) return { message: limitsError };

  const columnTypes: Record<string, ColumnDataType> = {};
  for (const col of columnDefs) {
    columnTypes[col.normalizedKey] = col.type;
  }
  const compatErrors = validateOperatorTypeCompat(expression, columnTypes);
  if (compatErrors.length > 0) return { message: compatErrors[0] };

  return { expression, columnTypes };
}

class FilterError extends Error {}

function buildTypedGroupSQL(
  group: FilterGroup,
  stmt: CachedStatements,
  columnTypes: Record<string, ColumnDataType>
): SQL {
  const parts = group.conditions.map((item) => {
    if ("combinator" in item) {
      return buildTypedGroupSQL(item, stmt, columnTypes);
    }
    return buildTypedConditionSQL(item, stmt, columnTypes[item.field]);
  });

  if (parts.length === 1) return parts[0];

  if (group.combinator === "and") {
    return sql.join(
      parts.map((p) => sql`(${p})`),
      sql` AND `
    );
  }
  return sql`(${sql.join(
    parts.map((p) => sql`(${p})`),
    sql` OR `
  )})`;
}

function buildTypedConditionSQL(
  condition: FilterCondition,
  stmt: CachedStatements,
  dataType: ColumnDataType
): SQL {
  const { field, operator, value } = condition;
  const refBuilder = stmt.columnRefByNormalizedKey.get(field);
  if (!refBuilder) {
    throw new FilterError(`unknown column: ${field}`);
  }
  const colRef = sql.raw(refBuilder("w"));

  if (operator === "is_empty") {
    return sql`(${colRef} IS NULL)`;
  }
  if (operator === "is_not_empty") {
    return sql`(${colRef} IS NOT NULL)`;
  }

  switch (dataType) {
    case "number":
      return buildTypedNumericCondition(colRef, operator, value);
    case "boolean":
      return buildTypedBooleanCondition(colRef, operator, value);
    case "date":
    case "datetime":
      return buildTypedDateCondition(colRef, operator, value);
    case "enum":
    case "reference":
      return buildTypedEnumCondition(colRef, operator, value);
    case "array":
    case "reference-array":
      return buildTypedArrayCondition(colRef, operator, value);
    case "string":
    case "json":
    default:
      return buildTypedStringCondition(colRef, operator, value);
  }
}

function buildTypedStringCondition(
  colRef: SQL,
  operator: FilterOperator,
  value: unknown
): SQL {
  const val = String(value ?? "");
  switch (operator) {
    case "eq":
      return sql`${colRef} = ${val}`;
    case "neq":
      return sql`(${colRef} IS NULL OR ${colRef} <> ${val})`;
    case "contains":
      return sql`${colRef}::text ILIKE ${"%" + val + "%"}`;
    case "not_contains":
      return sql`(${colRef} IS NULL OR ${colRef}::text NOT ILIKE ${"%" + val + "%"})`;
    case "starts_with":
      return sql`${colRef}::text ILIKE ${val + "%"}`;
    case "ends_with":
      return sql`${colRef}::text ILIKE ${"%" + val}`;
    default:
      return sql`TRUE`;
  }
}

function buildTypedNumericCondition(
  colRef: SQL,
  operator: FilterOperator,
  value: unknown
): SQL {
  const numVal = Number(value);
  switch (operator) {
    case "eq":
      return sql`${colRef} = ${numVal}`;
    case "neq":
      return sql`(${colRef} IS NULL OR ${colRef} <> ${numVal})`;
    case "gt":
      return sql`${colRef} > ${numVal}`;
    case "gte":
      return sql`${colRef} >= ${numVal}`;
    case "lt":
      return sql`${colRef} < ${numVal}`;
    case "lte":
      return sql`${colRef} <= ${numVal}`;
    case "between": {
      const [lo, hi] = parseBetweenValue(value);
      return sql`${colRef} >= ${Number(lo)} AND ${colRef} <= ${Number(hi)}`;
    }
    default:
      return sql`TRUE`;
  }
}

function buildTypedBooleanCondition(
  colRef: SQL,
  operator: FilterOperator,
  value: unknown
): SQL {
  const boolVal = String(value) === "true";
  switch (operator) {
    case "eq":
      return sql`${colRef} = ${boolVal}`;
    case "neq":
      return sql`(${colRef} IS NULL OR ${colRef} <> ${boolVal})`;
    default:
      return sql`TRUE`;
  }
}

function buildTypedDateCondition(
  colRef: SQL,
  operator: FilterOperator,
  value: unknown
): SQL {
  const dateStr = String(value ?? "");
  switch (operator) {
    case "eq":
      return sql`${colRef} = ${dateStr}`;
    case "neq":
      return sql`(${colRef} IS NULL OR ${colRef} <> ${dateStr})`;
    case "gt":
      return sql`${colRef} > ${dateStr}`;
    case "gte":
      return sql`${colRef} >= ${dateStr}`;
    case "lt":
      return sql`${colRef} < ${dateStr}`;
    case "lte":
      return sql`${colRef} <= ${dateStr}`;
    case "between": {
      const [lo, hi] = parseBetweenValue(value);
      return sql`${colRef} >= ${String(lo)} AND ${colRef} <= ${String(hi)}`;
    }
    default:
      return sql`TRUE`;
  }
}

function buildTypedEnumCondition(
  colRef: SQL,
  operator: FilterOperator,
  value: unknown
): SQL {
  switch (operator) {
    case "eq":
      return sql`${colRef} = ${String(value)}`;
    case "neq":
      return sql`(${colRef} IS NULL OR ${colRef} <> ${String(value)})`;
    case "in": {
      const arr = Array.isArray(value) ? value.map(String) : [String(value)];
      return sql`${colRef} IN (${sql.join(
        arr.map((v) => sql`${v}`),
        sql`, `
      )})`;
    }
    case "not_in": {
      const arr = Array.isArray(value) ? value.map(String) : [String(value)];
      return sql`(${colRef} IS NULL OR ${colRef} NOT IN (${sql.join(
        arr.map((v) => sql`${v}`),
        sql`, `
      )}))`;
    }
    default:
      return sql`TRUE`;
  }
}

function buildTypedArrayCondition(
  colRef: SQL,
  operator: FilterOperator,
  value: unknown
): SQL {
  const val = String(value ?? "");
  switch (operator) {
    case "contains":
      // text[] @> ARRAY[val] — true iff the column array contains val.
      return sql`${colRef} @> ARRAY[${val}]::text[]`;
    case "not_contains":
      return sql`(${colRef} IS NULL OR NOT (${colRef} @> ARRAY[${val}]::text[]))`;
    default:
      return sql`TRUE`;
  }
}

/**
 * Build a sort expression against a typed wide-table column. Returns
 * `null` if the normalizedKey is unknown to the cache (caller falls
 * back to the default `created` order).
 */
export function buildSortExpression(
  stmt: CachedStatements,
  normalizedKey: string
): SQL | null {
  const refBuilder = stmt.columnRefByNormalizedKey.get(normalizedKey);
  if (!refBuilder) return null;
  return sql.raw(refBuilder("w"));
}
