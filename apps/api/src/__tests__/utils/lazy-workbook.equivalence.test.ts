/**
 * Equivalence test for the row-async refactor — case 5 from
 * `docs/SPREADSHEET_PARSER_ROW_ASYNC.spec.md` §Tests, scoped down to
 * exercise the production `makeLazyWorkbookFromCache` factory through
 * the parser's `replay()` pipeline. The assertion: a fixed
 * `LayoutPlan` replayed against the lazy workbook produces the same
 * records as the eager `makeWorkbook(WorkbookData)` workbook over the
 * same underlying data.
 *
 * Mocks `WorkbookCacheService.readRows` + `getMerges` so we exercise
 * the factory + parser without a Redis dependency. The chunked
 * payload mirrors what the file-upload / connector pipelines
 * actually persist (dense `ChunkRow[]`, 0-indexed rows).
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import type {
  ChunkRow,
  SheetChunkMeta,
} from "../../services/workbook-cache.service.js";
import type { LayoutPlan, WorkbookData } from "@portalai/spreadsheet-parsing";

const readRowsMock =
  jest.fn<
    (
      prefix: string,
      sheetId: string,
      rowStart: number,
      rowEnd: number
    ) => AsyncIterable<ChunkRow>
  >();
const getMergesMock =
  jest.fn<(prefix: string, sheetId: string) => Promise<never[]>>();

jest.unstable_mockModule("../../services/workbook-cache.service.js", () => ({
  WorkbookCacheService: {
    readRows: readRowsMock,
    getMerges: getMergesMock,
  },
}));

const { makeWorkbook } = await import("@portalai/spreadsheet-parsing");
const { replay } = await import("@portalai/spreadsheet-parsing/replay");
const { makeLazyWorkbookFromCache } =
  await import("../../utils/lazy-workbook.util.js");

function makeAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

interface SyntheticInput {
  /** Dense 0-indexed rows fed to the cache mock. */
  rows: ChunkRow[];
  /** Same data, sparse + 1-indexed, fed to `makeWorkbook` for the eager comparison. */
  workbookData: WorkbookData;
  sheetMeta: SheetChunkMeta;
}

function buildSynthetic(
  rowCount: number,
  cols: string[],
  rowValues: (rowIdx: number) => (string | number | null)[]
): SyntheticInput {
  const rows: ChunkRow[] = [cols.slice()];
  for (let i = 0; i < rowCount; i++) rows.push(rowValues(i));

  const sparseCells: WorkbookData["sheets"][number]["cells"] = [];
  rows.forEach((row, rowIdx) => {
    row.forEach((value, colIdx) => {
      if (value === null || value === undefined || value === "") return;
      sparseCells.push({ row: rowIdx + 1, col: colIdx + 1, value });
    });
  });

  return {
    rows,
    workbookData: {
      sheets: [
        {
          name: "Sheet1",
          dimensions: { rows: rows.length, cols: cols.length },
          cells: sparseCells,
        },
      ],
    },
    sheetMeta: {
      sheetId: "sheet-1",
      name: "Sheet1",
      rowCount: rows.length,
      colCount: cols.length,
      hasMerges: false,
    },
  };
}

function contactsPlan(rowCount: number): LayoutPlan {
  return {
    planVersion: "1.0.0",
    workbookFingerprint: {
      sheetNames: ["Sheet1"],
      dimensions: { Sheet1: { rows: rowCount + 1, cols: 3 } },
      anchorCells: [{ sheet: "Sheet1", row: 1, col: 1, value: "email" }],
    },
    regions: [
      {
        id: "r1",
        sheet: "Sheet1",
        bounds: {
          startRow: 1,
          startCol: 1,
          endRow: rowCount + 1,
          endCol: 3,
        },
        targetEntityDefinitionId: "contacts",
        headerAxes: ["row"],
        segmentsByAxis: {
          row: [{ kind: "field", positionCount: 3 }],
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
        columnBindings: [
          {
            sourceLocator: { kind: "byHeaderName", axis: "row", name: "email" },
            columnDefinitionId: "col-email",
            confidence: 0.9,
          },
          {
            sourceLocator: { kind: "byHeaderName", axis: "row", name: "name" },
            columnDefinitionId: "col-name",
            confidence: 0.9,
          },
          {
            sourceLocator: { kind: "byHeaderName", axis: "row", name: "age" },
            columnDefinitionId: "col-age",
            confidence: 0.9,
          },
        ],
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
}

describe("makeLazyWorkbookFromCache — replay equivalence (case 5)", () => {
  beforeEach(() => {
    readRowsMock.mockReset();
    getMergesMock.mockReset();
    getMergesMock.mockResolvedValue([]);
  });

  it("produces the same records as the eager path on a 5k-row contacts sheet", async () => {
    const ROWS = 5_000;
    const synth = buildSynthetic(ROWS, ["email", "name", "age"], (i) => [
      `user${i}@x.com`,
      `user-${i}`,
      i % 99,
    ]);

    readRowsMock.mockImplementation((_prefix, _id, rowStart, rowEnd) =>
      makeAsyncIterable(synth.rows.slice(rowStart, rowEnd))
    );

    const lazy = makeLazyWorkbookFromCache("prefix:case5", [synth.sheetMeta]);
    const eager = makeWorkbook(synth.workbookData);
    const plan = contactsPlan(ROWS);

    const lazyResult = await replay(plan, lazy);
    const eagerResult = await replay(plan, eager);

    expect(lazyResult.records).toHaveLength(ROWS);
    expect(eagerResult.records).toHaveLength(ROWS);
    expect(lazyResult.records).toEqual(eagerResult.records);
    expect(lazyResult.drift).toEqual(eagerResult.drift);

    // The factory's row-window fetcher fired at least once (lazy path
    // actually consulted the cache rather than short-circuiting).
    expect(readRowsMock).toHaveBeenCalled();
  });

  it("matches the eager path on a sparse sheet (drops nulls + empty strings consistently)", async () => {
    // Mixed sparsity: blanks scattered through the body. Both paths
    // must agree on which cells are populated and which are null.
    const synth = buildSynthetic(50, ["email", "name", "age"], (i) => [
      i % 7 === 0 ? null : `user${i}@x.com`,
      i % 5 === 0 ? "" : `user-${i}`,
      i % 3 === 0 ? null : i,
    ]);
    readRowsMock.mockImplementation((_p, _id, rowStart, rowEnd) =>
      makeAsyncIterable(synth.rows.slice(rowStart, rowEnd))
    );

    const lazy = makeLazyWorkbookFromCache("prefix:case5-sparse", [
      synth.sheetMeta,
    ]);
    const eager = makeWorkbook(synth.workbookData);
    const plan = contactsPlan(50);

    const lazyResult = await replay(plan, lazy);
    const eagerResult = await replay(plan, eager);

    expect(lazyResult.records).toEqual(eagerResult.records);
  });
});
