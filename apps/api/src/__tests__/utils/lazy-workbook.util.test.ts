/**
 * Unit tests for `makeLazyWorkbookFromCache` — case 4 from
 * `docs/SPREADSHEET_PARSER_ROW_ASYNC.spec.md` §Tests.
 *
 * The factory builds a parser-compatible `Workbook` whose sheets resolve
 * row windows on demand from `WorkbookCacheService.readRows`. These
 * tests mock the cache service so the factory's row-payload → WorkbookCell
 * adaptation can be exercised without touching Redis.
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import type {
  ChunkRow,
  SheetChunkMeta,
} from "../../services/workbook-cache.service.js";
import type { MergedRange } from "@portalai/spreadsheet-parsing";

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
  jest.fn<(prefix: string, sheetId: string) => Promise<MergedRange[]>>();

jest.unstable_mockModule("../../services/workbook-cache.service.js", () => ({
  WorkbookCacheService: {
    readRows: readRowsMock,
    getMerges: getMergesMock,
  },
}));

const { RangeNotLoadedError } = await import("@portalai/spreadsheet-parsing");
const { makeLazyWorkbookFromCache } =
  await import("../../utils/lazy-workbook.util.js");

function makeAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

describe("makeLazyWorkbookFromCache", () => {
  beforeEach(() => {
    readRowsMock.mockReset();
    getMergesMock.mockReset();
  });

  it("builds a Workbook whose sheets resolve row windows on demand", async () => {
    // Sheet has rows 1..10, cols 1..3. Cache row 4 = ["alice", 30, null],
    // row 7 = ["bob", null, "x"]. Other rows resolve as sparse.
    const sheetMeta: SheetChunkMeta = {
      sheetId: "sheet-1",
      name: "Sheet1",
      rowCount: 10,
      colCount: 3,
      hasMerges: false,
    };
    readRowsMock.mockImplementation((_prefix, _id, rowStart, rowEnd) => {
      // readRows is 0-indexed, half-open. loadRange(1, 10) → readRows(0, 10).
      const allRows: ChunkRow[] = [
        ["", "", ""], // row 1 (1-based) → readRows index 0
        ["", "", ""], // 2
        ["", "", ""], // 3
        ["alice", 30, null], // 4
        ["", "", ""], // 5
        ["", "", ""], // 6
        ["bob", null, "x"], // 7
        ["", "", ""], // 8
        ["", "", ""], // 9
        ["", "", ""], // 10
      ];
      return makeAsyncIterable(allRows.slice(rowStart, rowEnd));
    });

    const wb = makeLazyWorkbookFromCache("prefix:abc", [sheetMeta]);
    expect(wb.sheets).toHaveLength(1);
    const sheet = wb.sheets[0]!;
    expect(sheet.name).toBe("Sheet1");
    expect(sheet.dimensions).toEqual({ rows: 10, cols: 3 });

    // Reads outside the loaded window throw.
    expect(() => sheet.cell(4, 1)).toThrow(RangeNotLoadedError);

    await sheet.loadRange(1, 10);

    expect(readRowsMock).toHaveBeenCalledTimes(1);
    expect(readRowsMock).toHaveBeenCalledWith("prefix:abc", "sheet-1", 0, 10);

    // Sparse semantics: empty strings + nulls drop to undefined.
    expect(sheet.cell(1, 1)).toBeUndefined();
    expect(sheet.cell(4, 1)?.value).toBe("alice");
    expect(sheet.cell(4, 2)?.value).toBe(30);
    expect(sheet.cell(4, 3)).toBeUndefined();
    expect(sheet.cell(7, 1)?.value).toBe("bob");
    expect(sheet.cell(7, 2)).toBeUndefined();
    expect(sheet.cell(7, 3)?.value).toBe("x");
  });

  it("throws RangeNotLoadedError when reading outside any loaded window", async () => {
    const sheetMeta: SheetChunkMeta = {
      sheetId: "sheet-1",
      name: "Sheet1",
      rowCount: 100,
      colCount: 3,
      hasMerges: false,
    };
    readRowsMock.mockImplementation((_p, _id, rowStart) => {
      // Only row index 0 has data; the rest are empty.
      const rows: ChunkRow[] = [["a", null, null]];
      return makeAsyncIterable(rowStart === 0 ? rows : []);
    });

    const wb = makeLazyWorkbookFromCache("prefix", [sheetMeta]);
    const sheet = wb.sheets[0]!;
    await sheet.loadRange(1, 10);

    expect(() => sheet.cell(50, 1)).toThrow(RangeNotLoadedError);
    try {
      sheet.cell(50, 1);
    } catch (err) {
      expect(err).toBeInstanceOf(RangeNotLoadedError);
      if (err instanceof RangeNotLoadedError) {
        expect(err.row).toBe(50);
        expect(err.col).toBe(1);
      }
    }
  });

  it("attaches merged-range metadata when the sheet has merges", async () => {
    const sheetMeta: SheetChunkMeta = {
      sheetId: "sheet-1",
      name: "Sheet1",
      rowCount: 4,
      colCount: 3,
      hasMerges: true,
    };
    const merges: MergedRange[] = [
      // Cell (2, 2) is the top-left of a 2x2 merged range.
      { startRow: 2, startCol: 2, endRow: 3, endCol: 3 },
    ];
    getMergesMock.mockResolvedValue(merges);
    readRowsMock.mockImplementation(() =>
      makeAsyncIterable<ChunkRow>([
        ["a", "b", "c"], // row 1
        ["d", "merged", null], // row 2 — col 2 is the merge top-left
        ["e", null, null], // row 3 — part of the merge body (sparse)
        ["f", "g", "h"], // row 4
      ])
    );

    const wb = makeLazyWorkbookFromCache("prefix", [sheetMeta]);
    const sheet = wb.sheets[0]!;
    await sheet.loadRange(1, 4);

    expect(getMergesMock).toHaveBeenCalledTimes(1);
    expect(getMergesMock).toHaveBeenCalledWith("prefix", "sheet-1");

    const mergedCell = sheet.cell(2, 2);
    expect(mergedCell?.value).toBe("merged");
    expect(mergedCell?.merged).toEqual({
      startRow: 2,
      startCol: 2,
      endRow: 3,
      endCol: 3,
    });

    // Non-top-left cells in the merged body remain sparse.
    expect(sheet.cell(3, 3)).toBeUndefined();
  });

  it("does not call getMerges when the sheet has hasMerges=false", async () => {
    const sheetMeta: SheetChunkMeta = {
      sheetId: "sheet-1",
      name: "Sheet1",
      rowCount: 2,
      colCount: 2,
      hasMerges: false,
    };
    readRowsMock.mockImplementation(() =>
      makeAsyncIterable<ChunkRow>([
        ["a", "b"],
        ["c", "d"],
      ])
    );

    const wb = makeLazyWorkbookFromCache("prefix", [sheetMeta]);
    await wb.sheets[0]!.loadRange(1, 2);

    expect(getMergesMock).not.toHaveBeenCalled();
  });

  it("caches the merges map across loadRange calls (one getMerges per sheet)", async () => {
    const sheetMeta: SheetChunkMeta = {
      sheetId: "sheet-1",
      name: "Sheet1",
      rowCount: 20,
      colCount: 2,
      hasMerges: true,
    };
    getMergesMock.mockResolvedValue([]);
    readRowsMock.mockImplementation(() =>
      makeAsyncIterable<ChunkRow>([
        ["a", "b"],
        ["c", "d"],
      ])
    );

    const wb = makeLazyWorkbookFromCache("prefix", [sheetMeta]);
    const sheet = wb.sheets[0]!;
    await sheet.loadRange(1, 5);
    await sheet.loadRange(10, 15);

    // Two separate row-window fetches but only one merges fetch.
    expect(readRowsMock).toHaveBeenCalledTimes(2);
    expect(getMergesMock).toHaveBeenCalledTimes(1);
  });

  it("builds one independent LazySheet per sheet meta", async () => {
    const sheetA: SheetChunkMeta = {
      sheetId: "sheet-a",
      name: "A",
      rowCount: 3,
      colCount: 1,
      hasMerges: false,
    };
    const sheetB: SheetChunkMeta = {
      sheetId: "sheet-b",
      name: "B",
      rowCount: 3,
      colCount: 1,
      hasMerges: false,
    };
    readRowsMock.mockImplementation((_prefix, sheetId) =>
      makeAsyncIterable<ChunkRow>(
        sheetId === "sheet-a"
          ? [["a-1"], ["a-2"], ["a-3"]]
          : [["b-1"], ["b-2"], ["b-3"]]
      )
    );

    const wb = makeLazyWorkbookFromCache("prefix", [sheetA, sheetB]);
    expect(wb.sheets.map((s) => s.name)).toEqual(["A", "B"]);

    await wb.sheets[0]!.loadRange(1, 3);
    await wb.sheets[1]!.loadRange(1, 3);

    expect(wb.sheets[0]!.cell(2, 1)?.value).toBe("a-2");
    expect(wb.sheets[1]!.cell(2, 1)?.value).toBe("b-2");
    // Cache was called once per sheet.
    expect(readRowsMock).toHaveBeenCalledTimes(2);
    expect(readRowsMock).toHaveBeenNthCalledWith(1, "prefix", "sheet-a", 0, 3);
    expect(readRowsMock).toHaveBeenNthCalledWith(2, "prefix", "sheet-b", 0, 3);
  });
});
