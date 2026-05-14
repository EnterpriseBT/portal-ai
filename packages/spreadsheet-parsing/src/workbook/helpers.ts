import {
  RangeNotLoadedError,
  type Sheet,
  type SheetData,
  type SheetDimensions,
  type Workbook,
  type WorkbookCell,
  type WorkbookData,
} from "./types.js";

const cellKey = (row: number, col: number): string => `${row}:${col}`;

/**
 * Build a synchronous `Sheet` from a fully-materialized `SheetData`.
 *
 * Every row is considered loaded — `loadRange` is a `Promise.resolve()`
 * no-op. This is the default factory for in-process workbook fixtures
 * (parser unit tests, the eager `makeWorkbook` path).
 *
 * Phase 4 of `docs/LARGE_FILE_PARSE_STREAMING.plan.md` introduced the
 * sibling lazy form below; the row-async refactor (`docs/
 * SPREADSHEET_PARSER_ROW_ASYNC.spec.md`) added `loadRange` to the
 * shared interface so the eager + lazy variants are substitutable
 * everywhere a `Sheet` is consumed.
 */
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
    // Eager sheets carry every row up-front; nothing to fetch.
    async loadRange() {
      // no-op
    },
  };
}

export function makeWorkbook(data: WorkbookData): Workbook {
  return { sheets: data.sheets.map(makeSheetAccessor) };
}

// ── Lazy sheet ─────────────────────────────────────────────────────────

/**
 * Fetcher signature for `makeLazySheetAccessor`. Receives an inclusive
 * row window `[r0, r1]` (1-based; already clamped to the sheet's
 * dimensions); returns the cells present in that window. May return
 * fewer than `(r1 - r0 + 1)` rows if the underlying source has sparse
 * rows — missing cells become `undefined` from the `cell()` accessor.
 *
 * The lazy sheet calls this exactly once per non-overlapping window
 * (idempotent across repeated `loadRange` calls).
 */
export type LazySheetRowFetcher = (
  r0: number,
  r1: number
) => Promise<WorkbookCell[]>;

export interface LazySheetMeta {
  name: string;
  dimensions: SheetDimensions;
}

/**
 * Build a `Sheet` whose row windows are fetched lazily. Used by the
 * lazy workbook adapter at the API layer (`apps/api/src/utils/
 * lazy-workbook.util.ts`) to back interpret + commit against the
 * chunked Redis cache without materializing the full workbook in V8
 * heap.
 *
 * Behaviour invariants:
 * - Cumulative loaded windows: `loadRange(1, 10)` followed by
 *   `loadRange(20, 30)` leaves both windows readable; the gap throws.
 * - Idempotent: repeated `loadRange` calls over the same (or already-
 *   covered) window resolve without re-fetching.
 * - Clamps: out-of-dimension bounds collapse to the in-range subset;
 *   an entirely out-of-bounds window resolves as a no-op without
 *   firing the fetcher.
 * - Fetcher rejection propagates from `loadRange`; no partial state
 *   is recorded on failure.
 */
export function makeLazySheetAccessor(
  meta: LazySheetMeta,
  fetcher: LazySheetRowFetcher
): Sheet {
  const { rows, cols } = meta.dimensions;
  const cellMap = new Map<string, WorkbookCell>();
  // Sorted, non-overlapping inclusive ranges. Maintained on each
  // successful `loadRange` via `mergeLoaded`.
  let loaded: Array<[number, number]> = [];

  function isLoaded(row: number): boolean {
    for (const [a, b] of loaded) {
      if (row >= a && row <= b) return true;
      if (row < a) return false;
    }
    return false;
  }

  // Insert `[a, b]` into `loaded`, merging overlapping or adjacent
  // segments so the list stays sorted + minimal.
  function mergeLoaded(a: number, b: number): void {
    const next: Array<[number, number]> = [];
    let cur: [number, number] = [a, b];
    let placed = false;
    for (const seg of loaded) {
      if (placed) {
        next.push(seg);
        continue;
      }
      if (seg[1] + 1 < cur[0]) {
        next.push(seg);
      } else if (cur[1] + 1 < seg[0]) {
        next.push(cur);
        next.push(seg);
        placed = true;
      } else {
        cur = [Math.min(cur[0], seg[0]), Math.max(cur[1], seg[1])];
      }
    }
    if (!placed) next.push(cur);
    loaded = next;
  }

  // Return the sub-ranges of `[a, b]` not yet covered by `loaded`. The
  // fetcher is called once per element of the returned array; an empty
  // array means the window is already fully loaded.
  function subtractLoaded(a: number, b: number): Array<[number, number]> {
    let segments: Array<[number, number]> = [[a, b]];
    for (const [la, lb] of loaded) {
      const nextSegments: Array<[number, number]> = [];
      for (const [sa, sb] of segments) {
        if (lb < sa || la > sb) {
          nextSegments.push([sa, sb]);
          continue;
        }
        if (la > sa) nextSegments.push([sa, la - 1]);
        if (lb < sb) nextSegments.push([lb + 1, sb]);
      }
      segments = nextSegments;
      if (segments.length === 0) return [];
    }
    return segments;
  }

  return {
    name: meta.name,
    dimensions: meta.dimensions,

    async loadRange(r0, r1) {
      // Clamp to the sheet's row dimensions. An entirely out-of-bounds
      // window collapses to an empty range and resolves without firing
      // the fetcher.
      const a = Math.max(1, r0);
      const b = Math.min(rows, r1);
      if (b < a) return;

      const segments = subtractLoaded(a, b);
      if (segments.length === 0) return;

      for (const [sa, sb] of segments) {
        const cells = await fetcher(sa, sb);
        for (const c of cells) {
          cellMap.set(cellKey(c.row, c.col), c);
        }
        mergeLoaded(sa, sb);
      }
    },

    cell(row, col) {
      // Out-of-dimension reads return undefined (matches eager-sheet
      // semantics) regardless of loaded state; only in-dimension rows
      // gate on `isLoaded`.
      if (row < 1 || col < 1 || row > rows || col > cols) return undefined;
      if (!isLoaded(row)) throw new RangeNotLoadedError(row, col);
      return cellMap.get(cellKey(row, col));
    },

    range(startRow, startCol, endRow, endCol) {
      if (endRow < startRow || endCol < startCol) return [];
      const rs0 = Math.max(1, startRow);
      const cs0 = Math.max(1, startCol);
      const rs1 = Math.min(rows, endRow);
      const cs1 = Math.min(cols, endCol);
      if (rs1 < rs0 || cs1 < cs0) return [];
      for (let r = rs0; r <= rs1; r++) {
        if (!isLoaded(r)) throw new RangeNotLoadedError(r, cs0);
      }
      const out: (WorkbookCell | undefined)[][] = [];
      for (let r = rs0; r <= rs1; r++) {
        const row: (WorkbookCell | undefined)[] = [];
        for (let c = cs0; c <= cs1; c++) {
          row.push(cellMap.get(cellKey(r, c)));
        }
        out.push(row);
      }
      return out;
    },
  };
}
