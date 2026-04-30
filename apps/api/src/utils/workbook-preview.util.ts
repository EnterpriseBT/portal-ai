/**
 * Shared workbook preview helpers used by both the file-upload and
 * google-sheets pipelines. The two pipelines hand a `WorkbookData` to
 * the same RegionEditor, so the preview shape (inline-or-sliced sheets,
 * rectangle slicing) lives here as one source of truth.
 *
 * See `docs/GOOGLE_SHEETS_CONNECTOR.phase-B.plan.md` §Slice 7.
 */

import type {
  CellValue,
  WorkbookData,
} from "@portalai/spreadsheet-parsing";

import { ApiCode } from "../constants/api-codes.constants.js";
import { environment } from "../environment.js";
import { ApiError } from "../services/http.service.js";

/** A preview-shape sheet — what the parse-session / select-sheet routes return. */
export interface PreviewSheet {
  id: string;
  name: string;
  dimensions: { rows: number; cols: number };
  cells: (string | number | null)[][];
}

/** Stable sheet id the client uses to address a tab. */
export function sheetId(index: number, name: string): string {
  const slug = name.replace(/\s+/g, "_").toLowerCase();
  return `sheet_${index}_${slug}`;
}

/** Coerce the parser's rich `CellValue` into the preview's JSON-safe union. */
export function coerceToPreviewCell(
  value: CellValue
): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * Build a dense preview grid for one sheet. Sheets whose total cell
 * count exceeds `inlineCellsMax` come back with `cells: []`; callers
 * surface a top-level `sliced: true` flag so the editor knows to fall
 * back to the slice endpoint per rectangle.
 */
export function inflateSheetPreview(
  sheet: WorkbookData["sheets"][number],
  index: number,
  inlineCellsMax: number
): { sheet: PreviewSheet; sliced: boolean } {
  const id = sheetId(index, sheet.name);
  const totalCells = sheet.dimensions.rows * sheet.dimensions.cols;
  const sliced = totalCells > inlineCellsMax;

  if (sliced) {
    return {
      sheet: { id, name: sheet.name, dimensions: sheet.dimensions, cells: [] },
      sliced: true,
    };
  }

  const cells: (string | number | null)[][] = Array.from(
    { length: sheet.dimensions.rows },
    () =>
      Array.from(
        { length: sheet.dimensions.cols },
        () => "" as string
      ) as (string | number | null)[]
  );
  for (const cell of sheet.cells) {
    const r = cell.row - 1;
    const c = cell.col - 1;
    if (r < 0 || r >= sheet.dimensions.rows) continue;
    if (c < 0 || c >= sheet.dimensions.cols) continue;
    cells[r]![c] = coerceToPreviewCell(cell.value);
  }

  return {
    sheet: { id, name: sheet.name, dimensions: sheet.dimensions, cells },
    sliced: false,
  };
}

/** Look up a sheet in a workbook by the minted `sheetId`. */
export function findSheetById(
  workbook: WorkbookData,
  id: string
): { sheet: WorkbookData["sheets"][number]; index: number } | undefined {
  for (let i = 0; i < workbook.sheets.length; i++) {
    if (sheetId(i, workbook.sheets[i]!.name) === id) {
      return { sheet: workbook.sheets[i]!, index: i };
    }
  }
  return undefined;
}

export interface SliceQuery {
  rowStart: number;
  rowEnd: number;
  colStart: number;
  colEnd: number;
}

export interface SliceResult {
  cells: (string | number | null)[][];
  rowStart: number;
  colStart: number;
}

/**
 * Extract a cell rectangle from a sheet, clamping the requested bounds
 * to the sheet's dimensions and enforcing the per-request cell cap so a
 * runaway client can't pull the whole sheet in one call.
 */
export function sliceWorkbookRectangle(
  sheet: WorkbookData["sheets"][number],
  query: SliceQuery
): SliceResult {
  const rowStart = Math.max(
    0,
    Math.min(query.rowStart, sheet.dimensions.rows)
  );
  const rowEnd = Math.max(
    0,
    Math.min(query.rowEnd, sheet.dimensions.rows)
  );
  const colStart = Math.max(
    0,
    Math.min(query.colStart, sheet.dimensions.cols)
  );
  const colEnd = Math.max(
    0,
    Math.min(query.colEnd, sheet.dimensions.cols)
  );

  if (rowEnd <= rowStart || colEnd <= colStart) {
    return { cells: [], rowStart, colStart };
  }

  const rows = rowEnd - rowStart;
  const cols = colEnd - colStart;
  if (rows * cols > environment.FILE_UPLOAD_SLICE_CELLS_MAX) {
    throw new ApiError(
      400,
      ApiCode.FILE_UPLOAD_SLICE_TOO_LARGE,
      `Slice of ${rows * cols} cells exceeds ${environment.FILE_UPLOAD_SLICE_CELLS_MAX}`
    );
  }

  const cells: (string | number | null)[][] = Array.from(
    { length: rows },
    () =>
      Array.from(
        { length: cols },
        () => "" as string
      ) as (string | number | null)[]
  );
  for (const cell of sheet.cells) {
    const r = cell.row - 1 - rowStart;
    const c = cell.col - 1 - colStart;
    if (r < 0 || r >= rows) continue;
    if (c < 0 || c >= cols) continue;
    cells[r]![c] = coerceToPreviewCell(cell.value);
  }

  return { cells, rowStart, colStart };
}
