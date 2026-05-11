import { describe, it, expect, jest } from "@jest/globals";
import ExcelJS from "exceljs";

import { xlsxToCache } from "../../../services/workbook-adapters/xlsx.adapter.js";
import type {
  ChunkRow,
  SessionWriter,
} from "../../../services/workbook-cache.service.js";
import {
  buildMultiSheetXlsx,
  buildSingleSheetXlsx,
  toStream,
} from "../../utils/xlsx-fixtures.util.js";

// ExcelJS' streaming WorkbookReader has a race condition (line 303 of
// `node_modules/exceljs/lib/stream/xlsx/workbook-reader.js` —
// `_parseWorksheet` reads `this.model.sheets` before `_parseWorkbook`
// may have set `this.model`) that flakes ~5-25% of runs against
// in-memory xlsx fixtures. The bug doesn't reproduce against real S3
// streams (kernel I/O ticks sequence the zip entries the way the
// reader expects). Until a fix lands upstream, retry up to 3 times.
// See `xlsx-fixtures.util.ts:toStream` for context.
jest.retryTimes(3);

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
