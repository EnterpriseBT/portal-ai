import { Readable } from "node:stream";

import { describe, it, expect } from "@jest/globals";

import { csvToWorkbook } from "../../../services/workbook-adapters/csv.adapter.js";

function toStream(text: string): Readable {
  return Readable.from(Buffer.from(text, "utf8"));
}

describe("csvToWorkbook", () => {
  it("produces a single sheet with 1-based cell coordinates for headers + 3 rows", async () => {
    const csv =
      "name,age,email\nalice,30,a@x.com\nbob,25,b@x.com\ncarol,40,c@x.com\n";
    const wb = await csvToWorkbook(toStream(csv), { sheetName: "test.csv" });

    expect(wb.sheets).toHaveLength(1);
    const sheet = wb.sheets[0];
    expect(sheet.name).toBe("test.csv");
    expect(sheet.dimensions).toEqual({ rows: 4, cols: 3 });

    const byCoord = new Map(
      sheet.cells.map((c) => [`${c.row}:${c.col}`, c.value])
    );
    expect(byCoord.get("1:1")).toBe("name");
    expect(byCoord.get("1:2")).toBe("age");
    expect(byCoord.get("1:3")).toBe("email");
    expect(byCoord.get("2:1")).toBe("alice");
    expect(byCoord.get("2:2")).toBe("30");
    expect(byCoord.get("4:3")).toBe("c@x.com");
  });

  it("handles an empty source without throwing", async () => {
    const wb = await csvToWorkbook(toStream(""), { sheetName: "empty.csv" });
    expect(wb.sheets).toHaveLength(1);
    expect(wb.sheets[0].dimensions).toEqual({ rows: 0, cols: 0 });
    expect(wb.sheets[0].cells).toEqual([]);
  });

  it("auto-detects tab delimiter", async () => {
    const csv = "a\tb\tc\n1\t2\t3\n";
    const wb = await csvToWorkbook(toStream(csv), { sheetName: "t.tsv" });
    const sheet = wb.sheets[0];
    expect(sheet.dimensions.cols).toBe(3);
    expect(sheet.cells.find((c) => c.row === 1 && c.col === 2)?.value).toBe(
      "b"
    );
  });

  it("auto-detects semicolon delimiter", async () => {
    const csv = "name;age\nalice;30\n";
    const wb = await csvToWorkbook(toStream(csv), { sheetName: "eu.csv" });
    expect(
      wb.sheets[0].cells.find((c) => c.row === 2 && c.col === 1)?.value
    ).toBe("alice");
  });

  it("auto-detects pipe delimiter", async () => {
    const csv = "x|y|z\n1|2|3\n";
    const wb = await csvToWorkbook(toStream(csv), { sheetName: "p.csv" });
    expect(
      wb.sheets[0].cells.find((c) => c.row === 1 && c.col === 3)?.value
    ).toBe("z");
  });

  it("does not synthesize column_N for empty header cells (header detection is deferred)", async () => {
    const csv = ",name,age\n1,alice,30\n";
    const wb = await csvToWorkbook(toStream(csv), { sheetName: "blanks.csv" });

    const byCoord = new Map(
      wb.sheets[0].cells.map((c) => [`${c.row}:${c.col}`, c.value])
    );
    // The first header cell is empty — adapter must leave it empty, not rewrite to "column_1".
    expect(byCoord.get("1:1")).toBeUndefined();
    expect(byCoord.get("1:2")).toBe("name");
    expect(byCoord.get("1:3")).toBe("age");
    expect(byCoord.get("2:1")).toBe("1");
  });

  it("omits empty cells from the cells array so the grid stays sparse", async () => {
    const csv = "a,,c\n,b,\n";
    const wb = await csvToWorkbook(toStream(csv), { sheetName: "sparse.csv" });
    const sheet = wb.sheets[0];

    expect(sheet.dimensions).toEqual({ rows: 2, cols: 3 });
    // Only populated cells should appear
    expect(
      sheet.cells.map((c) => `${c.row}:${c.col}=${c.value}`).sort()
    ).toEqual(["1:1=a", "1:3=c", "2:2=b"]);
  });

  it("passes through the Workbook Zod schema", async () => {
    const csv = "a,b\n1,2\n";
    const wb = await csvToWorkbook(toStream(csv), { sheetName: "ok.csv" });

    const { WorkbookSchema } = await import("@portalai/spreadsheet-parsing");
    expect(WorkbookSchema.safeParse(wb).success).toBe(true);
  });

  it("honours explicit delimiter override", async () => {
    const csv = "a|b|c\n1|2|3\n";
    const wb = await csvToWorkbook(toStream(csv), {
      sheetName: "forced.csv",
      delimiter: "|",
    });
    expect(wb.sheets[0].dimensions.cols).toBe(3);
    expect(
      wb.sheets[0].cells.find((c) => c.row === 2 && c.col === 2)?.value
    ).toBe("2");
  });
});
