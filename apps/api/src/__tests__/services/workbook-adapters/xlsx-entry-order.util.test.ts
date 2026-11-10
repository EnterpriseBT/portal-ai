import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import ExcelJS from "exceljs";

import {
  metadataFirst,
  readZipEntrySpans,
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
    const spans = await readZipEntrySpans(path, bytes.length);
    const names = spans.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "xl/workbook.xml",
        "xl/sharedStrings.xml",
        "xl/worksheets/sheet1.xml",
        "xl/worksheets/sheet2.xml",
      ])
    );
    expect(spans[0].start).toBe(0);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].start).toBe(spans[i - 1].end);
    }
    // Each span opens with a local file header.
    for (const s of spans) expect(bytes.readUInt32LE(s.start)).toBe(0x04034b50);
  });

  it("puts the metadata ahead of the sheets, which ExcelJS writes first", async () => {
    const stored = (await readZipEntrySpans(path, bytes.length)).map(
      (s) => s.name
    );
    expect(stored.indexOf("xl/worksheets/sheet1.xml")).toBeLessThan(
      stored.indexOf("xl/sharedStrings.xml")
    );
    const ordered = metadataFirst(
      await readZipEntrySpans(path, bytes.length)
    ).map((s) => s.name);
    expect(ordered.indexOf("xl/sharedStrings.xml")).toBeLessThan(
      ordered.indexOf("xl/worksheets/sheet1.xml")
    );
    expect(ordered.indexOf("xl/styles.xml")).toBeLessThan(
      ordered.indexOf("xl/worksheets/sheet1.xml")
    );
    expect([...ordered].sort()).toEqual([...stored].sort());
  });

  it("streams each entry's bytes unchanged, in the new order", async () => {
    const spans = metadataFirst(await readZipEntrySpans(path, bytes.length));
    const out = await collect(streamEntries(path, spans));
    let at = 0;
    for (const s of spans) {
      const len = s.end - s.start;
      expect(
        out.subarray(at, at + len).equals(bytes.subarray(s.start, s.end))
      ).toBe(true);
      at += len;
    }
    expect(at).toBe(out.length);
  });

  it("gives ExcelJS a stream it reads in full", async () => {
    const spans = metadataFirst(await readZipEntrySpans(path, bytes.length));
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
    ).stream.xlsx.WorkbookReader(streamEntries(path, spans), {
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
    await expect(readZipEntrySpans(notZip, 19)).rejects.toBeInstanceOf(
      ZipLayoutError
    );
  });
});
