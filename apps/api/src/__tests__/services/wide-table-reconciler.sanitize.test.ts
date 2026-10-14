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

  // #801: Postgres silently truncates an identifier past 63 bytes, so two
  // long keys sharing a prefix would land on one column.
  describe("63-byte identifier limit", () => {
    const bytes = (s: string) => Buffer.byteLength(s, "utf8");

    it("clips a long key to fit", () => {
      const name = sanitizeColumnName("k".repeat(200), new Set());
      expect(bytes(name)).toBeLessThanOrEqual(63);
      expect(name.startsWith("c_kkk")).toBe(true);
    });

    it("keeps two long keys with a shared prefix apart", () => {
      const prefix = "p".repeat(70);
      const first = sanitizeColumnName(`${prefix}_alpha`, new Set());
      const second = sanitizeColumnName(`${prefix}_beta`, new Set([first]));
      expect(second).not.toBe(first);
      expect(bytes(first)).toBeLessThanOrEqual(63);
      expect(bytes(second)).toBeLessThanOrEqual(63);
    });

    it("stays within the limit at a three-digit collision suffix", () => {
      const base = sanitizeColumnName("k".repeat(200), new Set());
      const taken = new Set([base]);
      for (let i = 2; i <= 120; i++) {
        const next = sanitizeColumnName("k".repeat(200), taken);
        expect(bytes(next)).toBeLessThanOrEqual(63);
        expect(taken.has(next)).toBe(false);
        taken.add(next);
      }
    });

    it("treats a column Postgres already truncated as taken", () => {
      // Created before the limit: the catalog holds the full name, Postgres
      // holds its first 63 bytes.
      const legacy = `c_${"p".repeat(70)}`;
      const next = sanitizeColumnName(
        `${"p".repeat(61)}_other`,
        new Set([legacy])
      );
      expect(next).not.toBe(legacy.slice(0, 63));
      expect(bytes(next)).toBeLessThanOrEqual(63);
    });

    it("leaves a key that already fits unchanged", () => {
      expect(sanitizeColumnName("k".repeat(58), new Set())).toBe(
        `c_${"k".repeat(58)}`
      );
      expect(sanitizeColumnName("k".repeat(61), new Set())).toBe(
        `c_${"k".repeat(61)}`
      );
    });
  });
});
