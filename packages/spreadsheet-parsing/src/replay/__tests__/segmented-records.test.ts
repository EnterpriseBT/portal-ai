import { describe, it, expect } from "@jest/globals";

import type { Region } from "../../plan/index.js";
import { makeWorkbook } from "../../workbook/helpers.js";
import { extractRecords } from "../extract-records.js";

// Matrix id 1e — rows × headerAxis:row × statics + 2 segments.
// Header:  name | industry | Q1 | Q2 | Q3 | Jan | Feb | Mar
// Row 1:   Apple | Tech    | 10 | 20 | 30 | 4   | 5   | 6
function appleWorkbook() {
  return makeWorkbook({
    sheets: [
      {
        name: "Data",
        dimensions: { rows: 2, cols: 8 },
        cells: [
          { row: 1, col: 1, value: "name" },
          { row: 1, col: 2, value: "industry" },
          { row: 1, col: 3, value: "Q1" },
          { row: 1, col: 4, value: "Q2" },
          { row: 1, col: 5, value: "Q3" },
          { row: 1, col: 6, value: "Jan" },
          { row: 1, col: 7, value: "Feb" },
          { row: 1, col: 8, value: "Mar" },
          { row: 2, col: 1, value: "Apple" },
          { row: 2, col: 2, value: "Tech" },
          { row: 2, col: 3, value: 10 },
          { row: 2, col: 4, value: 20 },
          { row: 2, col: 5, value: 30 },
          { row: 2, col: 6, value: 4 },
          { row: 2, col: 7, value: 5 },
          { row: 2, col: 8, value: 6 },
        ],
      },
    ],
  });
}

function appleRegion(): Region {
  return {
    id: "r-1e",
    sheet: "Data",
    bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 8 },
    boundsMode: "absolute",
    targetEntityDefinitionId: "companies",
    orientation: "rows-as-records",
    headerAxis: "row",
    headerStrategy: {
      kind: "row",
      locator: { kind: "row", sheet: "Data", row: 1 },
      confidence: 1,
    },
    identityStrategy: {
      kind: "column",
      sourceLocator: { kind: "column", sheet: "Data", col: 1 },
      confidence: 1,
    },
    columnBindings: [
      {
        sourceLocator: { kind: "byHeaderName", name: "name" },
        columnDefinitionId: "col-name",
        confidence: 1,
      },
      {
        sourceLocator: { kind: "byHeaderName", name: "industry" },
        columnDefinitionId: "col-industry",
        confidence: 1,
      },
    ],
    skipRules: [],
    drift: {
      headerShiftRows: 0,
      addedColumns: "halt",
      removedColumns: { max: 0, action: "halt" },
    },
    confidence: { region: 1, aggregate: 1 },
    warnings: [],
    positionRoles: [
      { kind: "field" },
      { kind: "field" },
      { kind: "pivotLabel", segmentId: "quarter" },
      { kind: "pivotLabel", segmentId: "quarter" },
      { kind: "pivotLabel", segmentId: "quarter" },
      { kind: "pivotLabel", segmentId: "month" },
      { kind: "pivotLabel", segmentId: "month" },
      { kind: "pivotLabel", segmentId: "month" },
    ],
    pivotSegments: [
      {
        id: "quarter",
        axisName: "quarter",
        axisNameSource: "user",
        valueFieldName: "revenue",
        valueFieldNameSource: "user",
      },
      {
        id: "month",
        axisName: "month",
        axisNameSource: "user",
        valueFieldName: "revenue",
        valueFieldNameSource: "user",
      },
    ],
  };
}

