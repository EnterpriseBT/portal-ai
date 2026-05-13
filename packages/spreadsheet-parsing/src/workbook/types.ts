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
  /**
   * Synchronous cell accessor. Returns the cell at `(row, col)` if it has
   * been loaded into the sheet; `undefined` for sparse cells inside a
   * loaded window or for coordinates outside the sheet's dimensions.
   *
   * Throws `RangeNotLoadedError` when `row` is outside every window the
   * caller has previously `await`-ed via `loadRange`. The throw is a
   * programmer-error signal — a forgotten `loadRange` is a bug, not a
   * sparse-cell condition. The eager sheet (`makeSheetAccessor`) treats
   * every row as loaded and never throws.
   */
  cell(row: number, col: number): WorkbookCell | undefined;
  /**
   * Synchronous rectangle accessor. Throws `RangeNotLoadedError` if any
   * row in `[startRow, endRow]` lies outside every loaded window.
   */
  range(
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number
  ): (WorkbookCell | undefined)[][];
  /**
   * Load the row window `[r0, r1]` (inclusive, 1-based) into the sheet so
   * subsequent `cell()` calls inside that window resolve synchronously.
   *
   * Cumulative — multiple non-overlapping windows can be loaded and
   * remain readable. Idempotent — re-loading an already-loaded window is
   * a no-op. Out-of-bounds bounds are clamped to the sheet's
   * `dimensions.rows`; a window that's entirely out of bounds resolves
   * as a no-op without fetching.
   *
   * The eager sheet implements this as `Promise.resolve()` since every
   * row is already loaded; the lazy sheet (`makeLazySheetAccessor`)
   * backs it with the caller-supplied fetcher.
   */
  loadRange(r0: number, r1: number): Promise<void>;
}

export interface Workbook {
  sheets: Sheet[];
}

/**
 * Thrown by `LazySheet.cell` (and `.range`) when the caller reads a cell
 * outside every window previously loaded via `loadRange`. Carries the
 * offending coordinates so callers can format diagnostic messages
 * without re-parsing the error string.
 *
 * Catching this to retry via `loadRange` is an anti-pattern — every
 * parser stage that reads a region should pre-load its row window once,
 * then read synchronously. The throw exists as a backstop, not a
 * control-flow signal.
 */
export class RangeNotLoadedError extends Error {
  constructor(
    public readonly row: number,
    public readonly col: number
  ) {
    super(`Cell at (row=${row}, col=${col}) is outside the loaded window`);
    this.name = "RangeNotLoadedError";
  }
}
