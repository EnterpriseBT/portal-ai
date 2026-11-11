import type { ReplayWarning } from "@portalai/core/contracts";

import {
  colIndexToLetter,
  formatBounds,
} from "../modules/RegionEditor/utils/a1-notation.util";

/**
 * #1009: one line for a region a sync read past its sheet, or skipped because
 * its sheet is gone. Warning bounds are 1-based (as stored on the plan); the
 * editor's A1 helpers are 0-based.
 *
 * What a lost line meant depends on the axis that holds the records: lines
 * along it were records (removed), lines across it were fields (skipped). A
 * crosstab's records are cells, so any lost line took records with it.
 */
export function formatReplayWarning(warning: ReplayWarning): string {
  const { bounds } = warning;
  const range = formatBounds({
    startRow: bounds.startRow - 1,
    startCol: bounds.startCol - 1,
    endRow: bounds.endRow - 1,
    endCol: bounds.endCol - 1,
  });
  const entity = warning.targetEntityLabel ?? warning.targetEntityDefinitionId;

  if (warning.kind === "sheet-missing") {
    return (
      `${range} (${entity}) was on sheet "${warning.sheet}", which is no ` +
      `longer in the workbook, so it replayed nothing. Its records weren't ` +
      `refreshed.`
    );
  }

  const letter = (col: number) => colIndexToLetter(col - 1);
  const lastRow = `last row (${warning.sheetLastRow})`;
  const lastCol = `last column (${letter(warning.sheetLastCol)})`;
  const where = `${range} on "${warning.sheet}" (${entity})`;

  // Wholly past the sheet: nothing was read, so nothing was reconciled or
  // removed; the region's records simply weren't refreshed.
  const pastRows = bounds.startRow > warning.sheetLastRow;
  const pastCols = bounds.startCol > warning.sheetLastCol;
  if (pastRows || pastCols) {
    const edge = pastRows ? lastRow : lastCol;
    return (
      `${where} is entirely past the sheet's ${edge}, so it replayed ` +
      `nothing. Its records weren't refreshed.`
    );
  }

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

  const recordLines = (axis: "row" | "column") =>
    warning.recordsAxis === null || warning.recordsAxis === axis;

  if (rowsPast > 0 && colsPast > 0) {
    const consequence =
      warning.recordsAxis === null
        ? "the records in them were removed"
        : `they were skipped and the lost ${warning.recordsAxis}s' records removed`;
    return (
      `${where} runs past the sheet's ${lastRow} and ${lastCol}: ${rows} and ` +
      `${cols} are gone from the sheet, so ${consequence}.`
    );
  }

  const axis = rowsPast > 0 ? "row" : "column";
  const lost = rowsPast > 0 ? rows : cols;
  const many = (rowsPast > 0 ? rowsPast : colsPast) > 1;
  const consequence =
    warning.recordsAxis === null
      ? "the records in them were removed"
      : recordLines(axis)
        ? `${many ? "their" : "its"} records were removed`
        : `${many ? "they were" : "it was"} skipped`;
  return (
    `${where} runs past the sheet's ${rowsPast > 0 ? lastRow : lastCol}: ` +
    `${lost} ${many ? "are" : "is"} gone from the sheet, so ${consequence}.`
  );
}
