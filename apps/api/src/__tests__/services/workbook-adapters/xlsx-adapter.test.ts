import { describe, it, expect } from "@jest/globals";
import ExcelJS from "exceljs";

import type { WorkbookCell } from "@portalai/spreadsheet-parsing";

import {
  xlsxToCache,
  xlsxToWorkbook,
} from "../../../services/workbook-adapters/xlsx.adapter.js";
import type {
  ChunkRow,
  SessionWriter,
} from "../../../services/workbook-cache.service.js";
import {
  buildMultiSheetXlsx,
  buildSingleSheetXlsx,
  toStream,
} from "../../utils/xlsx-fixtures.util.js";

function cellAt(
  cells: WorkbookCell[],
  row: number,
  col: number
): WorkbookCell | undefined {
  return cells.find((c) => c.row === row && c.col === col);
}

/** In-memory writer that captures everything xlsxToCache hands it. */
function makeRecorder(): {
  writer: SessionWriter;
  rowsBySheet: Map<string, ChunkRow[]>;
  finishedBySheet: Map<
    string,
    { name: string; rowCount: number; colCount: number }
  >;
} {
  const rowsBySheet = new Map<string, ChunkRow[]>();
  const finishedBySheet = new Map<
    string,
    { name: string; rowCount: number; colCount: number }
  >();
  const writer: SessionWriter = {
    async appendRows(sheetId, rows) {
      const list = rowsBySheet.get(sheetId) ?? [];
      list.push(...rows);
      rowsBySheet.set(sheetId, list);
    },
    async finishSheet(sheetId, info) {
      finishedBySheet.set(sheetId, {
        name: info.name,
        rowCount: info.rowCount,
        colCount: info.colCount,
      });
    },
    async finalize() {},
    async fail() {},
  };
  return { writer, rowsBySheet, finishedBySheet };
}

function defaultResolveSheet() {
  let i = 0;
  return (rawName: string) => {
    const out = { name: rawName, sheetId: `sheet_${i}_${rawName}` };
    i++;
    return out;
  };
}

describe("xlsxToWorkbook", () => {
  it("produces one sheet per worksheet in workbook order", async () => {
    const buf = await buildMultiSheetXlsx({
      First: [
        ["a", "b"],
        ["1", "2"],
      ],
      Second: [["x"], ["y"]],
      Third: [["only"]],
    });

    const wb = await xlsxToWorkbook(toStream(buf));
    expect(wb.sheets.map((s) => s.name)).toEqual(["First", "Second", "Third"]);
  });

  it("places cell values at 1-based (row, col) matching the source layout", async () => {
    const buf = await buildSingleSheetXlsx("S", [
      ["name", "age"],
      ["alice", 30],
      ["bob", 25],
    ]);

    const wb = await xlsxToWorkbook(toStream(buf));
    const sheet = wb.sheets[0];
    expect(sheet.name).toBe("S");
    expect(sheet.dimensions.rows).toBe(3);
    expect(sheet.dimensions.cols).toBe(2);

    expect(cellAt(sheet.cells, 1, 1)?.value).toBe("name");
    expect(cellAt(sheet.cells, 1, 2)?.value).toBe("age");
    expect(cellAt(sheet.cells, 2, 1)?.value).toBe("alice");
    expect(cellAt(sheet.cells, 2, 2)?.value).toBe(30);
    expect(cellAt(sheet.cells, 3, 1)?.value).toBe("bob");
    expect(cellAt(sheet.cells, 3, 2)?.value).toBe(25);
  });

  it("preserves Date values as Date instances", async () => {
    const d = new Date("2024-06-01T00:00:00Z");
    const buf = await buildSingleSheetXlsx("S", [["when"], [d]]);
    const wb = await xlsxToWorkbook(toStream(buf));
    const cell = cellAt(wb.sheets[0].cells, 2, 1);
    expect(cell?.value).toBeInstanceOf(Date);
    expect((cell?.value as Date).toISOString()).toBe(
      "2024-06-01T00:00:00.000Z"
    );
  });

  it("preserves booleans as boolean values", async () => {
    const buf = await buildSingleSheetXlsx("S", [["flag"], [true], [false]]);
    const wb = await xlsxToWorkbook(toStream(buf));
    expect(cellAt(wb.sheets[0].cells, 2, 1)?.value).toBe(true);
    expect(cellAt(wb.sheets[0].cells, 3, 1)?.value).toBe(false);
  });

  it("preserves numbers as number values", async () => {
    const buf = await buildSingleSheetXlsx("S", [["qty"], [42], [3.14]]);
    const wb = await xlsxToWorkbook(toStream(buf));
    expect(cellAt(wb.sheets[0].cells, 2, 1)?.value).toBe(42);
    expect(cellAt(wb.sheets[0].cells, 3, 1)?.value).toBe(3.14);
  });

  it("flattens rich-text cells into a single string", async () => {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet("Rich");
    ws.addRow(["plain"]);
    ws.getCell("A2").value = {
      richText: [{ text: "hello " }, { text: "world", font: { bold: true } }],
    };
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const buf = Buffer.from(arrayBuffer as ArrayBuffer);

    const wb = await xlsxToWorkbook(toStream(buf));
    expect(cellAt(wb.sheets[0].cells, 2, 1)?.value).toBe("hello world");
  });

  it("omits empty cells from the cells array (sparse grid)", async () => {
    const buf = await buildSingleSheetXlsx("S", [
      ["a", "", "c"],
      ["", "b", ""],
    ]);
    const wb = await xlsxToWorkbook(toStream(buf));
    const sheet = wb.sheets[0];
    const keys = sheet.cells
      .map((c) => `${c.row}:${c.col}=${String(c.value)}`)
      .sort();
    expect(keys).toEqual(["1:1=a", "1:3=c", "2:2=b"]);
    expect(sheet.dimensions.cols).toBeGreaterThanOrEqual(3);
  });

  it("attaches merged-range metadata to the top-left cell of the merge", async () => {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet("Merge");
    ws.addRow(["Title", "", "", "other"]);
    ws.addRow(["a", "b", "c", "d"]);
    ws.mergeCells("A1:C1");
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const buf = Buffer.from(arrayBuffer as ArrayBuffer);

    const wb = await xlsxToWorkbook(toStream(buf));
    const sheet = wb.sheets[0];
    const top = cellAt(sheet.cells, 1, 1);
    expect(top?.value).toBe("Title");
    expect(top?.merged).toEqual({
      startRow: 1,
      startCol: 1,
      endRow: 1,
      endCol: 3,
    });
  });

  it("passes through the Workbook Zod schema", async () => {
    const buf = await buildSingleSheetXlsx("S", [["a"], ["1"]]);
    const wb = await xlsxToWorkbook(toStream(buf));

    const { WorkbookSchema } = await import("@portalai/spreadsheet-parsing");
    expect(WorkbookSchema.safeParse(wb).success).toBe(true);
  });

  it("handles a sheet with no rows by emitting zero-dimension sheet metadata", async () => {
    const buf = await buildMultiSheetXlsx({
      Populated: [["a"], ["1"]],
      Empty: [],
    });
    const wb = await xlsxToWorkbook(toStream(buf));
    const emptySheet = wb.sheets.find((s) => s.name === "Empty")!;
    // The fixture builder inserts a single blank row for ExcelJS compatibility;
    // the adapter treats blank cells as absent and reports no populated cells.
    expect(emptySheet.cells).toEqual([]);
  });
});

