import type { Readable } from "node:stream";

import { parse } from "csv-parse";
import chardet from "chardet";

import type { FileParseResult } from "@portalai/core/models";

import {
  type ColumnAccumulator,
  createAccumulator,
  updateAccumulator,
  finalizeAccumulator,
} from "./column-stats.util.js";

/** Maximum sample rows to capture per file. */
const DEFAULT_MAX_SAMPLE_ROWS = 50;

/** Bytes to read for delimiter/encoding detection. */
const DETECTION_CHUNK_SIZE = 4096;

const CANDIDATE_DELIMITERS = [",", "\t", ";", "|"];

/**
 * Auto-detect the delimiter from a sample of the file.
 * Counts occurrences of each candidate and picks the most frequent.
 */
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

/**
 * Heuristic header detection: first row is a header iff it has >1 non-empty
 * values and none of them parse as numbers.
 */
function detectHeader(values: string[]): boolean {
  return (
    values.length > 1 &&
    values.every((v) => v.trim() !== "" && isNaN(Number(v.trim())))
  );
}

interface ConfiguredParser {
  /** The csv-parse parser stream. Consume via `for await`. */
  parser: AsyncIterable<string[]>;
  /** Detected (or explicitly provided) delimiter. */
  delimiter: string;
  /** Detected encoding (defaults to utf-8). */
  encoding: string;
  /** True if the source stream was empty. */
  empty: boolean;
}

/**
 * Read up to DETECTION_CHUNK_SIZE bytes from the source to detect encoding +
 * delimiter, then wire the remaining stream into a configured csv-parse parser.
 * Memory usage is bounded by DETECTION_CHUNK_SIZE plus csv-parse's internal
 * buffer — no full-file buffering.
 */
async function configureParser(
  source: Readable,
  explicitDelimiter?: string,
): Promise<ConfiguredParser> {
  const iter = source[Symbol.asyncIterator]() as AsyncIterator<Buffer>;

  // Read chunks until we have enough for detection or the source ends
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
    // Empty source — create a parser that immediately ends
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
  const sampleText = sampleBuf.subarray(0, DETECTION_CHUNK_SIZE).toString("utf-8");
  const delimiter = explicitDelimiter ?? detectDelimiter(sampleText);

  const parser = parse({
    delimiter,
    relax_column_count: true,
    skip_empty_lines: true,
  });

  // Seed the parser with the buffered sample
  parser.write(sampleBuf);

  if (sourceEnded) {
    parser.end();
  } else {
    // Pump the remainder in the background, handling backpressure
    void (async () => {
      try {
        while (true) {
          const next = await iter.next();
          if (next.done) break;
          const ok = parser.write(next.value);
          if (!ok) {
            await new Promise<void>((resolve) =>
              parser.once("drain", resolve),
            );
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

/**
 * Stream a CSV from a Readable and produce a FileParseResult with headers,
 * sample rows, and column statistics. Peak memory is bounded by
 * `maxSampleRows * column count` plus DETECTION_CHUNK_SIZE — independent of
 * total file size.
 */
export async function parseCsvStream(
  source: Readable,
  options: {
    fileName: string;
    maxSampleRows?: number;
    /** Skip delimiter detection and use this value. */
    delimiter?: string;
  },
): Promise<FileParseResult> {
  const maxSampleRows = options.maxSampleRows ?? DEFAULT_MAX_SAMPLE_ROWS;
  const { parser, delimiter, encoding, empty } = await configureParser(
    source,
    options.delimiter,
  );

  if (empty) {
    return {
      fileName: options.fileName,
      delimiter,
      hasHeader: false,
      encoding,
      rowCount: 0,
      headers: [],
      sampleRows: [],
      columnStats: [],
    };
  }

  const sampleRows: string[][] = [];
  const accumulators: ColumnAccumulator[] = [];
  let headers: string[] = [];
  let rowIndex = 0;
  let hasHeader = false;

  for await (const record of parser) {
    const values = record as string[];

    if (rowIndex === 0) {
      hasHeader = detectHeader(values);
      headers = hasHeader ? values : values.map((_, i) => `column_${i + 1}`);
      for (const h of headers) accumulators.push(createAccumulator(h));

      if (!hasHeader) {
        for (let i = 0; i < values.length && i < accumulators.length; i++) {
          updateAccumulator(accumulators[i], values[i] ?? "");
        }
        if (sampleRows.length < maxSampleRows) sampleRows.push(values);
      }
    } else {
      for (let i = 0; i < values.length && i < accumulators.length; i++) {
        updateAccumulator(accumulators[i], values[i] ?? "");
      }
      if (sampleRows.length < maxSampleRows) sampleRows.push(values);
    }
    rowIndex++;
  }

  const dataRowCount = hasHeader ? Math.max(0, rowIndex - 1) : rowIndex;

  return {
    fileName: options.fileName,
    delimiter,
    hasHeader,
    encoding,
    rowCount: dataRowCount,
    headers,
    sampleRows,
    columnStats: accumulators.map(finalizeAccumulator),
  };
}

/**
 * Stream CSV rows as Record<string,string> keyed by the detected header row.
 * If the first row does not look like a header, synthesize `column_1`, `column_2`, …
 * Consumable with `for await`.
 */
export async function* csvRowIterator(
  source: Readable,
  options: { delimiter?: string } = {},
): AsyncIterable<Record<string, string>> {
  const { parser, empty } = await configureParser(source, options.delimiter);
  if (empty) return;

  let headers: string[] | null = null;
  let rowIndex = 0;

  for await (const record of parser) {
    const values = record as string[];

    if (rowIndex === 0) {
      if (detectHeader(values)) {
        headers = values;
        rowIndex++;
        continue;
      }
      headers = values.map((_, i) => `column_${i + 1}`);
    }

    const row: Record<string, string> = {};
    for (let i = 0; i < values.length; i++) {
      const key = headers![i] ?? `column_${i + 1}`;
      row[key] = values[i] ?? "";
    }
    yield row;
    rowIndex++;
  }
}
