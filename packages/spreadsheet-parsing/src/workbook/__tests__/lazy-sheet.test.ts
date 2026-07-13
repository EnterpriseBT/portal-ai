/**
 * Unit tests for `makeLazySheetAccessor` — the row-async backing of
 * `Sheet` used by the lazy workbook adapter at the API layer.
 *
 * Cases 1.1–1.6 from `docs/SPREADSHEET_PARSER_ROW_ASYNC.spec.md` §Tests.
 *
 * The lazy sheet exposes the same `Sheet` surface as the eager form
 * (`cell` / `range` / `dimensions` / `name`) but only resolves cells
 * inside windows the caller has explicitly `await sheet.loadRange(r0, r1)`-d.
 * Calls to `cell()` outside any loaded window throw a
 * `RangeNotLoadedError` — a forgotten load is a programmer error,
 * not a sparse-cell condition.
 */

import { describe, it, expect, jest } from "@jest/globals";

import { makeLazySheetAccessor, RangeNotLoadedError } from "../index.js";
import type { SheetDimensions, WorkbookCell } from "../index.js";

const cell = (
  row: number,
  col: number,
  value: WorkbookCell["value"]
): WorkbookCell => ({
  row,
  col,
  value,
});

function makeFetcher(
  cells: WorkbookCell[]
): jest.Mock<(r0: number, r1: number) => Promise<WorkbookCell[]>> {
  return jest.fn<(r0: number, r1: number) => Promise<WorkbookCell[]>>(
    async (r0, r1) => cells.filter((c) => c.row >= r0 && c.row <= r1)
  );
}

const dimensions: SheetDimensions = { rows: 100, cols: 3 };
const meta = { name: "Sheet1", dimensions };

