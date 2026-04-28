import { describe, it, expect } from "@jest/globals";

import { makeSheetAccessor } from "../../../workbook/helpers.js";
import type { SheetData, WorkbookCell } from "../../../workbook/types.js";
import { sampleWorkbookRegion } from "../sampler.js";

function cell(
  row: number,
  col: number,
  value: WorkbookCell["value"]
): WorkbookCell {
  return { row, col, value };
}

function makeDenseSheet(
  rows: number,
  cols: number,
  name = "Sheet1"
): SheetData {
  const cells: WorkbookCell[] = [];
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) {
      cells.push(cell(r, c, `r${r}c${c}`));
    }
  }
  return { name, dimensions: { rows, cols }, cells };
}

describe("sampleWorkbookRegion", () => {
  it("returns the full region unchanged when smaller than the cap", () => {
    const sheet = makeSheetAccessor(makeDenseSheet(3, 3));
    const sampled = sampleWorkbookRegion(
      sheet,
      { startRow: 1, startCol: 1, endRow: 3, endCol: 3 },
      { maxRows: 10, maxCols: 10 }
    );
    expect(sampled.truncated).toBe(false);
    expect(sampled.cells).toEqual([
      ["r1c1", "r1c2", "r1c3"],
      ["r2c1", "r2c2", "r2c3"],
      ["r3c1", "r3c2", "r3c3"],
    ]);
  });

  it("clips at maxRows and maxCols and flags truncated=true", () => {
    const sheet = makeSheetAccessor(makeDenseSheet(5, 5));
    const sampled = sampleWorkbookRegion(
      sheet,
      { startRow: 1, startCol: 1, endRow: 5, endCol: 5 },
      { maxRows: 3, maxCols: 3 }
    );
    expect(sampled.truncated).toBe(true);
    expect(sampled.cells).toHaveLength(3);
    expect(sampled.cells[0]).toHaveLength(3);
    expect(sampled.cells[0]).toEqual(["r1c1", "r1c2", "r1c3"]);
  });

  it("substitutes empty string for unset cells", () => {
    const sheet = makeSheetAccessor({
      name: "Sparse",
      dimensions: { rows: 2, cols: 2 },
      cells: [cell(1, 1, "a"), cell(2, 2, "d")],
    });
    const sampled = sampleWorkbookRegion(sheet, {
      startRow: 1,
      startCol: 1,
      endRow: 2,
      endCol: 2,
    });
    expect(sampled.cells).toEqual([
      ["a", ""],
      ["", "d"],
    ]);
  });

  it("returns an empty cell grid when bounds are inverted", () => {
    const sheet = makeSheetAccessor(makeDenseSheet(2, 2));
    const sampled = sampleWorkbookRegion(sheet, {
      startRow: 2,
      startCol: 2,
      endRow: 1,
      endCol: 1,
    });
    expect(sampled.cells).toEqual([]);
    expect(sampled.truncated).toBe(false);
  });

  it("coerces Date cells to ISO strings", () => {
    const sheet = makeSheetAccessor({
      name: "Dates",
      dimensions: { rows: 1, cols: 1 },
      cells: [cell(1, 1, new Date("2024-03-15T00:00:00Z"))],
    });
    const sampled = sampleWorkbookRegion(sheet, {
      startRow: 1,
      startCol: 1,
      endRow: 1,
      endCol: 1,
    });
    expect(sampled.cells[0][0]).toBe("2024-03-15T00:00:00.000Z");
  });

  it("applies default caps of 200 rows × 30 cols when no opts supplied", () => {
    const sheet = makeSheetAccessor(makeDenseSheet(300, 40));
    const sampled = sampleWorkbookRegion(sheet, {
      startRow: 1,
      startCol: 1,
      endRow: 300,
      endCol: 40,
    });
    expect(sampled.cells).toHaveLength(200);
    expect(sampled.cells[0]).toHaveLength(30);
    expect(sampled.truncated).toBe(true);
  });
});
