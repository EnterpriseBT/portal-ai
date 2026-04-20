import {
  DEFAULT_UNTIL_EMPTY_TERMINATOR_COUNT,
  type Region,
} from "../plan/index.js";
import type { Sheet, WorkbookCell } from "../workbook/types.js";

export interface ResolvedBounds {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

function isRowBlank(
  sheet: Sheet,
  row: number,
  startCol: number,
  endCol: number
): boolean {
  for (let c = startCol; c <= endCol; c++) {
    const cell = sheet.cell(row, c);
    if (cell && cell.value !== null && cell.value !== "") return false;
  }
  return true;
}

function cellText(cell: WorkbookCell | undefined): string {
  if (!cell || cell.value === null) return "";
  if (cell.value instanceof Date) return cell.value.toISOString();
  if (typeof cell.value === "boolean") return cell.value ? "true" : "false";
  return String(cell.value);
}

/**
 * Expand a region's row bounds downward until a terminator is reached.
 * Terminator = `untilEmptyTerminatorCount` consecutive blank rows
 * (default = `DEFAULT_UNTIL_EMPTY_TERMINATOR_COUNT`, i.e. 2).
 *
 * Returns the last **non-blank** row reached before the terminator (so the
 * returned `endRow` is always a data row, not a blank).
 */
function expandUntilEmpty(region: Region, sheet: Sheet): ResolvedBounds {
  const terminator =
    region.untilEmptyTerminatorCount ?? DEFAULT_UNTIL_EMPTY_TERMINATOR_COUNT;
  const { startRow, startCol, endCol } = region.bounds;
  const sheetMax = sheet.dimensions.rows;

  let lastDataRow = region.bounds.endRow;
  let blanks = 0;
  for (let r = region.bounds.endRow + 1; r <= sheetMax; r++) {
    if (isRowBlank(sheet, r, startCol, endCol)) {
      blanks++;
      if (blanks >= terminator) break;
    } else {
      blanks = 0;
      lastDataRow = r;
    }
  }
  return { startRow, startCol, endRow: lastDataRow, endCol };
}

/**
 * Expand a region's row bounds downward until a row whose leading cell
 * (`startCol`) matches `boundsPattern`. The matching row is *not* included
 * — it's a terminator marker. When no row matches, the region extends to
 * the sheet's declared row dimension.
 */
function expandUntilPattern(region: Region, sheet: Sheet): ResolvedBounds {
  const { startRow, startCol, endCol } = region.bounds;
  if (!region.boundsPattern) {
    return { ...region.bounds };
  }
  const re = new RegExp(region.boundsPattern);
  const sheetMax = sheet.dimensions.rows;
  let endRow = sheetMax;
  for (let r = region.bounds.endRow + 1; r <= sheetMax; r++) {
    const firstCell = cellText(sheet.cell(r, startCol));
    if (re.test(firstCell)) {
      endRow = r - 1;
      break;
    }
  }
  return { startRow, startCol, endRow, endCol };
}

/**
 * Resolve a region's `bounds` against the workbook. `absolute` returns the
 * literal range; `untilEmpty` and `matchesPattern` expand rowwise.
 */
export function resolveRegionBounds(
  region: Region,
  sheet: Sheet
): ResolvedBounds {
  switch (region.boundsMode) {
    case "absolute":
      return { ...region.bounds };
    case "untilEmpty":
      return expandUntilEmpty(region, sheet);
    case "matchesPattern":
      return expandUntilPattern(region, sheet);
  }
}
