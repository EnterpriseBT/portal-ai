/**
 * A1 notation for the parser's own messages (#1002). Coordinates are
 * 1-based, matching the workbook's `row` / `col`.
 */

/** 1-based column index → letters: 1 → "A", 26 → "Z", 27 → "AA". */
export function columnLetters(col: number): string {
  let out = "";
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) {
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  }
  return out;
}

/** A 1-based range as A1 notation; a single cell collapses to "B2". */
export function formatA1Range(bounds: {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}): string {
  const start = `${columnLetters(bounds.startCol)}${bounds.startRow}`;
  const end = `${columnLetters(bounds.endCol)}${bounds.endRow}`;
  return start === end ? start : `${start}:${end}`;
}
