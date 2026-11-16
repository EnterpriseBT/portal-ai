import {
  colIndexToLetter,
  coordInBounds,
  formatBounds,
  formatCell,
  letterToColIndex,
  normalizeBounds,
  parseRange,
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

describe("parseRange (#795)", () => {
  const sheet = { rowCount: 200, colCount: 26 };

  test("parses a rectangle", () => {
    expect(parseRange("A1:D20", sheet)).toEqual({
      ok: true,
      bounds: { startRow: 0, endRow: 19, startCol: 0, endCol: 3 },
    });
  });

  test("normalizes a reversed rectangle", () => {
    expect(parseRange("D20:A1", sheet)).toEqual(parseRange("A1:D20", sheet));
  });

  test("parses a single cell", () => {
    expect(parseRange("B3", sheet)).toEqual({
      ok: true,
      bounds: { startRow: 2, endRow: 2, startCol: 1, endCol: 1 },
    });
  });

  test("parses full-height columns", () => {
    expect(parseRange("A:D", sheet)).toEqual({
      ok: true,
      bounds: { startRow: 0, endRow: 199, startCol: 0, endCol: 3 },
    });
  });

  test("parses full-width rows", () => {
    expect(parseRange("3:10", sheet)).toEqual({
      ok: true,
      bounds: { startRow: 2, endRow: 9, startCol: 0, endCol: 25 },
    });
  });

  test("ignores case and surrounding whitespace", () => {
    expect(parseRange("  b2 : c4 ", sheet)).toEqual({
      ok: true,
      bounds: { startRow: 1, endRow: 3, startCol: 1, endCol: 2 },
    });
  });

  test.each(["", "   ", "hello", "A0", "A1:", "1A", "A1:B2:C3", "A:3"])(
    "rejects %j with the format hint",
    (input) => {
      expect(parseRange(input, sheet)).toEqual({
        ok: false,
        error: "Enter a range like A1:D20",
      });
    }
  );

  test.each(["A1:AA1", "A1:A201", "AB:AC", "199:201"])(
    "rejects %j as outside the sheet",
    (input) => {
      expect(parseRange(input, sheet)).toEqual({
        ok: false,
        error: "Outside the sheet (A1:Z200)",
      });
    }
  );
});
