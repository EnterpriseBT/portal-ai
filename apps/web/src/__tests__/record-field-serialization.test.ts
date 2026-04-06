import type { ColumnDefinitionSummary } from "@portalai/core/contracts";

import {
  serializeRecordFields,
  validateRequiredFields,
  initializeRecordFields,
} from "../utils/record-field-serialization.util";

// ── Helpers ──────────────────────────────────────────────────────────

function col(
  key: string,
  type: ColumnDefinitionSummary["type"],
  overrides?: Partial<ColumnDefinitionSummary>
): ColumnDefinitionSummary {
  return {
    key,
    label: key.charAt(0).toUpperCase() + key.slice(1),
    type,
    required: false,
    enumValues: null,
    defaultValue: null,
    validationPattern: null,
    canonicalFormat: null,
    ...overrides,
  };
}

// ── serializeRecordFields ────────────────────────────────────────────

describe("serializeRecordFields", () => {
  it("serializes string field", () => {
    const { data, errors } = serializeRecordFields(
      [col("name", "string")],
      { name: "Alice" }
    );
    expect(data.name).toBe("Alice");
    expect(errors).toEqual({});
  });

  it("serializes empty string to null", () => {
    const { data, errors } = serializeRecordFields(
      [col("name", "string")],
      { name: "" }
    );
    expect(data.name).toBeNull();
    expect(errors).toEqual({});
  });

  it("serializes number field", () => {
    const { data, errors } = serializeRecordFields(
      [col("age", "number")],
      { age: "25" }
    );
    expect(data.age).toBe(25);
    expect(errors).toEqual({});
  });

  it("returns error for non-numeric number field", () => {
    const { errors } = serializeRecordFields(
      [col("age", "number")],
      { age: "abc" }
    );
    expect(errors.age).toBe("Must be a valid number");
  });

  it("serializes empty number to null", () => {
    const { data, errors } = serializeRecordFields(
      [col("age", "number")],
      { age: "" }
    );
    expect(data.age).toBeNull();
    expect(errors).toEqual({});
  });

  it("serializes boolean true", () => {
    const { data, errors } = serializeRecordFields(
      [col("active", "boolean")],
      { active: true }
    );
    expect(data.active).toBe(true);
    expect(errors).toEqual({});
  });

  it("serializes boolean false", () => {
    const { data, errors } = serializeRecordFields(
      [col("active", "boolean")],
      { active: false }
    );
    expect(data.active).toBe(false);
    expect(errors).toEqual({});
  });

  it("serializes date field as string", () => {
    const { data, errors } = serializeRecordFields(
      [col("dob", "date")],
      { dob: "2024-01-15" }
    );
    expect(data.dob).toBe("2024-01-15");
    expect(errors).toEqual({});
  });

  it("serializes json field", () => {
    const { data, errors } = serializeRecordFields(
      [col("meta", "json")],
      { meta: '{"a":1}' }
    );
    expect(data.meta).toEqual({ a: 1 });
    expect(errors).toEqual({});
  });

  it("returns error for invalid json", () => {
    const { errors } = serializeRecordFields(
      [col("meta", "json")],
      { meta: "{bad" }
    );
    expect(errors.meta).toMatch(/Invalid JSON:/);
  });

  it("serializes array field", () => {
    const { data, errors } = serializeRecordFields(
      [col("tags", "array")],
      { tags: '["a","b"]' }
    );
    expect(data.tags).toEqual(["a", "b"]);
    expect(errors).toEqual({});
  });

  it("returns error for non-array json in array field", () => {
    const { errors } = serializeRecordFields(
      [col("tags", "array")],
      { tags: '{"a":1}' }
    );
    expect(errors.tags).toBe("Value must be a JSON array");
  });

  it("serializes reference-array", () => {
    const { data, errors } = serializeRecordFields(
      [col("ids", "reference-array")],
      { ids: "a, b, c" }
    );
    expect(data.ids).toEqual(["a", "b", "c"]);
    expect(errors).toEqual({});
  });

  it("serializes empty reference-array to null", () => {
    const { data, errors } = serializeRecordFields(
      [col("ids", "reference-array")],
      { ids: "" }
    );
    expect(data.ids).toBeNull();
    expect(errors).toEqual({});
  });

  it("serializes enum field as string", () => {
    const { data, errors } = serializeRecordFields(
      [col("status", "enum")],
      { status: "active" }
    );
    expect(data.status).toBe("active");
    expect(errors).toEqual({});
  });

  it("serializes empty enum to null", () => {
    const { data, errors } = serializeRecordFields(
      [col("status", "enum")],
      { status: "" }
    );
    expect(data.status).toBeNull();
    expect(errors).toEqual({});
  });
});

// ── validateRequiredFields ───────────────────────────────────────────

describe("validateRequiredFields", () => {
  it("returns error for empty required string", () => {
    const errors = validateRequiredFields(
      [col("name", "string", { required: true })],
      { name: "" }
    );
    expect(errors.name).toBe("Name is required");
  });

  it("returns error for null required field", () => {
    const errors = validateRequiredFields(
      [col("name", "string", { required: true })],
      { name: null }
    );
    expect(errors.name).toBe("Name is required");
  });

  it("passes for non-empty required field", () => {
    const errors = validateRequiredFields(
      [col("name", "string", { required: true })],
      { name: "Alice" }
    );
    expect(errors).toEqual({});
  });

  it("passes for non-required empty field", () => {
    const errors = validateRequiredFields(
      [col("name", "string", { required: false })],
      { name: "" }
    );
    expect(errors).toEqual({});
  });

  it("boolean required fields always pass", () => {
    const errors = validateRequiredFields(
      [col("active", "boolean", { required: true })],
      { active: false }
    );
    expect(errors).toEqual({});
  });
});

// ── initializeRecordFields ───────────────────────────────────────────

describe("initializeRecordFields", () => {
  it("initializes string with defaultValue", () => {
    const values = initializeRecordFields([
      col("name", "string", { defaultValue: "hello" }),
    ]);
    expect(values.name).toBe("hello");
  });

  it("initializes string without default to empty string", () => {
    const values = initializeRecordFields([col("name", "string")]);
    expect(values.name).toBe("");
  });

  it("initializes boolean as false", () => {
    const values = initializeRecordFields([col("active", "boolean")]);
    expect(values.active).toBe(false);
  });

  it("initializes json as empty string", () => {
    const values = initializeRecordFields([col("meta", "json")]);
    expect(values.meta).toBe("");
  });

  it("deserializes existing json object to pretty-printed string", () => {
    const values = initializeRecordFields(
      [col("meta", "json")],
      { meta: { a: 1 } }
    );
    expect(values.meta).toBe('{\n  "a": 1\n}');
  });

  it("deserializes existing number to string", () => {
    const values = initializeRecordFields(
      [col("age", "number")],
      { age: 25 }
    );
    expect(values.age).toBe("25");
  });

  it("deserializes existing boolean — pass through", () => {
    const values = initializeRecordFields(
      [col("active", "boolean")],
      { active: true }
    );
    expect(values.active).toBe(true);
  });

  it("passes through existing string", () => {
    const values = initializeRecordFields(
      [col("name", "string")],
      { name: "Alice" }
    );
    expect(values.name).toBe("Alice");
  });
});