describe("extractRecords — segmented rows-as-records (matrix id 1e)", () => {
  it("emits one record per pivotLabel position per entity-unit", () => {
    const records = extractRecords(appleRegion(), appleWorkbook().sheets[0]);
    expect(records).toHaveLength(6);
  });

  it("attaches statics from field-role positions to every emitted record", () => {
    const records = extractRecords(appleRegion(), appleWorkbook().sheets[0]);
    for (const r of records) {
      expect(r.fields["col-name"]).toBe("Apple");
      expect(r.fields["col-industry"]).toBe("Tech");
    }
  });

  it("emits 3 quarter records with the right labels and values", () => {
    const records = extractRecords(appleRegion(), appleWorkbook().sheets[0]);
    const quarter = records.filter((r) => "quarter" in r.fields);
    expect(quarter).toHaveLength(3);
    expect(quarter.map((r) => r.fields.quarter)).toEqual(["Q1", "Q2", "Q3"]);
    expect(quarter.map((r) => r.fields.revenue)).toEqual([10, 20, 30]);
    for (const r of quarter) {
      expect(r.fields).not.toHaveProperty("month");
    }
  });

  it("emits 3 month records with the right labels and values", () => {
    const records = extractRecords(appleRegion(), appleWorkbook().sheets[0]);
    const month = records.filter((r) => "month" in r.fields);
    expect(month).toHaveLength(3);
    expect(month.map((r) => r.fields.month)).toEqual(["Jan", "Feb", "Mar"]);
    expect(month.map((r) => r.fields.revenue)).toEqual([4, 5, 6]);
    for (const r of month) {
      expect(r.fields).not.toHaveProperty("quarter");
    }
  });

  it("carries regionId and targetEntityDefinitionId on every record", () => {
    const records = extractRecords(appleRegion(), appleWorkbook().sheets[0]);
    for (const r of records) {
      expect(r.regionId).toBe("r-1e");
      expect(r.targetEntityDefinitionId).toBe("companies");
    }
  });

  it("produces distinct source-ids per (entity-unit, segment, label)", () => {
    const records = extractRecords(appleRegion(), appleWorkbook().sheets[0]);
    const ids = new Set(records.map((r) => r.sourceId));
    expect(ids.size).toBe(6);
    // Every source-id should contain the entity base ("Apple") and the label.
    for (const r of records) {
      expect(r.sourceId).toContain("Apple");
    }
  });

  it("produces a non-empty checksum per record", () => {
    const records = extractRecords(appleRegion(), appleWorkbook().sheets[0]);
    for (const r of records) {
      expect(typeof r.checksum).toBe("string");
      expect(r.checksum.length).toBeGreaterThan(0);
    }
  });
});

// ── Matrix id 1b — all-pivot 1 segment ─────────────────────────────────────
function quartersOnlyWorkbook() {
  return makeWorkbook({
    sheets: [
      {
        name: "Data",
        dimensions: { rows: 3, cols: 3 },
        cells: [
          { row: 1, col: 1, value: "Q1" },
          { row: 1, col: 2, value: "Q2" },
          { row: 1, col: 3, value: "Q3" },
          { row: 2, col: 1, value: 10 },
          { row: 2, col: 2, value: 20 },
          { row: 2, col: 3, value: 30 },
          { row: 3, col: 1, value: 11 },
          { row: 3, col: 2, value: 22 },
          { row: 3, col: 3, value: 33 },
        ],
      },
    ],
  });
}

function quartersOnlyRegion(): Region {
  return {
    id: "r-1b",
    sheet: "Data",
    bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 3 },
    boundsMode: "absolute",
    targetEntityDefinitionId: "sales",
    orientation: "rows-as-records",
    headerAxis: "row",
    headerStrategy: {
      kind: "row",
      locator: { kind: "row", sheet: "Data", row: 1 },
      confidence: 1,
    },
    identityStrategy: { kind: "rowPosition", confidence: 1 },
    columnBindings: [],
    skipRules: [],
    drift: {
      headerShiftRows: 0,
      addedColumns: "halt",
      removedColumns: { max: 0, action: "halt" },
    },
    confidence: { region: 1, aggregate: 1 },
    warnings: [],
    positionRoles: [
      { kind: "pivotLabel", segmentId: "quarter" },
      { kind: "pivotLabel", segmentId: "quarter" },
      { kind: "pivotLabel", segmentId: "quarter" },
    ],
    pivotSegments: [
      {
        id: "quarter",
        axisName: "quarter",
        axisNameSource: "user",
        valueFieldName: "revenue",
        valueFieldNameSource: "user",
      },
    ],
  };
}

