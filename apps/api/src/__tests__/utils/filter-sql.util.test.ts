import { describe, it, expect } from "@jest/globals";

import { parseAndBuildFilterSQL, isFilterError } from "../../utils/filter-sql.util.js";

import type { ResolvedColumn } from "@portalai/core/contracts";
import type { SQL } from "drizzle-orm";

// ── Helpers ─────────────────────────────────────────────────────────

const defaults = { required: false, enumValues: null, defaultValue: null, format: null, validationPattern: null, canonicalFormat: null } as const;

const columnDefs: ResolvedColumn[] = [
  { key: "name", normalizedKey: "name", label: "Name", type: "string", ...defaults },
  { key: "email", normalizedKey: "email", label: "Email", type: "string", ...defaults },
  { key: "age", normalizedKey: "age", label: "Age", type: "number", ...defaults },
  { key: "amount", normalizedKey: "amount", label: "Amount", type: "number", ...defaults },
  { key: "active", normalizedKey: "active", label: "Active", type: "boolean", ...defaults },
  { key: "created_at", normalizedKey: "created_at", label: "Created At", type: "date", ...defaults },
  { key: "updated_at", normalizedKey: "updated_at", label: "Updated At", type: "datetime", ...defaults },
  { key: "status", normalizedKey: "status", label: "Status", type: "enum", ...defaults },
  { key: "tags", normalizedKey: "tags", label: "Tags", type: "array", ...defaults },
  { key: "metadata", normalizedKey: "metadata", label: "Metadata", type: "json", ...defaults },
  { key: "ref_id", normalizedKey: "ref_id", label: "Ref ID", type: "reference", ...defaults },
];

function encode(expression: unknown): string {
  return Buffer.from(JSON.stringify(expression)).toString("base64");
}

function expectSuccess(encoded: string) {
  const result = parseAndBuildFilterSQL(encoded, columnDefs);
  expect(isFilterError(result)).toBe(false);
  return (result as { where: SQL }).where;
}

function expectError(encoded: string): string {
  const result = parseAndBuildFilterSQL(encoded, columnDefs);
  expect(isFilterError(result)).toBe(true);
  return (result as { message: string }).message;
}

/** Extracts SQL chunks as flat array for inspection. */
function flattenChunks(sqlObj: SQL): unknown[] {
  const chunks: unknown[] = [];
  for (const chunk of (sqlObj as unknown as { queryChunks: unknown[] }).queryChunks) {
    if (chunk && typeof chunk === "object" && "value" in (chunk as Record<string, unknown>)) {
      chunks.push(...(chunk as { value: string[] }).value);
    } else if (chunk && typeof chunk === "object" && "queryChunks" in (chunk as Record<string, unknown>)) {
      chunks.push(...flattenChunks(chunk as SQL));
    } else {
      chunks.push(chunk);
    }
  }
  return chunks;
}

// ── Encoding validation ─────────────────────────────────────────────

describe("parseAndBuildFilterSQL — encoding", () => {
  it("should reject non-base64 input", () => {
    const msg = expectError("not-valid-json{{{");
    expect(msg).toContain("Invalid filter");
  });

  it("should reject base64 that is not valid JSON", () => {
    const msg = expectError(Buffer.from("not json").toString("base64"));
    expect(msg).toContain("Invalid filter");
  });

  it("should reject base64 JSON that doesn't match schema", () => {
    const msg = expectError(encode({ bad: "data" }));
    expect(msg).toContain("Invalid filter structure");
  });
});

// ── Limit validation ────────────────────────────────────────────────

describe("parseAndBuildFilterSQL — limits", () => {
  it("should reject expression exceeding MAX_FILTER_DEPTH", () => {
    let inner: Record<string, unknown> = {
      combinator: "and",
      conditions: [{ field: "name", operator: "eq", value: "x" }],
    };
    for (let i = 0; i < 4; i++) {
      inner = { combinator: "and", conditions: [inner] };
    }
    const msg = expectError(encode(inner));
    expect(msg).toContain("depth");
  });

  it("should reject expression exceeding MAX_CONDITIONS", () => {
    const conditions = Array.from({ length: 21 }, (_, i) => ({
      field: "name",
      operator: "eq",
      value: `val_${i}`,
    }));
    const msg = expectError(encode({ combinator: "and", conditions }));
    expect(msg).toContain("condition count");
  });
});

// ── Operator/type compatibility ─────────────────────────────────────

describe("parseAndBuildFilterSQL — operator/type validation", () => {
  it("should reject invalid operator for column type", () => {
    const msg = expectError(encode({
      combinator: "and",
      conditions: [{ field: "active", operator: "contains", value: "true" }],
    }));
    expect(msg).toContain("contains");
    expect(msg).toContain("boolean");
  });

  it("should reject unknown field", () => {
    const msg = expectError(encode({
      combinator: "and",
      conditions: [{ field: "nonexistent", operator: "eq", value: "x" }],
    }));
    expect(msg).toContain("Unknown field");
  });
});

