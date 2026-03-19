/**
 * Utility functions for the AdvancedFilterBuilder component.
 *
 * Handles serialization/deserialization of FilterExpression to/from
 * base64 query params, plus helpers for counting/emptiness checks.
 */

import {
  FilterExpressionSchema,
  countConditions as coreCountConditions,
} from "@portalai/core/contracts";
import type { FilterExpression, FilterCondition, FilterGroup } from "@portalai/core/contracts";

// ── Serialization ───────────────────────────────────────────────────

/**
 * Encode a FilterExpression as a base64 JSON string for use as a query param.
 */
export function serializeFilterExpression(expr: FilterExpression): string {
  return btoa(JSON.stringify(expr));
}

/**
 * Decode a base64 JSON string into a FilterExpression.
 * Returns null if the input is invalid.
 */
export function deserializeFilterExpression(str: string): FilterExpression | null {
  try {
    const json = JSON.parse(atob(str));
    const result = FilterExpressionSchema.safeParse(json);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

// ── Inspection helpers ──────────────────────────────────────────────

/**
 * Returns true if the expression has zero leaf conditions.
 */
export function isFilterExpressionEmpty(expr: FilterExpression): boolean {
  return countActiveConditions(expr) === 0;
}

/**
 * Count total leaf conditions in a filter expression.
 */
export function countActiveConditions(expr: FilterExpression): number {
  return coreCountConditions(expr);
}

// ── Factory helpers ─────────────────────────────────────────────────

/** Create an empty filter expression. */
export function createEmptyExpression(): FilterExpression {
  return { combinator: "and", conditions: [] };
}

/** Create a default condition for a given field. */
export function createDefaultCondition(field: string): FilterCondition {
  return { field, operator: "eq", value: "" };
}

/** Create an empty nested group. */
export function createEmptyGroup(): FilterGroup {
  return { combinator: "and", conditions: [] };
}

// ── Summarization ───────────────────────────────────────────────────

/** Human-readable operator labels. */
const OPERATOR_LABELS: Record<string, string> = {
  eq: "is",
  neq: "is not",
  contains: "contains",
  not_contains: "does not contain",
  starts_with: "starts with",
  ends_with: "ends with",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  between: "between",
  in: "is one of",
  not_in: "is not one of",
  is_empty: "is empty",
  is_not_empty: "is not empty",
};

export function getOperatorLabel(operator: string): string {
  return OPERATOR_LABELS[operator] ?? operator;
}

/**
 * Collect all leaf conditions from an expression (flattened).
 * Used to render summary chips.
 */
export function collectConditions(
  expr: FilterExpression,
): FilterCondition[] {
  const result: FilterCondition[] = [];
  function walk(group: FilterGroup) {
    for (const item of group.conditions) {
      if ("combinator" in item) {
        walk(item);
      } else {
        result.push(item);
      }
    }
  }
  walk(expr);
  return result;
}

/**
 * Remove a specific condition (by index in flattened order) from the expression.
 * Returns a new expression with the condition removed. Empty groups are pruned.
 */
export function removeConditionByIndex(
  expr: FilterExpression,
  targetIndex: number,
): FilterExpression {
  let currentIndex = 0;

  function walkGroup(group: FilterGroup): FilterGroup {
    const newConditions: FilterGroup["conditions"] = [];
    for (const item of group.conditions) {
      if ("combinator" in item) {
        const pruned = walkGroup(item);
        if (pruned.conditions.length > 0) {
          newConditions.push(pruned);
        }
      } else {
        if (currentIndex !== targetIndex) {
          newConditions.push(item);
        }
        currentIndex++;
      }
    }
    return { ...group, conditions: newConditions };
  }

  return walkGroup(expr);
}

/**
 * Remove conditions that reference columns not in the provided set.
 * Empty groups are pruned after stripping.
 * Returns [cleanedExpression, removedFieldKeys].
 */
export function stripInvalidColumns(
  expr: FilterExpression,
  validKeys: ReadonlySet<string>,
): [FilterExpression, string[]] {
  const removed: string[] = [];

  function walkGroup(group: FilterGroup): FilterGroup {
    const newConditions: FilterGroup["conditions"] = [];
    for (const item of group.conditions) {
      if ("combinator" in item) {
        const pruned = walkGroup(item);
        if (pruned.conditions.length > 0) {
          newConditions.push(pruned);
        }
      } else {
        if (validKeys.has(item.field)) {
          newConditions.push(item);
        } else {
          removed.push(item.field);
        }
      }
    }
    return { ...group, conditions: newConditions };
  }

  return [walkGroup(expr), removed];
}
