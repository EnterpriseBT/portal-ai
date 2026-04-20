import { describe, it, expect } from "@jest/globals";

import { ProcessorError } from "../../utils/processor-error.util.js";
import {
  parseXlsxStream,
  xlsxSheetRowIterator,
} from "../../utils/xlsx-parser.util.js";

import {
  buildMultiSheetXlsx,
  buildSingleSheetXlsx,
  toStream,
} from "./xlsx-fixtures.util.js";

describe("parseXlsxStream", () => {
  describe("single-sheet", () => {
    it("yields one FileParseResult", async () => {
      const buf = await buildSingleSheetXlsx("Contacts", [
        ["name", "age"],
        ["alice", 30],
        ["bob", 25],
      ]);

      const results = [];
      for await (const r of parseXlsxStream(toStream(buf), {
        fileName: "data.xlsx",
      })) {
        results.push(r);
      }
      expect(results).toHaveLength(1);
    });

    it("sets fileName to '<orig>[<SheetName>]'", async () => {
      const buf = await buildSingleSheetXlsx("Contacts", [["name"], ["alice"]]);
      const [r] = await collect(
        parseXlsxStream(toStream(buf), { fileName: "data.xlsx" })
      );
      expect(r.fileName).toBe("data.xlsx[Contacts]");
    });

    it("sets delimiter to 'xlsx', hasHeader true, encoding 'utf-8'", async () => {
      const buf = await buildSingleSheetXlsx("S", [["a"], ["1"]]);
      const [r] = await collect(
        parseXlsxStream(toStream(buf), { fileName: "f.xlsx" })
      );
      expect(r.delimiter).toBe("xlsx");
      expect(r.hasHeader).toBe(true);
      expect(r.encoding).toBe("utf-8");
    });

    it("extracts headers from first row", async () => {
      const buf = await buildSingleSheetXlsx("S", [
        ["name", "email", "age"],
        ["alice", "a@x.com", 30],
      ]);
      const [r] = await collect(
        parseXlsxStream(toStream(buf), { fileName: "f.xlsx" })
      );
      expect(r.headers).toEqual(["name", "email", "age"]);
    });

    it("extracts sample rows capped at maxSampleRows", async () => {
      const rows: (string | number)[][] = [["id", "v"]];
      for (let i = 0; i < 100; i++) rows.push([i, "x"]);
      const buf = await buildSingleSheetXlsx("S", rows);

      const [r] = await collect(
        parseXlsxStream(toStream(buf), { fileName: "f.xlsx", maxSampleRows: 5 })
      );
      expect(r.rowCount).toBe(100);
      expect(r.sampleRows).toHaveLength(5);
      expect(r.sampleRows[0]).toEqual(["0", "x"]);
      expect(r.sampleRows[4]).toEqual(["4", "x"]);
    });

    it("computes columnStats with correct counts and sample values", async () => {
      const buf = await buildSingleSheetXlsx("S", [
        ["letter", "num"],
        ["a", 1],
        ["b", 2],
        ["a", 3],
      ]);
      const [r] = await collect(
        parseXlsxStream(toStream(buf), { fileName: "f.xlsx" })
      );
      const letterStat = r.columnStats.find((s) => s.name === "letter")!;
      expect(letterStat.totalCount).toBe(3);
      expect(letterStat.uniqueCount).toBe(2);
      expect(letterStat.sampleValues).toEqual(
        expect.arrayContaining(["a", "b"])
      );
    });

    it("rowCount excludes header row", async () => {
      const buf = await buildSingleSheetXlsx("S", [["h"], ["a"], ["b"], ["c"]]);
      const [r] = await collect(
        parseXlsxStream(toStream(buf), { fileName: "f.xlsx" })
      );
      expect(r.rowCount).toBe(3);
    });
  });

  describe("multi-sheet", () => {
    it("yields one FileParseResult per non-empty sheet, preserving order", async () => {
      const buf = await buildMultiSheetXlsx({
        Contacts: [["name"], ["alice"]],
        Deals: [["title"], ["d1"], ["d2"]],
      });
      const results = await collect(
        parseXlsxStream(toStream(buf), { fileName: "data.xlsx" })
      );
      expect(results.map((r) => r.fileName)).toEqual([
        "data.xlsx[Contacts]",
        "data.xlsx[Deals]",
      ]);
      expect(results[0].rowCount).toBe(1);
      expect(results[1].rowCount).toBe(2);
    });

    it("skips empty sheets (zero data rows)", async () => {
      const buf = await buildMultiSheetXlsx({
        Empty: [],
        HeaderOnly: [["h1", "h2"]],
        Real: [["x"], ["1"]],
      });
      const results = await collect(
        parseXlsxStream(toStream(buf), { fileName: "f.xlsx" })
      );
      expect(results.map((r) => r.fileName)).toEqual(["f.xlsx[Real]"]);
    });
  });

  describe("data types", () => {
    it("converts Date cells to ISO 8601 strings", async () => {
      const date = new Date("2025-04-15T12:34:56.000Z");
      const buf = await buildSingleSheetXlsx("S", [["when"], [date]]);
      const [r] = await collect(
        parseXlsxStream(toStream(buf), { fileName: "f.xlsx" })
      );
      expect(r.sampleRows[0]).toEqual([date.toISOString()]);
    });

    it("converts numbers to string representation", async () => {
      const buf = await buildSingleSheetXlsx("S", [["n"], [42], [3.14]]);
      const [r] = await collect(
        parseXlsxStream(toStream(buf), { fileName: "f.xlsx" })
      );
      expect(r.sampleRows).toEqual([["42"], ["3.14"]]);
    });

    it("converts boolean cells to 'true' / 'false'", async () => {
      const buf = await buildSingleSheetXlsx("S", [["b"], [true], [false]]);
      const [r] = await collect(
        parseXlsxStream(toStream(buf), { fileName: "f.xlsx" })
      );
      expect(r.sampleRows).toEqual([["true"], ["false"]]);
    });

    it("treats null cells as empty strings", async () => {
      const buf = await buildSingleSheetXlsx("S", [
        ["a", "b"],
        ["x", null],
      ]);
      const [r] = await collect(
        parseXlsxStream(toStream(buf), { fileName: "f.xlsx" })
      );
      expect(r.sampleRows[0]).toEqual(["x", ""]);
    });
  });

  describe("error handling", () => {
    it("throws ProcessorError('XLSX_PARSE_FAILED') for corrupted input", async () => {
      const corrupt = Buffer.from("not a real xlsx file");
      await expect(
        collect(parseXlsxStream(toStream(corrupt), { fileName: "bad.xlsx" }))
      ).rejects.toMatchObject({
        name: "ProcessorError",
        code: "XLSX_PARSE_FAILED",
      });
    });
  });
});