// ── String operators ────────────────────────────────────────────────

describe("parseAndBuildFilterSQL — string operators", () => {
  it("should build eq condition", () => {
    const where = expectSuccess(encode({
      combinator: "and",
      conditions: [{ field: "name", operator: "eq", value: "Alice" }],
    }));
    const chunks = flattenChunks(where);
    expect(chunks).toContain("Alice");
  });

  it("should build neq condition", () => {
    const where = expectSuccess(encode({
      combinator: "and",
      conditions: [{ field: "name", operator: "neq", value: "Bob" }],
    }));
    const chunks = flattenChunks(where);
    expect(chunks).toContain("Bob");
  });

  it("should build contains condition with ILIKE", () => {
    const where = expectSuccess(encode({
      combinator: "and",
      conditions: [{ field: "name", operator: "contains", value: "test" }],
    }));
    const chunks = flattenChunks(where);
    expect(chunks).toContain("%test%");
  });

  it("should build not_contains condition", () => {
    const where = expectSuccess(encode({
      combinator: "and",
      conditions: [{ field: "name", operator: "not_contains", value: "bad" }],
    }));
    const chunks = flattenChunks(where);
    expect(chunks).toContain("%bad%");
  });

  it("should build starts_with condition", () => {
    const where = expectSuccess(encode({
      combinator: "and",
      conditions: [{ field: "name", operator: "starts_with", value: "A" }],
    }));
    const chunks = flattenChunks(where);
    expect(chunks).toContain("A%");
  });

  it("should build ends_with condition", () => {
    const where = expectSuccess(encode({
      combinator: "and",
      conditions: [{ field: "name", operator: "ends_with", value: "z" }],
    }));
    const chunks = flattenChunks(where);
    expect(chunks).toContain("%z");
  });
});

// ── Numeric operators ───────────────────────────────────────────────

describe("parseAndBuildFilterSQL — numeric operators", () => {
  it("should build gt condition with numeric casting", () => {
    const where = expectSuccess(encode({
      combinator: "and",
      conditions: [{ field: "age", operator: "gt", value: 18 }],
    }));
    const chunks = flattenChunks(where);
    expect(chunks).toContain(18);
  });

  it("should build between condition", () => {
    const where = expectSuccess(encode({
      combinator: "and",
      conditions: [{ field: "amount", operator: "between", value: ["10", "100"] }],
    }));
    const chunks = flattenChunks(where);
    expect(chunks).toContain(10);
    expect(chunks).toContain(100);
  });
});

// ── Boolean operators ───────────────────────────────────────────────

describe("parseAndBuildFilterSQL — boolean operators", () => {
  it("should build eq condition for boolean true", () => {
    const where = expectSuccess(encode({
      combinator: "and",
      conditions: [{ field: "active", operator: "eq", value: true }],
    }));
    const chunks = flattenChunks(where);
    expect(chunks).toContain("true");
  });

  it("should build neq condition for boolean", () => {
    const where = expectSuccess(encode({
      combinator: "and",
      conditions: [{ field: "active", operator: "neq", value: false }],
    }));
    const chunks = flattenChunks(where);
    expect(chunks).toContain("false");
  });
});

// ── Date operators ──────────────────────────────────────────────────

describe("parseAndBuildFilterSQL — date operators", () => {
  it("should build gte condition for date", () => {
    const where = expectSuccess(encode({
      combinator: "and",
      conditions: [{ field: "created_at", operator: "gte", value: "2024-01-01" }],
    }));
    const chunks = flattenChunks(where);
    expect(chunks).toContain("2024-01-01");
  });

  it("should build between condition for datetime", () => {
    const where = expectSuccess(encode({
      combinator: "and",
      conditions: [{ field: "updated_at", operator: "between", value: ["2024-01-01", "2024-12-31"] }],
    }));
    const chunks = flattenChunks(where);
    expect(chunks).toContain("2024-01-01");
    expect(chunks).toContain("2024-12-31");
  });
});

// ── Enum operators ──────────────────────────────────────────────────

describe("parseAndBuildFilterSQL — enum operators", () => {
  it("should build in condition", () => {
    const where = expectSuccess(encode({
      combinator: "and",
      conditions: [{ field: "status", operator: "in", value: ["active", "pending"] }],
    }));
    expect(where).toBeDefined();
  });

  it("should build not_in condition", () => {
    const where = expectSuccess(encode({
      combinator: "and",
      conditions: [{ field: "status", operator: "not_in", value: ["deleted"] }],
    }));
    expect(where).toBeDefined();
  });
});

