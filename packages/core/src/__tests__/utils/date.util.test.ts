import { DateFactory } from "../../utils/date.factory.js";
import { TZDate } from "@date-fns/tz";

// ── Tests ───────────────────────────────────────────────────────────

describe("DateFactory", () => {
  const NY = "America/New_York";
  const TOKYO = "Asia/Tokyo";

  // ── Constructor ───────────────────────────────────────────────────

  describe("constructor", () => {
    it("stores the provided time zone", () => {
      const factory = new DateFactory(NY);
      expect(factory.timeZone).toBe(NY);
    });

    it("throws when given an empty string", () => {
      expect(() => new DateFactory("")).toThrow(
        "A valid IANA time zone identifier is required."
      );
    });

    it("exposes date-fns via the fns property", () => {
      const factory = new DateFactory(NY);
      expect(typeof factory.fns.format).toBe("function");
      expect(typeof factory.fns.addDays).toBe("function");
    });

    it("should enable using the tzContext with arbitrary date-fns functions", () => {
      const factory = new DateFactory(TOKYO);
      const date = new Date("2025-03-15T00:00:00Z"); // Mar 15 09:00 JST
      const result = factory.fns.startOfMonth(date, {
        in: factory.tzContext,
      });
      expect(factory.fns.format(result, "yyyy-MM-dd")).toBe("2025-03-01");
      expect((result as TZDate).timeZone).toBe(TOKYO);
    });
  });

  // ── now() ─────────────────────────────────────────────────────────

  describe("now()", () => {
    it("returns a TZDate in the configured time zone", () => {
      const factory = new DateFactory(NY);
      const now = factory.now();

      expect(now).toBeInstanceOf(TZDate);
      expect(now.timeZone).toBe(NY);
    });
  });

  // ── toTZDate() ────────────────────────────────────────────────────

  describe("toTZDate()", () => {
    it("converts a plain Date to a TZDate in the factory time zone", () => {
      const factory = new DateFactory(TOKYO);
      const plain = new Date("2025-06-15T12:00:00Z");
      const result = factory.toTZDate(plain);

      expect(result).toBeInstanceOf(TZDate);
      expect(result.timeZone).toBe(TOKYO);
      // The underlying instant must be the same
      expect(result.getTime()).toBe(plain.getTime());
    });

    it("converts a timestamp to a TZDate", () => {
      const factory = new DateFactory(NY);
      const ts = Date.UTC(2025, 0, 1);
      const result = factory.toTZDate(ts);

      expect(result).toBeInstanceOf(TZDate);
      expect(result.getTime()).toBe(ts);
    });

    it("converts an ISO string to a TZDate", () => {
      const factory = new DateFactory(NY);
      const result = factory.toTZDate("2025-06-15T00:00:00Z");

      expect(result).toBeInstanceOf(TZDate);
      expect(result.timeZone).toBe(NY);
    });
  });

  // ── format() ──────────────────────────────────────────────────────

  describe("format()", () => {
    it("formats a date in the configured time zone", () => {
      const factory = new DateFactory("UTC");
      const date = new Date("2025-07-04T15:30:00Z");
      const result = factory.format(date, "yyyy-MM-dd HH:mm");

      expect(result).toBe("2025-07-04 15:30");
    });

    it("shifts display to the target time zone", () => {
      // midnight UTC → 09:00 JST
      const utcMidnight = new Date("2025-01-15T00:00:00Z");
      const tokyoFactory = new DateFactory(TOKYO);
      const result = tokyoFactory.format(utcMidnight, "HH:mm");

      expect(result).toBe("09:00");
    });
  });

  // ── add / sub ─────────────────────────────────────────────────────

  describe("add()", () => {
    it("adds a duration and returns a TZDate in the configured tz", () => {
      const factory = new DateFactory(NY);
      const base = new Date("2025-03-01T12:00:00Z");
      const result = factory.add(base, { days: 1, hours: 2 });

      expect(result).toBeInstanceOf(TZDate);
      expect(result.timeZone).toBe(NY);
      // 1 day + 2 hours = 26 hours ahead
      expect(result.getTime() - base.getTime()).toBe(26 * 60 * 60 * 1000);
    });
  });

  describe("sub()", () => {
    it("subtracts a duration and returns a TZDate", () => {
      const factory = new DateFactory(NY);
      const base = new Date("2025-03-02T12:00:00Z");
      const result = factory.sub(base, { days: 1 });

      expect(result.getTime()).toBe(base.getTime() - 24 * 60 * 60 * 1000);
    });
  });

  // ── startOfDay / endOfDay ─────────────────────────────────────────

  describe("startOfDay()", () => {
    it("returns midnight in the configured time zone", () => {
      const factory = new DateFactory("UTC");
      const date = new Date("2025-06-15T14:30:00Z");
      const result = factory.startOfDay(date);

      expect(result).toBeInstanceOf(TZDate);
      expect(factory.format(result, "HH:mm:ss")).toBe("00:00:00");
    });
  });

  describe("endOfDay()", () => {
    it("returns 23:59:59.999 in the configured time zone", () => {
      const factory = new DateFactory("UTC");
      const date = new Date("2025-06-15T14:30:00Z");
      const result = factory.endOfDay(date);

      expect(result).toBeInstanceOf(TZDate);
      expect(factory.format(result, "HH:mm:ss")).toBe("23:59:59");
    });
  });

  // ── isSameDay ─────────────────────────────────────────────────────

  describe("isSameDay()", () => {
    it("compares days in the configured time zone", () => {
      // These two instants are the same UTC day but straddle midnight in Tokyo
      const a = new Date("2025-01-15T14:00:00Z"); // Jan 15 23:00 JST
      const b = new Date("2025-01-15T16:00:00Z"); // Jan 16 01:00 JST

      const utcFactory = new DateFactory("UTC");
      expect(utcFactory.isSameDay(a, b)).toBe(true);

      const tokyoFactory = new DateFactory(TOKYO);
      expect(tokyoFactory.isSameDay(a, b)).toBe(false);
    });
  });

  // ── differenceInCalendarDays ──────────────────────────────────────

  describe("differenceInCalendarDays()", () => {
    it("returns the calendar day difference in the configured tz", () => {
      const factory = new DateFactory("UTC");
      const a = new Date("2025-06-15T23:00:00Z");
      const b = new Date("2025-06-14T01:00:00Z");

      expect(factory.differenceInCalendarDays(a, b)).toBe(1);
    });
  });

  // ── relativeTime (static) ─────────────────────────────────────────

  describe("relativeTime()", () => {
    it("returns 'just now' for timestamps less than 60 seconds ago", () => {
      expect(DateFactory.relativeTime(Date.now() - 30_000)).toBe("just now");
    });

    it("returns minutes ago for timestamps less than 1 hour ago", () => {
      expect(DateFactory.relativeTime(Date.now() - 5 * 60_000)).toBe("5m ago");
    });

    it("returns hours ago for timestamps less than 1 day ago", () => {
      expect(DateFactory.relativeTime(Date.now() - 3 * 3_600_000)).toBe("3h ago");
    });

    it("returns days ago for timestamps more than 1 day ago", () => {
      expect(DateFactory.relativeTime(Date.now() - 2 * 86_400_000)).toBe("2d ago");
    });
  });

  // ── now (static) ─────────────────────────────────────────────────

  describe("now()", () => {
    it("returns a number close to Date.now()", () => {
      const before = Date.now();
      const result = DateFactory.now();
      const after = Date.now();
      expect(result).toBeGreaterThanOrEqual(before);
      expect(result).toBeLessThanOrEqual(after);
    });
  });

  // ── fns passthrough with tzContext ────────────────────────────────

  describe("fns + tzContext passthrough", () => {
    it("allows using arbitrary date-fns functions with the tz context", () => {
      const factory = new DateFactory(TOKYO);
      const date = new Date("2025-03-15T00:00:00Z"); // Mar 15 09:00 JST
      const result = factory.fns.startOfMonth(factory.toTZDate(date), {
        in: factory.tzContext,
      });

      expect(factory.fns.format(result, "yyyy-MM-dd")).toBe("2025-03-01");
      expect((result as TZDate).timeZone).toBe(TOKYO);
    });
  });
});
