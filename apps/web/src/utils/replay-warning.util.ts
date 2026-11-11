import type { ReplayWarning } from "@portalai/core/contracts";

import {
  colIndexToLetter,
  formatBounds,
} from "../modules/RegionEditor/utils/a1-notation.util";

/**
 * #1009: one line for a region a sync read past its sheet, or skipped because
 * its sheet is gone. Warning bounds are 1-based (as stored on the plan); the
 * editor's A1 helpers are 0-based.
 */
export function formatReplayWarning(warning: ReplayWarning): string {
  const { bounds } = warning;
  const range = formatBounds({
    startRow: bounds.startRow - 1,
    startCol: bounds.startCol - 1,
    endRow: bounds.endRow - 1,
    endCol: bounds.endCol - 1,
  });
  const entity = warning.targetEntityDefinitionId;

  if (warning.kind === "sheet-missing") {
    return (
      `${range} (${entity}) was on sheet "${warning.sheet}", which is no ` +
      `longer in the workbook, so it replayed nothing. Its records weren't ` +
      `refreshed.`
    );
  }

  const letter = (col: number) => colIndexToLetter(col - 1);
  const rowsPast = Math.max(0, bounds.endRow - warning.sheetLastRow);
  const colsPast = Math.max(0, bounds.endCol - warning.sheetLastCol);
  const rows =
    rowsPast > 1
      ? `rows ${warning.sheetLastRow + 1}–${bounds.endRow}`
      : `row ${bounds.endRow}`;
  const cols =
    colsPast > 1
      ? `columns ${letter(warning.sheetLastCol + 1)}–${letter(bounds.endCol)}`
      : `column ${letter(bounds.endCol)}`;
  const lastRow = `last row (${warning.sheetLastRow})`;
  const lastCol = `last column (${letter(warning.sheetLastCol)})`;
  const where = `${range} on "${warning.sheet}" (${entity}) runs past the sheet's`;

  if (rowsPast > 0 && colsPast > 0) {
    return (
      `${where} ${lastRow} and ${lastCol}: ${rows} and ${cols} are gone from ` +
      `the sheet, so they were skipped and those rows' records removed.`
    );
  }
  if (rowsPast > 0) {
    return (
      `${where} ${lastRow}: ${rows} ${rowsPast > 1 ? "are" : "is"} gone from ` +
      `the sheet, so ${rowsPast > 1 ? "their" : "its"} records were removed.`
    );
  }
  return (
    `${where} ${lastCol}: ${cols} ${colsPast > 1 ? "are" : "is"} gone from ` +
    `the sheet, so ${colsPast > 1 ? "they were" : "it was"} skipped.`
  );
}
