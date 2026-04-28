import { describe, it, expect } from "@jest/globals";

import {
  axisNameFor,
  classifyLabel,
  dynamicForTag,
} from "../segment-patterns.js";

describe("classifyLabel", () => {
  it.each(["Q1", "Q2", "Q3", "Q4", "FY26Q1", "fy26q3", "q4"])(
    "%s → quarter",
    (label) => {
      expect(classifyLabel(label)).toBe("quarter");
    }
  );

  it.each([
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
    "January",
    "February",
    "MARCH",
    "april",
    "September",
  ])("%s → month (case-insensitive)", (label) => {
    expect(classifyLabel(label)).toBe("month");
  });

  it.each(["2024", "2025", "2099", "FY26", "FY30"])("%s → year", (label) => {
    expect(classifyLabel(label)).toBe("year");
  });

  it.each(["2024-01-15", "2026-12-31", "1999-03-07"])(
    "%s → date",
    (label) => {
      expect(classifyLabel(label)).toBe("date");
    }
  );

  it.each(["Total", "TOTAL", "total", " Total "])(
    "%s → skip",
    (label) => {
      expect(classifyLabel(label)).toBe("skip");
    }
  );

  it.each(["name", "industry", "Account Owner", "Revenue", "Description"])(
    "%s → field",
    (label) => {
      expect(classifyLabel(label)).toBe("field");
    }
  );

  it("returns field for empty / whitespace-only labels", () => {
    expect(classifyLabel("")).toBe("field");
    expect(classifyLabel("   ")).toBe("field");
  });

  it("returns field for unknown tokens that look similar to patterns", () => {
    // Close-but-not-matching tokens must not silently pivot.
    expect(classifyLabel("Q5")).toBe("field"); // out-of-range quarter
    expect(classifyLabel("Janaury")).toBe("field"); // misspelled month
    expect(classifyLabel("19999")).toBe("field"); // not 4-digit year
    expect(classifyLabel("2024-1-1")).toBe("field"); // non-ISO date
  });

  it("trims surrounding whitespace before matching", () => {
    expect(classifyLabel("  Q1  ")).toBe("quarter");
    expect(classifyLabel("\tJan\n")).toBe("month");
    expect(classifyLabel(" 2024 ")).toBe("year");
  });
});

describe("axisNameFor", () => {
  it("returns the pattern's axis name for pivot tags", () => {
    expect(axisNameFor("quarter")).toBe("quarter");
    expect(axisNameFor("month")).toBe("month");
    expect(axisNameFor("year")).toBe("year");
    expect(axisNameFor("date")).toBe("date");
  });

  it("returns null for field (no pattern)", () => {
    expect(axisNameFor("field")).toBeNull();
  });

  it("returns an empty string for skip (no axis name)", () => {
    expect(axisNameFor("skip")).toBe("");
  });
});

describe("dynamicForTag", () => {
  it("is true for open-ended tags", () => {
    expect(dynamicForTag("year")).toBe(true);
    expect(dynamicForTag("date")).toBe(true);
  });

  it("is false for fixed-enum or non-pivot tags", () => {
    expect(dynamicForTag("quarter")).toBe(false);
    expect(dynamicForTag("month")).toBe(false);
    expect(dynamicForTag("skip")).toBe(false);
    expect(dynamicForTag("field")).toBe(false);
  });
});
