import { describe, it, expect } from "@jest/globals";

import type { Region } from "../../plan/index.js";
import { makeWorkbook } from "../../workbook/helpers.js";
import { extractRecords } from "../extract-records.js";

function baseRegion(overrides: Partial<Region> = {}): Region {
  return {
    id: "r1",
    sheet: "Sheet1",
    bounds: { startRow: 1, startCol: 1, endRow: 5, endCol: 3 },
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
    identityStrategy: { kind: "rowPosition", confidence: 0.3 },
    columnBindings: [
      {
        sourceLocator: { kind: "byHeaderName", axis: "row", name: "name" },
        columnDefinitionId: "col-name",
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
    ...overrides,
  };
}

describe("extractRecords — skip rules", () => {
  it("blank rule drops rows whose cells are all empty (records-are-rows)", () => {
    const wb = makeWorkbook({
      sheets: [
        {
          name: "Sheet1",
          dimensions: { rows: 5, cols: 3 },
          cells: [
            { row: 1, col: 1, value: "name" },
            { row: 1, col: 2, value: "age" },
            { row: 2, col: 1, value: "alice" },
            { row: 2, col: 2, value: 30 },
            // Row 3 is completely blank → skip
            { row: 4, col: 1, value: "bob" },
            { row: 4, col: 2, value: 25 },
            // Row 5 is blank → skip
          ],
        },
      ],
    });
    const region = baseRegion({
      skipRules: [{ kind: "blank" }],
    });
    const records = extractRecords(region, wb.sheets[0]);
    const names = records.map((r) => r.fields["name"]);
    expect(names).toEqual(["alice", "bob"]);
  });

  it("cellMatches rule drops rows whose crossAxisIndex column matches the pattern", () => {
    const wb = makeWorkbook({
      sheets: [
        {
          name: "Sheet1",
          dimensions: { rows: 4, cols: 3 },
          cells: [
            { row: 1, col: 1, value: "name" },
            { row: 1, col: 2, value: "kind" },
            { row: 2, col: 1, value: "alice" },
            { row: 2, col: 2, value: "user" },
            { row: 3, col: 1, value: "Total" },
            { row: 3, col: 2, value: "summary" },
            { row: 4, col: 1, value: "bob" },
            { row: 4, col: 2, value: "user" },
          ],
        },
      ],
    });
    const region = baseRegion({
      bounds: { startRow: 1, startCol: 1, endRow: 4, endCol: 3 },
      skipRules: [
        { kind: "cellMatches", crossAxisIndex: 0, pattern: "^Total$" },
      ],
    });
    const records = extractRecords(region, wb.sheets[0]);
    const names = records.map((r) => r.fields["name"]);
    expect(names).toEqual(["alice", "bob"]);
  });

  it("cellMatches with null cells coerces to empty string before regex test (^$ matches empty)", () => {
    const wb = makeWorkbook({
      sheets: [
        {
          name: "Sheet1",
          dimensions: { rows: 4, cols: 2 },
          cells: [
            { row: 1, col: 1, value: "name" },
            { row: 1, col: 2, value: "note" },
            { row: 2, col: 1, value: "alice" },
            { row: 2, col: 2, value: "hi" },
            { row: 3, col: 1, value: "bob" },
            { row: 4, col: 1, value: "carol" },
            { row: 4, col: 2, value: "hello" },
          ],
        },
      ],
    });
    const region = baseRegion({
      bounds: { startRow: 1, startCol: 1, endRow: 4, endCol: 2 },
      segmentsByAxis: {
        row: [{ kind: "field", positionCount: 2 }],
      },
      skipRules: [{ kind: "cellMatches", crossAxisIndex: 1, pattern: "^$" }],
    });
    const records = extractRecords(region, wb.sheets[0]);
    const names = records.map((r) => r.fields["name"]);
    expect(names).toEqual(["alice", "carol"]);
  });

  it("crosstab cellMatches with axis: 'column' only skips columns (not rows)", () => {
    const wb = makeWorkbook({
      sheets: [
        {
          name: "Sheet1",
          dimensions: { rows: 3, cols: 4 },
          cells: [
            { row: 1, col: 1, value: "Q" },
            { row: 1, col: 2, value: "A" },
            { row: 1, col: 3, value: "B" },
            { row: 1, col: 4, value: "Total" },
            { row: 2, col: 1, value: "Q1" },
            { row: 2, col: 2, value: 1 },
            { row: 2, col: 3, value: 2 },
            { row: 2, col: 4, value: 3 },
            { row: 3, col: 1, value: "Q2" },
            { row: 3, col: 2, value: 4 },
            { row: 3, col: 3, value: 5 },
            { row: 3, col: 4, value: 9 },
          ],
        },
      ],
    });
    const region: Region = {
      ...baseRegion(),
      headerAxes: ["row", "column"],
      bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 4 },
      segmentsByAxis: {
        row: [
          { kind: "skip", positionCount: 1 },
          {
            kind: "pivot",
            id: "letter",
            axisName: "Letter",
            axisNameSource: "user",
            positionCount: 3,
          },
        ],
        column: [
          { kind: "skip", positionCount: 1 },
          {
            kind: "pivot",
            id: "quarter",
            axisName: "Quarter",
            axisNameSource: "user",
            positionCount: 2,
          },
        ],
      },
      cellValueField: { name: "Value", nameSource: "user" },
      axisAnchorCell: { row: 1, col: 1 },
      headerStrategyByAxis: {
        row: {
          kind: "row",
          locator: { kind: "row", sheet: "Sheet1", row: 1 },
          confidence: 0.9,
        },
        column: {
          kind: "column",
          locator: { kind: "column", sheet: "Sheet1", col: 1 },
          confidence: 0.9,
        },
      },
      columnBindings: [],
      skipRules: [
        {
          kind: "cellMatches",
          crossAxisIndex: 0, // header row (row 1 = absolute index 0)
          pattern: "^Total$",
          axis: "column",
        },
      ],
    };
    const records = extractRecords(region, wb.sheets[0]);
    expect(records).toHaveLength(4);
    for (const r of records) {
      expect(r.fields.Letter).not.toBe("Total");
    }
  });
});
