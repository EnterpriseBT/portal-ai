/**
 * Standalone memory smoke for the row-async refactor — case 6 from
 * `docs/SPREADSHEET_PARSER_ROW_ASYNC.spec.md` §Tests.
 *
 * Drives `replay(plan, lazyWorkbook)` against a 50,000-row × 20-col
 * synthetic dataset whose rows are generated lazily by the
 * `LazySheet`'s fetcher. The companion jest test spawns this script
 * with `NODE_OPTIONS=--max-old-space-size=512`; success = clean exit
 * 0 (no signal-9, no `JavaScript heap out of memory`). Failure mode
 * surfaces as a heap-cap OOM in the child's stderr.
 *
 * The script intentionally bypasses `WorkbookCacheService` so the
 * smoke doesn't need a Redis instance — the regression we're gating
 * lives in the parser's `replay` path + the lazy adapter, not in
 * the cache layer. Slice 3's lazy-factory tests already cover the
 * cache-shape adapter; slice 4's equivalence tests already cover
 * lazy-vs-eager record-set parity.
 */

import {
  makeLazySheetAccessor,
  type LayoutPlan,
  type LazySheetMeta,
  type LazySheetRowFetcher,
  type Workbook,
  type WorkbookCell,
} from "@portalai/spreadsheet-parsing";
import { replay } from "@portalai/spreadsheet-parsing/replay";

const ROWS = 50_000;
const COLS = 20;
const HEADERS = Array.from({ length: COLS }, (_, i) => `col_${i}`);

function generateRowsForWindow(r0: number, r1: number): WorkbookCell[] {
  const cells: WorkbookCell[] = [];
  for (let r = r0; r <= r1; r++) {
    if (r === 1) {
      for (let c = 0; c < COLS; c++) {
        cells.push({ row: 1, col: c + 1, value: HEADERS[c] });
      }
      continue;
    }
    const idx = r - 2;
    cells.push({ row: r, col: 1, value: `id-${idx}` });
    for (let c = 1; c < COLS; c++) {
      cells.push({ row: r, col: c + 1, value: `${HEADERS[c]}-${idx}` });
    }
  }
  return cells;
}

const fetcher: LazySheetRowFetcher = async (r0, r1) =>
  generateRowsForWindow(r0, r1);

const meta: LazySheetMeta = {
  name: "Sheet1",
  dimensions: { rows: ROWS + 1, cols: COLS },
};

const workbook: Workbook = {
  sheets: [makeLazySheetAccessor(meta, fetcher)],
};

const plan: LayoutPlan = {
  planVersion: "1.0.0",
  workbookFingerprint: {
    sheetNames: ["Sheet1"],
    dimensions: { Sheet1: { rows: ROWS + 1, cols: COLS } },
    anchorCells: [{ sheet: "Sheet1", row: 1, col: 1, value: HEADERS[0]! }],
  },
  regions: [
    {
      id: "r1",
      sheet: "Sheet1",
      bounds: { startRow: 1, startCol: 1, endRow: ROWS + 1, endCol: COLS },
      targetEntityDefinitionId: "rows",
      headerAxes: ["row"],
      segmentsByAxis: {
        row: [{ kind: "field", positionCount: COLS }],
      },
      headerStrategyByAxis: {
        row: {
          kind: "row",
          locator: { kind: "row", sheet: "Sheet1", row: 1 },
          confidence: 0.95,
        },
      },
      identityStrategy: {
        kind: "column",
        sourceLocator: { kind: "column", sheet: "Sheet1", col: 1 },
        confidence: 0.9,
      },
      columnBindings: HEADERS.map((h) => ({
        sourceLocator: { kind: "byHeaderName" as const, axis: "row" as const, name: h },
        columnDefinitionId: `col-${h}`,
        confidence: 0.9,
      })),
      skipRules: [],
      drift: {
        headerShiftRows: 0,
        addedColumns: "halt",
        removedColumns: { max: 0, action: "halt" },
      },
      confidence: { region: 0.9, aggregate: 0.9 },
      warnings: [],
    },
  ],
  confidence: { overall: 0.9, perRegion: { r1: 0.9 } },
};

const start = Date.now();
const result = await replay(plan, workbook);
const elapsedMs = Date.now() - start;

if (result.records.length !== ROWS) {
  console.error(
    `FAIL: expected ${ROWS} records, got ${result.records.length}`
  );
  process.exit(1);
}

const usedMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
console.log(
  `OK row-async memory smoke: ${result.records.length} records in ${elapsedMs} ms; ` +
    `heapUsed=${usedMb} MB, rss=${rssMb} MB`
);
process.exit(0);
