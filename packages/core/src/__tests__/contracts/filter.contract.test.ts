import {
  FilterConditionSchema,
  FilterExpressionSchema,
  FilterGroupSchema,
  FilterOperatorEnum,
  FilterCombinatorEnum,
  OPERATORS_BY_COLUMN_TYPE,
  MAX_FILTER_DEPTH,
  MAX_CONDITIONS,
  countConditions,
  measureDepth,
  validateFilterLimits,
  validateOperatorTypeCompat,
} from "../../contracts/filter.contract.js";
import { ColumnDataTypeEnum } from "../../models/column-definition.model.js";

import type { FilterGroup } from "../../contracts/filter.contract.js";
import type { ColumnDataType } from "../../models/column-definition.model.js";

// ── Helper ──────────────────────────────────────────────────────────

/** Builds a FilterGroup conveniently in tests. */
function group(
  combinator: "and" | "or",
  conditions: (FilterGroup | { field: string; operator: string; value: unknown })[],
): FilterGroup {
  return { combinator, conditions: conditions as FilterGroup["conditions"] };
}

function cond(field: string, operator: string, value: unknown) {
  return { field, operator, value } as FilterGroup["conditions"][number];
}

// ── FilterOperatorEnum ──────────────────────────────────────────────

describe("FilterOperatorEnum", () => {
  it("should accept all valid operators", () => {
    const operators = [
      "eq", "neq", "contains", "not_contains", "starts_with", "ends_with",
      "gt", "gte", "lt", "lte", "between", "in", "not_in",
      "is_empty", "is_not_empty",
    ];
    for (const op of operators) {
      expect(FilterOperatorEnum.safeParse(op).success).toBe(true);
    }
  });

  it("should reject invalid operators", () => {
    expect(FilterOperatorEnum.safeParse("like").success).toBe(false);
    expect(FilterOperatorEnum.safeParse("").success).toBe(false);
  });
});

// ── FilterCombinatorEnum ────────────────────────────────────────────

describe("FilterCombinatorEnum", () => {
  it("should accept 'and' and 'or'", () => {
    expect(FilterCombinatorEnum.safeParse("and").success).toBe(true);
    expect(FilterCombinatorEnum.safeParse("or").success).toBe(true);
  });

  it("should reject invalid combinators", () => {
    expect(FilterCombinatorEnum.safeParse("xor").success).toBe(false);
  });
});

// ── FilterConditionSchema ───────────────────────────────────────────

describe("FilterConditionSchema", () => {
  it("should accept a valid string condition", () => {
    const result = FilterConditionSchema.safeParse({
      field: "email",
      operator: "contains",
      value: "@example.com",
    });
    expect(result.success).toBe(true);
  });

  it("should accept a numeric value", () => {
    const result = FilterConditionSchema.safeParse({
      field: "amount",
      operator: "gt",
      value: 100,
    });
    expect(result.success).toBe(true);
  });

  it("should accept a boolean value", () => {
    const result = FilterConditionSchema.safeParse({
      field: "active",
      operator: "eq",
      value: true,
    });
    expect(result.success).toBe(true);
  });

  it("should accept a string array value (for in/not_in)", () => {
    const result = FilterConditionSchema.safeParse({
      field: "status",
      operator: "in",
      value: ["active", "pending"],
    });
    expect(result.success).toBe(true);
  });

  it("should accept null value (for is_empty/is_not_empty)", () => {
    const result = FilterConditionSchema.safeParse({
      field: "name",
      operator: "is_empty",
      value: null,
    });
    expect(result.success).toBe(true);
  });

  it("should reject empty field name", () => {
    const result = FilterConditionSchema.safeParse({
      field: "",
      operator: "eq",
      value: "test",
    });
    expect(result.success).toBe(false);
  });

  it("should reject missing operator", () => {
    const result = FilterConditionSchema.safeParse({
      field: "email",
      value: "test",
    });
    expect(result.success).toBe(false);
  });

  it("should reject invalid operator", () => {
    const result = FilterConditionSchema.safeParse({
      field: "email",
      operator: "regex",
      value: "test",
    });
    expect(result.success).toBe(false);
  });
});

// ── FilterGroupSchema ───────────────────────────────────────────────