describe("extractRecords — segmented (matrix id 1b: all-pivot 1 segment)", () => {
  it("emits one record per pivotLabel position per entity-unit, no statics", () => {
    const records = extractRecords(
      quartersOnlyRegion(),
      quartersOnlyWorkbook().sheets[0]
    );
    expect(records).toHaveLength(6); // 2 data rows × 3 positions
    for (const r of records) {
      expect(Object.keys(r.fields).sort()).toEqual(["quarter", "revenue"]);
    }
  });

  it("carries the right quarter/revenue pairs per data row", () => {
    const records = extractRecords(
      quartersOnlyRegion(),
      quartersOnlyWorkbook().sheets[0]
    );
    const row2 = records.filter((r) => r.sourceId.startsWith("row-2"));
    const row3 = records.filter((r) => r.sourceId.startsWith("row-3"));
    expect(row2.map((r) => r.fields.revenue)).toEqual([10, 20, 30]);
    expect(row3.map((r) => r.fields.revenue)).toEqual([11, 22, 33]);
  });
});

// ── Matrix id 1c — 2-segments, no statics ──────────────────────────────────
describe("extractRecords — segmented (matrix id 1c: 2-segments, no statics)", () => {
  function region1c(): Region {
    return {
      ...appleRegion(),
      id: "r-1c",
      // Drop the two "field" positions; shift to a 6-col layout.
      bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 6 },
      columnBindings: [],
      identityStrategy: { kind: "rowPosition", confidence: 1 },
      positionRoles: [
        { kind: "pivotLabel", segmentId: "quarter" },
        { kind: "pivotLabel", segmentId: "quarter" },
        { kind: "pivotLabel", segmentId: "quarter" },
        { kind: "pivotLabel", segmentId: "month" },
        { kind: "pivotLabel", segmentId: "month" },
        { kind: "pivotLabel", segmentId: "month" },
      ],
    };
  }

  function workbook1c() {
    return makeWorkbook({
      sheets: [
        {
          name: "Data",
          dimensions: { rows: 2, cols: 6 },
          cells: [
            { row: 1, col: 1, value: "Q1" },
            { row: 1, col: 2, value: "Q2" },
            { row: 1, col: 3, value: "Q3" },
            { row: 1, col: 4, value: "Jan" },
            { row: 1, col: 5, value: "Feb" },
            { row: 1, col: 6, value: "Mar" },
            { row: 2, col: 1, value: 10 },
            { row: 2, col: 2, value: 20 },
            { row: 2, col: 3, value: 30 },
            { row: 2, col: 4, value: 4 },
            { row: 2, col: 5, value: 5 },
            { row: 2, col: 6, value: 6 },
          ],
        },
      ],
    });
  }

  it("emits 6 records per entity-unit split across the two segments with no statics", () => {
    const records = extractRecords(region1c(), workbook1c().sheets[0]);
    expect(records).toHaveLength(6);
    for (const r of records) {
      const keys = Object.keys(r.fields).sort();
      // Exactly { segment.axisName, segment.valueFieldName }; no statics.
      expect(keys.length).toBe(2);
      expect(keys).toContain("revenue");
    }
  });
});