describe("xlsxSheetRowIterator", () => {
  it("yields Record<string,string> keyed by header row", async () => {
    const buf = await buildSingleSheetXlsx("Contacts", [
      ["name", "age"],
      ["alice", 30],
      ["bob", 25],
    ]);
    const rows = await collect(xlsxSheetRowIterator(toStream(buf), "Contacts"));
    expect(rows).toEqual([
      { name: "alice", age: "30" },
      { name: "bob", age: "25" },
    ]);
  });

  it("throws ProcessorError('UPLOAD_SHEET_NOT_FOUND') when sheet missing", async () => {
    const buf = await buildSingleSheetXlsx("Contacts", [["name"], ["alice"]]);
    await expect(
      collect(xlsxSheetRowIterator(toStream(buf), "Nope"))
    ).rejects.toMatchObject({
      name: "ProcessorError",
      code: "UPLOAD_SHEET_NOT_FOUND",
    });
  });

  it("is consumable with for await (async-iterable shape)", async () => {
    const buf = await buildSingleSheetXlsx("S", [["a"], ["1"]]);
    const iter = xlsxSheetRowIterator(toStream(buf), "S");
    expect(typeof iter[Symbol.asyncIterator]).toBe("function");
  });

  it("yields nothing when sheet has no data rows", async () => {
    const buf = await buildSingleSheetXlsx("S", [["only", "headers"]]);
    const rows = await collect(xlsxSheetRowIterator(toStream(buf), "S"));
    expect(rows).toEqual([]);
  });

  it("uses ProcessorError class for missing sheet", async () => {
    const buf = await buildSingleSheetXlsx("Real", [["a"], ["1"]]);
    let caught: unknown;
    try {
      await collect(xlsxSheetRowIterator(toStream(buf), "Other"));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProcessorError);
  });
});

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}
