/**
 * Advanced filter SQL generation against typed wide-table columns.
 *
 * Phase 2's read-path migration completed in slice 6: the legacy
 * JSONB-against-`entity_records.normalized_data` builder is gone.
 * Operator builders reference typed `er__<id>` columns via a
 * `columnRef(normalizedKey)` resolver supplied by the caller — no
 * JSONB casts, no regex guards.
 *
 * Two entry points:
 *
 *   - `parseFilterPayload(encoded, columnDefs)` — decode + validate the
 *     base64 expression. Returns `{ expression, columnTypes }` or a
 *     `FilterValidationError`.
 *   - `buildFilterSqlForEntity(expression, stmt, columnTypes)` — emit
 *     the typed-column WHERE fragment.
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

import type { CachedStatements } from "../services/wide-table-statement.cache.js";

// ── Public API ──────────────────────────────────────────────────────

export interface FilterSQLResult {
  where: SQL;
}

export interface FilterValidationError {
  message: string;
}

/**
 * Type guard to distinguish result types.
 */
export function isFilterError(
  result: FilterSQLResult | FilterValidationError
): result is FilterValidationError {
  return "message" in result;
}

/**
 * Decode + validate a base64-encoded filter expression against the
 * supplied column definitions. Returns the parsed expression + a
 * normalizedKey → type map, or a structured `FilterValidationError`.
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

/**
 * Build a parameterised WHERE fragment against typed wide-table
 * columns. Resolves each `condition.field` to a `"w"."c_*"` reference
 * via the statement cache. Returns `FilterValidationError`
 * (`message: "unknown column: <key>"`) for fields the cache doesn't know.
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

// ── Internals ───────────────────────────────────────────────────────

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
      return sql`${colRef} @> ARRAY[${val}]::text[]`;
    case "not_contains":
      return sql`(${colRef} IS NULL OR NOT (${colRef} @> ARRAY[${val}]::text[]))`;
    default:
      return sql`TRUE`;
  }
}

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
