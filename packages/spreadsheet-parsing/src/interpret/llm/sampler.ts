import type { Sheet, WorkbookCell } from "../../workbook/types.js";
import { MAX_SHEET_SAMPLE } from "./prompt.js";

export interface SampleBounds {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export interface SampleOptions {
  maxRows?: number;
  maxCols?: number;
}

export interface SampledRegion {
  bounds: SampleBounds;
  cells: string[][];
  truncated: boolean;
}

function cellText(cell: WorkbookCell | undefined): string {
  if (!cell || cell.value === null) return "";
  if (cell.value instanceof Date) return cell.value.toISOString();
  if (typeof cell.value === "boolean") return cell.value ? "true" : "false";
  return String(cell.value);
}

/**
 * Pure clipping helper. Returns a 2-D array of stringified cell values
 * covering at most `maxRows × maxCols` of the source region. Sparse cells
 * coerce to empty string so the returned grid is always rectangular.
 *
 * Defaults match `MAX_SHEET_SAMPLE` — consumers may override when composing
 * their own prompt.
 */
export function sampleWorkbookRegion(
  sheet: Sheet,
  bounds: SampleBounds,
  opts: SampleOptions = {}
): SampledRegion {
  const maxRows = opts.maxRows ?? MAX_SHEET_SAMPLE.rows;
  const maxCols = opts.maxCols ?? MAX_SHEET_SAMPLE.cols;

  if (bounds.endRow < bounds.startRow || bounds.endCol < bounds.startCol) {
    return { bounds, cells: [], truncated: false };
  }

  const totalRows = bounds.endRow - bounds.startRow + 1;
  const totalCols = bounds.endCol - bounds.startCol + 1;
  const rows = Math.min(totalRows, maxRows);
  const cols = Math.min(totalCols, maxCols);
  const truncated = rows < totalRows || cols < totalCols;

  const cells: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < cols; c++) {
      row.push(cellText(sheet.cell(bounds.startRow + r, bounds.startCol + c)));
    }
    cells.push(row);
  }

  return { bounds, cells, truncated };
}
