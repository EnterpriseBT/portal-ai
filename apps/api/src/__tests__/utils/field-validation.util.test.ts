import { describe, it, expect } from "@jest/globals";

import {
  validateRequired,
  validatePattern,
  validateEnum,
} from "../../utils/field-validation.util.js";

// ── validateRequired ────────────────────────────────────────────────

describe("validateRequired", () => {
  it("returns error for null", () => {
    expect(validateRequired(null)).toBe("Required field is missing");
  });

  it("returns error for undefined", () => {
    expect(validateRequired(undefined)).toBe("Required field is missing");
  });

  it("returns error for empty string", () => {
    expect(validateRequired("")).toBe("Required field is missing");
  });

  it("returns null for a non-empty string", () => {
    expect(validateRequired("value")).toBeNull();
  });

  it("returns null for 0", () => {
    expect(validateRequired(0)).toBeNull();
  });

  it("returns null for false", () => {
    expect(validateRequired(false)).toBeNull();
  });
});

// ── validatePattern ─────────────────────────────────────────────────

describe("validatePattern", () => {
  it("returns null when value is null (skip)", () => {
    expect(validatePattern(null, ".*")).toBeNull();
  });

  it("returns null when value is undefined (skip)", () => {
    expect(validatePattern(undefined, ".*")).toBeNull();
  });

  it("returns null when value matches pattern", () => {
    expect(validatePattern("test@example.com", "^.+@.+\\..+$")).toBeNull();
  });

  it("returns default message when value does not match", () => {
    const result = validatePattern("bad", "^\\d+$");
    expect(result).toBe("Does not match pattern ^\\d+$");
  });

  it("returns custom message when provided", () => {
    const result = validatePattern("bad", "^\\d+$", "Must be numeric");
    expect(result).toBe("Must be numeric");
  });

  it("returns null when custom message is null and value matches", () => {
    expect(validatePattern("123", "^\\d+$", null)).toBeNull();
  });

  it("returns null for an invalid regex pattern without throwing", () => {
    // AI-generated patterns can be syntactically invalid; should never crash the import
    expect(() => validatePattern("value", "[unclosed", null)).not.toThrow();
    expect(validatePattern("value", "[unclosed", null)).toBeNull();
  });

  it("returns null for another invalid regex pattern without throwing", () => {
    expect(validatePattern("value", "(?P<bad>invalid)", null)).toBeNull();
  });
});

// ── validateEnum ────────────────────────────────────────────────────

describe("validateEnum", () => {
  it("returns null when value is null (skip)", () => {
    expect(validateEnum(null, ["a", "b"])).toBeNull();
  });

  it("returns null when value is undefined (skip)", () => {
    expect(validateEnum(undefined, ["a", "b"])).toBeNull();
  });

  it("returns null when value is a member", () => {
    expect(validateEnum("a", ["a", "b", "c"])).toBeNull();
  });

  it("returns error when value is not a member", () => {
    const result = validateEnum("d", ["a", "b", "c"]);
    expect(result).toBe("Value 'd' is not one of: a, b, c");
  });

  it("coerces number to string for comparison", () => {
    expect(validateEnum(1, ["1", "2", "3"])).toBeNull();
  });
});