describe("FilterGroupSchema", () => {
  it("should accept a simple AND group with one condition", () => {
    const result = FilterGroupSchema.safeParse({
      combinator: "and",
      conditions: [{ field: "name", operator: "eq", value: "Alice" }],
    });
    expect(result.success).toBe(true);
  });

  it("should accept an OR group with multiple conditions", () => {
    const result = FilterGroupSchema.safeParse({
      combinator: "or",
      conditions: [
        { field: "name", operator: "eq", value: "Alice" },
        { field: "name", operator: "eq", value: "Bob" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("should accept nested groups", () => {
    const result = FilterGroupSchema.safeParse({
      combinator: "and",
      conditions: [
        { field: "active", operator: "eq", value: true },
        {
          combinator: "or",
          conditions: [
            { field: "role", operator: "eq", value: "admin" },
            { field: "role", operator: "eq", value: "editor" },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("should reject a group with empty conditions", () => {
    const result = FilterGroupSchema.safeParse({
      combinator: "and",
      conditions: [],
    });
    expect(result.success).toBe(false);
  });

  it("should reject missing combinator", () => {
    const result = FilterGroupSchema.safeParse({
      conditions: [{ field: "name", operator: "eq", value: "test" }],
    });
    expect(result.success).toBe(false);
  });
});

// ── FilterExpressionSchema ──────────────────────────────────────────

describe("FilterExpressionSchema", () => {
  it("should accept a complete filter expression", () => {
    const expression = {
      combinator: "and",
      conditions: [
        { field: "email", operator: "contains", value: "@acme.com" },
        { field: "age", operator: "gte", value: 18 },
        {
          combinator: "or",
          conditions: [
            { field: "status", operator: "eq", value: "active" },
            { field: "status", operator: "eq", value: "trial" },
          ],
        },
      ],
    };
    const result = FilterExpressionSchema.safeParse(expression);
    expect(result.success).toBe(true);
  });
});

// ── OPERATORS_BY_COLUMN_TYPE ────────────────────────────────────────

describe("OPERATORS_BY_COLUMN_TYPE", () => {
  it("should have entries for every ColumnDataType", () => {
    const allTypes = ColumnDataTypeEnum.options;
    for (const type of allTypes) {
      expect(OPERATORS_BY_COLUMN_TYPE[type]).toBeDefined();
      expect(OPERATORS_BY_COLUMN_TYPE[type].length).toBeGreaterThan(0);
    }
  });

  it("should only contain valid FilterOperator values", () => {
    const allOps = FilterOperatorEnum.options;
    for (const [, ops] of Object.entries(OPERATORS_BY_COLUMN_TYPE)) {
      for (const op of ops) {
        expect(allOps).toContain(op);
      }
    }
  });

  it("should map string type to expected operators", () => {
    expect(OPERATORS_BY_COLUMN_TYPE.string).toEqual(
      expect.arrayContaining(["eq", "neq", "contains", "not_contains", "starts_with", "ends_with", "is_empty", "is_not_empty"]),
    );
  });

  it("should map boolean type to only eq and neq", () => {
    expect(OPERATORS_BY_COLUMN_TYPE.boolean).toEqual(["eq", "neq"]);
  });

  it("should map json type to only is_empty and is_not_empty", () => {
    expect(OPERATORS_BY_COLUMN_TYPE.json).toEqual(["is_empty", "is_not_empty"]);
  });

  it("should include 'between' for number, date, and datetime", () => {
    const types: ColumnDataType[] = ["number", "date", "datetime"];
    for (const type of types) {
      expect(OPERATORS_BY_COLUMN_TYPE[type]).toContain("between");
    }
  });

  it("should include 'in' and 'not_in' only for enum type", () => {
    for (const [type, ops] of Object.entries(OPERATORS_BY_COLUMN_TYPE)) {
      if (type === "enum") {
        expect(ops).toContain("in");
        expect(ops).toContain("not_in");
      } else {
        expect(ops).not.toContain("in");
        expect(ops).not.toContain("not_in");
      }
    }
  });
});

// ── countConditions ─────────────────────────────────────────────────

describe("countConditions", () => {
  it("should count flat conditions", () => {
    const expr = group("and", [
      cond("a", "eq", "1"),
      cond("b", "eq", "2"),
    ]);
    expect(countConditions(expr)).toBe(2);
  });

  it("should count nested conditions", () => {
    const expr = group("and", [
      cond("a", "eq", "1"),
      group("or", [
        cond("b", "eq", "2"),
        cond("c", "eq", "3"),
      ]),
    ]);
    expect(countConditions(expr)).toBe(3);
  });
});

// ── measureDepth ────────────────────────────────────────────────────

describe("measureDepth", () => {
  it("should return 1 for a flat group", () => {
    expect(measureDepth(group("and", [cond("a", "eq", "1")]))).toBe(1);
  });

  it("should return 2 for one level of nesting", () => {
    const expr = group("and", [
      group("or", [cond("a", "eq", "1")]),
    ]);
    expect(measureDepth(expr)).toBe(2);
  });

  it("should return correct depth for deep nesting", () => {
    const expr = group("and", [
      group("or", [
        group("and", [
          group("or", [cond("a", "eq", "1")]),
        ]),
      ]),
    ]);
    expect(measureDepth(expr)).toBe(4);
  });
});

// ── validateFilterLimits ────────────────────────────────────────────

describe("validateFilterLimits", () => {
  it("should return null for a valid expression", () => {
    expect(validateFilterLimits(group("and", [cond("a", "eq", "1")]))).toBeNull();
  });

  it("should return error when depth exceeds MAX_FILTER_DEPTH", () => {
    // Build a chain of depth MAX_FILTER_DEPTH + 1
    let inner: FilterGroup = group("and", [cond("a", "eq", "1")]);
    for (let i = 0; i < MAX_FILTER_DEPTH; i++) {
      inner = group("and", [inner]);
    }
    const error = validateFilterLimits(inner);
    expect(error).not.toBeNull();
    expect(error).toContain("depth");
  });

  it("should return error when conditions exceed MAX_CONDITIONS", () => {
    const conditions = Array.from({ length: MAX_CONDITIONS + 1 }, (_, i) =>
      cond(`field_${i}`, "eq", `val_${i}`),
    );
    const expr = group("and", conditions);
    const error = validateFilterLimits(expr);
    expect(error).not.toBeNull();
    expect(error).toContain("condition count");
  });

  it("should accept exactly MAX_FILTER_DEPTH levels", () => {
    let inner: FilterGroup = group("and", [cond("a", "eq", "1")]);
    for (let i = 1; i < MAX_FILTER_DEPTH; i++) {
      inner = group("and", [inner]);
    }
    expect(measureDepth(inner)).toBe(MAX_FILTER_DEPTH);
    expect(validateFilterLimits(inner)).toBeNull();
  });

  it("should accept exactly MAX_CONDITIONS conditions", () => {
    const conditions = Array.from({ length: MAX_CONDITIONS }, (_, i) =>
      cond(`field_${i}`, "eq", `val_${i}`),
    );
    const expr = group("and", conditions);
    expect(countConditions(expr)).toBe(MAX_CONDITIONS);
    expect(validateFilterLimits(expr)).toBeNull();
  });
});

// ── validateOperatorTypeCompat ──────────────────────────────────────

describe("validateOperatorTypeCompat", () => {
  const columnTypes: Record<string, ColumnDataType> = {
    name: "string",
    age: "number",
    active: "boolean",
    created_at: "date",
    status: "enum",
    tags: "array",
    metadata: "json",
    ref_id: "reference",
  };

  it("should return no errors for valid operator/type combos", () => {
    const expr = group("and", [
      cond("name", "contains", "test"),
      cond("age", "gt", 18),
      cond("active", "eq", true),
      cond("status", "in", ["a", "b"]),
    ]);
    expect(validateOperatorTypeCompat(expr, columnTypes)).toEqual([]);
  });

  it("should return error for invalid operator on boolean", () => {
    const expr = group("and", [cond("active", "contains", "true")]);
    const errors = validateOperatorTypeCompat(expr, columnTypes);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("contains");
    expect(errors[0]).toContain("boolean");
  });

  it("should return error for unknown field", () => {
    const expr = group("and", [cond("nonexistent", "eq", "x")]);
    const errors = validateOperatorTypeCompat(expr, columnTypes);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Unknown field");
  });

  it("should return error for 'between' on string type", () => {
    const expr = group("and", [cond("name", "between", null)]);
    const errors = validateOperatorTypeCompat(expr, columnTypes);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("between");
    expect(errors[0]).toContain("string");
  });

  it("should return error for 'in' on number type", () => {
    const expr = group("and", [cond("age", "in", ["1", "2"])]);
    const errors = validateOperatorTypeCompat(expr, columnTypes);
    expect(errors).toHaveLength(1);
  });

  it("should validate nested groups", () => {
    const expr = group("and", [
      cond("name", "eq", "Alice"),
      group("or", [
        cond("active", "gt", 1),      // invalid: gt on boolean
        cond("metadata", "contains", "x"), // invalid: contains on json
      ]),
    ]);
    const errors = validateOperatorTypeCompat(expr, columnTypes);
    expect(errors).toHaveLength(2);
  });

  it("should accept is_empty/is_not_empty on all types that support it", () => {
    const expr = group("and", [
      cond("name", "is_empty", null),
      cond("age", "is_not_empty", null),
      cond("status", "is_empty", null),
      cond("metadata", "is_not_empty", null),
    ]);
    expect(validateOperatorTypeCompat(expr, columnTypes)).toEqual([]);
  });
});
