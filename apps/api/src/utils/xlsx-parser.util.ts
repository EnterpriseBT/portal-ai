import type { Readable } from "node:stream";

import ExcelJS from "exceljs";

import type { FileParseResult } from "@portalai/core/models";

import {
  type ColumnAccumulator,
  createAccumulator,
  updateAccumulator,
  finalizeAccumulator,
} from "./column-stats.util.js";
import { ProcessorError } from "./processor-error.util.js";

/** Maximum sample rows to capture per sheet. */
const DEFAULT_MAX_SAMPLE_ROWS = 50;

/** Hard cap on columns per sheet — anything beyond is dropped. */
const MAX_COLUMNS = 500;

/** Common reader options — `styles: "cache"` is required for date detection. */
const READER_OPTIONS: Partial<ExcelJS.stream.xlsx.WorkbookStreamReaderOptions> = {
  worksheets: "emit",
  sharedStrings: "cache",
  hyperlinks: "ignore",
  styles: "cache",
};

/**
 * Coerce a single XLSX cell value to its canonical string form.
 *
 * Rules:
 *   - null / undefined → ""
 *   - Date             → ISO 8601
 *   - boolean          → "true" / "false"
 *   - number           → String(n)
 *   - string           → as-is
 *   - rich text        → concatenation of text parts
 *   - hyperlink        → display text
 *   - formula          → coerced result
 */
function coerceCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const obj = value as {
      richText?: Array<{ text?: string }>;
      text?: string;
      result?: unknown;
    };
    if (Array.isArray(obj.richText)) {
      return obj.richText.map((part) => part.text ?? "").join("");
    }
    if (typeof obj.text === "string") return obj.text;
    if (obj.result !== undefined) return coerceCell(obj.result);
  }
  return String(value);
}

/**
 * Convert a streaming Row to a dense string[] of cell values (1-based → 0-based).
 * Truncates at MAX_COLUMNS; trailing empty cells are preserved up to the row's
 * declared length so column-aligned data stays aligned.
 */
function rowToValues(row: ExcelJS.Row): string[] {
  const raw = row.values as ExcelJS.CellValue[] | undefined;
  if (!raw || raw.length <= 1) return [];
  const out: string[] = [];
  for (let i = 1; i < raw.length && i - 1 < MAX_COLUMNS; i++) {
    out.push(coerceCell(raw[i]));
  }
  return out;
}

function isEmptyRow(values: string[]): boolean {
  return values.length === 0 || values.every((v) => v.trim() === "");
}

/** Synthesize column_N for empty cells in the header row. */
function normalizeHeaders(values: string[]): string[] {
  return values.map((v, i) => (v.trim() === "" ? `column_${i + 1}` : v));
}

function wrapXlsxError(err: unknown): ProcessorError {
  if (err instanceof ProcessorError) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (/password|encrypted|encryption/i.test(message)) {
    return new ProcessorError(
      "XLSX_PASSWORD_PROTECTED",
      `XLSX file is password-protected: ${message}`,
    );
  }
  return new ProcessorError(
    "XLSX_PARSE_FAILED",
    `Failed to parse XLSX file: ${message}`,
  );
}

/**
 * Stream an XLSX workbook from a Readable and yield one FileParseResult per
 * non-empty sheet. Peak memory is bounded by `maxSampleRows * column count`
 * per sheet plus exceljs's internal sharedStrings cache.
 *
 * Sheet identity is encoded in `fileName` as `<originalName>[<SheetName>]`
 * so downstream code can recover the sheet name via a simple regex.
 */
export async function* parseXlsxStream(
  source: Readable,
  options: { fileName: string; maxSampleRows?: number },
): AsyncGenerator<FileParseResult> {
  const maxSampleRows = options.maxSampleRows ?? DEFAULT_MAX_SAMPLE_ROWS;

  let workbookReader: ExcelJS.stream.xlsx.WorkbookReader;
  try {
    workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(source, READER_OPTIONS);
  } catch (err) {
    throw wrapXlsxError(err);
  }

  try {
    for await (const worksheetReader of workbookReader) {
      const sheetName =
        (worksheetReader as unknown as { name?: string }).name ??
        `Sheet${(worksheetReader as unknown as { id?: number }).id ?? "?"}`;

      let headers: string[] = [];
      const accumulators: ColumnAccumulator[] = [];
      const sampleRows: string[][] = [];
      let dataRowCount = 0;
      let headerSeen = false;

      for await (const row of worksheetReader) {
        const values = rowToValues(row);
        if (isEmptyRow(values)) continue;

        if (!headerSeen) {
          headers = normalizeHeaders(values);
          for (const h of headers) accumulators.push(createAccumulator(h));
          headerSeen = true;
          continue;
        }

        for (let i = 0; i < accumulators.length; i++) {
          updateAccumulator(accumulators[i], values[i] ?? "");
        }
        if (sampleRows.length < maxSampleRows) {
          // Pad/trim to header width for consistency
          const padded = new Array(accumulators.length)
            .fill("")
            .map((_, i) => values[i] ?? "");
          sampleRows.push(padded);
        }
        dataRowCount++;
      }

      if (dataRowCount === 0) continue;

      yield {
        fileName: `${options.fileName}[${sheetName}]`,
        delimiter: "xlsx",
        hasHeader: true,
        encoding: "utf-8",
        rowCount: dataRowCount,
        headers,
        sampleRows,
        columnStats: accumulators.map(finalizeAccumulator),
      };
    }
  } catch (err) {
    throw wrapXlsxError(err);
  }
}

/**
 * Stream rows from a single named sheet as Record<string,string> keyed by the
 * sheet's first non-empty row (treated as headers).
 *
 * Throws ProcessorError("UPLOAD_SHEET_NOT_FOUND") if the named sheet does not
 * exist in the workbook.
 */
export async function* xlsxSheetRowIterator(
  source: Readable,
  sheetName: string,
): AsyncGenerator<Record<string, string>> {
  let workbookReader: ExcelJS.stream.xlsx.WorkbookReader;
  try {
    workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(source, READER_OPTIONS);
  } catch (err) {
    throw wrapXlsxError(err);
  }

  let found = false;

  try {
    for await (const worksheetReader of workbookReader) {
      const currentName = (worksheetReader as unknown as { name?: string }).name;
      if (currentName !== sheetName) {
        // Drain to advance the underlying stream to the next sheet entry
        for await (const _ of worksheetReader) {
          void _;
        }
        continue;
      }
      found = true;

      let headers: string[] | null = null;

      for await (const row of worksheetReader) {
        const values = rowToValues(row);
        if (isEmptyRow(values)) continue;

        if (headers === null) {
          headers = normalizeHeaders(values);
          continue;
        }

        const out: Record<string, string> = {};
        for (let i = 0; i < headers.length; i++) {
          out[headers[i]] = values[i] ?? "";
        }
        yield out;
      }
    }
  } catch (err) {
    throw wrapXlsxError(err);
  }

  if (!found) {
    throw new ProcessorError(
      "UPLOAD_SHEET_NOT_FOUND",
      `Sheet "${sheetName}" not found in XLSX file`,
    );
  }
}
