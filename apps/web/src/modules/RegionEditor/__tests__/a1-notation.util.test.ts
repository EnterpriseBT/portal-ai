import {
  colIndexToLetter,
  coordInBounds,
  formatBounds,
  formatCell,
  letterToColIndex,
  normalizeBounds,
} from "../utils/a1-notation.util";

describe("colIndexToLetter", () => {
  test("single-letter columns", () => {
    expect(colIndexToLetter(0)).toBe("A");
    expect(colIndexToLetter(25)).toBe("Z");
  });

  test("two-letter columns wrap correctly", () => {
    expect(colIndexToLetter(26)).toBe("AA");
    expect(colIndexToLetter(27)).toBe("AB");
    expect(colIndexToLetter(51)).toBe("AZ");
    expect(colIndexToLetter(52)).toBe("BA");
  });
});

describe("letterToColIndex", () => {
  test("is the inverse of colIndexToLetter", () => {
    for (const i of [0, 1, 25, 26, 27, 51, 52, 100]) {
      expect(letterToColIndex(colIndexToLetter(i))).toBe(i);
    }
  });
});

describe("formatCell / formatBounds", () => {
  test("formatCell returns A1 notation", () => {
    expect(formatCell({ row: 0, col: 0 })).toBe("A1");
    expect(formatCell({ row: 4, col: 2 })).toBe("C5");
  });

  test("formatBounds collapses single-cell ranges", () => {
    expect(
      formatBounds({ startRow: 0, endRow: 0, startCol: 0, endCol: 0 })
    ).toBe("A1");
  });

  test("formatBounds expands multi-cell ranges", () => {
    expect(
      formatBounds({ startRow: 0, endRow: 4, startCol: 1, endCol: 3 })
    ).toBe("B1:D5");
  });
});

describe("normalizeBounds", () => {
  test("orders start/end regardless of drag direction", () => {
    const b = normalizeBounds({ row: 5, col: 3 }, { row: 2, col: 1 });
    expect(b).toEqual({ startRow: 2, endRow: 5, startCol: 1, endCol: 3 });
  });

  test("handles single-cell selection", () => {
    const b = normalizeBounds({ row: 3, col: 2 }, { row: 3, col: 2 });
    expect(b).toEqual({ startRow: 3, endRow: 3, startCol: 2, endCol: 2 });
  });
});

describe("coordInBounds", () => {
  const bounds = { startRow: 1, endRow: 3, startCol: 2, endCol: 4 };

  test("true inside bounds", () => {
    expect(coordInBounds({ row: 2, col: 3 }, bounds)).toBe(true);
  });

  test("true on edges", () => {
    expect(coordInBounds({ row: 1, col: 2 }, bounds)).toBe(true);
    expect(coordInBounds({ row: 3, col: 4 }, bounds)).toBe(true);
  });

  test("false outside bounds", () => {
    expect(coordInBounds({ row: 0, col: 2 }, bounds)).toBe(false);
    expect(coordInBounds({ row: 4, col: 2 }, bounds)).toBe(false);
    expect(coordInBounds({ row: 2, col: 5 }, bounds)).toBe(false);
  });
});

