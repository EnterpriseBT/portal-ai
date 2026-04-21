import { describe, it, expect } from "@jest/globals";

import {
  sourceFieldToNormalizedKey,
  sourceLocatorToNormalizedKey,
} from "../normalized-key.js";

describe("sourceFieldToNormalizedKey", () => {
  it("lowercases and replaces non-alphanumerics with underscores", () => {
    expect(sourceFieldToNormalizedKey("Email Address")).toBe("email_address");
    expect(sourceFieldToNormalizedKey("Customer ID!")).toBe("customer_id");
  });

  it("trims leading / trailing underscores after normalisation", () => {
    expect(sourceFieldToNormalizedKey("  email  ")).toBe("email");
    expect(sourceFieldToNormalizedKey("!!!email!!!")).toBe("email");
  });

  it("collapses repeated separators", () => {
    expect(sourceFieldToNormalizedKey("foo -- bar")).toBe("foo_bar");
  });

  it("prefixes with f_ when the normalised value starts with a digit", () => {
    expect(sourceFieldToNormalizedKey("2024 revenue")).toBe("f_2024_revenue");
  });

  it("falls back to 'field' when normalisation empties the string", () => {
    expect(sourceFieldToNormalizedKey("!!!")).toBe("field");
    expect(sourceFieldToNormalizedKey("   ")).toBe("field");
  });

  it("passes an already-valid key through unchanged", () => {
    expect(sourceFieldToNormalizedKey("email_address")).toBe("email_address");
  });
});

describe("sourceLocatorToNormalizedKey", () => {
  it("handles byHeaderName locators", () => {
    expect(sourceLocatorToNormalizedKey("header:Email Address")).toBe(
      "email_address"
    );
  });

  it("handles byColumnIndex locators", () => {
    expect(sourceLocatorToNormalizedKey("col:3")).toBe("col_3");
    expect(sourceLocatorToNormalizedKey("col:17")).toBe("col_17");
  });

  it("falls back to raw normalisation when the prefix is unknown", () => {
    expect(sourceLocatorToNormalizedKey("weird:value")).toBe("weird_value");
  });
});
