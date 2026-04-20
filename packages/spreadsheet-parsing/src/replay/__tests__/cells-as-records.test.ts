import { describe, it, expect } from "@jest/globals";

import type { Region } from "../../plan/index.js";
import { makeWorkbook } from "../../workbook/helpers.js";
import { extractRecords } from "../extract-records.js";

function quarterByRegion(): Region {
  return {
    id: "crosstab-r1",
    sheet: "QuarterByRegion",
    bounds: { startRow: 1, startCol: 1, endRow: 4, endCol: 4 },
    boundsMode: "absolute",
    targetEntityDefinitionId: "revenue-crosstab",
    orientation: "cells-as-records",
    headerAxis: "row",
    recordsAxisName: { name: "Quarter", source: "user" },
    secondaryRecordsAxisName: { name: "Region", source: "user" },
    cellValueName: { name: "Revenue", source: "user" },
    axisAnchorCell: { row: 1, col: 1 },
    headerStrategy: {
      kind: "row",
      locator: { kind: "row", sheet: "QuarterByRegion", row: 1 },
      confidence: 0.9,
    },
    identityStrategy: { kind: "rowPosition", confidence: 0.3 },
    columnBindings: [],
    skipRules: [],
    drift: {
      headerShiftRows: 0,
      addedColumns: "halt",
      removedColumns: { max: 0, action: "halt" },
    },
    confidence: { region: 0.88, aggregate: 0.85 },
    warnings: [],
  };
}

function crosstabWorkbook() {
  return makeWorkbook({
    sheets: [
      {
        name: "QuarterByRegion",
        dimensions: { rows: 4, cols: 4 },
        cells: [
          { row: 1, col: 1, value: "Quarter" },
          { row: 1, col: 2, value: "North" },
          { row: 1, col: 3, value: "South" },
          { row: 1, col: 4, value: "East" },
          { row: 2, col: 1, value: "Q1" },
          { row: 2, col: 2, value: 100 },
          { row: 2, col: 3, value: 110 },
          { row: 2, col: 4, value: 120 },
          { row: 3, col: 1, value: "Q2" },
          { row: 3, col: 2, value: 200 },
          { row: 3, col: 3, value: 210 },
          { row: 3, col: 4, value: 220 },
          { row: 4, col: 1, value: "Q3" },
          { row: 4, col: 2, value: 300 },
          { row: 4, col: 3, value: 310 },
          { row: 4, col: 4, value: 320 },
        ],
      },
    ],
  });
}

describe("extractRecords — cells-as-records (crosstab)", () => {
  it("emits one record per interior cell (rows × cols) skipping headers + anchor", () => {
    const records = extractRecords(
      quarterByRegion(),
      crosstabWorkbook().sheets[0]
    );
    // Interior: 3 row labels (Q1, Q2, Q3) × 3 col labels (North, South, East) = 9
    expect(records).toHaveLength(9);
  });

  it("each record has fields {Quarter, Region, Revenue} keyed by the three user-facing names", () => {
    const records = extractRecords(
      quarterByRegion(),
      crosstabWorkbook().sheets[0]
    );
    const first = records.find(
      (r) => r.fields.Quarter === "Q1" && r.fields.Region === "North"
    );
    expect(first).toBeDefined();
    expect(first?.fields.Revenue).toBe(100);

    const last = records.find(
      (r) => r.fields.Quarter === "Q3" && r.fields.Region === "East"
    );
    expect(last).toBeDefined();
    expect(last?.fields.Revenue).toBe(320);
  });

  it("assigns `cell-{row}-{col}` source_id for rowPosition identity", () => {
    const records = extractRecords(
      quarterByRegion(),
      crosstabWorkbook().sheets[0]
    );
    // Q1 × North is at row 2, col 2
    const q1North = records.find(
      (r) => r.fields.Quarter === "Q1" && r.fields.Region === "North"
    );
    expect(q1North?.sourceId).toBe("cell-2-2");
  });

  it("does not emit a record for cells along the header row or header column", () => {
    const records = extractRecords(
      quarterByRegion(),
      crosstabWorkbook().sheets[0]
    );
    for (const r of records) {
      // No record should have row/col indices that correspond to row 1 or col 1.
      expect(r.fields.Quarter).not.toBe("Quarter");
      expect(r.fields.Region).not.toBe("Quarter");
    }
  });
});
