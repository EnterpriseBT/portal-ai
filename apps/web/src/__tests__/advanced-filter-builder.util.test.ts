import {
  serializeFilterExpression,
  deserializeFilterExpression,
  isFilterExpressionEmpty,
  countActiveConditions,
  createEmptyExpression,
  createDefaultCondition,
  createEmptyGroup,
  getOperatorLabel,
  collectConditions,
  removeConditionByIndex,
  stripInvalidColumns,
} from "../utils/advanced-filter-builder.util";

import type { FilterExpression } from "@portalai/core/contracts";

// ── Serialization round-trip ────────────────────────────────────────

describe("serializeFilterExpression / deserializeFilterExpression", () => {
  it("should round-trip a valid expression", () => {
    const expr: FilterExpression = {
      combinator: "and",
      conditions: [{ field: "name", operator: "eq", value: "Alice" }],
    };
    const encoded = serializeFilterExpression(expr);
    const decoded = deserializeFilterExpression(encoded);
    expect(decoded).toEqual(expr);
  });

  it("should round-trip a nested expression", () => {
    const expr: FilterExpression = {
      combinator: "or",
      conditions: [
        { field: "a", operator: "gt", value: 10 },
        {
          combinator: "and",
          conditions: [
            { field: "b", operator: "contains", value: "test" },
            { field: "c", operator: "is_empty", value: null },
          ],
        },
      ],
    };
    const encoded = serializeFilterExpression(expr);
    const decoded = deserializeFilterExpression(encoded);
    expect(decoded).toEqual(expr);
  });

  it("should return null for invalid base64", () => {
    expect(deserializeFilterExpression("not-valid{{{")).toBeNull();
  });

  it("should return null for valid base64 but invalid JSON", () => {
    expect(deserializeFilterExpression(btoa("not json"))).toBeNull();
  });

  it("should return null for valid JSON but invalid schema", () => {
    expect(deserializeFilterExpression(btoa(JSON.stringify({ bad: true })))).toBeNull();
  });

  it("should return null for empty string", () => {
    expect(deserializeFilterExpression("")).toBeNull();
  });
});

// ── isFilterExpressionEmpty ─────────────────────────────────────────

describe("isFilterExpressionEmpty", () => {
  it("should return true for expression with no conditions", () => {
    expect(isFilterExpressionEmpty({ combinator: "and", conditions: [] })).toBe(true);
  });

  it("should return true for expression with only empty groups", () => {
    expect(
      isFilterExpressionEmpty({
        combinator: "and",
        conditions: [{ combinator: "or", conditions: [] }],
      }),
    ).toBe(true);
  });

  it("should return false for expression with leaf conditions", () => {
    expect(
      isFilterExpressionEmpty({
        combinator: "and",
        conditions: [{ field: "name", operator: "eq", value: "x" }],
      }),
    ).toBe(false);
  });
});

// ── countActiveConditions ───────────────────────────────────────────

describe("countActiveConditions", () => {
  it("should return 0 for empty expression", () => {
    expect(countActiveConditions(createEmptyExpression())).toBe(0);
  });

  it("should count flat conditions", () => {
    expect(
      countActiveConditions({
        combinator: "and",
        conditions: [
          { field: "a", operator: "eq", value: "1" },
          { field: "b", operator: "eq", value: "2" },
        ],
      }),
    ).toBe(2);
  });

  it("should count nested conditions", () => {
    expect(
      countActiveConditions({
        combinator: "and",
        conditions: [
          { field: "a", operator: "eq", value: "1" },
          {
            combinator: "or",
            conditions: [
              { field: "b", operator: "eq", value: "2" },
              { field: "c", operator: "eq", value: "3" },
            ],
          },
        ],
      }),
    ).toBe(3);
  });
});

// ── Factory helpers ─────────────────────────────────────────────────

describe("createEmptyExpression", () => {
  it("should create an AND group with no conditions", () => {
    const expr = createEmptyExpression();
    expect(expr.combinator).toBe("and");
    expect(expr.conditions).toEqual([]);
  });
});

