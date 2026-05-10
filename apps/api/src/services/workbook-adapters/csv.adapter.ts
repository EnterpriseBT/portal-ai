import type { Readable } from "node:stream";

import chardet from "chardet";
import { parse } from "csv-parse";

import type {
  ChunkRow,
  SessionWriter,
} from "../workbook-cache.service.js";

const DETECTION_CHUNK_SIZE = 4096;
const CANDIDATE_DELIMITERS = [",", "\t", ";", "|"];

function detectDelimiter(sample: string): string {
  let best = ",";
  let bestCount = 0;
  for (const d of CANDIDATE_DELIMITERS) {
    const count = sample.split(d).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

export interface ConfiguredCsvStream {
  parser: AsyncIterable<string[]>;
  delimiter: string;
  encoding: string;
  empty: boolean;
}

/**
 * Read a detection sample to pick encoding + delimiter, then wire the rest of
 * the source into a csv-parse stream. Memory bounded by DETECTION_CHUNK_SIZE
 * plus csv-parse's internal buffer.
 */
export async function configureCsvStream(
  source: Readable,
  explicitDelimiter?: string
): Promise<ConfiguredCsvStream> {
  const iter = source[Symbol.asyncIterator]() as AsyncIterator<Buffer>;

  const sampleChunks: Buffer[] = [];
  let sampleSize = 0;
  let sourceEnded = false;

  while (sampleSize < DETECTION_CHUNK_SIZE) {
    const next = await iter.next();
    if (next.done) {
      sourceEnded = true;
      break;
    }
    sampleChunks.push(next.value);
    sampleSize += next.value.length;
  }

  const sampleBuf = Buffer.concat(sampleChunks);

  if (sampleBuf.length === 0) {
    const parser = parse({
      delimiter: ",",
      relax_column_count: true,
      skip_empty_lines: true,
    });
    parser.end();
    return {
      parser: parser as unknown as AsyncIterable<string[]>,
      delimiter: ",",
      encoding: "utf-8",
      empty: true,
    };
  }

  const encoding = chardet.detect(sampleBuf) ?? "utf-8";
  const sampleText = sampleBuf
    .subarray(0, DETECTION_CHUNK_SIZE)
    .toString("utf-8");
  const delimiter = explicitDelimiter ?? detectDelimiter(sampleText);

  const parser = parse({
    delimiter,
    relax_column_count: true,
    skip_empty_lines: true,
  });

  parser.write(sampleBuf);

  if (sourceEnded) {
    parser.end();
  } else {
    void (async () => {
      try {
        while (true) {
          const next = await iter.next();
          if (next.done) break;
          const ok = parser.write(next.value);
          if (!ok) {
            await new Promise<void>((resolve) => parser.once("drain", resolve));
          }
        }
        parser.end();
      } catch (err) {
        parser.destroy(err instanceof Error ? err : new Error(String(err)));
      }
    })();
  }

  return {
    parser: parser as unknown as AsyncIterable<string[]>,
    delimiter,
    encoding,
    empty: false,
  };
}

export interface CsvToCacheOptions {
  delimiter?: string;
}

export interface CsvSheetStats {
  rowCount: number;
  colCount: number;
}

/**
 * Stream a CSV byte source into the chunked workbook cache via `writer`.
 * Returns the sheet's final dimensions; never holds more than one chunk's
 * worth of rows in process memory at once. The caller is responsible for
 * calling `writer.finishSheet(sheetId, { name, ...stats })` once this
 * resolves.
 *
 * Empty cells inside a row stay as `""` (csv-parse already yields empty
 * strings for omitted fields). The dense row layout matches what the slice
 * and preview readers expect.
 */
export async function csvToCache(
  source: Readable,
  sheetId: string,
  writer: SessionWriter,
  options: CsvToCacheOptions = {}
): Promise<CsvSheetStats> {
  const { parser, empty } = await configureCsvStream(source, options.delimiter);

  if (empty) {
    return { rowCount: 0, colCount: 0 };
  }

  let rowCount = 0;
  let colCount = 0;
  // Tiny in-process buffer just so we don't hammer the writer with 1-row
  // appends; the writer itself is what flushes to Redis at chunk size. 64
  // is a token amount — keeps GC pressure down without growing memory.
  const STAGE_SIZE = 64;
  let stage: ChunkRow[] = [];

  for await (const record of parser) {
    rowCount++;
    const values = record as string[];
    if (values.length > colCount) colCount = values.length;
    stage.push(values as ChunkRow);
    if (stage.length >= STAGE_SIZE) {
      await writer.appendRows(sheetId, stage);
      stage = [];
    }
  }
  if (stage.length > 0) {
    await writer.appendRows(sheetId, stage);
  }

  return { rowCount, colCount };
}
