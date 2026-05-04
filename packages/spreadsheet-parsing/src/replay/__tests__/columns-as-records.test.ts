import { describe, it, expect } from "@jest/globals";

import type { Region } from "../../plan/index.js";
import { makeWorkbook } from "../../workbook/helpers.js";
import { extractRecords } from "../extract-records.js";

// The old "columns-as-records (pivoted)" shape — records are columns; each
// column carries a `Month` label from row 1, plus Revenue and Cost read by
// row-labels on column 1. Under the new schema this is:
//   - headerAxes: ["column"] (labels live in a column — col 1)
//   - segmentsByAxis.column: skip row 1 (Month anchor), 2 field positions.
//   - Identity = rowPosition → "col-{N}".
function monthlyRegion(): Region {
  return {
    id: "monthly-r1",
    sheet: "Monthly",
    bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 5 },
    targetEntityDefinitionId: "monthly-metrics",
    headerAxes: ["column"],
    segmentsByAxis: {
      column: [
        { kind: "skip", positionCount: 1 },
        { kind: "field", positionCount: 2 },
      ],
    },
    axisAnchorCell: { row: 1, col: 1 },
    headerStrategyByAxis: {
      column: {
        kind: "rowLabels",
        locator: { kind: "column", sheet: "Monthly", col: 1 },
        confidence: 0.9,
      },
    },
    identityStrategy: { kind: "rowPosition", confidence: 0.3 },
    columnBindings: [
      {
        sourceLocator: {
          kind: "byHeaderName",
          axis: "column",
          name: "Revenue",
        },
        columnDefinitionId: "col-revenue",
        confidence: 0.9,
      },
      {
        sourceLocator: { kind: "byHeaderName", axis: "column", name: "Cost" },
        columnDefinitionId: "col-cost",
        confidence: 0.9,
      },
    ],
    skipRules: [],
    drift: {
      headerShiftRows: 0,
      addedColumns: "halt",
      removedColumns: { max: 0, action: "halt" },
    },
    confidence: { region: 0.85, aggregate: 0.85 },
    warnings: [],
  };
}

function monthlyWorkbook() {
  return makeWorkbook({
    sheets: [
      {
        name: "Monthly",
        dimensions: { rows: 3, cols: 5 },
        cells: [
          { row: 1, col: 1, value: "Month" },
          { row: 1, col: 2, value: "Jan" },
          { row: 1, col: 3, value: "Feb" },
          { row: 1, col: 4, value: "Mar" },
          { row: 1, col: 5, value: "Apr" },
          { row: 2, col: 1, value: "Revenue" },
          { row: 2, col: 2, value: 100 },
          { row: 2, col: 3, value: 120 },
          { row: 2, col: 4, value: 130 },
          { row: 2, col: 5, value: 140 },
          { row: 3, col: 1, value: "Cost" },
          { row: 3, col: 2, value: 80 },
          { row: 3, col: 3, value: 90 },
          { row: 3, col: 4, value: 95 },
          { row: 3, col: 5, value: 100 },
        ],
      },
    ],
  });
}

describe("extractRecords — 1D headerAxes:['column'] (records-are-columns)", () => {
  it("emits one record per data column (Jan, Feb, Mar, Apr)", () => {
    const records = extractRecords(
      monthlyRegion(),
      monthlyWorkbook().sheets[0]
    );
    expect(records).toHaveLength(4);
  });

  it("keys each record's fields by the binding's source-field name for row-labeled fields", () => {
    const records = extractRecords(
      monthlyRegion(),
      monthlyWorkbook().sheets[0]
    );
    expect(records[0].fields["Revenue"]).toBe(100);
    expect(records[0].fields["Cost"]).toBe(80);
    expect(records[2].fields["Revenue"]).toBe(130);
  });

  it("falls back to col-{N} source_id for rowPosition identity with records-are-columns", () => {
    const records = extractRecords(
      monthlyRegion(),
      monthlyWorkbook().sheets[0]
    );
    expect(records[0].sourceId).toBe("col-2");
    expect(records[1].sourceId).toBe("col-3");
  });
});
