import { describe, it, expect } from "@jest/globals";

import {
  coerceString,
  coerceNumber,
  coerceBoolean,
  coerceDate,
  coerceDatetime,
  coerceEnum,
  coerceJson,
  coerceArray,
  coerceReference,
  coerceReferenceArray,
  coerce,
} from "../../utils/coercion.util.js";

// ── coerceString ────────────────────────────────────────────────────

describe("coerceString", () => {
  it("returns null for null", () => {
    expect(coerceString(null)).toEqual({ value: null });
  });

  it("returns null for undefined", () => {
    expect(coerceString(undefined)).toEqual({ value: null });
  });

  it("converts a number to string", () => {
    expect(coerceString(42)).toEqual({ value: "42" });
  });

  it("converts an object to string", () => {
    expect(coerceString({ a: 1 })).toEqual({ value: "[object Object]" });
  });

  it("passes through a string", () => {
    expect(coerceString("hello")).toEqual({ value: "hello" });
  });
});

// ── coerceNumber ────────────────────────────────────────────────────

describe("coerceNumber", () => {
  it("returns null for null", () => {
    expect(coerceNumber(null)).toEqual({ value: null });
  });

  it("returns null for undefined", () => {
    expect(coerceNumber(undefined)).toEqual({ value: null });
  });

  it("returns null for empty string", () => {
    expect(coerceNumber("")).toEqual({ value: null });
  });

  it("passes through a valid number", () => {
    expect(coerceNumber(42)).toEqual({ value: 42 });
  });

  it("returns error for NaN number", () => {
    expect(coerceNumber(NaN)).toEqual({
      value: null,
      error: "Expected a number",
    });
  });

  it("parses a simple numeric string", () => {
    expect(coerceNumber("123.45")).toEqual({ value: 123.45 });
  });

  it("strips commas from formatted numbers", () => {
    expect(coerceNumber("1,234.56")).toEqual({ value: 1234.56 });
  });

  it("strips dollar sign", () => {
    expect(coerceNumber("$99")).toEqual({ value: 99 });
  });

  it("strips euro sign", () => {
    expect(coerceNumber("€50")).toEqual({ value: 50 });
  });

  it("handles European format with eu hint", () => {
    expect(coerceNumber("1.234,56", "eu")).toEqual({ value: 1234.56 });
  });

  it("handles European format with comma hint", () => {
    expect(coerceNumber("1.234,56", ",")).toEqual({ value: 1234.56 });
  });

  it("returns error for non-numeric string", () => {
    expect(coerceNumber("abc")).toEqual({
      value: null,
      error: "Expected a number",
    });
  });

  it("handles whitespace-padded numbers", () => {
    expect(coerceNumber("  42  ")).toEqual({ value: 42 });
  });

  it("rounds to 2 decimal places with currency format", () => {
    expect(coerceNumber("$19.999", "currency")).toEqual({ value: 20 });
    expect(coerceNumber("$1,234.567", "currency")).toEqual({ value: 1234.57 });
    expect(coerceNumber(9.999, "currency")).toEqual({ value: 10 });
  });

  it("rounds to N decimal places with precision:N format", () => {
    expect(coerceNumber("3.14159", "precision:2")).toEqual({ value: 3.14 });
    expect(coerceNumber("3.14159", "precision:4")).toEqual({ value: 3.1416 });
    expect(coerceNumber("3.14159", "precision:0")).toEqual({ value: 3 });
    expect(coerceNumber(2.5, "precision:0")).toEqual({ value: 3 });
  });

  it("ignores invalid precision format", () => {
    expect(coerceNumber("3.14", "precision:abc")).toEqual({ value: 3.14 });
    expect(coerceNumber("3.14", "precision:")).toEqual({ value: 3.14 });
  });
});

// ── coerceBoolean ───────────────────────────────────────────────────

