/**
 * `makeLazyWorkbookFromCache(prefix, sheetMetas)` builds a parser-compatible
 * `Workbook` whose sheets resolve row windows on demand from the chunked
 * Redis cache (`WorkbookCacheService.readRows`). Used by the four
 * `resolveWorkbook` orchestrators (file-upload, google-sheets,
 * microsoft-excel, microsoft-excel sync) to feed `interpret` + `commit`
 * without materialising the full workbook in V8 heap.
 *
 * Sheets here use `makeLazySheetAccessor` from `@portalai/spreadsheet-parsing`
 * — every parser stage that reads cells has been migrated to `await
 * sheet.loadRange(r0, r1)` before its sync `cell()` reads (slices 1 + 2).
 *
 * See `docs/SPREADSHEET_PARSER_ROW_ASYNC.spec.md` §Factory contract.
 */

import {
  makeLazySheetAccessor,
  type LazySheetMeta,
  type LazySheetRowFetcher,
  type MergedRange,
  type Sheet,
  type Workbook,
  type WorkbookCell,
} from "@portalai/spreadsheet-parsing";

import {
  WorkbookCacheService,
  type SheetChunkMeta,
} from "../services/workbook-cache.service.js";

/**
 * Build a lazy `Workbook` backed by a chunked-cache session at `prefix`.
 * The merges side-table is fetched once per sheet on the first
 * `loadRange` and cached in the closure for subsequent windows.
 */
export function makeLazyWorkbookFromCache(
  prefix: string,
  sheetMetas: SheetChunkMeta[]
): Workbook {
  return {
    sheets: sheetMetas.map((sheetMeta) =>
      buildLazySheet(prefix, sheetMeta)
    ),
  };
}

function buildLazySheet(prefix: string, sheetMeta: SheetChunkMeta): Sheet {
  const meta: LazySheetMeta = {
    name: sheetMeta.name,
    dimensions: { rows: sheetMeta.rowCount, cols: sheetMeta.colCount },
  };
  let mergesPromise: Promise<Map<string, MergedRange>> | undefined;
  const loadMerges = (): Promise<Map<string, MergedRange>> => {
    if (!mergesPromise) {
      mergesPromise = sheetMeta.hasMerges
        ? WorkbookCacheService.getMerges(prefix, sheetMeta.sheetId).then(
            (merges) => {
              const map = new Map<string, MergedRange>();
              for (const m of merges) {
                map.set(`${m.startRow}:${m.startCol}`, m);
              }
              return map;
            }
          )
        : Promise.resolve(new Map<string, MergedRange>());
    }
    return mergesPromise;
  };

  const fetcher: LazySheetRowFetcher = async (r0, r1) => {
    const mergesByTopLeft = await loadMerges();
    const out: WorkbookCell[] = [];
    // `loadRange(r0, r1)` is 1-based inclusive on both ends; `readRows`
    // takes a 0-based half-open `[rowStart, rowEnd)` range. The first
    // yielded row corresponds to sheet row `r0`.
    let rowNum = r0;
    for await (const row of WorkbookCacheService.readRows(
      prefix,
      sheetMeta.sheetId,
      r0 - 1,
      r1
    )) {
      for (let c = 0; c < row.length; c++) {
        const value = row[c];
        // Sparse representation: drop nulls and empty strings so the
        // parser's `cell()` accessor returns `undefined` for them
        // (matches the eager-sheet semantics produced by
        // `makeWorkbook`).
        if (value === null || value === undefined || value === "") continue;
        const colNum = c + 1;
        const merged = mergesByTopLeft.get(`${rowNum}:${colNum}`);
        out.push(
          merged
            ? { row: rowNum, col: colNum, value, merged }
            : { row: rowNum, col: colNum, value }
        );
      }
      rowNum++;
    }
    return out;
  };

  return makeLazySheetAccessor(meta, fetcher);
}
