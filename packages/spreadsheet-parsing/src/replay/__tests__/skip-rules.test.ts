import { describe, it, expect } from "@jest/globals";

import type { Region } from "../../plan/index.js";
import { makeWorkbook } from "../../workbook/helpers.js";
import { extractRecords } from "../extract-records.js";

function baseRegion(overrides: Partial<Region> = {}): Region {
  return {
    id: "r1",
    sheet: "Sheet1",
    bounds: { startRow: 1, startCol: 1, endRow: 5, endCol: 3 },
    boundsMode: "absolute",
    targetEntityDefinitionId: "contacts",
    orientation: "rows-as-records",
    headerAxis: "row",
    headerStrategy: {
      kind: "row",
      locator: { kind: "row", sheet: "Sheet1", row: 1 },
      confidence: 0.9,
    },
    identityStrategy: { kind: "rowPosition", confidence: 0.3 },
    columnBindings: [
      {
        sourceLocator: { kind: "byHeaderName", name: "name" },
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
  it("blank rule drops rows whose cells are all empty (rows-as-records)", () => {
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
    const names = records.map((r) => r.fields["col-name"]);
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
      // crossAxisIndex is 0-based absolute index; col 1 is index 0.
      skipRules: [
        { kind: "cellMatches", crossAxisIndex: 0, pattern: "^Total$" },
      ],
    });
    const records = extractRecords(region, wb.sheets[0]);
    const names = records.map((r) => r.fields["col-name"]);
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
            // row 3 col 2 is absent → empty
            { row: 4, col: 1, value: "carol" },
            { row: 4, col: 2, value: "hello" },
          ],
        },
      ],
    });
    const region = baseRegion({
      bounds: { startRow: 1, startCol: 1, endRow: 4, endCol: 2 },
      // Match rows with empty cell at col 2 (index 1).
      skipRules: [{ kind: "cellMatches", crossAxisIndex: 1, pattern: "^$" }],
    });
    const records = extractRecords(region, wb.sheets[0]);
    const names = records.map((r) => r.fields["col-name"]);
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
      ...baseRegion({
        orientation: "cells-as-records",
        recordsAxisName: { name: "Quarter", source: "user" },
        secondaryRecordsAxisName: { name: "Letter", source: "user" },
        cellValueName: { name: "Value", source: "user" },
        axisAnchorCell: { row: 1, col: 1 },
        bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 4 },
        columnBindings: [],
      }),
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
    // Q1 × Total and Q2 × Total (cols matching Total) should be skipped.
    // Remaining: Q1×A, Q1×B, Q2×A, Q2×B → 4 records
    expect(records).toHaveLength(4);
    for (const r of records) {
      expect(r.fields.Letter).not.toBe("Total");
    }
  });
});
