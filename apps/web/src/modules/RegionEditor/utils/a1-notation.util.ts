import type { CellBounds, CellCoord } from "./region-editor.types";

export function colIndexToLetter(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

export function letterToColIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

export function formatCell(coord: CellCoord): string {
  return `${colIndexToLetter(coord.col)}${coord.row + 1}`;
}

export function formatBounds(bounds: CellBounds): string {
  const start = formatCell({ row: bounds.startRow, col: bounds.startCol });
  const end = formatCell({ row: bounds.endRow, col: bounds.endCol });
  return start === end ? start : `${start}:${end}`;
}

export function normalizeBounds(a: CellCoord, b: CellCoord): CellBounds {
  return {
    startRow: Math.min(a.row, b.row),
    endRow: Math.max(a.row, b.row),
    startCol: Math.min(a.col, b.col),
    endCol: Math.max(a.col, b.col),
  };
}

export function coordInBounds(coord: CellCoord, bounds: CellBounds): boolean {
  return (
    coord.row >= bounds.startRow &&
    coord.row <= bounds.endRow &&
    coord.col >= bounds.startCol &&
    coord.col <= bounds.endCol
  );
}

export type ParseRangeResult =
  | { ok: true; bounds: CellBounds }
  | { ok: false; error: string };

const FORMAT_ERROR = "Enter a range like A1:D20";

// One endpoint of a range: a cell (B3), a column (B) or a row (3).
const ENDPOINT = /^([A-Z]+)?([0-9]+)?$/;

/**
 * Parses a typed A1 range into 0-based bounds (#795): a rectangle
 * (`A1:D20`, either corner first), one cell (`B3`), full-height columns
 * (`A:D`) or full-width rows (`3:10`). Case and spaces don't matter. Both
 * ends must be the same kind, and the range must lie on the sheet.
 */
export function parseRange(
  input: string,
  sheet: { rowCount: number; colCount: number }
): ParseRangeResult {
  const parts = input.toUpperCase().replace(/\s+/g, "").split(":");
  if (parts.length > 2 || parts.some((p) => p === "")) {
    return { ok: false, error: FORMAT_ERROR };
  }
  const ends = parts.map((p) => {
    const m = ENDPOINT.exec(p);
    if (!m || (!m[1] && !m[2])) return null;
    const row = m[2] === undefined ? null : Number(m[2]) - 1;
    if (row !== null && row < 0) return null;
    return { col: m[1] ? letterToColIndex(m[1]) : null, row };
  });
  if (ends.some((e) => e === null)) return { ok: false, error: FORMAT_ERROR };
  const [a, b = a] = ends as { col: number | null; row: number | null }[];
  const kind = (e: typeof a) =>
    e.col !== null && e.row !== null ? "cell" : e.col !== null ? "col" : "row";
  // A lone column or row needs its pair (`A:D`, `3:10`); a cell may stand
  // alone, and the two ends must match.
  if (kind(a) !== kind(b) || (parts.length === 1 && kind(a) !== "cell")) {
    return { ok: false, error: FORMAT_ERROR };
  }
  const lastRow = sheet.rowCount - 1;
  const lastCol = sheet.colCount - 1;
  const bounds = normalizeBounds(
    { row: a.row ?? 0, col: a.col ?? 0 },
    { row: b.row ?? lastRow, col: b.col ?? lastCol }
  );
  if (a.row === null) {
    bounds.startRow = 0;
    bounds.endRow = lastRow;
  }
  if (a.col === null) {
    bounds.startCol = 0;
    bounds.endCol = lastCol;
  }
  if (bounds.endRow > lastRow || bounds.endCol > lastCol) {
    return {
      ok: false,
      error: `Outside the sheet (A1:${formatCell({ row: lastRow, col: lastCol })})`,
    };
  }
  return { ok: true, bounds };
}