describe("coerceBoolean", () => {
  it("returns null for null", () => {
    expect(coerceBoolean(null)).toEqual({ value: null });
  });

  it("returns null for undefined", () => {
    expect(coerceBoolean(undefined)).toEqual({ value: null });
  });

  it("returns null for empty string", () => {
    expect(coerceBoolean("")).toEqual({ value: null });
  });

  it("passes through true", () => {
    expect(coerceBoolean(true)).toEqual({ value: true });
  });

  it("passes through false", () => {
    expect(coerceBoolean(false)).toEqual({ value: false });
  });

  it.each(["true", "yes", "1", "on", "TRUE", "Yes"])(
    'maps "%s" to true',
    (v) => {
      expect(coerceBoolean(v)).toEqual({ value: true });
    },
  );

  it.each(["false", "no", "0", "off", "FALSE", "No"])(
    'maps "%s" to false',
    (v) => {
      expect(coerceBoolean(v)).toEqual({ value: false });
    },
  );

  it("returns error for unrecognized string", () => {
    expect(coerceBoolean("maybe")).toEqual({
      value: null,
      error: "Expected a boolean",
    });
  });

  it("uses custom format labels — true label", () => {
    expect(coerceBoolean("active", "active/inactive")).toEqual({ value: true });
  });

  it("uses custom format labels — false label", () => {
    expect(coerceBoolean("inactive", "active/inactive")).toEqual({
      value: false,
    });
  });

  it("uses custom format labels — case insensitive", () => {
    expect(coerceBoolean("ACTIVE", "active/inactive")).toEqual({ value: true });
  });

  it("returns error for unrecognized custom label", () => {
    const result = coerceBoolean("unknown", "active/inactive");
    expect(result.value).toBeNull();
    expect(result.error).toContain("active");
    expect(result.error).toContain("inactive");
  });
});

// ── coerceDate ──────────────────────────────────────────────────────

describe("coerceDate", () => {
  it("returns null for null", () => {
    expect(coerceDate(null)).toEqual({ value: null });
  });

  it("returns null for undefined", () => {
    expect(coerceDate(undefined)).toEqual({ value: null });
  });

  it("parses an ISO date string", () => {
    expect(coerceDate("2024-01-15")).toEqual({ value: "2024-01-15" });
  });

  it("parses an ISO datetime and extracts date", () => {
    expect(coerceDate("2024-01-15T10:30:00.000Z")).toEqual({
      value: "2024-01-15",
    });
  });

  it("parses with a format hint", () => {
    expect(coerceDate("01/15/2024", "MM/dd/yyyy")).toEqual({
      value: "2024-01-15",
    });
  });

  it("parses DD-MM-YYYY format", () => {
    expect(coerceDate("15-01-2024", "dd-MM-yyyy")).toEqual({
      value: "2024-01-15",
    });
  });

  it("returns error for invalid date", () => {
    expect(coerceDate("not-a-date")).toEqual({
      value: null,
      error: "Expected a valid date",
    });
  });

  it("returns error for empty string", () => {
    expect(coerceDate("")).toEqual({
      value: null,
      error: "Expected a valid date",
    });
  });

  it("parses YYYY-MM-DD format (moment.js convention) without throwing", () => {
    // AI tools emit moment.js tokens; YYYY must be normalised to yyyy before date-fns sees it
    expect(coerceDate("2021-09-05", "YYYY-MM-DD")).toEqual({ value: "2021-09-05" });
  });

  it("parses DD/MM/YYYY format (moment.js convention) without throwing", () => {
    expect(coerceDate("05/09/2021", "DD/MM/YYYY")).toEqual({ value: "2021-09-05" });
  });

  it("parses mixed-case format MM/DD/YYYY without throwing", () => {
    expect(coerceDate("09/05/2021", "MM/DD/YYYY")).toEqual({ value: "2021-09-05" });
  });

  it("returns date error gracefully for a completely malformed format string", () => {
    // Should not throw even if date-fns cannot interpret the format at all
    expect(() => coerceDate("2021-09-05", "!!!invalid!!!")).not.toThrow();
    const result = coerceDate("2021-09-05", "!!!invalid!!!");
    expect(result.value).toBeNull();
    expect(result.error).toBe("Expected a valid date");
  });
});

