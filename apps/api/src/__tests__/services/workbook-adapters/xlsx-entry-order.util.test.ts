import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import ExcelJS from "exceljs";

import {
  metadataFirst,
  readZipLayout,
  streamEntries,
  ZipLayoutError,
} from "../../../services/workbook-adapters/xlsx-entry-order.util.js";
import { buildMultiSheetXlsx } from "../../utils/xlsx-fixtures.util.js";

async function collect(stream: Readable): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of stream) parts.push(chunk as Buffer);
  return Buffer.concat(parts);
}

describe("xlsx entry order (#997)", () => {
  let dir: string;
  let path: string;
  let bytes: Buffer;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "xlsx-order-test-"));
    path = join(dir, "book.xlsx");
    bytes = await buildMultiSheetXlsx({
      One: [["alpha", "beta"]],
      Two: [["gamma"], ["alpha"]],
    });
    await writeFile(path, bytes);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads every entry, with spans that tile the file up to the central directory", async () => {
    const { entries, tail } = await readZipLayout(path, bytes.length);
    expect(entries.map((s) => s.name)).toEqual(
      expect.arrayContaining([
        "xl/workbook.xml",
        "xl/sharedStrings.xml",
        "xl/worksheets/sheet1.xml",
        "xl/worksheets/sheet2.xml",
      ])
    );
    expect(entries[0].start).toBe(0);
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].start).toBe(entries[i - 1].end);
    }
    expect(tail).toEqual({
      start: entries[entries.length - 1].end,
      end: bytes.length,
    });
    // Each span opens with a local file header, the tail with the directory.
    for (const s of entries) {
      expect(bytes.readUInt32LE(s.start)).toBe(0x04034b50);
    }
    expect(bytes.readUInt32LE(tail.start)).toBe(0x02014b50);
  });

  it("puts the metadata ahead of the sheets, which ExcelJS writes first", async () => {
    const { entries } = await readZipLayout(path, bytes.length);
    const stored = entries.map((s) => s.name);
    expect(stored.indexOf("xl/worksheets/sheet1.xml")).toBeLessThan(
      stored.indexOf("xl/sharedStrings.xml")
    );
    const ordered = metadataFirst(entries).map((s) => s.name);
    expect(ordered.indexOf("xl/sharedStrings.xml")).toBeLessThan(
      ordered.indexOf("xl/worksheets/sheet1.xml")
    );
    expect(ordered.indexOf("xl/styles.xml")).toBeLessThan(
      ordered.indexOf("xl/worksheets/sheet1.xml")
    );
    expect([...ordered].sort()).toEqual([...stored].sort());
  });

  it("streams each entry's bytes unchanged, in the new order, then the central directory", async () => {
    const layout = await readZipLayout(path, bytes.length);
    const ordered = { ...layout, entries: metadataFirst(layout.entries) };
    const out = await collect(streamEntries(path, ordered));
    let at = 0;
    for (const s of [...ordered.entries, ordered.tail]) {
      const len = s.end - s.start;
      expect(
        out.subarray(at, at + len).equals(bytes.subarray(s.start, s.end))
      ).toBe(true);
      at += len;
    }
    expect(at).toBe(out.length);
    // Without the directory a streaming reader hits FILE_ENDED and ExcelJS
    // drops whatever it hadn't read yet, which lost a sheet in the app.
    expect(out.readUInt32LE(out.length - 22)).toBe(0x06054b50);
  });

  it("gives ExcelJS a stream it reads in full", async () => {
    const layout = await readZipLayout(path, bytes.length);
    const ordered = { ...layout, entries: metadataFirst(layout.entries) };
    const reader = new (
      ExcelJS as unknown as {
        stream: {
          xlsx: {
            WorkbookReader: new (
              s: Readable,
              o: object
            ) => AsyncIterable<
              AsyncIterable<{ values: unknown[] }> & { name: string }
            >;
          };
        };
      }
    ).stream.xlsx.WorkbookReader(streamEntries(path, ordered), {
      sharedStrings: "cache",
      worksheets: "emit",
    });
    const seen: Record<string, unknown[][]> = {};
    for await (const ws of reader) {
      seen[ws.name] = [];
      for await (const row of ws) seen[ws.name].push(row.values.slice(1));
    }
    expect(seen).toEqual({
      One: [["alpha", "beta"]],
      Two: [["gamma"], ["alpha"]],
    });
  });

  it("refuses a file with no zip end record", async () => {
    const notZip = join(dir, "not.xlsx");
    await writeFile(notZip, "name,team\nAda,Core\n");
    await expect(readZipLayout(notZip, 19)).rejects.toBeInstanceOf(
      ZipLayoutError
    );
  });
});
