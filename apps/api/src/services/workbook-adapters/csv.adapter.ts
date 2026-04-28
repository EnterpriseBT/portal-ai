import type { Readable } from "node:stream";

import chardet from "chardet";
import { parse } from "csv-parse";

import type { WorkbookCell, WorkbookData } from "@portalai/spreadsheet-parsing";

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

export interface CsvToWorkbookOptions {
  sheetName: string;
  delimiter?: string;
}

/**
 * Convert a CSV byte stream into a canonical `WorkbookData`. The adapter does
 * no header detection or synthesis — every populated field becomes a cell at
 * 1-based (row, col). Empty fields are omitted so the sparse grid stays small.
 */
export async function csvToWorkbook(
  source: Readable,
  options: CsvToWorkbookOptions
): Promise<WorkbookData> {
  const { parser, empty } = await configureCsvStream(source, options.delimiter);

  if (empty) {
    return {
      sheets: [
        {
          name: options.sheetName,
          dimensions: { rows: 0, cols: 0 },
          cells: [],
        },
      ],
    };
  }

  const cells: WorkbookCell[] = [];
  let maxCol = 0;
  let row = 0;

  for await (const record of parser) {
    row++;
    const values = record as string[];
    if (values.length > maxCol) maxCol = values.length;
    for (let i = 0; i < values.length; i++) {
      const value = values[i] ?? "";
      if (value === "") continue;
      cells.push({ row, col: i + 1, value });
    }
  }

  return {
    sheets: [
      {
        name: options.sheetName,
        dimensions: { rows: row, cols: maxCol },
        cells,
      },
    ],
  };
}
