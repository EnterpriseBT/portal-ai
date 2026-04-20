import { describe, it, expect } from "@jest/globals";

import {
  WorkbookSchema,
  WorkbookCellSchema,
  SheetDataSchema,
  makeWorkbook,
  makeSheetAccessor,
  computeWorkbookFingerprint,
} from "../index.js";
import type { SheetData, WorkbookCell } from "../index.js";

const cell = (
  row: number,
  col: number,
  value: WorkbookCell["value"],
  extra: Partial<WorkbookCell> = {}
): WorkbookCell => ({ row, col, value, ...extra });

const simpleSheet = (): SheetData => ({
  name: "Sheet1",
  dimensions: { rows: 3, cols: 2 },
  cells: [
    cell(1, 1, "Name"),
    cell(1, 2, "Age"),
    cell(2, 1, "Alice"),
    cell(2, 2, 30),
    cell(3, 1, "Bob"),
    cell(3, 2, 25),
  ],
});

describe("WorkbookSchema", () => {
  it("accepts a minimal workbook with one sheet", () => {
    const input = {
      sheets: [
        {
          name: "Sheet1",
          dimensions: { rows: 1, cols: 1 },
          cells: [{ row: 1, col: 1, value: "hello" }],
        },
      ],
    };
    const result = WorkbookSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects empty sheets array", () => {
    const result = WorkbookSchema.safeParse({ sheets: [] });
    expect(result.success).toBe(false);
  });

  it("rejects cells whose row/col are 0 or negative (coordinates are 1-based)", () => {
    const bad = {
      sheets: [
        {
          name: "Sheet1",
          dimensions: { rows: 1, cols: 1 },
          cells: [{ row: 0, col: 1, value: "x" }],
        },
      ],
    };
    const result = WorkbookSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("accepts all supported cell value types (string, number, boolean, Date, null)", () => {
    const now = new Date("2024-01-15T00:00:00Z");
    const values: WorkbookCell["value"][] = ["text", 42, true, now, null];
    for (const value of values) {
      const parsed = WorkbookCellSchema.safeParse({ row: 1, col: 1, value });
      expect(parsed.success).toBe(true);
    }
  });

  it("round-trips merged-cell metadata", () => {
    const input = {
      row: 1,
      col: 1,
      value: "Header",
      merged: { startRow: 1, startCol: 1, endRow: 1, endCol: 3 },
    };
    const parsed = WorkbookCellSchema.parse(input);
    expect(parsed.merged).toEqual({
      startRow: 1,
      startCol: 1,
      endRow: 1,
      endCol: 3,
    });
  });

  it("preserves rawText when distinct from value", () => {
    const input = { row: 2, col: 3, value: 1234.5, rawText: "$1,234.50" };
    const parsed = WorkbookCellSchema.parse(input);
    expect(parsed.rawText).toBe("$1,234.50");
    expect(parsed.value).toBe(1234.5);
  });

  it("accepts a full SheetDataSchema round-trip", () => {
    const data = simpleSheet();
    const parsed = SheetDataSchema.safeParse(data);
    expect(parsed.success).toBe(true);
  });
});

describe("makeSheetAccessor", () => {
  const sheet = makeSheetAccessor(simpleSheet());

  it("returns the cell at 1-based (row, col)", () => {
    expect(sheet.cell(1, 1)?.value).toBe("Name");
    expect(sheet.cell(2, 2)?.value).toBe(30);
    expect(sheet.cell(3, 1)?.value).toBe("Bob");
  });

  it("returns undefined for out-of-bounds coordinates", () => {
    expect(sheet.cell(0, 1)).toBeUndefined();
    expect(sheet.cell(1, 0)).toBeUndefined();
    expect(sheet.cell(4, 1)).toBeUndefined();
    expect(sheet.cell(1, 3)).toBeUndefined();
  });

  it("returns undefined for unset cells inside dimensions", () => {
    const sparse = makeSheetAccessor({
      name: "S",
      dimensions: { rows: 3, cols: 3 },
      cells: [cell(1, 1, "a"), cell(3, 3, "c")],
    });
    expect(sparse.cell(2, 2)).toBeUndefined();
    expect(sparse.cell(1, 1)?.value).toBe("a");
    expect(sparse.cell(3, 3)?.value).toBe("c");
  });

  it("returns a 2D range (inclusive) with undefined for sparse cells", () => {
    const rng = sheet.range(2, 1, 3, 2);
    expect(rng).toHaveLength(2);
    expect(rng[0]).toHaveLength(2);
    expect(rng[0][0]?.value).toBe("Alice");
    expect(rng[0][1]?.value).toBe(30);
    expect(rng[1][0]?.value).toBe("Bob");
    expect(rng[1][1]?.value).toBe(25);
  });

  it("returns an empty range when endRow < startRow", () => {
    expect(sheet.range(3, 1, 2, 2)).toEqual([]);
  });

  it("clamps range queries to sheet dimensions", () => {
    const rng = sheet.range(1, 1, 10, 10);
    expect(rng).toHaveLength(3);
    expect(rng[0]).toHaveLength(2);
  });
});

describe("makeWorkbook", () => {
  it("wraps each SheetData with accessors", () => {
    const wb = makeWorkbook({ sheets: [simpleSheet()] });
    expect(wb.sheets).toHaveLength(1);
    expect(wb.sheets[0].name).toBe("Sheet1");
    expect(wb.sheets[0].cell(1, 1)?.value).toBe("Name");
  });
});

describe("computeWorkbookFingerprint", () => {
  it("returns sheet names, dimensions, and top-left anchor cells", () => {
    const data = {
      sheets: [
        simpleSheet(),
        {
          name: "Sheet2",
          dimensions: { rows: 2, cols: 1 },
          cells: [cell(1, 1, "Anchor"), cell(2, 1, "row2")],
        },
      ],
    };
    const fp = computeWorkbookFingerprint(data);
    expect(fp.sheetNames).toEqual(["Sheet1", "Sheet2"]);
    expect(fp.dimensions).toEqual({
      Sheet1: { rows: 3, cols: 2 },
      Sheet2: { rows: 2, cols: 1 },
    });
    expect(fp.anchorCells).toEqual([
      { sheet: "Sheet1", row: 1, col: 1, value: "Name" },
      { sheet: "Sheet2", row: 1, col: 1, value: "Anchor" },
    ]);
  });

  it("omits the anchor cell entry when the top-left is unset", () => {
    const data = {
      sheets: [
        {
          name: "Sparse",
          dimensions: { rows: 2, cols: 2 },
          cells: [cell(2, 2, "only")],
        },
      ],
    };
    const fp = computeWorkbookFingerprint(data);
    expect(fp.anchorCells).toEqual([]);
  });

  it("is deterministic — same workbook data yields equal fingerprints", () => {
    const a = computeWorkbookFingerprint({ sheets: [simpleSheet()] });
    const b = computeWorkbookFingerprint({ sheets: [simpleSheet()] });
    expect(a).toEqual(b);
  });

  it("coerces non-string anchor-cell values to strings", () => {
    const data = {
      sheets: [
        {
          name: "Numeric",
          dimensions: { rows: 1, cols: 1 },
          cells: [cell(1, 1, 42)],
        },
      ],
    };
    const fp = computeWorkbookFingerprint(data);
    expect(fp.anchorCells[0]).toEqual({
      sheet: "Numeric",
      row: 1,
      col: 1,
      value: "42",
    });
  });
});