describe("makeLazySheetAccessor — loadRange + cell access", () => {
  // 1.1
  it("loads the requested window and makes cells synchronously available", async () => {
    const fetcher = makeFetcher([
      cell(1, 1, "a-1"),
      cell(1, 2, "a-2"),
      cell(2, 1, "b-1"),
      cell(5, 1, "e-1"),
      cell(10, 3, "j-3"),
    ]);

    const sheet = makeLazySheetAccessor(meta, fetcher);

    await sheet.loadRange(1, 10);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(1, 10);
    expect(sheet.cell(1, 1)?.value).toBe("a-1");
    expect(sheet.cell(2, 1)?.value).toBe("b-1");
    expect(sheet.cell(10, 3)?.value).toBe("j-3");
    // Cells inside the window with no data in the fetcher yield → undefined,
    // not a throw (matches the eager-sheet sparse semantics).
    expect(sheet.cell(3, 3)).toBeUndefined();
  });

  // 1.2
  it("throws RangeNotLoadedError on cell access outside the loaded window", async () => {
    const fetcher = makeFetcher([cell(1, 1, "a-1")]);
    const sheet = makeLazySheetAccessor(meta, fetcher);

    await sheet.loadRange(1, 10);

    expect(() => sheet.cell(50, 1)).toThrow(RangeNotLoadedError);
    expect(() => sheet.cell(50, 1)).toThrow(/row=50/);
    // The error carries the coordinates so callers can format their own message.
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

  // 1.3
  it("loaded windows are cumulative — non-overlapping loads keep both readable", async () => {
    const fetcher = makeFetcher([
      cell(1, 1, "a-1"),
      cell(5, 1, "e-1"),
      cell(25, 1, "y-1"),
      cell(30, 1, "dd-1"),
    ]);
    const sheet = makeLazySheetAccessor(meta, fetcher);

    await sheet.loadRange(1, 10);
    await sheet.loadRange(20, 30);

    // Two distinct fetches over the two non-overlapping windows.
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenNthCalledWith(1, 1, 10);
    expect(fetcher).toHaveBeenNthCalledWith(2, 20, 30);

    expect(sheet.cell(1, 1)?.value).toBe("a-1");
    expect(sheet.cell(25, 1)?.value).toBe("y-1");
    // Reading from the unloaded gap throws.
    expect(() => sheet.cell(15, 1)).toThrow(RangeNotLoadedError);
  });

  // 1.4
  it("repeated loadRange over the same window is idempotent (one fetch)", async () => {
    const fetcher = makeFetcher([cell(1, 1, "a-1")]);
    const sheet = makeLazySheetAccessor(meta, fetcher);

    await sheet.loadRange(1, 10);
    await sheet.loadRange(1, 10);
    await sheet.loadRange(1, 10);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(sheet.cell(1, 1)?.value).toBe("a-1");
  });

  // 1.5
  it("clamps the requested window to the sheet's dimensions", async () => {
    const fetcher = makeFetcher([cell(1, 1, "a-1"), cell(100, 1, "end-1")]);
    const sheet = makeLazySheetAccessor(meta, fetcher);

    // sheet.dimensions.rows === 100; request way beyond on both ends.
    await sheet.loadRange(-50, 1_000_000);

    // Single clamped fetch.
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(1, 100);
    expect(sheet.cell(1, 1)?.value).toBe("a-1");
    expect(sheet.cell(100, 1)?.value).toBe("end-1");
  });

  // 1.5b — entirely out-of-bounds windows resolve as no-ops without fetching.
  it("entirely out-of-bounds windows resolve as no-ops (no fetch)", async () => {
    const fetcher = makeFetcher([]);
    const sheet = makeLazySheetAccessor(meta, fetcher);

    await sheet.loadRange(500, 1000); // both ends past dimensions.rows
    await sheet.loadRange(-10, -5); // both ends below row 1

    expect(fetcher).not.toHaveBeenCalled();
  });

  // 1.6
  it("fetcher rejection propagates from loadRange + leaves loaded state intact", async () => {
    const error = new Error("redis down");
    const fetcher = jest.fn<
      (r0: number, r1: number) => Promise<WorkbookCell[]>
    >(async () => {
      throw error;
    });
    const sheet = makeLazySheetAccessor(meta, fetcher);

    await expect(sheet.loadRange(1, 10)).rejects.toBe(error);

    // No cells loaded → reads still throw the not-loaded marker.
    expect(() => sheet.cell(1, 1)).toThrow(RangeNotLoadedError);
  });

  // Additional sanity: out-of-dimensions cell coordinates always return
  // undefined (matches the eager-sheet semantics) even when the row IS in
  // a loaded window. The throw is for "row I haven't loaded," not for
  // "col beyond the sheet's last column."
  it("cell coordinates outside dimensions return undefined regardless of loaded state", async () => {
    const fetcher = makeFetcher([]);
    const sheet = makeLazySheetAccessor(meta, fetcher);

    await sheet.loadRange(1, 100);

    expect(sheet.cell(1, 999)).toBeUndefined();
    expect(sheet.cell(0, 1)).toBeUndefined();
    expect(sheet.cell(-1, 1)).toBeUndefined();
  });

  // range() — composite read across loaded rows; throws if any row in the
  // requested rectangle is outside loaded windows.
  it("range() returns dense rows from loaded windows; throws if any row is not loaded", async () => {
    const fetcher = makeFetcher([
      cell(1, 1, "a-1"),
      cell(1, 2, "a-2"),
      cell(2, 1, "b-1"),
      cell(2, 2, "b-2"),
    ]);
    const sheet = makeLazySheetAccessor(meta, fetcher);

    await sheet.loadRange(1, 5);

    const rect = sheet.range(1, 1, 2, 2);
    expect(rect).toHaveLength(2);
    expect(rect[0]?.[0]?.value).toBe("a-1");
    expect(rect[1]?.[1]?.value).toBe("b-2");

    expect(() => sheet.range(1, 1, 50, 2)).toThrow(RangeNotLoadedError);
  });
});
