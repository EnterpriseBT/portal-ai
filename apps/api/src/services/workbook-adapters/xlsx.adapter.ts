import type { Readable } from "node:stream";

import ExcelJS from "exceljs";

import type {
  CellValue,
  MergedRange,
  SheetData,
  WorkbookCell,
  WorkbookData,
} from "@portalai/spreadsheet-parsing";

import { ProcessorError } from "../../utils/processor-error.util.js";

/**
 * Coerce an ExcelJS raw cell value into the canonical `CellValue`.
 *
 * Rules:
 *   - null / undefined   → null
 *   - Date               → Date (preserved)
 *   - boolean            → boolean
 *   - number             → number
 *   - string             → string (trimmed of empty → null)
 *   - rich text          → concatenated string
 *   - hyperlink object   → display text
 *   - formula result     → coerced recursively
 */
function coerceCell(raw: unknown): CellValue {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return raw;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") return raw === "" ? null : raw;
  if (typeof raw === "object") {
    const obj = raw as {
      richText?: Array<{ text?: string }>;
      text?: string;
      result?: unknown;
    };
    if (Array.isArray(obj.richText)) {
      const joined = obj.richText.map((p) => p.text ?? "").join("");
      return joined === "" ? null : joined;
    }
    if (typeof obj.text === "string") {
      return obj.text === "" ? null : obj.text;
    }
    if (obj.result !== undefined) return coerceCell(obj.result);
  }
  return String(raw);
}

interface MergeModel {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

function collectMerges(ws: ExcelJS.Worksheet): Map<string, MergedRange> {
  const byTopLeft = new Map<string, MergedRange>();
  const merges = (
    ws as unknown as { _merges?: Record<string, { model?: MergeModel }> }
  )._merges;
  if (!merges) return byTopLeft;
  for (const key of Object.keys(merges)) {
    const model = merges[key]?.model;
    if (!model) continue;
    byTopLeft.set(`${model.top}:${model.left}`, {
      startRow: model.top,
      startCol: model.left,
      endRow: model.bottom,
      endCol: model.right,
    });
  }
  return byTopLeft;
}

async function readAll(source: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of source) {
    chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function wrapXlsxError(err: unknown): ProcessorError {
  if (err instanceof ProcessorError) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (/password|encrypted|encryption/i.test(message)) {
    return new ProcessorError(
      "XLSX_PASSWORD_PROTECTED",
      `XLSX file is password-protected: ${message}`
    );
  }
  return new ProcessorError(
    "XLSX_PARSE_FAILED",
    `Failed to parse XLSX file: ${message}`
  );
}

function buildSheet(ws: ExcelJS.Worksheet): SheetData {
  const merges = collectMerges(ws);
  const cells: WorkbookCell[] = [];
  let maxRow = 0;
  let maxCol = 0;

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const value = coerceCell(cell.value);
      if (value === null) return;
      if (rowNumber > maxRow) maxRow = rowNumber;
      if (colNumber > maxCol) maxCol = colNumber;
      const mergedKey = `${rowNumber}:${colNumber}`;
      const merged = merges.get(mergedKey);
      cells.push(
        merged
          ? { row: rowNumber, col: colNumber, value, merged }
          : { row: rowNumber, col: colNumber, value }
      );
    });
  });

  const name =
    (ws as unknown as { name?: string }).name ??
    `Sheet${(ws as unknown as { id?: number }).id ?? "?"}`;

  return {
    name,
    dimensions: { rows: maxRow, cols: maxCol },
    cells,
  };
}

/**
 * Convert an XLSX byte stream into a canonical `WorkbookData`. The full buffer
 * is loaded in-memory (ExcelJS streaming does not expose merged-cell metadata).
 */
export async function xlsxToWorkbook(source: Readable): Promise<WorkbookData> {
  let buffer: Buffer;
  try {
    buffer = await readAll(source);
  } catch (err) {
    throw wrapXlsxError(err);
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch (err) {
    throw wrapXlsxError(err);
  }

  const sheets: SheetData[] = [];
  workbook.eachSheet((ws) => {
    sheets.push(buildSheet(ws));
  });

  return { sheets };
}
