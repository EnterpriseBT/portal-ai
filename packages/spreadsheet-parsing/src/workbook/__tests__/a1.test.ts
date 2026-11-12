import { describe, it, expect } from "@jest/globals";

import { columnLetters, formatA1Range } from "../a1.js";

describe("columnLetters", () => {
  it.each([
    [1, "A"],
    [26, "Z"],
    [27, "AA"],
    [52, "AZ"],
    [53, "BA"],
    [702, "ZZ"],
    [703, "AAA"],
  ])("column %i is %s", (col, letters) => {
    expect(columnLetters(col)).toBe(letters);
  });
});

describe("formatA1Range", () => {
  it("formats a range", () => {
    expect(
      formatA1Range({ startRow: 72, startCol: 2, endRow: 75, endCol: 7 })
    ).toBe("B72:G75");
  });

  it("collapses a single cell", () => {
    expect(
      formatA1Range({ startRow: 2, startCol: 2, endRow: 2, endCol: 2 })
    ).toBe("B2");
  });
});