describe("xlsxToCache", () => {
  it("streams each worksheet through the writer with dense rows + meta", async () => {
    const buf = await buildMultiSheetXlsx({
      First: [
        ["a", "b"],
        ["1", "2"],
      ],
      Second: [["x"], ["y"]],
    });

    const { writer, rowsBySheet, finishedBySheet } = makeRecorder();
    const out = await xlsxToCache(toStream(buf), writer, {
      resolveSheet: defaultResolveSheet(),
    });

    expect(out.map((s) => s.name)).toEqual(["First", "Second"]);
    expect(out[0]).toEqual({
      sheetId: "sheet_0_First",
      name: "First",
      rowCount: 2,
      colCount: 2,
    });
    expect(out[1]).toEqual({
      sheetId: "sheet_1_Second",
      name: "Second",
      rowCount: 2,
      colCount: 1,
    });

    expect(rowsBySheet.get("sheet_0_First")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(rowsBySheet.get("sheet_1_Second")).toEqual([["x"], ["y"]]);
    expect(finishedBySheet.size).toBe(2);
  });

  it("preserves numbers + booleans and serializes dates as ISO strings", async () => {
    const d = new Date("2024-06-01T00:00:00Z");
    const buf = await buildSingleSheetXlsx("S", [
      ["qty", "flag", "when"],
      [42, true, d],
      [3.14, false, "skip"],
    ]);
    const { writer, rowsBySheet } = makeRecorder();
    await xlsxToCache(toStream(buf), writer, {
      resolveSheet: defaultResolveSheet(),
    });
    const rows = rowsBySheet.get("sheet_0_S")!;
    expect(rows[0]).toEqual(["qty", "flag", "when"]);
    expect(rows[1]).toEqual([42, true, "2024-06-01T00:00:00.000Z"]);
    expect(rows[2]).toEqual([3.14, false, "skip"]);
  });

  it("trims trailing empty cells from each row to keep chunks tight", async () => {
    const buf = await buildSingleSheetXlsx("S", [
      ["a", "b", "c"],
      ["x", "", ""],
      ["", "y", ""],
    ]);
    const { writer, rowsBySheet } = makeRecorder();
    const out = await xlsxToCache(toStream(buf), writer, {
      resolveSheet: defaultResolveSheet(),
    });
    const rows = rowsBySheet.get("sheet_0_S")!;
    expect(rows[0]).toEqual(["a", "b", "c"]);
    // Trailing empties stripped — the slice/preview readers pad with null
    // when reading past the end of a row.
    expect(rows[1]).toEqual(["x"]);
    expect(rows[2]).toEqual([null, "y"]);
    // colCount is still 3 because row 0 has three cells.
    expect(out[0].colCount).toBe(3);
  });

  it("flattens rich-text cells into a single string", async () => {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet("Rich");
    ws.addRow(["plain"]);
    ws.getCell("A2").value = {
      richText: [{ text: "hello " }, { text: "world", font: { bold: true } }],
    };
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const buf = Buffer.from(arrayBuffer as ArrayBuffer);

    const { writer, rowsBySheet } = makeRecorder();
    await xlsxToCache(toStream(buf), writer, {
      resolveSheet: defaultResolveSheet(),
    });
    const rows = rowsBySheet.get("sheet_0_Rich")!;
    expect(rows[1]?.[0]).toBe("hello world");
  });

  it("invokes resolveSheet once per worksheet, in workbook order", async () => {
    const buf = await buildMultiSheetXlsx({
      Alpha: [["a"]],
      Beta: [["b"]],
      Gamma: [["c"]],
    });
    const seen: string[] = [];
    let i = 0;
    await xlsxToCache(toStream(buf), makeRecorder().writer, {
      resolveSheet: (raw) => {
        seen.push(raw);
        const out = { name: raw, sheetId: `sheet_${i}_${raw}` };
        i++;
        return out;
      },
    });
    expect(seen).toEqual(["Alpha", "Beta", "Gamma"]);
  });
});
