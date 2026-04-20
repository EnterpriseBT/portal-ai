import type { Readable } from "node:stream";

import type { FileParseResult } from "@portalai/core/models";

import { configureCsvStream } from "../services/workbook-adapters/csv.adapter.js";
import {
  type ColumnAccumulator,
  createAccumulator,
  updateAccumulator,
  finalizeAccumulator,
} from "./column-stats.util.js";

/** Maximum sample rows to capture per file. */
const DEFAULT_MAX_SAMPLE_ROWS = 50;

/**
 * Legacy heuristic header detection for the simple-layout upload path.
 *
 * @deprecated Header detection is moving into
 * `@portalai/spreadsheet-parsing`'s `detect-headers` stage in Phase 3. New
 * callers should consume the `Workbook` adapters and run interpretation via
 * the parser module rather than this heuristic.
 */
function detectHeader(values: string[]): boolean {
  return (
    values.length > 1 &&
    values.every((v) => v.trim() !== "" && isNaN(Number(v.trim())))
  );
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
  }
): Promise<FileParseResult> {
  const maxSampleRows = options.maxSampleRows ?? DEFAULT_MAX_SAMPLE_ROWS;
  const { parser, delimiter, encoding, empty } = await configureCsvStream(
    source,
    options.delimiter
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
  options: { delimiter?: string } = {}
): AsyncIterable<Record<string, string>> {
  const { parser, empty } = await configureCsvStream(source, options.delimiter);
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
