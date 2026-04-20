import type {
  Sheet,
  SheetData,
  Workbook,
  WorkbookCell,
  WorkbookData,
} from "./types.js";

const cellKey = (row: number, col: number): string => `${row}:${col}`;

export function makeSheetAccessor(data: SheetData): Sheet {
  const index = new Map<string, WorkbookCell>();
  for (const c of data.cells) {
    index.set(cellKey(c.row, c.col), c);
  }

  const { rows, cols } = data.dimensions;

  return {
    name: data.name,
    dimensions: data.dimensions,
    cell(row, col) {
      if (row < 1 || col < 1 || row > rows || col > cols) return undefined;
      return index.get(cellKey(row, col));
    },
    range(startRow, startCol, endRow, endCol) {
      if (endRow < startRow || endCol < startCol) return [];
      const r0 = Math.max(1, startRow);
      const c0 = Math.max(1, startCol);
      const r1 = Math.min(rows, endRow);
      const c1 = Math.min(cols, endCol);
      if (r1 < r0 || c1 < c0) return [];
      const out: (WorkbookCell | undefined)[][] = [];
      for (let r = r0; r <= r1; r++) {
        const row: (WorkbookCell | undefined)[] = [];
        for (let c = c0; c <= c1; c++) {
          row.push(index.get(cellKey(r, c)));
        }
        out.push(row);
      }
      return out;
    },
  };
}

export function makeWorkbook(data: WorkbookData): Workbook {
  return { sheets: data.sheets.map(makeSheetAccessor) };
}
