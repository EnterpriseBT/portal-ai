import { z } from "zod";

import type { ColumnDataType } from "../models/column-definition.model.js";

// ── Constants ───────────────────────────────────────────────────────

/** Maximum nesting depth for filter groups (prevents abuse). */
export const MAX_FILTER_DEPTH = 4;

/** Maximum total conditions across the entire filter expression. */
export const MAX_CONDITIONS = 20;

// ── Filter operator ─────────────────────────────────────────────────

export const FilterOperatorEnum = z.enum([
  "eq",
  "neq",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "in",
  "not_in",
  "is_empty",
  "is_not_empty",
]);

export type FilterOperator = z.infer<typeof FilterOperatorEnum>;

// ── Operators by column data type ───────────────────────────────────

export const OPERATORS_BY_COLUMN_TYPE: Record<ColumnDataType, FilterOperator[]> = {
  string: ["eq", "neq", "contains", "not_contains", "starts_with", "ends_with", "is_empty", "is_not_empty"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "between", "is_empty", "is_not_empty"],
  currency: ["eq", "neq", "gt", "gte", "lt", "lte", "between", "is_empty", "is_not_empty"],
  boolean: ["eq", "neq"],
  date: ["eq", "neq", "gt", "gte", "lt", "lte", "between", "is_empty", "is_not_empty"],
  datetime: ["eq", "neq", "gt", "gte", "lt", "lte", "between", "is_empty", "is_not_empty"],
  enum: ["eq", "neq", "in", "not_in", "is_empty", "is_not_empty"],
  array: ["contains", "not_contains", "is_empty", "is_not_empty"],
  json: ["is_empty", "is_not_empty"],
  reference: ["eq", "neq", "is_empty", "is_not_empty"],
  "reference-array": ["contains", "not_contains", "is_empty", "is_not_empty"],
};

// ── Compile-time exhaustiveness check ───────────────────────────────
// Ensures every ColumnDataType is covered in the operator map.
const _exhaustiveCheck: Record<ColumnDataType, FilterOperator[]> = OPERATORS_BY_COLUMN_TYPE;
void _exhaustiveCheck;

// ── Filter condition schema ─────────────────────────────────────────

export const FilterConditionSchema = z.object({
  field: z.string().min(1),
  operator: FilterOperatorEnum,
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]),
});

export type FilterCondition = z.infer<typeof FilterConditionSchema>;

// ── Filter group schema (recursive) ─────────────────────────────────

export const FilterCombinatorEnum = z.enum(["and", "or"]);

export type FilterCombinator = z.infer<typeof FilterCombinatorEnum>;

export type FilterGroup = {
  combinator: FilterCombinator;
  conditions: (FilterCondition | FilterGroup)[];
};

export const FilterGroupSchema: z.ZodType<FilterGroup> = z.lazy(() =>
  z.object({
    combinator: FilterCombinatorEnum,
    conditions: z.array(z.union([FilterConditionSchema, FilterGroupSchema])).min(1),
  }),
);

// ── Filter expression (top-level) ───────────────────────────────────

export const FilterExpressionSchema = FilterGroupSchema;

export type FilterExpression = FilterGroup;

// ── Validation helpers ──────────────────────────────────────────────

/**
 * Counts total leaf conditions in a filter expression (recursive).
 */
export function countConditions(expression: FilterGroup): number {
  let count = 0;
  for (const item of expression.conditions) {
    if ("combinator" in item) {
      count += countConditions(item);
    } else {
      count += 1;
    }
  }
  return count;
}

/**
 * Returns the maximum nesting depth of a filter expression.
 * A flat group has depth 1.
 */
export function measureDepth(expression: FilterGroup): number {
  let maxChildDepth = 0;
  for (const item of expression.conditions) {
    if ("combinator" in item) {
      maxChildDepth = Math.max(maxChildDepth, measureDepth(item));
    }
  }
  return 1 + maxChildDepth;
}

/**
 * Validates a filter expression against depth and condition count limits.
 * Returns an error message string or null if valid.
 */
export function validateFilterLimits(expression: FilterGroup): string | null {
  const depth = measureDepth(expression);
  if (depth > MAX_FILTER_DEPTH) {
    return `Filter nesting depth ${depth} exceeds maximum of ${MAX_FILTER_DEPTH}`;
  }
  const conditions = countConditions(expression);
  if (conditions > MAX_CONDITIONS) {
    return `Filter condition count ${conditions} exceeds maximum of ${MAX_CONDITIONS}`;
  }
  return null;
}

/**
 * Validates that all filter operators are compatible with their field's column type.
 * Returns an array of error messages (empty if valid).
 */
export function validateOperatorTypeCompat(
  expression: FilterGroup,
  columnTypes: Record<string, ColumnDataType>,
): string[] {
  const errors: string[] = [];

  function walk(group: FilterGroup): void {
    for (const item of group.conditions) {
      if ("combinator" in item) {
        walk(item);
      } else {
        const colType = columnTypes[item.field];
        if (!colType) {
          errors.push(`Unknown field: "${item.field}"`);
          continue;
        }
        const allowed = OPERATORS_BY_COLUMN_TYPE[colType];
        if (!allowed.includes(item.operator)) {
          errors.push(
            `Operator "${item.operator}" is not valid for field "${item.field}" of type "${colType}"`,
          );
        }
      }
    }
  }

  walk(expression);
  return errors;
}
