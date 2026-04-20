/**
 * End-to-end validation: filter expression → serialize → deserialize → validate.
 *
 * Verifies the full pipeline from UI filter state through to the format
 * the API expects, without requiring a running server.
 */

import {
  serializeFilterExpression,
  deserializeFilterExpression,
  countActiveConditions,
  isFilterExpressionEmpty,
} from "../utils/advanced-filter-builder.util";

import {
  FilterExpressionSchema,
  validateFilterLimits,
  validateOperatorTypeCompat,
} from "@portalai/core/contracts";

import type {
  FilterExpression,
  ResolvedColumn,
} from "@portalai/core/contracts";
import type { ColumnDataType } from "@portalai/core/models";

// ── Helpers ─────────────────────────────────────────────────────────

const columnDefs: ResolvedColumn[] = [
  {
    key: "name",
    normalizedKey: "name",
    label: "Name",
    type: "string",
    required: false,
    enumValues: null,
    defaultValue: null,
    validationPattern: null,
    canonicalFormat: null,
    format: null,
  },
  {
    key: "age",
    normalizedKey: "age",
    label: "Age",
    type: "number",
    required: false,
    enumValues: null,
    defaultValue: null,
    validationPattern: null,
    canonicalFormat: null,
    format: null,
  },
  {
    key: "active",
    normalizedKey: "active",
    label: "Active",
    type: "boolean",
    required: false,
    enumValues: null,
    defaultValue: null,
    validationPattern: null,
    canonicalFormat: null,
    format: null,
  },
  {
    key: "signup_date",
    normalizedKey: "signup_date",
    label: "Signup Date",
    type: "date",
    required: false,
    enumValues: null,
    defaultValue: null,
    validationPattern: null,
    canonicalFormat: null,
    format: null,
  },
  {
    key: "status",
    normalizedKey: "status",
    label: "Status",
    type: "enum",
    required: false,
    enumValues: null,
    defaultValue: null,
    validationPattern: null,
    canonicalFormat: null,
    format: null,
  },
];

function columnTypes(): Record<string, ColumnDataType> {
  const map: Record<string, ColumnDataType> = {};
  for (const col of columnDefs) {
    map[col.key] = col.type;
  }
  return map;
}

/**
 * Simulate the full pipeline:
 * 1. Frontend serializes the expression to base64
 * 2. Backend decodes + validates with Zod schema
 * 3. Backend validates limits
 * 4. Backend validates operator/type compatibility
 */
function validatePipeline(expr: FilterExpression) {
  // Step 1: Serialize (frontend)
  const encoded = serializeFilterExpression(expr);
  expect(typeof encoded).toBe("string");
  expect(encoded.length).toBeGreaterThan(0);

  // Step 2: Deserialize (simulating backend decode)
  const decoded = deserializeFilterExpression(encoded);
  expect(decoded).not.toBeNull();
  expect(decoded).toEqual(expr);

  // Step 3: Zod schema validation (backend)
  const schemaResult = FilterExpressionSchema.safeParse(decoded);
  expect(schemaResult.success).toBe(true);

  // Step 4: Limits validation (backend)
  const limitsError = validateFilterLimits(decoded!);
  expect(limitsError).toBeNull();

  // Step 5: Operator/type compatibility (backend)
  const compatErrors = validateOperatorTypeCompat(decoded!, columnTypes());
  expect(compatErrors).toEqual([]);
}

// ── Tests ───────────────────────────────────────────────────────────

describe("Advanced Filters — end-to-end pipeline", () => {
  it("should pass pipeline for a simple string equality filter", () => {
    validatePipeline({
      combinator: "and",
      conditions: [{ field: "name", operator: "eq", value: "Alice" }],
    });
  });

  it("should pass pipeline for multiple conditions with AND", () => {
    validatePipeline({
      combinator: "and",
      conditions: [
        { field: "name", operator: "contains", value: "test" },
        { field: "age", operator: "gte", value: 18 },
        { field: "active", operator: "eq", value: true },
      ],
    });
  });

  it("should pass pipeline for OR group with nested AND", () => {
    validatePipeline({
      combinator: "or",
      conditions: [
        {
          combinator: "and",
          conditions: [
            { field: "active", operator: "eq", value: true },
            { field: "age", operator: "gt", value: 21 },
          ],
        },
        {
          combinator: "and",
          conditions: [
            { field: "status", operator: "eq", value: "trial" },
            { field: "signup_date", operator: "gte", value: "2024-01-01" },
          ],
        },
      ],
    });
  });

  it("should pass pipeline for is_empty/is_not_empty operators", () => {
    validatePipeline({
      combinator: "and",
      conditions: [
        { field: "name", operator: "is_not_empty", value: null },
        { field: "age", operator: "is_empty", value: null },
      ],
    });
  });

  it("should pass pipeline for between operator", () => {
    validatePipeline({
      combinator: "and",
      conditions: [
        { field: "age", operator: "between", value: ["18", "65"] },
        {
          field: "signup_date",
          operator: "between",
          value: ["2023-01-01", "2024-12-31"],
        },
      ],
    });
  });

  it("should pass pipeline for enum in/not_in operators", () => {
    validatePipeline({
      combinator: "and",
      conditions: [
        { field: "status", operator: "in", value: ["active", "trial"] },
      ],
    });
  });

  it("should reject invalid operator/type combos through the pipeline", () => {
    const expr: FilterExpression = {
      combinator: "and",
      conditions: [{ field: "active", operator: "gt", value: 1 }],
    };

    const encoded = serializeFilterExpression(expr);
    const decoded = deserializeFilterExpression(encoded);
    expect(decoded).not.toBeNull();

    // Schema passes (it doesn't enforce operator/type)
    expect(FilterExpressionSchema.safeParse(decoded).success).toBe(true);

    // But operator/type compat fails
    const errors = validateOperatorTypeCompat(decoded!, columnTypes());
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("gt");
    expect(errors[0]).toContain("boolean");
  });

  it("should count conditions correctly through serialization round-trip", () => {
    const expr: FilterExpression = {
      combinator: "and",
      conditions: [
        { field: "name", operator: "eq", value: "x" },
        {
          combinator: "or",
          conditions: [
            { field: "age", operator: "gt", value: 10 },
            { field: "active", operator: "eq", value: true },
          ],
        },
      ],
    };

    const encoded = serializeFilterExpression(expr);
    const decoded = deserializeFilterExpression(encoded)!;
    expect(countActiveConditions(decoded)).toBe(3);
    expect(isFilterExpressionEmpty(decoded)).toBe(false);
  });
});