// ── coerceDatetime ──────────────────────────────────────────────────

describe("coerceDatetime", () => {
  it("returns null for null", () => {
    expect(coerceDatetime(null)).toEqual({ value: null });
  });

  it("parses an ISO datetime string", () => {
    const result = coerceDatetime("2024-01-15T10:30:00.000Z");
    expect(result.error).toBeUndefined();
    // DateFactory.format with XXX may output Z or +00:00 for UTC
    expect(result.value).toMatch(/^2024-01-15T10:30:00\.000(Z|\+00:00)$/);
  });

  it("parses a date-only string and adds time component", () => {
    const result = coerceDatetime("2024-01-15");
    expect(result.error).toBeUndefined();
    expect((result.value as string).startsWith("2024-01-15T")).toBe(true);
  });

  it("parses with a format hint", () => {
    const result = coerceDatetime(
      "01/15/2024 14:30",
      "MM/dd/yyyy HH:mm",
    );
    expect(result.error).toBeUndefined();
    expect((result.value as string).startsWith("2024-01-15T")).toBe(true);
  });

  it("returns error for invalid datetime", () => {
    expect(coerceDatetime("not-a-date")).toEqual({
      value: null,
      error: "Expected a valid datetime",
    });
  });

  it("parses YYYY-MM-DD HH:mm:ss format (moment.js convention) without throwing", () => {
    const result = coerceDatetime("2021-09-05 14:30:00", "YYYY-MM-DD HH:mm:ss");
    expect(result.error).toBeUndefined();
    expect((result.value as string).startsWith("2021-09-05T")).toBe(true);
  });

  it("returns datetime error gracefully for a completely malformed format string", () => {
    expect(() => coerceDatetime("2021-09-05", "!!!invalid!!!")).not.toThrow();
    const result = coerceDatetime("2021-09-05", "!!!invalid!!!");
    expect(result.value).toBeNull();
    expect(result.error).toBe("Expected a valid datetime");
  });
});

// ── coerceEnum ──────────────────────────────────────────────────────

describe("coerceEnum", () => {
  it("returns null for null", () => {
    expect(coerceEnum(null)).toEqual({ value: null });
  });

  it("passes through as string", () => {
    expect(coerceEnum("active")).toEqual({ value: "active" });
  });

  it("converts number to string", () => {
    expect(coerceEnum(1)).toEqual({ value: "1" });
  });
});

// ── coerceJson ──────────────────────────────────────────────────────

describe("coerceJson", () => {
  it("returns null for null", () => {
    expect(coerceJson(null)).toEqual({ value: null });
  });

  it("passes through an object", () => {
    const obj = { a: 1, b: "two" };
    expect(coerceJson(obj)).toEqual({ value: obj });
  });

  it("passes through an array", () => {
    const arr = [1, 2, 3];
    expect(coerceJson(arr)).toEqual({ value: arr });
  });

  it("parses a valid JSON string", () => {
    expect(coerceJson('{"key":"value"}')).toEqual({
      value: { key: "value" },
    });
  });

  it("returns error for invalid JSON string", () => {
    expect(coerceJson("{bad json}")).toEqual({
      value: null,
      error: "Invalid JSON",
    });
  });

  it("returns error for non-object, non-string types", () => {
    expect(coerceJson(42)).toEqual({ value: null, error: "Invalid JSON" });
  });
});

// ── coerceArray ─────────────────────────────────────────────────────

