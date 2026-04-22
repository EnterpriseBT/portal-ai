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

// ── Matrix id 2e — canonical transpose: cols × headerAxis:col ──────────────
// Each column is an entity. Headers are a column of labels.
//
//           col-2 | col-3 | col-4
// name    : Apple | Berry | Cherry
// industry: Tech  | Food  | Food
// Q1      : 10    | 11    | 12
// Q2      : 20    | 21    | 22
// Q3      : 30    | 31    | 32
// Jan     : 4     | 5     | 6
// Feb     : 5     | 6     | 7
// Mar     : 6     | 7     | 8
function cols2eWorkbook() {
  return makeWorkbook({
    sheets: [
      {
        name: "Data",
        dimensions: { rows: 8, cols: 4 },
        cells: [
          // Column 1 holds row labels.
          { row: 1, col: 1, value: "name" },
          { row: 2, col: 1, value: "industry" },
          { row: 3, col: 1, value: "Q1" },
          { row: 4, col: 1, value: "Q2" },
          { row: 5, col: 1, value: "Q3" },
          { row: 6, col: 1, value: "Jan" },
          { row: 7, col: 1, value: "Feb" },
          { row: 8, col: 1, value: "Mar" },
          // Column 2 — Apple
          { row: 1, col: 2, value: "Apple" },
          { row: 2, col: 2, value: "Tech" },
          { row: 3, col: 2, value: 10 },
          { row: 4, col: 2, value: 20 },
          { row: 5, col: 2, value: 30 },
          { row: 6, col: 2, value: 4 },
          { row: 7, col: 2, value: 5 },
          { row: 8, col: 2, value: 6 },
          // Column 3 — Berry
          { row: 1, col: 3, value: "Berry" },
          { row: 2, col: 3, value: "Food" },
          { row: 3, col: 3, value: 11 },
          { row: 4, col: 3, value: 21 },
          { row: 5, col: 3, value: 31 },
          { row: 6, col: 3, value: 5 },
          { row: 7, col: 3, value: 6 },
          { row: 8, col: 3, value: 7 },
          // Column 4 — Cherry
          { row: 1, col: 4, value: "Cherry" },
          { row: 2, col: 4, value: "Food" },
          { row: 3, col: 4, value: 12 },
          { row: 4, col: 4, value: 22 },
          { row: 5, col: 4, value: 32 },
          { row: 6, col: 4, value: 6 },
          { row: 7, col: 4, value: 7 },
          { row: 8, col: 4, value: 8 },
        ],
      },
    ],
  });
}

