import { Readable } from "node:stream";

import { describe, it, expect } from "@jest/globals";

import {
  parseCsvStream,
  csvRowIterator,
} from "../../utils/csv-parser.util.js";

function toStream(text: string): Readable {
  return Readable.from(Buffer.from(text, "utf8"));
}

function chunkedStream(text: string, chunkSize: number): Readable {
  const buf = Buffer.from(text, "utf8");
  async function* gen() {
    for (let i = 0; i < buf.length; i += chunkSize) {
      yield buf.subarray(i, i + chunkSize);
    }
  }
  return Readable.from(gen());
}

describe("parseCsvStream", () => {
  it("streams a simple CSV and returns FileParseResult with headers + sample rows + stats", async () => {
    const csv = "name,age,email\nalice,30,a@x.com\nbob,25,b@x.com\n";
    const result = await parseCsvStream(toStream(csv), { fileName: "test.csv" });

    expect(result.fileName).toBe("test.csv");
    expect(result.delimiter).toBe(",");
    expect(result.hasHeader).toBe(true);
    expect(result.headers).toEqual(["name", "age", "email"]);
    expect(result.rowCount).toBe(2);
    expect(result.sampleRows).toEqual([
      ["alice", "30", "a@x.com"],
      ["bob", "25", "b@x.com"],
    ]);
    expect(result.columnStats).toHaveLength(3);
    expect(result.columnStats[0].name).toBe("name");
    expect(result.columnStats[0].totalCount).toBe(2);
    expect(result.columnStats[0].uniqueCount).toBe(2);
  });

  it("handles empty file without throwing", async () => {
    const result = await parseCsvStream(toStream(""), { fileName: "empty.csv" });

    expect(result.rowCount).toBe(0);
    expect(result.headers).toEqual([]);
    expect(result.sampleRows).toEqual([]);
    expect(result.columnStats).toEqual([]);
  });

  it("handles header-only file (rowCount 0, headers set, hasHeader true)", async () => {
    const csv = "col1,col2,col3\n";
    const result = await parseCsvStream(toStream(csv), { fileName: "hdr.csv" });

    expect(result.hasHeader).toBe(true);
    expect(result.headers).toEqual(["col1", "col2", "col3"]);
    expect(result.rowCount).toBe(0);
    expect(result.sampleRows).toEqual([]);
  });

  it("auto-detects tab delimiter", async () => {
    const csv = "a\tb\tc\n1\t2\t3\n";
    const result = await parseCsvStream(toStream(csv), { fileName: "t.tsv" });
    expect(result.delimiter).toBe("\t");
    expect(result.headers).toEqual(["a", "b", "c"]);
  });

  it("auto-detects semicolon delimiter", async () => {
    const csv = "name;age\nalice;30\n";
    const result = await parseCsvStream(toStream(csv), { fileName: "eu.csv" });
    expect(result.delimiter).toBe(";");
    expect(result.headers).toEqual(["name", "age"]);
  });

  it("auto-detects pipe delimiter", async () => {
    const csv = "x|y|z\n1|2|3\n";
    const result = await parseCsvStream(toStream(csv), { fileName: "p.csv" });
    expect(result.delimiter).toBe("|");
  });

  it("respects explicit delimiter option (skips detection)", async () => {
    // This text has pipe data but auto-detect would pick comma; explicit wins
    const csv = "x|y|z\n1|2|3\n";
    const result = await parseCsvStream(toStream(csv), { fileName: "x.csv", delimiter: "|" });
    expect(result.delimiter).toBe("|");
    expect(result.headers).toEqual(["x", "y", "z"]);
  });

  it("returns a non-empty encoding string", async () => {
    const csv = "name,age\nalice,30\n";
    const result = await parseCsvStream(toStream(csv), { fileName: "x.csv" });
    expect(typeof result.encoding).toBe("string");
    expect(result.encoding.length).toBeGreaterThan(0);
  });

  it("caps sampleRows at maxSampleRows and still counts total rows correctly", async () => {
    const lines = ["id,val\n"];
    for (let i = 0; i < 100; i++) lines.push(`${i},v\n`);
    const result = await parseCsvStream(toStream(lines.join("")), {
      fileName: "big.csv",
      maxSampleRows: 5,
    });
    expect(result.rowCount).toBe(100);
    expect(result.sampleRows).toHaveLength(5);
    expect(result.sampleRows[0]).toEqual(["0", "v"]);
    expect(result.sampleRows[4]).toEqual(["4", "v"]);
  });

  it("accumulates column stats incrementally across chunked input", async () => {
    const csv = "letter,num\na,1\nb,2\na,3\nc,4\n";
    const result = await parseCsvStream(chunkedStream(csv, 3), { fileName: "c.csv" });

    expect(result.rowCount).toBe(4);
    const letterStat = result.columnStats.find((s) => s.name === "letter")!;
    expect(letterStat.uniqueCount).toBe(3);
    expect(letterStat.totalCount).toBe(4);
  });

  it("treats numeric-only first row as data (no header)", async () => {
    const csv = "1,2,3\n4,5,6\n";
    const result = await parseCsvStream(toStream(csv), { fileName: "n.csv" });
    expect(result.hasHeader).toBe(false);
    expect(result.headers).toEqual(["column_1", "column_2", "column_3"]);
    expect(result.rowCount).toBe(2);
  });

  it("handles large input via small chunks without buffering the full file", async () => {
    // 10k-row CSV, chunked at 256 bytes
    const lines = ["id,value\n"];
    for (let i = 0; i < 10_000; i++) lines.push(`${i},x\n`);
    const result = await parseCsvStream(chunkedStream(lines.join(""), 256), {
      fileName: "stream.csv",
      maxSampleRows: 3,
    });
    expect(result.rowCount).toBe(10_000);
    expect(result.sampleRows).toHaveLength(3);
    expect(result.columnStats[0].totalCount).toBe(10_000);
  });

  it("propagates csv-parse errors", async () => {
    // Unterminated quoted field triggers csv-parse error
    const csv = 'a,b,c\n"unterminated,x,y\n';
    await expect(
      parseCsvStream(toStream(csv), { fileName: "bad.csv" }),
    ).rejects.toThrow();
  });
});