describe("createDefaultCondition", () => {
  it("should create a condition with eq operator and empty value", () => {
    const cond = createDefaultCondition("email");
    expect(cond.field).toBe("email");
    expect(cond.operator).toBe("eq");
    expect(cond.value).toBe("");
  });
});

describe("createEmptyGroup", () => {
  it("should create an AND group with no conditions", () => {
    const group = createEmptyGroup();
    expect(group.combinator).toBe("and");
    expect(group.conditions).toEqual([]);
  });
});

// ── getOperatorLabel ────────────────────────────────────────────────

describe("getOperatorLabel", () => {
  it("should return human labels for known operators", () => {
    expect(getOperatorLabel("eq")).toBe("is");
    expect(getOperatorLabel("neq")).toBe("is not");
    expect(getOperatorLabel("contains")).toBe("contains");
    expect(getOperatorLabel("gt")).toBe(">");
    expect(getOperatorLabel("between")).toBe("between");
    expect(getOperatorLabel("is_empty")).toBe("is empty");
    expect(getOperatorLabel("in")).toBe("is one of");
  });

  it("should return the operator itself for unknown operators", () => {
    expect(getOperatorLabel("unknown_op")).toBe("unknown_op");
  });
});

// ── collectConditions ───────────────────────────────────────────────

describe("collectConditions", () => {
  it("should return empty array for empty expression", () => {
    expect(collectConditions(createEmptyExpression())).toEqual([]);
  });

  it("should collect flat conditions", () => {
    const conditions = collectConditions({
      combinator: "and",
      conditions: [
        { field: "a", operator: "eq", value: "1" },
        { field: "b", operator: "gt", value: 5 },
      ],
    });
    expect(conditions).toHaveLength(2);
    expect(conditions[0].field).toBe("a");
    expect(conditions[1].field).toBe("b");
  });

  it("should collect nested conditions in flattened order", () => {
    const conditions = collectConditions({
      combinator: "and",
      conditions: [
        { field: "a", operator: "eq", value: "1" },
        {
          combinator: "or",
          conditions: [
            { field: "b", operator: "eq", value: "2" },
            { field: "c", operator: "eq", value: "3" },
          ],
        },
        { field: "d", operator: "eq", value: "4" },
      ],
    });
    expect(conditions.map((c) => c.field)).toEqual(["a", "b", "c", "d"]);
  });
});

// ── removeConditionByIndex ──────────────────────────────────────────

describe("removeConditionByIndex", () => {
  it("should remove the condition at the given flat index", () => {
    const expr: FilterExpression = {
      combinator: "and",
      conditions: [
        { field: "a", operator: "eq", value: "1" },
        { field: "b", operator: "eq", value: "2" },
        { field: "c", operator: "eq", value: "3" },
      ],
    };
    const result = removeConditionByIndex(expr, 1);
    const remaining = collectConditions(result);
    expect(remaining.map((c) => c.field)).toEqual(["a", "c"]);
  });

  it("should remove a nested condition by flat index", () => {
    const expr: FilterExpression = {
      combinator: "and",
      conditions: [
        { field: "a", operator: "eq", value: "1" },
        {
          combinator: "or",
          conditions: [
            { field: "b", operator: "eq", value: "2" },
            { field: "c", operator: "eq", value: "3" },
          ],
        },
      ],
    };
    // flat order: a=0, b=1, c=2 — remove b
    const result = removeConditionByIndex(expr, 1);
    const remaining = collectConditions(result);
    expect(remaining.map((c) => c.field)).toEqual(["a", "c"]);
  });

  it("should prune empty groups after removal", () => {
    const expr: FilterExpression = {
      combinator: "and",
      conditions: [
        { field: "a", operator: "eq", value: "1" },
        {
          combinator: "or",
          conditions: [{ field: "b", operator: "eq", value: "2" }],
        },
      ],
    };
    // Remove the only condition in the nested group — group should be pruned
    const result = removeConditionByIndex(expr, 1);
    expect(result.conditions).toHaveLength(1);
    expect(collectConditions(result).map((c) => c.field)).toEqual(["a"]);
  });

  it("should handle removing the first condition", () => {
    const expr: FilterExpression = {
      combinator: "and",
      conditions: [
        { field: "a", operator: "eq", value: "1" },
        { field: "b", operator: "eq", value: "2" },
      ],
    };
    const result = removeConditionByIndex(expr, 0);
    expect(collectConditions(result).map((c) => c.field)).toEqual(["b"]);
  });

  it("should handle removing the last condition", () => {
    const expr: FilterExpression = {
      combinator: "and",
      conditions: [
        { field: "a", operator: "eq", value: "1" },
        { field: "b", operator: "eq", value: "2" },
      ],
    };
    const result = removeConditionByIndex(expr, 1);
    expect(collectConditions(result).map((c) => c.field)).toEqual(["a"]);
  });
});

