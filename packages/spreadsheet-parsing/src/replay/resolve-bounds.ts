import {
  DEFAULT_UNTIL_BLANK_COUNT,
  recordsAxisOf,
  type AxisMember,
  type Region,
  type Terminator,
} from "../plan/index.js";
import type { Sheet, WorkbookCell } from "../workbook/types.js";

export interface ResolvedBounds {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

function cellText(cell: WorkbookCell | undefined): string {
  if (!cell || cell.value === null) return "";
  if (cell.value instanceof Date) return cell.value.toISOString();
  if (typeof cell.value === "boolean") return cell.value ? "true" : "false";
  return String(cell.value);
}

function isLineBlank(
  sheet: Sheet,
  axis: AxisMember,
  coord: number,
  crossStart: number,
  crossEnd: number
): boolean {
  if (axis === "row") {
    for (let c = crossStart; c <= crossEnd; c++) {
      if (cellText(sheet.cell(coord, c)) !== "") return false;
    }
    return true;
  }
  for (let r = crossStart; r <= crossEnd; r++) {
    if (cellText(sheet.cell(r, coord)) !== "") return false;
  }
  return true;
}

function firstCellText(
  sheet: Sheet,
  axis: AxisMember,
  coord: number,
  crossStart: number
): string {
  return axis === "row"
    ? cellText(sheet.cell(coord, crossStart))
    : cellText(sheet.cell(crossStart, coord));
}

/**
 * Extend a bound outward along `axis` until the terminator fires. Returns the
 * last coord to include (a data line, not the terminator itself).
 *
 * - `untilBlank`: walk coords; count consecutive blank lines; stop after
 *   `consecutiveBlanks` blanks; return the last non-blank coord. If no blank
 *   line is found, return the sheet edge.
 * - `matchesPattern`: walk coords; stop when the leading cell matches the
 *   pattern; return the coord before the match. If no match, return the sheet
 *   edge.
 */
function extendAlongAxis(
  terminator: Terminator,
  sheet: Sheet,
  axis: AxisMember,
  startCoord: number,
  crossStart: number,
  crossEnd: number,
  sheetEdge: number
): number {
  if (terminator.kind === "untilBlank") {
    const needed = terminator.consecutiveBlanks ?? DEFAULT_UNTIL_BLANK_COUNT;
    let lastData = startCoord - 1;
    let blanks = 0;
    for (let c = startCoord; c <= sheetEdge; c++) {
      if (isLineBlank(sheet, axis, c, crossStart, crossEnd)) {
        blanks++;
        if (blanks >= needed) break;
      } else {
        blanks = 0;
        lastData = c;
      }
    }
    return lastData;
  }
  const re = new RegExp(terminator.pattern);
  for (let c = startCoord; c <= sheetEdge; c++) {
    if (re.test(firstCellText(sheet, axis, c, crossStart))) {
      return c - 1;
    }
  }
  return sheetEdge;
}

/**
 * Resolve a region's bounds against the workbook. If `recordAxisTerminator`
 * is set, extend the records-axis bound outward; otherwise return the literal
 * bounds. Only single-axis extension is applied here; per-axis dynamic tail
 * segments are handled by the extract pipeline.
 */
export function resolveRegionBounds(
  region: Region,
  sheet: Sheet
): ResolvedBounds {
  const bounds: ResolvedBounds = { ...region.bounds };
  if (!region.recordAxisTerminator) return bounds;

  const recordsAxis = recordsAxisOf(region);
  if (!recordsAxis) return bounds;

  if (recordsAxis === "row") {
    bounds.endRow = extendAlongAxis(
      region.recordAxisTerminator,
      sheet,
      "row",
      bounds.endRow + 1,
      bounds.startCol,
      bounds.endCol,
      sheet.dimensions.rows
    );
    if (bounds.endRow < region.bounds.endRow) bounds.endRow = region.bounds.endRow;
  } else {
    bounds.endCol = extendAlongAxis(
      region.recordAxisTerminator,
      sheet,
      "column",
      bounds.endCol + 1,
      bounds.startRow,
      bounds.endRow,
      sheet.dimensions.cols
    );
    if (bounds.endCol < region.bounds.endCol) bounds.endCol = region.bounds.endCol;
  }
  return bounds;
}