describe("csvRowIterator", () => {
  it("yields Record<string,string> keyed by header row", async () => {
    const csv = "name,age\nalice,30\nbob,25\n";
    const rows: Record<string, string>[] = [];
    for await (const row of csvRowIterator(toStream(csv), { delimiter: "," })) {
      rows.push(row);
    }
    expect(rows).toEqual([
      { name: "alice", age: "30" },
      { name: "bob", age: "25" },
    ]);
  });

  it("is consumable with for await (async-iterable shape)", async () => {
    const csv = "a\n1\n2\n";
    const iter = csvRowIterator(toStream(csv), { delimiter: "," });
    expect(typeof iter[Symbol.asyncIterator]).toBe("function");
  });

  it("handles empty iterable (empty file yields nothing)", async () => {
    const rows: Record<string, string>[] = [];
    for await (const row of csvRowIterator(toStream(""), { delimiter: "," })) {
      rows.push(row);
    }
    expect(rows).toEqual([]);
  });

  it("respects explicit delimiter", async () => {
    const csv = "a;b\n1;2\n";
    const rows: Record<string, string>[] = [];
    for await (const row of csvRowIterator(toStream(csv), { delimiter: ";" })) {
      rows.push(row);
    }
    expect(rows).toEqual([{ a: "1", b: "2" }]);
  });

  it("synthesizes column_N headers when first row is numeric-only", async () => {
    const csv = "1,2\n3,4\n";
    const rows: Record<string, string>[] = [];
    for await (const row of csvRowIterator(toStream(csv), { delimiter: "," })) {
      rows.push(row);
    }
    expect(rows).toEqual([
      { column_1: "1", column_2: "2" },
      { column_1: "3", column_2: "4" },
    ]);
  });

  it("propagates parser errors through the iterator", async () => {
    const csv = 'a,b\n"unterminated,x\n';
    await expect(async () => {
      for await (const _ of csvRowIterator(toStream(csv), { delimiter: "," })) {
        // consume
      }
    }).rejects.toThrow();
  });
});