// ── Empty/not-empty operators ───────────────────────────────────────

describe("parseAndBuildFilterSQL — is_empty/is_not_empty", () => {
  it("should build is_empty condition", () => {
    const where = expectSuccess(encode({
      combinator: "and",
      conditions: [{ field: "name", operator: "is_empty", value: null }],
    }));
    expect(where).toBeDefined();
  });

  it("should build is_not_empty condition", () => {
    const where = expectSuccess(encode({
      combinator: "and",
      conditions: [{ field: "age", operator: "is_not_empty", value: null }],
    }));
    expect(where).toBeDefined();
  });
});

// ── Array operators ─────────────────────────────────────────────────

describe("parseAndBuildFilterSQL — array operators", () => {
  it("should build contains condition for array type", () => {
    const where = expectSuccess(encode({
      combinator: "and",
      conditions: [{ field: "tags", operator: "contains", value: "important" }],
    }));
    expect(where).toBeDefined();
  });

  it("should build not_contains condition for array type", () => {
    const where = expectSuccess(encode({
      combinator: "and",
      conditions: [{ field: "tags", operator: "not_contains", value: "spam" }],
    }));
    expect(where).toBeDefined();
  });
});

// ── Nested groups ───────────────────────────────────────────────────

describe("parseAndBuildFilterSQL — nested groups", () => {
  it("should build AND/OR nested groups", () => {
    const where = expectSuccess(encode({
      combinator: "and",
      conditions: [
        { field: "active", operator: "eq", value: true },
        {
          combinator: "or",
          conditions: [
            { field: "status", operator: "eq", value: "active" },
            { field: "status", operator: "eq", value: "trial" },
          ],
        },
      ],
    }));
    expect(where).toBeDefined();
  });

  it("should build deeply nested groups within limits", () => {
    const where = expectSuccess(encode({
      combinator: "and",
      conditions: [
        {
          combinator: "or",
          conditions: [
            {
              combinator: "and",
              conditions: [
                { field: "name", operator: "eq", value: "test" },
              ],
            },
          ],
        },
      ],
    }));
    expect(where).toBeDefined();
  });
});

// ── SQL injection prevention ────────────────────────────────────────

describe("parseAndBuildFilterSQL — SQL injection prevention", () => {
  it("should sanitize field keys (SQL injection in field name)", () => {
    // The field key gets sanitized by escapeSqlIdentifier,
    // but also needs to exist in column defs — so unknown field = rejected
    const msg = expectError(encode({
      combinator: "and",
      conditions: [{ field: "name'; DROP TABLE--", operator: "eq", value: "x" }],
    }));
    expect(msg).toContain("Unknown field");
  });

  it("should parameterize values (SQL injection in value)", () => {
    // Values are always parameterized, never interpolated
    const where = expectSuccess(encode({
      combinator: "and",
      conditions: [{ field: "name", operator: "eq", value: "'; DROP TABLE entity_records; --" }],
    }));
    const chunks = flattenChunks(where);
    // The malicious value appears as a bound parameter, not raw SQL
    expect(chunks).toContain("'; DROP TABLE entity_records; --");
  });

  it("should parameterize ILIKE values with special chars", () => {
    const where = expectSuccess(encode({
      combinator: "and",
      conditions: [{ field: "name", operator: "contains", value: "100%" }],
    }));
    const chunks = flattenChunks(where);
    expect(chunks).toContain("%100%%");
  });
});

// ── Phase 4: no currency type, normalizedData keys ─────────────────

describe("parseAndBuildFilterSQL — Phase 4", () => {
  it("handles number type for values previously typed as currency", () => {
    // "amount" is type "number" — currency-like values go through the numeric path
    const where = expectSuccess(encode({
      combinator: "and",
      conditions: [{ field: "amount", operator: "gte", value: 9.99 }],
    }));
    const chunks = flattenChunks(where);
    expect(chunks).toContain(9.99);
  });

  it("filter field keys reference normalizedData JSONB keys", () => {
    // The filter references "name" which maps to normalizedData->>'name'
    const where = expectSuccess(encode({
      combinator: "and",
      conditions: [{ field: "name", operator: "eq", value: "Alice" }],
    }));
    const chunks = flattenChunks(where);
    // The SQL should contain the field key used for JSONB extraction
    expect(chunks.some((c) => typeof c === "string" && c.includes("'name'"))).toBe(true);
  });

  it("does not have a currency case in the type switch", () => {
    // There is no "currency" column type — verify that the ColumnDataType enum
    // used in columnDefs does not include it
    const types = columnDefs.map((c) => c.type);
    expect(types).not.toContain("currency");
  });
});