function cols2eRegion(): Region {
  return {
    id: "r-2e",
    sheet: "Data",
    bounds: { startRow: 1, startCol: 1, endRow: 8, endCol: 4 },
    boundsMode: "absolute",
    targetEntityDefinitionId: "companies",
    orientation: "columns-as-records",
    headerAxis: "column",
    headerStrategy: {
      kind: "column",
      locator: { kind: "column", sheet: "Data", col: 1 },
      confidence: 1,
    },
    identityStrategy: {
      kind: "column",
      sourceLocator: { kind: "row", sheet: "Data", row: 1 },
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
      { kind: "field" }, // name row
      { kind: "field" }, // industry row
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

describe("extractRecords — segmented columns-as-records (matrix id 2e)", () => {
  it("emits 6 records per data column with the right statics", () => {
    const records = extractRecords(cols2eRegion(), cols2eWorkbook().sheets[0]);
    expect(records).toHaveLength(18); // 3 companies × (3 quarter + 3 month)
    const byEntity = new Map<string, typeof records>();
    for (const r of records) {
      const n = r.fields["col-name"] as string;
      byEntity.set(n, [...(byEntity.get(n) ?? []), r]);
    }
    expect(byEntity.get("Apple")?.length).toBe(6);
    expect(byEntity.get("Berry")?.length).toBe(6);
    expect(byEntity.get("Cherry")?.length).toBe(6);
    for (const r of byEntity.get("Apple") ?? []) {
      expect(r.fields["col-industry"]).toBe("Tech");
    }
  });

  it("emits the right quarter and month labels per entity", () => {
    const records = extractRecords(cols2eRegion(), cols2eWorkbook().sheets[0]);
    const apple = records.filter((r) => r.fields["col-name"] === "Apple");
    expect(apple.filter((r) => "quarter" in r.fields).map((r) => r.fields.quarter))
      .toEqual(["Q1", "Q2", "Q3"]);
    expect(apple.filter((r) => "quarter" in r.fields).map((r) => r.fields.revenue))
      .toEqual([10, 20, 30]);
    expect(apple.filter((r) => "month" in r.fields).map((r) => r.fields.month))
      .toEqual(["Jan", "Feb", "Mar"]);
    expect(apple.filter((r) => "month" in r.fields).map((r) => r.fields.revenue))
      .toEqual([4, 5, 6]);
  });

  it("produces distinct source-ids per (entity-column, segment, label)", () => {
    const records = extractRecords(cols2eRegion(), cols2eWorkbook().sheets[0]);
    const ids = new Set(records.map((r) => r.sourceId));
    expect(ids.size).toBe(records.length);
  });
});

// ── Matrix id 2b — all-pivot 1 segment (columns-as-records) ────────────────
describe("extractRecords — segmented (matrix id 2b: cols all-pivot 1 segment)", () => {
  function workbook2b() {
    return makeWorkbook({
      sheets: [
        {
          name: "Data",
          dimensions: { rows: 3, cols: 3 },
          cells: [
            { row: 1, col: 1, value: "Q1" },
            { row: 2, col: 1, value: "Q2" },
            { row: 3, col: 1, value: "Q3" },
            { row: 1, col: 2, value: 10 },
            { row: 2, col: 2, value: 20 },
            { row: 3, col: 2, value: 30 },
            { row: 1, col: 3, value: 11 },
            { row: 2, col: 3, value: 22 },
            { row: 3, col: 3, value: 33 },
          ],
        },
      ],
    });
  }

  function region2b(): Region {
    return {
      ...cols2eRegion(),
      id: "r-2b",
      bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 3 },
      columnBindings: [],
      identityStrategy: { kind: "rowPosition", confidence: 1 },
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

  it("emits 1 record per position per data column, no statics", () => {
    const records = extractRecords(region2b(), workbook2b().sheets[0]);
    expect(records).toHaveLength(6); // 2 data cols × 3 positions
    for (const r of records) {
      expect(Object.keys(r.fields).sort()).toEqual(["quarter", "revenue"]);
    }
    const col2 = records.filter((r) => r.sourceId.startsWith("col-2"));
    const col3 = records.filter((r) => r.sourceId.startsWith("col-3"));
    expect(col2.map((r) => r.fields.revenue)).toEqual([10, 20, 30]);
    expect(col3.map((r) => r.fields.revenue)).toEqual([11, 22, 33]);
  });
});

// ── Matrix id 2c — 2 segments, no statics (columns-as-records) ─────────────
describe("extractRecords — segmented (matrix id 2c: cols 2-segments, no statics)", () => {
  function workbook2c() {
    return makeWorkbook({
      sheets: [
        {
          name: "Data",
          dimensions: { rows: 6, cols: 3 },
          cells: [
            { row: 1, col: 1, value: "Q1" },
            { row: 2, col: 1, value: "Q2" },
            { row: 3, col: 1, value: "Q3" },
            { row: 4, col: 1, value: "Jan" },
            { row: 5, col: 1, value: "Feb" },
            { row: 6, col: 1, value: "Mar" },
            { row: 1, col: 2, value: 10 },
            { row: 2, col: 2, value: 20 },
            { row: 3, col: 2, value: 30 },
            { row: 4, col: 2, value: 4 },
            { row: 5, col: 2, value: 5 },
            { row: 6, col: 2, value: 6 },
            { row: 1, col: 3, value: 11 },
            { row: 2, col: 3, value: 22 },
            { row: 3, col: 3, value: 33 },
            { row: 4, col: 3, value: 5 },
            { row: 5, col: 3, value: 6 },
            { row: 6, col: 3, value: 7 },
          ],
        },
      ],
    });
  }

  function region2c(): Region {
    return {
      ...cols2eRegion(),
      id: "r-2c",
      bounds: { startRow: 1, startCol: 1, endRow: 6, endCol: 3 },
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

  it("emits 6 records per data column across two segments, no statics", () => {
    const records = extractRecords(region2c(), workbook2c().sheets[0]);
    expect(records).toHaveLength(12); // 2 data cols × 6 positions
    for (const r of records) {
      expect(Object.keys(r.fields).length).toBe(2);
    }
  });
});

// ── Matrix id 2d — mixed: statics + 1 segment (columns-as-records) ─────────
describe("extractRecords — segmented (matrix id 2d: cols statics + 1 segment)", () => {
  function workbook2d() {
    return makeWorkbook({
      sheets: [
        {
          name: "Data",
          dimensions: { rows: 5, cols: 3 },
          cells: [
            { row: 1, col: 1, value: "name" },
            { row: 2, col: 1, value: "industry" },
            { row: 3, col: 1, value: "Q1" },
            { row: 4, col: 1, value: "Q2" },
            { row: 5, col: 1, value: "Q3" },
            { row: 1, col: 2, value: "Apple" },
            { row: 2, col: 2, value: "Tech" },
            { row: 3, col: 2, value: 10 },
            { row: 4, col: 2, value: 20 },
            { row: 5, col: 2, value: 30 },
            { row: 1, col: 3, value: "Berry" },
            { row: 2, col: 3, value: "Food" },
            { row: 3, col: 3, value: 11 },
            { row: 4, col: 3, value: 21 },
            { row: 5, col: 3, value: 31 },
          ],
        },
      ],
    });
  }

  function region2d(): Region {
    return {
      ...cols2eRegion(),
      id: "r-2d",
      bounds: { startRow: 1, startCol: 1, endRow: 5, endCol: 3 },
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

  it("emits 3 records per data column, each with statics", () => {
    const records = extractRecords(region2d(), workbook2d().sheets[0]);
    expect(records).toHaveLength(6);
    const apple = records.filter((r) => r.fields["col-name"] === "Apple");
    expect(apple).toHaveLength(3);
    expect(apple.map((r) => r.fields.quarter)).toEqual(["Q1", "Q2", "Q3"]);
    expect(apple.map((r) => r.fields.revenue)).toEqual([10, 20, 30]);
    for (const r of apple) expect(r.fields["col-industry"]).toBe("Tech");
  });
});

// ── Matrix id 2f — mixed + skip (columns-as-records) ───────────────────────
describe("extractRecords — segmented (matrix id 2f: cols mixed + skip)", () => {
  function workbook2f() {
    return makeWorkbook({
      sheets: [
        {
          name: "Data",
          dimensions: { rows: 6, cols: 2 },
          cells: [
            { row: 1, col: 1, value: "name" },
            { row: 2, col: 1, value: "industry" },
            { row: 3, col: 1, value: "Q1" },
            { row: 4, col: 1, value: "Q2" },
            { row: 5, col: 1, value: "Q3" },
            { row: 6, col: 1, value: "Total" },
            { row: 1, col: 2, value: "Apple" },
            { row: 2, col: 2, value: "Tech" },
            { row: 3, col: 2, value: 10 },
            { row: 4, col: 2, value: 20 },
            { row: 5, col: 2, value: 30 },
            { row: 6, col: 2, value: 60 },
          ],
        },
      ],
    });
  }

  function region2f(): Region {
    return {
      ...cols2eRegion(),
      id: "r-2f",
      bounds: { startRow: 1, startCol: 1, endRow: 6, endCol: 2 },
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

  it("omits the Total row from record count and values", () => {
    const records = extractRecords(region2f(), workbook2f().sheets[0]);
    expect(records).toHaveLength(3);
    for (const r of records) {
      expect(r.fields.quarter).not.toBe("Total");
      expect(r.fields.revenue).not.toBe(60);
    }
    expect(records.map((r) => r.fields.quarter)).toEqual(["Q1", "Q2", "Q3"]);
  });
});

// ── Matrix id 3b — pivoted rows-as-records + headerAxis:column + N-segments ─
// Layout matches 2e (vertical header, horizontal data cols). Declaring
// orientation: rows-as-records with headerAxis: column is the "pivoted rows"
// shape — entity units are sheet columns even though the orientation name
// suggests otherwise. See the discovery-doc orientation-dispatch table.
describe("extractRecords — segmented (matrix id 3b: pivoted rows + multi-segment)", () => {
  function region3b(): Region {
    return {
      ...cols2eRegion(),
      id: "r-3b",
      orientation: "rows-as-records",
      // Columns-as-records identity wouldn't make sense here; the user-facing
      // "entity id" lives in the first data row for this pivoted shape.
      identityStrategy: {
        kind: "column",
        sourceLocator: { kind: "row", sheet: "Data", row: 1 },
        confidence: 1,
      },
    };
  }

  it("emits 18 records (3 entities × 6 positions) with the right statics and segment labels", () => {
    const records = extractRecords(region3b(), cols2eWorkbook().sheets[0]);
    expect(records).toHaveLength(18);
    const apple = records.filter((r) => r.fields["col-name"] === "Apple");
    expect(apple).toHaveLength(6);
    for (const r of apple) expect(r.fields["col-industry"]).toBe("Tech");
    expect(
      apple.filter((r) => "quarter" in r.fields).map((r) => r.fields.quarter)
    ).toEqual(["Q1", "Q2", "Q3"]);
    expect(
      apple.filter((r) => "month" in r.fields).map((r) => r.fields.month)
    ).toEqual(["Jan", "Feb", "Mar"]);
  });
});

// ── Matrix id 4b — pivoted columns-as-records + headerAxis:row + N-segments ─
// Transpose of 3b. Layout matches 1e (horizontal header, vertical data rows).
describe("extractRecords — segmented (matrix id 4b: pivoted cols + multi-segment)", () => {
  function workbook4b() {
    return makeWorkbook({
      sheets: [
        {
          name: "Data",
          dimensions: { rows: 4, cols: 8 },
          cells: [
            // Top row: header labels for field + pivotLabel positions.
            { row: 1, col: 1, value: "name" },
            { row: 1, col: 2, value: "industry" },
            { row: 1, col: 3, value: "Q1" },
            { row: 1, col: 4, value: "Q2" },
            { row: 1, col: 5, value: "Q3" },
            { row: 1, col: 6, value: "Jan" },
            { row: 1, col: 7, value: "Feb" },
            { row: 1, col: 8, value: "Mar" },
            // Apple row
            { row: 2, col: 1, value: "Apple" },
            { row: 2, col: 2, value: "Tech" },
            { row: 2, col: 3, value: 10 },
            { row: 2, col: 4, value: 20 },
            { row: 2, col: 5, value: 30 },
            { row: 2, col: 6, value: 4 },
            { row: 2, col: 7, value: 5 },
            { row: 2, col: 8, value: 6 },
            // Berry row
            { row: 3, col: 1, value: "Berry" },
            { row: 3, col: 2, value: "Food" },
            { row: 3, col: 3, value: 11 },
            { row: 3, col: 4, value: 21 },
            { row: 3, col: 5, value: 31 },
            { row: 3, col: 6, value: 5 },
            { row: 3, col: 7, value: 6 },
            { row: 3, col: 8, value: 7 },
            // Cherry row
            { row: 4, col: 1, value: "Cherry" },
            { row: 4, col: 2, value: "Food" },
            { row: 4, col: 3, value: 12 },
            { row: 4, col: 4, value: 22 },
            { row: 4, col: 5, value: 32 },
            { row: 4, col: 6, value: 6 },
            { row: 4, col: 7, value: 7 },
            { row: 4, col: 8, value: 8 },
          ],
        },
      ],
    });
  }

  function region4b(): Region {
    return {
      ...appleRegion(),
      id: "r-4b",
      orientation: "columns-as-records",
      bounds: { startRow: 1, startCol: 1, endRow: 4, endCol: 8 },
      identityStrategy: {
        kind: "column",
        sourceLocator: { kind: "column", sheet: "Data", col: 1 },
        confidence: 1,
      },
    };
  }

  it("emits 18 records (3 entities × 6 positions) with the right statics and segment labels", () => {
    const records = extractRecords(region4b(), workbook4b().sheets[0]);
    expect(records).toHaveLength(18);
    const apple = records.filter((r) => r.fields["col-name"] === "Apple");
    expect(apple).toHaveLength(6);
    for (const r of apple) expect(r.fields["col-industry"]).toBe("Tech");
    expect(
      apple.filter((r) => "quarter" in r.fields).map((r) => r.fields.quarter)
    ).toEqual(["Q1", "Q2", "Q3"]);
    expect(
      apple.filter((r) => "month" in r.fields).map((r) => r.fields.month)
    ).toEqual(["Jan", "Feb", "Mar"]);
  });
});