// ── stripInvalidColumns ─────────────────────────────────────────────

describe("stripInvalidColumns", () => {
  const validKeys = new Set(["name", "age", "status"]);

  it("should keep conditions with valid fields", () => {
    const expr: FilterExpression = {
      combinator: "and",
      conditions: [
        { field: "name", operator: "eq", value: "Alice" },
        { field: "age", operator: "gt", value: 18 },
      ],
    };
    const [cleaned, removed] = stripInvalidColumns(expr, validKeys);
    expect(collectConditions(cleaned).map((c) => c.field)).toEqual(["name", "age"]);
    expect(removed).toEqual([]);
  });

  it("should remove conditions with invalid fields", () => {
    const expr: FilterExpression = {
      combinator: "and",
      conditions: [
        { field: "name", operator: "eq", value: "Alice" },
        { field: "deleted_col", operator: "eq", value: "x" },
        { field: "age", operator: "gt", value: 18 },
      ],
    };
    const [cleaned, removed] = stripInvalidColumns(expr, validKeys);
    expect(collectConditions(cleaned).map((c) => c.field)).toEqual(["name", "age"]);
    expect(removed).toEqual(["deleted_col"]);
  });

  it("should remove nested conditions with invalid fields", () => {
    const expr: FilterExpression = {
      combinator: "and",
      conditions: [
        { field: "name", operator: "eq", value: "Alice" },
        {
          combinator: "or",
          conditions: [
            { field: "gone", operator: "eq", value: "x" },
            { field: "status", operator: "eq", value: "active" },
          ],
        },
      ],
    };
    const [cleaned, removed] = stripInvalidColumns(expr, validKeys);
    expect(collectConditions(cleaned).map((c) => c.field)).toEqual(["name", "status"]);
    expect(removed).toEqual(["gone"]);
  });

  it("should prune empty groups after stripping", () => {
    const expr: FilterExpression = {
      combinator: "and",
      conditions: [
        {
          combinator: "or",
          conditions: [
            { field: "gone1", operator: "eq", value: "x" },
            { field: "gone2", operator: "eq", value: "y" },
          ],
        },
        { field: "name", operator: "eq", value: "Alice" },
      ],
    };
    const [cleaned, removed] = stripInvalidColumns(expr, validKeys);
    // The entire OR group should be pruned
    expect(cleaned.conditions).toHaveLength(1);
    expect(collectConditions(cleaned).map((c) => c.field)).toEqual(["name"]);
    expect(removed).toEqual(["gone1", "gone2"]);
  });

  it("should return all removed fields when everything is invalid", () => {
    const expr: FilterExpression = {
      combinator: "and",
      conditions: [
        { field: "x", operator: "eq", value: "1" },
        { field: "y", operator: "eq", value: "2" },
      ],
    };
    const [cleaned, removed] = stripInvalidColumns(expr, validKeys);
    expect(cleaned.conditions).toHaveLength(0);
    expect(removed).toEqual(["x", "y"]);
  });

  it("should handle empty expression", () => {
    const expr: FilterExpression = { combinator: "and", conditions: [] };
    const [cleaned, removed] = stripInvalidColumns(expr, validKeys);
    expect(cleaned.conditions).toHaveLength(0);
    expect(removed).toEqual([]);
  });
});
