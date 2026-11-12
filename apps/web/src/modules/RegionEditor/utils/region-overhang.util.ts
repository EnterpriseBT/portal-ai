import type { CellBounds, SheetPreview } from "./region-editor.types";

type SheetSize = Pick<SheetPreview, "rowCount" | "colCount">;

/** #1009: how far a region runs past its sheet. Bounds are 0-based, so the
 *  sheet's last row is `rowCount - 1`. */
export interface RegionOverhang {
  rowsPast: number;
  colsPast: number;
  lastRow: number;
  lastCol: number;
}

/**
 * #1009: a stored region outlives its sheet when rows or columns are deleted
 * at the source. Null when the region fits.
 */
export function regionOverhang(
  bounds: CellBounds,
  sheet: SheetSize
): RegionOverhang | null {
  const lastRow = sheet.rowCount - 1;
  const lastCol = sheet.colCount - 1;
  const rowsPast = Math.max(0, bounds.endRow - lastRow);
  const colsPast = Math.max(0, bounds.endCol - lastCol);
  if (rowsPast === 0 && colsPast === 0) return null;
  return { rowsPast, colsPast, lastRow, lastCol };
}

/** #1009: the region trimmed to its sheet (Fit to sheet). */
export function fitBoundsToSheet(
  bounds: CellBounds,
  sheet: SheetSize
): CellBounds {
  const lastRow = Math.max(0, sheet.rowCount - 1);
  const lastCol = Math.max(0, sheet.colCount - 1);
  return {
    startRow: Math.min(bounds.startRow, lastRow),
    startCol: Math.min(bounds.startCol, lastCol),
    endRow: Math.min(bounds.endRow, lastRow),
    endCol: Math.min(bounds.endCol, lastCol),
  };
}
