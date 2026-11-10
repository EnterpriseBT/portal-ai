import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "@jest/globals";
import ExcelJS from "exceljs";

import {
  coerceCell,
  declaredWorksheetCount,
  xlsxToCache,
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

// No retries (#997): the adapter hands ExcelJS each zip metadata-first,
// which takes it off the racy path these tests used to retry around.

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

// #997: ExcelJS' streaming reader dropped sheets and left shared strings
// unresolved when a zip's sheets precede `xl/sharedStrings.xml`, the order
// ExcelJS itself writes. Each case reads the file repeatedly, since the
// race was nondeterministic.
describe("xlsxToCache — sheets before shared strings (#997)", () => {
  const RUNS = 20;
  const here = dirname(fileURLToPath(import.meta.url));
  // A copy of the web app's sample (`apps/web/public/samples/`), kept in
  // this package so turbo hashes it with the tests that read it.
  const SAMPLE = join(here, "fixtures/supported_layouts.xlsx");

  it(`reads every sheet and string of the app's sample, ${RUNS} times out of ${RUNS}`, async () => {
    const bytes = await readFile(SAMPLE);
    for (let run = 0; run < RUNS; run++) {
      const { writer, rowsBySheet } = makeRecorder();
      const out = await xlsxToCache(toStream(bytes), writer, {
        resolveSheet: defaultResolveSheet(),
      });
      expect(out).toHaveLength(11);
      // 142 rows in the file, plus the blank rows between them that keep
      // row numbers aligned.
      expect(out.reduce((n, s) => n + s.rowCount, 0)).toBe(148);
      const cells = [...rowsBySheet.values()].flat(2);
      expect(cells).not.toContain("[object Object]");
      const table = out.find((s) => s.name === "Single Axis Static - Table 1");
      expect(rowsBySheet.get(table!.sheetId)?.flat()).toContain("employee_id");
    }
  });

  it(`reads shared strings on every sheet of an ExcelJS-written file, ${RUNS} times out of ${RUNS}`, async () => {
    const buf = await buildMultiSheetXlsx({
      Alpha: [
        ["name", "team"],
        ["Ada", "Core"],
      ],
      Beta: [
        ["name", "team"],
        ["Grace", "Core"],
      ],
      Gamma: [["Ada"], ["Grace"], ["Linus"]],
    });
    for (let run = 0; run < RUNS; run++) {
      const { writer, rowsBySheet } = makeRecorder();
      const out = await xlsxToCache(toStream(buf), writer, {
        resolveSheet: defaultResolveSheet(),
      });
      expect(out.map((s) => s.name)).toEqual(["Alpha", "Beta", "Gamma"]);
      expect(rowsBySheet.get("sheet_1_Beta")).toEqual([
        ["name", "team"],
        ["Grace", "Core"],
      ]);
      expect(rowsBySheet.get("sheet_2_Gamma")).toEqual([
        ["Ada"],
        ["Grace"],
        ["Linus"],
      ]);
    }
  });

  it("fails a file that isn't a zip as XLSX_PARSE_FAILED and leaves no temp file", async () => {
    // Its own temp dir, so a parallel test's files can't move the count.
    const own = await mkdtemp(join(tmpdir(), "xlsx-adapter-test-"));
    const savedTmp = process.env.TMPDIR;
    process.env.TMPDIR = own;
    try {
      const { writer } = makeRecorder();
      await expect(
        xlsxToCache(toStream(Buffer.from("name,team\nAda,Core\n")), writer, {
          resolveSheet: defaultResolveSheet(),
        })
      ).rejects.toMatchObject({ code: "XLSX_PARSE_FAILED" });
      expect(await readdir(own)).toEqual([]);
    } finally {
      process.env.TMPDIR = savedTmp;
      await rm(own, { recursive: true, force: true });
    }
  });

  it(`reads every sheet of a workbook with no shared strings, ${RUNS} times out of ${RUNS}`, async () => {
    const workbook = new ExcelJS.Workbook();
    for (let s = 0; s < 6; s++) {
      const ws = workbook.addWorksheet(`N${s}`);
      for (let r = 0; r < 20; r++) ws.addRow([r, r * 2]);
    }
    const buf = Buffer.from(await workbook.xlsx.writeBuffer());
    expect(buf.includes(Buffer.from("xl/sharedStrings.xml"))).toBe(false);
    for (let run = 0; run < RUNS; run++) {
      const { writer, rowsBySheet } = makeRecorder();
      const out = await xlsxToCache(toStream(buf), writer, {
        resolveSheet: defaultResolveSheet(),
      });
      expect(out.map((s) => s.name)).toEqual([
        "N0",
        "N1",
        "N2",
        "N3",
        "N4",
        "N5",
      ]);
      expect(rowsBySheet.get("sheet_5_N5")?.[19]).toEqual([19, 38]);
    }
  });

  it("keeps a formula's falsy cached result, which ExcelJS' row values drop", async () => {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet("Totals");
    ws.getCell("A1").value = { formula: "1-1", result: 0 };
    ws.getCell("B1").value = { formula: '""&""', result: "" };
    ws.getCell("C1").value = { formula: "2+3", result: 5 };
    ws.getCell("D1").value = { formula: "C1*2" } as ExcelJS.CellFormulaValue;
    ws.getCell("E1").value = "end";
    const buf = Buffer.from(await workbook.xlsx.writeBuffer());
    const { writer, rowsBySheet } = makeRecorder();
    await xlsxToCache(toStream(buf), writer, {
      resolveSheet: defaultResolveSheet(),
    });
    // 0 stays 0; "" and a formula saved without a result are empty.
    expect(rowsBySheet.get("sheet_0_Totals")).toEqual([
      [0, null, 5, null, "end"],
    ]);
  });

  it("leaves a failed download as the stream's own error, not a bad file", async () => {
    const failing = new Readable({
      read() {
        this.destroy(new Error("ECONNRESET"));
      },
    });
    const { writer } = makeRecorder();
    const err = await xlsxToCache(failing, writer, {
      resolveSheet: defaultResolveSheet(),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toMatchObject({ code: "XLSX_PARSE_FAILED" });
    expect((err as Error).message).toBe("ECONNRESET");
  });
});

describe("declaredWorksheetCount (#997)", () => {
  const SHEET =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";
  const STRICT =
    "http://purl.oclc.org/ooxml/officeDocument/relationships/worksheet";
  const CHART =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartsheet";

  it("counts declared worksheets whatever their part is named, and skips chart sheets", () => {
    expect(
      declaredWorksheetCount({
        model: {
          sheets: [
            { rId: "rId1" },
            { rId: "rId2" },
            { rId: "rId3" },
            { rId: "rId4" },
          ],
        },
        workbookRels: [
          { Id: "rId1", Type: SHEET, Target: "worksheets/sheet1.xml" },
          { Id: "rId2", Type: SHEET, Target: "worksheets/data.xml" },
          { Id: "rId3", Type: CHART, Target: "chartsheets/sheet1.xml" },
          { Id: "rId4", Type: STRICT, Target: "worksheets/sheet3.xml" },
        ],
      })
    ).toBe(3);
  });

  it("counts nothing for a reader that never read the workbook", () => {
    expect(declaredWorksheetCount({})).toBe(0);
  });
});

describe("coerceCell (#997)", () => {
  it("reads a formula error as its text", () => {
    expect(coerceCell({ error: "#N/A" })).toBe("#N/A");
  });

  it("reads a formula with no cached result as empty", () => {
    expect(coerceCell({ formula: "B1*2" })).toBeNull();
    expect(coerceCell({ sharedFormula: "C1" })).toBeNull();
  });

  it("refuses an unresolved shared string instead of storing [object Object]", () => {
    expect(() => coerceCell({ sharedString: 3 })).toThrow(
      expect.objectContaining({ code: "XLSX_PARSE_FAILED" })
    );
  });

  it("refuses an unknown object shape", () => {
    expect(() => coerceCell({ mystery: true })).toThrow(/mystery/);
  });
});
