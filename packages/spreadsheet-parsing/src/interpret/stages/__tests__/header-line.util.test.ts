import { describe, it, expect } from "@jest/globals";

import type { Region } from "../../../plan/index.js";
import { makeSheetAccessor } from "../../../workbook/helpers.js";
import type { SheetData } from "../../../workbook/types.js";
import {
  headerLineCoords,
  readHeaderLineLabels,
} from "../header-line.util.js";

function makeRegion(overrides: Partial<Region> = {}): Region {
  return {
    id: "r1",
    sheet: "Sheet1",
    bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 5 },
    targetEntityDefinitionId: "t",
    headerAxes: ["row"],
    segmentsByAxis: {
      row: [{ kind: "field", positionCount: 5 }],
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

describe("headerLineCoords", () => {
  it("returns sheet-col indices for row axis", () => {
    const region = makeRegion({
      bounds: { startRow: 2, startCol: 3, endRow: 5, endCol: 7 },
      headerAxes: ["row"],
      segmentsByAxis: { row: [{ kind: "field", positionCount: 5 }] },
      headerStrategyByAxis: {
        row: {
          kind: "row",
          locator: { kind: "row", sheet: "Sheet1", row: 2 },
          confidence: 1,
        },
      },
    });
    expect(headerLineCoords(region, "row", region.bounds)).toEqual([
      3, 4, 5, 6, 7,
    ]);
  });

  it("returns sheet-row indices for column axis", () => {
    const region = makeRegion({
      bounds: { startRow: 2, startCol: 3, endRow: 5, endCol: 7 },
      headerAxes: ["column"],
      segmentsByAxis: { column: [{ kind: "field", positionCount: 4 }] },
      headerStrategyByAxis: {
        column: {
          kind: "column",
          locator: { kind: "column", sheet: "Sheet1", col: 3 },
          confidence: 1,
        },
      },
    });
    expect(headerLineCoords(region, "column", region.bounds)).toEqual([
      2, 3, 4, 5,
    ]);
  });

  it("honors caller-supplied bounds (e.g. resolved bounds) over region.bounds", () => {
    const region = makeRegion({
      bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 3 },
      headerAxes: ["row"],
      segmentsByAxis: { row: [{ kind: "field", positionCount: 3 }] },
      headerStrategyByAxis: {
        row: {
          kind: "row",
          locator: { kind: "row", sheet: "Sheet1", row: 1 },
          confidence: 1,
        },
      },
    });
    expect(
      headerLineCoords(region, "row", {
        startRow: 1,
        startCol: 1,
        endRow: 3,
        endCol: 6,
      })
    ).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("throws when axis is not in region.headerAxes", () => {
    const region = makeRegion({ headerAxes: ["row"] });
    expect(() => headerLineCoords(region, "column", region.bounds)).toThrow(
      /headerAxes/
    );
  });
});

describe("readHeaderLineLabels", () => {
  it("returns trimmed labels in position order for headerAxes:['row']", () => {
    const data: SheetData = {
      name: "Sheet1",
      dimensions: { rows: 3, cols: 5 },
      cells: [
        { row: 1, col: 1, value: " Name " },
        { row: 1, col: 2, value: "Q1" },
        { row: 1, col: 3, value: "Q2" },
        { row: 1, col: 4, value: "Q3" },
        { row: 1, col: 5, value: "Q4" },
      ],
    };
    const sheet = makeSheetAccessor(data);
    const region = makeRegion({
      bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 5 },
      headerAxes: ["row"],
      segmentsByAxis: { row: [{ kind: "field", positionCount: 5 }] },
      headerStrategyByAxis: {
        row: {
          kind: "row",
          locator: { kind: "row", sheet: "Sheet1", row: 1 },
          confidence: 1,
        },
      },
    });
    expect(readHeaderLineLabels(region, "row", sheet, 1)).toEqual([
      "Name",
      "Q1",
      "Q2",
      "Q3",
      "Q4",
    ]);
  });

  it("returns row-labels for headerAxes:['column']", () => {
    const data: SheetData = {
      name: "Sheet1",
      dimensions: { rows: 4, cols: 2 },
      cells: [
        { row: 1, col: 1, value: "Revenue" },
        { row: 2, col: 1, value: " Cost " },
        { row: 3, col: 1, value: "Profit" },
        { row: 4, col: 1, value: "Margin" },
      ],
    };
    const sheet = makeSheetAccessor(data);
    const region = makeRegion({
      bounds: { startRow: 1, startCol: 1, endRow: 4, endCol: 2 },
      headerAxes: ["column"],
      segmentsByAxis: { column: [{ kind: "field", positionCount: 4 }] },
      headerStrategyByAxis: {
        column: {
          kind: "column",
          locator: { kind: "column", sheet: "Sheet1", col: 1 },
          confidence: 1,
        },
      },
    });
    expect(readHeaderLineLabels(region, "column", sheet, 1)).toEqual([
      "Revenue",
      "Cost",
      "Profit",
      "Margin",
    ]);
  });

  it("coerces non-strings to trimmed strings", () => {
    const data: SheetData = {
      name: "Sheet1",
      dimensions: { rows: 1, cols: 3 },
      cells: [
        { row: 1, col: 1, value: 2024 },
        { row: 1, col: 2, value: new Date("2024-01-15T00:00:00.000Z") },
        { row: 1, col: 3, value: true },
      ],
    };
    const sheet = makeSheetAccessor(data);
    const region = makeRegion({
      bounds: { startRow: 1, startCol: 1, endRow: 1, endCol: 3 },
      headerAxes: ["row"],
      segmentsByAxis: { row: [{ kind: "field", positionCount: 3 }] },
      headerStrategyByAxis: {
        row: {
          kind: "row",
          locator: { kind: "row", sheet: "Sheet1", row: 1 },
          confidence: 1,
        },
      },
    });
    expect(readHeaderLineLabels(region, "row", sheet, 1)).toEqual([
      "2024",
      "2024-01-15T00:00:00.000Z",
      "true",
    ]);
  });

  it("returns empty string for blank cells (preserving alignment)", () => {
    const data: SheetData = {
      name: "Sheet1",
      dimensions: { rows: 1, cols: 4 },
      cells: [
        { row: 1, col: 1, value: "Q1" },
        { row: 1, col: 2, value: null },
        { row: 1, col: 3, value: "Q3" },
        // col 4 missing entirely
      ],
    };
    const sheet = makeSheetAccessor(data);
    const region = makeRegion({
      bounds: { startRow: 1, startCol: 1, endRow: 1, endCol: 4 },
      headerAxes: ["row"],
      segmentsByAxis: { row: [{ kind: "field", positionCount: 4 }] },
      headerStrategyByAxis: {
        row: {
          kind: "row",
          locator: { kind: "row", sheet: "Sheet1", row: 1 },
          confidence: 1,
        },
      },
    });
    expect(readHeaderLineLabels(region, "row", sheet, 1)).toEqual([
      "Q1",
      "",
      "Q3",
      "",
    ]);
  });

  it("throws when axis is not in region.headerAxes", () => {
    const data: SheetData = {
      name: "Sheet1",
      dimensions: { rows: 1, cols: 1 },
      cells: [],
    };
    const sheet = makeSheetAccessor(data);
    const region = makeRegion({ headerAxes: ["row"] });
    expect(() => readHeaderLineLabels(region, "column", sheet, 1)).toThrow(
      /headerAxes/
    );
  });
});
