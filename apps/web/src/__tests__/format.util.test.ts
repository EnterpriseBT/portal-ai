import { Formatter } from "../utils/format.util";

describe("Formatter", () => {
  // ── format (dispatch) ───────────────────────────────────────────

  describe("format", () => {
    it("returns dash for null", () => {
      expect(Formatter.format(null, "string")).toBe("—");
    });

    it("returns dash for undefined", () => {
      expect(Formatter.format(undefined, "number")).toBe("—");
    });

    it("delegates to the correct type formatter", () => {
      expect(Formatter.format(true, "boolean")).toBe("Yes");
      expect(Formatter.format("hello", "string")).toBe("hello");
    });

    it("passes options through to type-specific formatters", () => {
      expect(
        Formatter.format(true, "boolean", {
          boolean: { trueLabel: "Active" },
        })
      ).toBe("Active");

      expect(
        Formatter.format("2025-06-15", "date", {
          date: { format: "dd/MM/yyyy" },
        })
      ).toBe("15/06/2025");

      expect(
        Formatter.format("2025-06-15T10:30:00Z", "datetime", {
          datetime: { format: "HH:mm" },
        })
      ).toBe("10:30");
    });
  });

  // ── string ──────────────────────────────────────────────────────

  describe("string", () => {
    it("converts value to string", () => {
      expect(Formatter.string("hello")).toBe("hello");
      expect(Formatter.string(42)).toBe("42");
    });
  });

  // ── number ──────────────────────────────────────────────────────

  describe("number", () => {
    it("formats a number with locale", () => {
      expect(Formatter.number(1000)).toBe((1000).toLocaleString());
    });

    it("parses a numeric string", () => {
      expect(Formatter.number("1234")).toBe((1234).toLocaleString());
    });

    it("returns string as-is for non-numeric input", () => {
      expect(Formatter.number("abc")).toBe("abc");
    });
  });

  // ── boolean ─────────────────────────────────────────────────────

  describe("boolean", () => {
    it("returns Yes for truthy by default", () => {
      expect(Formatter.boolean(true)).toBe("Yes");
      expect(Formatter.boolean(1)).toBe("Yes");
    });

    it("returns No for falsy by default", () => {
      expect(Formatter.boolean(false)).toBe("No");
      expect(Formatter.boolean(0)).toBe("No");
    });

    it("uses custom trueLabel", () => {
      expect(Formatter.boolean(true, { trueLabel: "Active" })).toBe("Active");
    });

    it("uses custom falseLabel", () => {
      expect(Formatter.boolean(false, { falseLabel: "Inactive" })).toBe(
        "Inactive"
      );
    });

    it("uses both custom labels together", () => {
      const opts = { trueLabel: "On", falseLabel: "Off" };
      expect(Formatter.boolean(true, opts)).toBe("On");
      expect(Formatter.boolean(false, opts)).toBe("Off");
    });
  });

  // ── date ────────────────────────────────────────────────────────

  describe("date", () => {
    it("formats as yyyy-MM-dd by default", () => {
      expect(Formatter.date("2025-06-15")).toBe("2025-06-15");
    });

    it("formats a timestamp as yyyy-MM-dd", () => {
      const ts = 1718409600000;
      expect(Formatter.date(ts)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("accepts a custom format string", () => {
      expect(Formatter.date("2025-06-15", { format: "dd/MM/yyyy" })).toBe(
        "15/06/2025"
      );
    });

    it("accepts a short format", () => {
      expect(Formatter.date("2025-06-15", { format: "MMM d, yyyy" })).toBe(
        "Jun 15, 2025"
      );
    });

    it("returns raw value for invalid date", () => {
      expect(Formatter.date("not-a-date")).toBe("not-a-date");
    });
  });

  // ── datetime ────────────────────────────────────────────────────

  describe("datetime", () => {
    it("formats as yyyy-MM-dd HH:mm:ss by default", () => {
      const result = Formatter.datetime("2025-06-15T10:30:00Z");
      expect(result).toBe("2025-06-15 10:30:00");
    });

    it("accepts a custom format string", () => {
      expect(
        Formatter.datetime("2025-06-15T10:30:00Z", {
          format: "dd MMM yyyy, HH:mm",
        })
      ).toBe("15 Jun 2025, 10:30");
    });

    it("accepts a time-only format", () => {
      expect(
        Formatter.datetime("2025-06-15T10:30:00Z", { format: "HH:mm" })
      ).toBe("10:30");
    });

    it("returns raw value for invalid datetime", () => {
      expect(Formatter.datetime("nope")).toBe("nope");
    });
  });

  // ── enum ────────────────────────────────────────────────────────

  describe("enum", () => {
    it("converts to string", () => {
      expect(Formatter.enum("active")).toBe("active");
    });
  });

  // ── json ────────────────────────────────────────────────────────

  describe("json", () => {
    it("returns string values as-is", () => {
      expect(Formatter.json('{"a":1}')).toBe('{"a":1}');
    });

    it("stringifies objects", () => {
      expect(Formatter.json({ a: 1 })).toBe('{"a":1}');
    });

    it("stringifies arrays", () => {
      expect(Formatter.json([1, 2])).toBe("[1,2]");
    });
  });

  // ── array ───────────────────────────────────────────────────────

  describe("array", () => {
    it("joins array elements with comma", () => {
      expect(Formatter.array(["a", "b", "c"])).toBe("a, b, c");
    });

    it("returns string for non-array", () => {
      expect(Formatter.array("not-array")).toBe("not-array");
    });
  });

  // ── reference ───────────────────────────────────────────────────

  describe("reference", () => {
    it("converts to string", () => {
      expect(Formatter.reference("ref-123")).toBe("ref-123");
    });
  });

  // ── canonicalFormat support ────────────────────────────────────

  describe("format with canonicalFormat", () => {
    it("applies canonicalFormat to date type (overrides default)", () => {
      expect(
        Formatter.format("2025-06-15", "date", {
          canonicalFormat: "dd/MM/yyyy",
        })
      ).toBe("15/06/2025");
    });

    it("applies canonicalFormat to datetime type", () => {
      expect(
        Formatter.format("2025-06-15T10:30:00Z", "datetime", {
          canonicalFormat: "HH:mm",
        })
      ).toBe("10:30");
    });

    it("applies canonicalFormat to number type with currency prefix", () => {
      const result = Formatter.format(1234.5, "number", {
        canonicalFormat: "$#,##0.00",
      });
      expect(result).toMatch(/^\$/);
      expect(result).toContain("1");
    });

    it("applies canonicalFormat to number with fixed decimals", () => {
      const result = Formatter.format(42, "number", {
        canonicalFormat: "#,##0.00",
      });
      // Should have 2 decimal places
      expect(result).toMatch(/42[.,]00/);
    });

    it("ignores canonicalFormat when null", () => {
      expect(
        Formatter.format("2025-06-15", "date", { canonicalFormat: null })
      ).toBe("2025-06-15");
    });

    it("ignores canonicalFormat for string type", () => {
      expect(
        Formatter.format("hello", "string", { canonicalFormat: "UPPER" })
      ).toBe("hello");
    });
  });

  // ── numberWithFormat ──────────────────────────────────────────

  describe("numberWithFormat", () => {
    it("formats with currency prefix", () => {
      const result = Formatter.numberWithFormat(1234.5, "$#,##0.00");
      expect(result).toMatch(/^\$/);
    });

    it("formats with fixed decimal places", () => {
      const result = Formatter.numberWithFormat(42, "#,##0.00");
      expect(result).toMatch(/42[.,]00/);
    });

    it("returns string for NaN input", () => {
      expect(Formatter.numberWithFormat("abc", "$#,##0.00")).toBe("abc");
    });
  });
});
