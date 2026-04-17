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

export function defaultFieldNamesForRegion(
  bounds: CellBounds,
  orientation: "rows-as-records" | "columns-as-records" | "cells-as-records"
): string[] {
  if (orientation === "columns-as-records") {
    const out: string[] = [];
    for (let row = bounds.startRow; row <= bounds.endRow; row++) {
      out.push(`row${row + 1}`);
    }
    return out;
  }
  const out: string[] = [];
  for (let col = bounds.startCol; col <= bounds.endCol; col++) {
    out.push(`column${colIndexToLetter(col)}`);
  }
  return out;
}
