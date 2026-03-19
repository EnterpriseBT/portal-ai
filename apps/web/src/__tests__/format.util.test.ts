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

      expect(
        Formatter.format(42.5, "currency", {
          currency: { currency: "USD", locale: "en-US" },
        })
      ).toBe("$42.50");
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
      expect(Formatter.boolean(true, { trueLabel: "Active" })).toBe(
        "Active"
      );
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

  // ── currency ────────────────────────────────────────────────────

  describe("currency", () => {
    it("formats a number with two decimal places by default", () => {
      const result = Formatter.currency(1234.5);
      expect(result).toContain("1");
      expect(result).toContain("234");
      expect(result).toContain("50");
    });

    it("parses a numeric string", () => {
      const result = Formatter.currency("99.9");
      expect(result).toContain("99");
      expect(result).toContain("90");
    });

    it("returns raw value for non-numeric input", () => {
      expect(Formatter.currency("N/A")).toBe("N/A");
    });

    it("formats with USD currency code", () => {
      const result = Formatter.currency(42.5, {
        currency: "USD",
        locale: "en-US",
      });
      expect(result).toBe("$42.50");
    });

    it("formats with EUR currency code", () => {
      const result = Formatter.currency(42.5, {
        currency: "EUR",
        locale: "de-DE",
      });
      expect(result).toContain("42,50");
      expect(result).toContain("€");
    });

    it("respects custom fraction digits", () => {
      const result = Formatter.currency(42.1234, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 4,
      });
      expect(result).toContain("1234");
    });
  });
});
