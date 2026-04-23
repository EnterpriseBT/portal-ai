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
    targetEntityDefinitionId: "contacts",
    headerAxes: ["row"],
    segmentsByAxis: {
      row: [{ kind: "field", positionCount: 3 }],
    },
    headerStrategyByAxis: {
      row: {
        kind: "row",
        locator: { kind: "row", sheet: "Sheet1", row: 1 },
        confidence: 0.9,
      },
    },
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
  describe("no terminator", () => {
    it("returns the literal bounds unchanged", () => {
      const sheet = makeSheetAccessor({
        name: "Sheet1",
        dimensions: { rows: 100, cols: 100 },
        cells: [],
      });
      const region = makeRegion({
        bounds: { startRow: 2, startCol: 2, endRow: 5, endCol: 5 },
        segmentsByAxis: {
          row: [{ kind: "field", positionCount: 4 }],
        },
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

  describe("recordAxisTerminator — untilBlank", () => {
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
        // Rows 5 and 6 empty → default terminator fires after 2 blanks.
        { row: 7, col: 1, value: "d" }, // NOT included with default.
      ],
    };
    const sheet = makeSheetAccessor(sheetData);

    it("expands endRow until `consecutiveBlanks` blank lines (default 2)", () => {
      const region = makeRegion({
        bounds: { startRow: 1, startCol: 1, endRow: 1, endCol: 2 },
        segmentsByAxis: { row: [{ kind: "field", positionCount: 2 }] },
        recordAxisTerminator: { kind: "untilBlank", consecutiveBlanks: 2 },
      });
      const resolved = resolveRegionBounds(region, sheet);
      expect(resolved.endRow).toBe(4);
    });

    it("respects a custom consecutiveBlanks count", () => {
      const region = makeRegion({
        bounds: { startRow: 1, startCol: 1, endRow: 1, endCol: 2 },
        segmentsByAxis: { row: [{ kind: "field", positionCount: 2 }] },
        recordAxisTerminator: { kind: "untilBlank", consecutiveBlanks: 3 },
      });
      const resolved = resolveRegionBounds(region, sheet);
      // Terminator requires 3 consecutive blanks; rows 5-6 are only 2, so
      // expansion continues to include row 7 and any further blanks.
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
        segmentsByAxis: { row: [{ kind: "field", positionCount: 2 }] },
        recordAxisTerminator: { kind: "untilBlank", consecutiveBlanks: 2 },
      });
      const resolved = resolveRegionBounds(region, smallSheet);
      expect(resolved.endRow).toBeLessThanOrEqual(3);
    });
  });

  describe("recordAxisTerminator — matchesPattern", () => {
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

    it("expands endRow until the leading cell matches the pattern", () => {
      const region = makeRegion({
        bounds: { startRow: 1, startCol: 1, endRow: 1, endCol: 2 },
        segmentsByAxis: { row: [{ kind: "field", positionCount: 2 }] },
        recordAxisTerminator: { kind: "matchesPattern", pattern: "^Total$" },
      });
      const resolved = resolveRegionBounds(region, sheet);
      expect(resolved.endRow).toBe(3);
    });

    it("falls back to the sheet bound when no row matches", () => {
      const region = makeRegion({
        bounds: { startRow: 1, startCol: 1, endRow: 1, endCol: 2 },
        segmentsByAxis: { row: [{ kind: "field", positionCount: 2 }] },
        recordAxisTerminator: {
          kind: "matchesPattern",
          pattern: "^NeverMatches$",
        },
      });
      const resolved = resolveRegionBounds(region, sheet);
      expect(resolved.endRow).toBe(sheet.dimensions.rows);
    });
  });
});