describe("coerceArray", () => {
  it("returns null for null", () => {
    expect(coerceArray(null)).toEqual({ value: null });
  });

  it("passes through an array", () => {
    expect(coerceArray([1, 2])).toEqual({ value: [1, 2] });
  });

  it("splits a comma-separated string", () => {
    expect(coerceArray("a,b,c")).toEqual({ value: ["a", "b", "c"] });
  });

  it("trims whitespace when splitting", () => {
    expect(coerceArray("a , b , c")).toEqual({ value: ["a", "b", "c"] });
  });

  it("uses custom delimiter from format", () => {
    expect(coerceArray("a|b|c", "|")).toEqual({ value: ["a", "b", "c"] });
  });

  it("wraps non-string, non-array values", () => {
    expect(coerceArray(42)).toEqual({ value: [42] });
  });
});

// ── coerceReference ─────────────────────────────────────────────────

describe("coerceReference", () => {
  it("returns null for null", () => {
    expect(coerceReference(null)).toEqual({ value: null });
  });

  it("converts to string", () => {
    expect(coerceReference("ref-123")).toEqual({ value: "ref-123" });
  });

  it("converts number to string", () => {
    expect(coerceReference(123)).toEqual({ value: "123" });
  });
});

// ── coerceReferenceArray ────────────────────────────────────────────

describe("coerceReferenceArray", () => {
  it("returns null for null", () => {
    expect(coerceReferenceArray(null)).toEqual({ value: null });
  });

  it("passes through an array", () => {
    expect(coerceReferenceArray(["a", "b"])).toEqual({ value: ["a", "b"] });
  });

  it("splits a comma-separated string", () => {
    expect(coerceReferenceArray("a,b,c")).toEqual({
      value: ["a", "b", "c"],
    });
  });

  it("uses custom delimiter from format", () => {
    expect(coerceReferenceArray("a|b|c", "|")).toEqual({
      value: ["a", "b", "c"],
    });
  });

  it("wraps non-string, non-array values", () => {
    expect(coerceReferenceArray(42)).toEqual({ value: [42] });
  });
});

// ── coerce (dispatcher) ────────────────────────────────────────────

describe("coerce", () => {
  it("routes string type to coerceString", () => {
    expect(coerce("string", 42)).toEqual({ value: "42" });
  });

  it("routes number type to coerceNumber", () => {
    expect(coerce("number", "$99")).toEqual({ value: 99 });
  });

  it("routes boolean type to coerceBoolean", () => {
    expect(coerce("boolean", "yes")).toEqual({ value: true });
  });

  it("routes date type to coerceDate", () => {
    expect(coerce("date", "2024-01-15")).toEqual({ value: "2024-01-15" });
  });

  it("routes datetime type to coerceDatetime", () => {
    const result = coerce("datetime", "2024-01-15T10:30:00.000Z");
    expect(result.error).toBeUndefined();
    expect((result.value as string).startsWith("2024-01-15T")).toBe(true);
  });

  it("routes enum type to coerceEnum", () => {
    expect(coerce("enum", "active")).toEqual({ value: "active" });
  });

  it("routes json type to coerceJson", () => {
    expect(coerce("json", '{"a":1}')).toEqual({ value: { a: 1 } });
  });

  it("routes array type to coerceArray", () => {
    expect(coerce("array", "a,b")).toEqual({ value: ["a", "b"] });
  });

  it("routes reference type to coerceReference", () => {
    expect(coerce("reference", "id-1")).toEqual({ value: "id-1" });
  });

  it("routes reference-array type to coerceReferenceArray", () => {
    expect(coerce("reference-array", "a,b")).toEqual({
      value: ["a", "b"],
    });
  });

  it("passes format through to the coercion function", () => {
    expect(coerce("number", "1.234,56", "eu")).toEqual({ value: 1234.56 });
  });

  it("returns null for null across all types", () => {
    const types: Array<import("@portalai/core/models").ColumnDataType> = [
      "string", "number", "boolean", "date", "datetime",
      "enum", "json", "array", "reference", "reference-array",
    ];
    for (const t of types) {
      expect(coerce(t, null)).toEqual({ value: null });
    }
  });
});
