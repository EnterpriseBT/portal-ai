import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import { crc32 } from "node:zlib";

/**
 * ExcelJS' streaming `WorkbookReader` races when a workbook's sheets come
 * before `xl/sharedStrings.xml` in the zip (#997): it spools those sheets
 * to temp files and parses them after the zip loop, and along that path it
 * drops whole sheets and leaves strings as `{ sharedString: n }`. That's
 * the order ExcelJS itself writes. With the metadata first it never takes
 * that path, so we hand it the same zip, entry for entry, in this order.
 */
export const METADATA_FIRST = [
  "[Content_Types].xml",
  "_rels/.rels",
  "xl/workbook.xml",
  "xl/_rels/workbook.xml.rels",
  "xl/sharedStrings.xml",
  "xl/styles.xml",
] as const;

/** One local entry: its name and the byte span of its header + data. */
export interface ZipEntrySpan {
  name: string;
  /** Offset of the entry's local file header. */
  start: number;
  /** Exclusive end: the next entry's header, or the central directory. */
  end: number;
}

/** A zip's local entries and the span of its central directory + end record. */
export interface ZipLayout {
  entries: ZipEntrySpan[];
  /**
   * From the central directory's start to the end of the file. A streaming
   * reader stops when it reaches it; a stream that just ends instead fails
   * with FILE_ENDED, which ExcelJS swallows, dropping what's still unread.
   */
  tail: { start: number; end: number };
}

export class ZipLayoutError extends Error {}

const EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const CENTRAL_SIG = 0x02014b50;
/** EOCD record (22 bytes) plus the longest possible comment. */
const EOCD_SEARCH = 22 + 0xffff;

async function readAt(
  path: string,
  position: number,
  length: number
): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buf, 0, length, position);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * The zip's local entries from its central directory, each with the span
 * from its local header to the next entry's (or the central directory's)
 * start. A span therefore carries the header, the compressed data and any
 * data descriptor, with no size arithmetic. Zip64 is supported.
 */
export async function readZipLayout(
  path: string,
  fileSize: number
): Promise<ZipLayout> {
  try {
    return await parseZipLayout(path, fileSize);
  } catch (err) {
    // A truncated or crafted structure overruns a buffer read; say so in
    // the same words as any other malformed zip, not Node's RangeError.
    if (err instanceof RangeError) {
      throw new ZipLayoutError("malformed zip structure");
    }
    throw err;
  }
}

async function parseZipLayout(
  path: string,
  fileSize: number
): Promise<ZipLayout> {
  const tailStart = Math.max(0, fileSize - EOCD_SEARCH);
  const tail = await readAt(path, tailStart, fileSize - tailStart);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipLayoutError("not a zip file (no end record)");

  let count = tail.readUInt16LE(eocd + 10);
  let cdSize = tail.readUInt32LE(eocd + 12);
  let cdOffset = tail.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff || count === 0xffff || cdSize === 0xffffffff) {
    const loc = eocd - 20;
    if (loc < 0 || tail.readUInt32LE(loc) !== ZIP64_LOCATOR_SIG) {
      throw new ZipLayoutError("zip64 end record locator missing");
    }
    const z64Offset = Number(tail.readBigUInt64LE(loc + 8));
    const z64 = await readAt(path, z64Offset, 56);
    if (z64.length < 56 || z64.readUInt32LE(0) !== ZIP64_EOCD_SIG) {
      throw new ZipLayoutError("zip64 end record missing");
    }
    count = Number(z64.readBigUInt64LE(32));
    cdSize = Number(z64.readBigUInt64LE(40));
    cdOffset = Number(z64.readBigUInt64LE(48));
  }
  if (cdOffset + cdSize > fileSize) {
    throw new ZipLayoutError("central directory runs past the end");
  }

  const cd = await readAt(path, cdOffset, cdSize);
  const entries: { name: string; start: number }[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== CENTRAL_SIG) {
      throw new ZipLayoutError("central directory entry malformed");
    }
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    let start = cd.readUInt32LE(p + 42);
    const name = cd.toString("utf8", p + 46, p + 46 + nameLen);
    if (start === 0xffffffff) {
      // Zip64 extra (0x0001): the 8-byte fields present are, in order, the
      // sizes that overflowed, then the local header offset.
      const extra = cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
      let e = 0;
      while (e + 4 <= extra.length) {
        const id = extra.readUInt16LE(e);
        const size = extra.readUInt16LE(e + 2);
        if (id === 0x0001) {
          let f = e + 4;
          if (cd.readUInt32LE(p + 24) === 0xffffffff) f += 8;
          if (cd.readUInt32LE(p + 20) === 0xffffffff) f += 8;
          start = Number(extra.readBigUInt64LE(f));
          break;
        }
        e += 4 + size;
      }
    }
    entries.push({ name, start });
    p += 46 + nameLen + extraLen + commentLen;
  }

  const byOffset = [...entries].sort((a, b) => a.start - b.start);
  return {
    entries: byOffset.map((entry, i) => ({
      ...entry,
      end: i + 1 < byOffset.length ? byOffset[i + 1].start : cdOffset,
    })),
    tail: { start: cdOffset, end: fileSize },
  };
}

/** The spans reordered: `METADATA_FIRST` names, then the rest as stored. */
export function metadataFirst(spans: ZipEntrySpan[]): ZipEntrySpan[] {
  const first: ZipEntrySpan[] = [];
  for (const name of METADATA_FIRST) {
    const span = spans.find((s) => s.name === name);
    if (span) first.push(span);
  }
  const rest = spans.filter(
    (s) => !(METADATA_FIRST as readonly string[]).includes(s.name)
  );
  return [...first, ...rest];
}

/**
 * A stream of the zip at `path` with its local entries in `entries` order,
 * each copied byte for byte, then its central directory. The directory's
 * offsets no longer match, which a streaming reader doesn't use; it only
 * needs the directory to know the entries are over.
 */
export function streamEntries(
  path: string,
  layout: ZipLayout,
  prefix: Buffer[] = []
): Readable {
  const spans = [...layout.entries, layout.tail];
  return Readable.from(
    (async function* () {
      yield* prefix;
      for (const span of spans) {
        if (span.end <= span.start) continue;
        yield* createReadStream(path, { start: span.start, end: span.end - 1 });
      }
    })()
  );
}

const EMPTY_SHARED_STRINGS = Buffer.from(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="0" uniqueCount="0"/>'
);

/**
 * A stored (uncompressed) local entry for an empty `xl/sharedStrings.xml`.
 * ExcelJS parses a sheet inline only once it has seen a shared-strings
 * part, so a workbook without one (all numbers, or inline strings) would
 * still take the racy temp-file path. Streamed ahead of the zip's own
 * entries, this keeps it inline. Its offsets aren't in the central
 * directory, which a streaming reader doesn't consult.
 */
export function emptySharedStringsEntry(): Buffer {
  const name = Buffer.from("xl/sharedStrings.xml");
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4); // version needed: 2.0
  header.writeUInt16LE(0, 6); // flags: sizes in the header
  header.writeUInt16LE(0, 8); // method: stored
  header.writeUInt16LE(0, 10); // time
  header.writeUInt16LE(0x21, 12); // date: 1980-01-01
  header.writeUInt32LE(crc32(EMPTY_SHARED_STRINGS) >>> 0, 14);
  header.writeUInt32LE(EMPTY_SHARED_STRINGS.length, 18);
  header.writeUInt32LE(EMPTY_SHARED_STRINGS.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, name, EMPTY_SHARED_STRINGS]);
}
