import { describe, it, expect } from "@jest/globals";

import type { Region } from "../../plan/index.js";
import { makeSheetAccessor } from "../../workbook/helpers.js";
import type { SheetData } from "../../workbook/types.js";
import { resolveRegionBounds } from "../resolve-bounds.js";

function makeRegion(overrides: Partial<Region> = {}): Region {
  return {
    id: "r1",
    sheet: "Sheet1",
    bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 3 },
    boundsMode: "absolute",
    targetEntityDefinitionId: "contacts",
    orientation: "rows-as-records",
    headerAxis: "row",
    identityStrategy: { kind: "rowPosition", confidence: 0 },
    columnBindings: [],
    skipRules: [],
    drift: {
      headerShiftRows: 0,
      addedColumns: "halt",
      removedColumns: { max: 0, action: "halt" },
    },
    confidence: { region: 0, aggregate: 0 },
    warnings: [],
    ...overrides,
  };
}

describe("resolveRegionBounds", () => {
  describe("absolute", () => {
    it("returns the literal bounds unchanged", () => {
      const sheet = makeSheetAccessor({
        name: "Sheet1",
        dimensions: { rows: 100, cols: 100 },
        cells: [],
      });
      const region = makeRegion({
        bounds: { startRow: 2, startCol: 2, endRow: 5, endCol: 5 },
        boundsMode: "absolute",
      });
      const resolved = resolveRegionBounds(region, sheet);
      expect(resolved).toEqual({
        startRow: 2,
        startCol: 2,
        endRow: 5,
        endCol: 5,
      });
    });
  });

  describe("untilEmpty", () => {
    const sheetData: SheetData = {
      name: "Sheet1",
      dimensions: { rows: 10, cols: 3 },
      cells: [
        { row: 1, col: 1, value: "name" },
        { row: 1, col: 2, value: "age" },
        { row: 2, col: 1, value: "a" },
        { row: 2, col: 2, value: 1 },
        { row: 3, col: 1, value: "b" },
        { row: 3, col: 2, value: 2 },
        { row: 4, col: 1, value: "c" },
        { row: 4, col: 2, value: 3 },
        // Rows 5 and 6 are empty → terminator (default count 2)
        { row: 7, col: 1, value: "d" }, // this should NOT be included
      ],
    };
    const sheet = makeSheetAccessor(sheetData);

    it("expands the region until untilEmptyTerminatorCount consecutive blank rows (default 2)", () => {
      const region = makeRegion({
        bounds: { startRow: 1, startCol: 1, endRow: 1, endCol: 2 },
        boundsMode: "untilEmpty",
      });
      const resolved = resolveRegionBounds(region, sheet);
      expect(resolved.endRow).toBe(4);
    });

    it("respects a custom untilEmptyTerminatorCount", () => {
      const region = makeRegion({
        bounds: { startRow: 1, startCol: 1, endRow: 1, endCol: 2 },
        boundsMode: "untilEmpty",
        untilEmptyTerminatorCount: 3,
      });
      const resolved = resolveRegionBounds(region, sheet);
      // With terminator count = 3, rows 5-6-7 aren't enough (row 7 has data) — expands to include row 7 and beyond until 3 blanks.
      expect(resolved.endRow).toBeGreaterThanOrEqual(7);
    });

    it("clamps expansion at the sheet's declared row dimension", () => {
      const smallSheetData: SheetData = {
        name: "Sheet1",
        dimensions: { rows: 3, cols: 2 },
        cells: [
          { row: 1, col: 1, value: "h" },
          { row: 2, col: 1, value: "a" },
          { row: 3, col: 1, value: "b" },
        ],
      };
      const smallSheet = makeSheetAccessor(smallSheetData);
      const region = makeRegion({
        bounds: { startRow: 1, startCol: 1, endRow: 1, endCol: 2 },
        boundsMode: "untilEmpty",
      });
      const resolved = resolveRegionBounds(region, smallSheet);
      expect(resolved.endRow).toBeLessThanOrEqual(3);
    });
  });

  describe("matchesPattern", () => {
    const sheetData: SheetData = {
      name: "Sheet1",
      dimensions: { rows: 10, cols: 2 },
      cells: [
        { row: 1, col: 1, value: "name" },
        { row: 2, col: 1, value: "alice" },
        { row: 3, col: 1, value: "bob" },
        { row: 4, col: 1, value: "Total" }, // stop here
        { row: 5, col: 1, value: "ghost" },
      ],
    };
    const sheet = makeSheetAccessor(sheetData);

    it("expands the region until the first row whose leading cell matches the boundsPattern regex", () => {
      const region = makeRegion({
        bounds: { startRow: 1, startCol: 1, endRow: 1, endCol: 2 },
        boundsMode: "matchesPattern",
        boundsPattern: "^Total$",
      });
      const resolved = resolveRegionBounds(region, sheet);
      expect(resolved.endRow).toBe(3);
    });

    it("falls back to the sheet bound when no row matches", () => {
      const region = makeRegion({
        bounds: { startRow: 1, startCol: 1, endRow: 1, endCol: 2 },
        boundsMode: "matchesPattern",
        boundsPattern: "^NeverMatches$",
      });
      const resolved = resolveRegionBounds(region, sheet);
      expect(resolved.endRow).toBe(sheet.dimensions.rows);
    });
  });
});
