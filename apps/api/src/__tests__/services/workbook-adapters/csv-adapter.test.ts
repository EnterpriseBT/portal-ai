import { Readable } from "node:stream";

import { describe, it, expect } from "@jest/globals";

import { csvToCache } from "../../../services/workbook-adapters/csv.adapter.js";
import type {
  ChunkRow,
  SessionWriter,
} from "../../../services/workbook-cache.service.js";

function toStream(text: string): Readable {
  return Readable.from(Buffer.from(text, "utf8"));
}

/**
 * Test double for the chunked-cache writer. Captures every appended row
 * verbatim so assertions can inspect the dense layout the real cache would
 * persist. `finishSheet` records the final dimensions; `finalize` / `fail`
 * are no-ops since the adapter never calls them.
 */
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
    async finalize() {
      // not used by csvToCache
    },
    async fail() {
      // not used by csvToCache
    },
  };
  return { writer, rowsBySheet, finishedBySheet };
}

describe("csvToCache", () => {
  it("streams a 4-row CSV into dense rows on the writer", async () => {
    const csv =
      "name,age,email\nalice,30,a@x.com\nbob,25,b@x.com\ncarol,40,c@x.com\n";
    const { writer, rowsBySheet } = makeRecorder();

    const stats = await csvToCache(toStream(csv), "sheet_0_test", writer);

    expect(stats).toEqual({ rowCount: 4, colCount: 3 });
    const rows = rowsBySheet.get("sheet_0_test");
    expect(rows).toBeDefined();
    expect(rows).toHaveLength(4);
    expect(rows![0]).toEqual(["name", "age", "email"]);
    expect(rows![1]).toEqual(["alice", "30", "a@x.com"]);
    expect(rows![3]).toEqual(["carol", "40", "c@x.com"]);
  });

  it("yields zero rows + zero cols on an empty source", async () => {
    const { writer, rowsBySheet } = makeRecorder();
    const stats = await csvToCache(toStream(""), "sheet_0_empty", writer);
    expect(stats).toEqual({ rowCount: 0, colCount: 0 });
    expect(rowsBySheet.get("sheet_0_empty")).toBeUndefined();
  });

  it("auto-detects tab delimiter", async () => {
    const csv = "a\tb\tc\n1\t2\t3\n";
    const { writer, rowsBySheet } = makeRecorder();
    const stats = await csvToCache(toStream(csv), "sheet_0_tsv", writer);
    expect(stats.colCount).toBe(3);
    expect(rowsBySheet.get("sheet_0_tsv")![0]).toEqual(["a", "b", "c"]);
  });

  it("auto-detects semicolon delimiter", async () => {
    const csv = "name;age\nalice;30\n";
    const { writer, rowsBySheet } = makeRecorder();
    await csvToCache(toStream(csv), "sheet_0_eu", writer);
    expect(rowsBySheet.get("sheet_0_eu")![1]).toEqual(["alice", "30"]);
  });

  it("auto-detects pipe delimiter", async () => {
    const csv = "x|y|z\n1|2|3\n";
    const { writer, rowsBySheet } = makeRecorder();
    await csvToCache(toStream(csv), "sheet_0_pipe", writer);
    expect(rowsBySheet.get("sheet_0_pipe")![0]).toEqual(["x", "y", "z"]);
  });

  it("preserves empty cells as empty strings (dense layout)", async () => {
    const csv = ",name,age\n1,alice,30\n";
    const { writer, rowsBySheet } = makeRecorder();
    await csvToCache(toStream(csv), "sheet_0_blanks", writer);
    const rows = rowsBySheet.get("sheet_0_blanks")!;
    // First header cell is empty — adapter emits an empty string in the
    // dense row, not a synthesized "column_1" placeholder.
    expect(rows[0]).toEqual(["", "name", "age"]);
    expect(rows[1]).toEqual(["1", "alice", "30"]);
  });

  it("emits dense rows even when interior cells are empty", async () => {
    const csv = "a,,c\n,b,\n";
    const { writer, rowsBySheet } = makeRecorder();
    const stats = await csvToCache(toStream(csv), "sheet_0_sparse", writer);
    expect(stats).toEqual({ rowCount: 2, colCount: 3 });
    const rows = rowsBySheet.get("sheet_0_sparse")!;
    expect(rows[0]).toEqual(["a", "", "c"]);
    expect(rows[1]).toEqual(["", "b", ""]);
  });

  it("honours explicit delimiter override", async () => {
    const csv = "a|b|c\n1|2|3\n";
    const { writer, rowsBySheet } = makeRecorder();
    await csvToCache(toStream(csv), "sheet_0_forced", writer, {
      delimiter: "|",
    });
    expect(rowsBySheet.get("sheet_0_forced")![0]).toEqual(["a", "b", "c"]);
  });
});
