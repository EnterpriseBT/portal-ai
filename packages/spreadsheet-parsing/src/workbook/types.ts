export interface MergedRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export type CellValue = string | number | boolean | Date | null;

export interface WorkbookCell {
  row: number;
  col: number;
  value: CellValue;
  rawText?: string;
  merged?: MergedRange;
}

export interface SheetDimensions {
  rows: number;
  cols: number;
}

export interface SheetData {
  name: string;
  dimensions: SheetDimensions;
  cells: WorkbookCell[];
}

export interface WorkbookData {
  sheets: SheetData[];
}

export interface Sheet {
  name: string;
  dimensions: SheetDimensions;
  cell(row: number, col: number): WorkbookCell | undefined;
  range(
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number
  ): (WorkbookCell | undefined)[][];
}

export interface Workbook {
  sheets: Sheet[];
}