// ── Matrix id 1d — mixed: statics + 1 segment ──────────────────────────────
describe("extractRecords — segmented (matrix id 1d: mixed statics + 1 segment)", () => {
  function region1d(): Region {
    const base = appleRegion();
    return {
      ...base,
      id: "r-1d",
      bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 5 },
      positionRoles: [
        { kind: "field" },
        { kind: "field" },
        { kind: "pivotLabel", segmentId: "quarter" },
        { kind: "pivotLabel", segmentId: "quarter" },
        { kind: "pivotLabel", segmentId: "quarter" },
      ],
      pivotSegments: [
        {
          id: "quarter",
          axisName: "quarter",
          axisNameSource: "user",
          valueFieldName: "revenue",
          valueFieldNameSource: "user",
        },
      ],
    };
  }

  function workbook1d() {
    return makeWorkbook({
      sheets: [
        {
          name: "Data",
          dimensions: { rows: 2, cols: 5 },
          cells: [
            { row: 1, col: 1, value: "name" },
            { row: 1, col: 2, value: "industry" },
            { row: 1, col: 3, value: "Q1" },
            { row: 1, col: 4, value: "Q2" },
            { row: 1, col: 5, value: "Q3" },
            { row: 2, col: 1, value: "Apple" },
            { row: 2, col: 2, value: "Tech" },
            { row: 2, col: 3, value: 10 },
            { row: 2, col: 4, value: 20 },
            { row: 2, col: 5, value: 30 },
          ],
        },
      ],
    });
  }

  it("emits 3 records per entity-unit, each carrying the statics", () => {
    const records = extractRecords(region1d(), workbook1d().sheets[0]);
    expect(records).toHaveLength(3);
    for (const r of records) {
      expect(r.fields["col-name"]).toBe("Apple");
      expect(r.fields["col-industry"]).toBe("Tech");
    }
    expect(records.map((r) => r.fields.quarter)).toEqual(["Q1", "Q2", "Q3"]);
    expect(records.map((r) => r.fields.revenue)).toEqual([10, 20, 30]);
  });
});

// ── Matrix id 1f — mixed + skip ────────────────────────────────────────────
describe("extractRecords — segmented (matrix id 1f: mixed + skip)", () => {
  function region1f(): Region {
    const base = appleRegion();
    return {
      ...base,
      id: "r-1f",
      bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 6 },
      positionRoles: [
        { kind: "field" },
        { kind: "field" },
        { kind: "pivotLabel", segmentId: "quarter" },
        { kind: "pivotLabel", segmentId: "quarter" },
        { kind: "pivotLabel", segmentId: "quarter" },
        { kind: "skip" },
      ],
      pivotSegments: [
        {
          id: "quarter",
          axisName: "quarter",
          axisNameSource: "user",
          valueFieldName: "revenue",
          valueFieldNameSource: "user",
        },
      ],
    };
  }

  function workbook1f() {
    return makeWorkbook({
      sheets: [
        {
          name: "Data",
          dimensions: { rows: 2, cols: 6 },
          cells: [
            { row: 1, col: 1, value: "name" },
            { row: 1, col: 2, value: "industry" },
            { row: 1, col: 3, value: "Q1" },
            { row: 1, col: 4, value: "Q2" },
            { row: 1, col: 5, value: "Q3" },
            { row: 1, col: 6, value: "Total" },
            { row: 2, col: 1, value: "Apple" },
            { row: 2, col: 2, value: "Tech" },
            { row: 2, col: 3, value: 10 },
            { row: 2, col: 4, value: 20 },
            { row: 2, col: 5, value: 30 },
            { row: 2, col: 6, value: 60 },
          ],
        },
      ],
    });
  }

  it("omits skipped positions from record count and field set", () => {
    const records = extractRecords(region1f(), workbook1f().sheets[0]);
    expect(records).toHaveLength(3); // Total column contributes nothing
    for (const r of records) {
      expect(r.fields.quarter).not.toBe("Total");
      expect(r.fields.revenue).not.toBe(60);
    }
    expect(records.map((r) => r.fields.quarter)).toEqual(["Q1", "Q2", "Q3"]);
  });
});
