import { describe, it, expect } from "@jest/globals";

import { sanitizeColumnName } from "../../services/wide-table-reconciler.service.js";

describe("sanitizeColumnName", () => {
  it("prefixes `c_` for a base key", () => {
    expect(sanitizeColumnName("diameter_avg_km", new Set())).toBe(
      "c_diameter_avg_km"
    );
  });

  it("is idempotent against keys already prefixed with c_", () => {
    // Without the idempotence guard, this would produce `c_c_foo` —
    // the bug that corrupted field-mapping resolution during #85 §4.
    expect(sanitizeColumnName("c_foo", new Set())).toBe("c_foo");
  });

  it("is idempotent against doubly-prefixed legacy keys", () => {
    expect(sanitizeColumnName("c_c_legacy", new Set())).toBe("c_legacy");
  });

  it("lowercases and replaces non-alphanumeric characters", () => {
    expect(sanitizeColumnName("Foo-Bar.Baz", new Set())).toBe("c_foo_bar_baz");
  });

  it("collapses repeated underscores and trims leading/trailing", () => {
    expect(sanitizeColumnName("__a__b__", new Set())).toBe("c_a_b");
  });

  it("appends `_2`, `_3`, ... on collision", () => {
    expect(sanitizeColumnName("name", new Set(["c_name"]))).toBe("c_name_2");
    expect(sanitizeColumnName("name", new Set(["c_name", "c_name_2"]))).toBe(
      "c_name_3"
    );
  });
});
