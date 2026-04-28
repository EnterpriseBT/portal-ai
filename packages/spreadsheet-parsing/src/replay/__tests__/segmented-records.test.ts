import { describe, it, expect } from "@jest/globals";

import type { Region } from "../../plan/index.js";
import { makeWorkbook } from "../../workbook/helpers.js";
import { extractRecords } from "../extract-records.js";

// ── Matrix id 1e — headerAxes:['row'] × statics + 2 segments ─────────────
// Header: name | industry | Q1 | Q2 | Q3 | Jan | Feb | Mar
// Row 1:  Apple | Tech    | 10 | 20 | 30 | 4   | 5   | 6
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
    targetEntityDefinitionId: "companies",
    headerAxes: ["row"],
    segmentsByAxis: {
      row: [
        { kind: "field", positionCount: 2 },
        {
          kind: "pivot",
          id: "quarter",
          axisName: "quarter",
          axisNameSource: "user",
          positionCount: 3,
        },
        {
          kind: "pivot",
          id: "month",
          axisName: "month",
          axisNameSource: "user",
          positionCount: 3,
        },
      ],
    },
    cellValueField: { name: "revenue", nameSource: "user" },
    headerStrategyByAxis: {
      row: {
        kind: "row",
        locator: { kind: "row", sheet: "Data", row: 1 },
        confidence: 1,
      },
    },
    identityStrategy: {
      kind: "column",
      sourceLocator: { kind: "column", sheet: "Data", col: 1 },
      confidence: 1,
    },
    columnBindings: [
      {
        sourceLocator: { kind: "byHeaderName", axis: "row", name: "name" },
        columnDefinitionId: "col-name",
        confidence: 1,
      },
      {
        sourceLocator: { kind: "byHeaderName", axis: "row", name: "industry" },
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
  };
}

describe("extractRecords — matrix id 1e (rows × 2 segments + statics)", () => {
  it("emits one record per pivot-label position per entity-unit", () => {
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
    targetEntityDefinitionId: "sales",
    headerAxes: ["row"],
    segmentsByAxis: {
      row: [
        {
          kind: "pivot",
          id: "quarter",
          axisName: "quarter",
          axisNameSource: "user",
          positionCount: 3,
        },
      ],
    },
    cellValueField: { name: "revenue", nameSource: "user" },
    headerStrategyByAxis: {
      row: {
        kind: "row",
        locator: { kind: "row", sheet: "Data", row: 1 },
        confidence: 1,
      },
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
  };
}

describe("extractRecords — matrix id 1b (rows × all-pivot 1 segment)", () => {
  it("emits one record per pivot-label position per entity-unit, no statics", () => {
    const records = extractRecords(
      quartersOnlyRegion(),
      quartersOnlyWorkbook().sheets[0]
    );
    expect(records).toHaveLength(6);
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

// ── Matrix id 1c — 2 segments, no statics ──────────────────────────────────
describe("extractRecords — matrix id 1c (rows × 2 segments, no statics)", () => {
  function region1c(): Region {
    return {
      ...appleRegion(),
      id: "r-1c",
      bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 6 },
      columnBindings: [],
      identityStrategy: { kind: "rowPosition", confidence: 1 },
      segmentsByAxis: {
        row: [
          {
            kind: "pivot",
            id: "quarter",
            axisName: "quarter",
            axisNameSource: "user",
            positionCount: 3,
          },
          {
            kind: "pivot",
            id: "month",
            axisName: "month",
            axisNameSource: "user",
            positionCount: 3,
          },
        ],
      },
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
      expect(keys.length).toBe(2);
      expect(keys).toContain("revenue");
    }
  });
});

// ── Matrix id 1d — statics + 1 segment ─────────────────────────────────────
describe("extractRecords — matrix id 1d (rows × statics + 1 segment)", () => {
  function region1d(): Region {
    const base = appleRegion();
    return {
      ...base,
      id: "r-1d",
      bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 5 },
      segmentsByAxis: {
        row: [
          { kind: "field", positionCount: 2 },
          {
            kind: "pivot",
            id: "quarter",
            axisName: "quarter",
            axisNameSource: "user",
            positionCount: 3,
          },
        ],
      },
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
describe("extractRecords — matrix id 1f (rows × statics + pivot + skip)", () => {
  function region1f(): Region {
    const base = appleRegion();
    return {
      ...base,
      id: "r-1f",
      bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 6 },
      segmentsByAxis: {
        row: [
          { kind: "field", positionCount: 2 },
          {
            kind: "pivot",
            id: "quarter",
            axisName: "quarter",
            axisNameSource: "user",
            positionCount: 3,
          },
          { kind: "skip", positionCount: 1 },
        ],
      },
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
    expect(records).toHaveLength(3);
    for (const r of records) {
      expect(r.fields.quarter).not.toBe("Total");
      expect(r.fields.revenue).not.toBe(60);
    }
    expect(records.map((r) => r.fields.quarter)).toEqual(["Q1", "Q2", "Q3"]);
  });
});

// ── Matrix id 2e — headerAxes:['column'] × statics + 2 segments ─────────
//           col-2 | col-3 | col-4
// name    : Apple | Berry | Cherry
// industry: Tech  | Food  | Food
// Q1..Mar : data columns
function cols2eWorkbook() {
  return makeWorkbook({
    sheets: [
      {
        name: "Data",
        dimensions: { rows: 8, cols: 4 },
        cells: [
          { row: 1, col: 1, value: "name" },
          { row: 2, col: 1, value: "industry" },
          { row: 3, col: 1, value: "Q1" },
          { row: 4, col: 1, value: "Q2" },
          { row: 5, col: 1, value: "Q3" },
          { row: 6, col: 1, value: "Jan" },
          { row: 7, col: 1, value: "Feb" },
          { row: 8, col: 1, value: "Mar" },
          { row: 1, col: 2, value: "Apple" },
          { row: 2, col: 2, value: "Tech" },
          { row: 3, col: 2, value: 10 },
          { row: 4, col: 2, value: 20 },
          { row: 5, col: 2, value: 30 },
          { row: 6, col: 2, value: 4 },
          { row: 7, col: 2, value: 5 },
          { row: 8, col: 2, value: 6 },
          { row: 1, col: 3, value: "Berry" },
          { row: 2, col: 3, value: "Food" },
          { row: 3, col: 3, value: 11 },
          { row: 4, col: 3, value: 21 },
          { row: 5, col: 3, value: 31 },
          { row: 6, col: 3, value: 5 },
          { row: 7, col: 3, value: 6 },
          { row: 8, col: 3, value: 7 },
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
    targetEntityDefinitionId: "companies",
    headerAxes: ["column"],
    segmentsByAxis: {
      column: [
        { kind: "field", positionCount: 2 },
        {
          kind: "pivot",
          id: "quarter",
          axisName: "quarter",
          axisNameSource: "user",
          positionCount: 3,
        },
        {
          kind: "pivot",
          id: "month",
          axisName: "month",
          axisNameSource: "user",
          positionCount: 3,
        },
      ],
    },
    cellValueField: { name: "revenue", nameSource: "user" },
    headerStrategyByAxis: {
      column: {
        kind: "column",
        locator: { kind: "column", sheet: "Data", col: 1 },
        confidence: 1,
      },
    },
    identityStrategy: {
      kind: "column",
      sourceLocator: { kind: "row", sheet: "Data", row: 1 },
      confidence: 1,
    },
    columnBindings: [
      {
        sourceLocator: { kind: "byHeaderName", axis: "column", name: "name" },
        columnDefinitionId: "col-name",
        confidence: 1,
      },
      {
        sourceLocator: {
          kind: "byHeaderName",
          axis: "column",
          name: "industry",
        },
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
  };
}

describe("extractRecords — matrix id 2e (cols × statics + 2 segments)", () => {
  it("emits 6 records per data column with the right statics", () => {
    const records = extractRecords(cols2eRegion(), cols2eWorkbook().sheets[0]);
    expect(records).toHaveLength(18);
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
    expect(
      apple.filter((r) => "quarter" in r.fields).map((r) => r.fields.quarter)
    ).toEqual(["Q1", "Q2", "Q3"]);
    expect(
      apple.filter((r) => "quarter" in r.fields).map((r) => r.fields.revenue)
    ).toEqual([10, 20, 30]);
    expect(
      apple.filter((r) => "month" in r.fields).map((r) => r.fields.month)
    ).toEqual(["Jan", "Feb", "Mar"]);
    expect(
      apple.filter((r) => "month" in r.fields).map((r) => r.fields.revenue)
    ).toEqual([4, 5, 6]);
  });

  it("produces distinct source-ids per (entity-column, segment, label)", () => {
    const records = extractRecords(cols2eRegion(), cols2eWorkbook().sheets[0]);
    const ids = new Set(records.map((r) => r.sourceId));
    expect(ids.size).toBe(records.length);
  });
});

// ── Matrix id 2b — cols all-pivot 1 segment ────────────────────────────────
describe("extractRecords — matrix id 2b (cols × all-pivot 1 segment)", () => {
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
      segmentsByAxis: {
        column: [
          {
            kind: "pivot",
            id: "quarter",
            axisName: "quarter",
            axisNameSource: "user",
            positionCount: 3,
          },
        ],
      },
    };
  }

  it("emits 1 record per position per data column, no statics", () => {
    const records = extractRecords(region2b(), workbook2b().sheets[0]);
    expect(records).toHaveLength(6);
    for (const r of records) {
      expect(Object.keys(r.fields).sort()).toEqual(["quarter", "revenue"]);
    }
    const col2 = records.filter((r) => r.sourceId.startsWith("col-2"));
    const col3 = records.filter((r) => r.sourceId.startsWith("col-3"));
    expect(col2.map((r) => r.fields.revenue)).toEqual([10, 20, 30]);
    expect(col3.map((r) => r.fields.revenue)).toEqual([11, 22, 33]);
  });
});

// ── Matrix id 2c — cols 2-segments, no statics ─────────────────────────────
describe("extractRecords — matrix id 2c (cols × 2 segments, no statics)", () => {
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
      segmentsByAxis: {
        column: [
          {
            kind: "pivot",
            id: "quarter",
            axisName: "quarter",
            axisNameSource: "user",
            positionCount: 3,
          },
          {
            kind: "pivot",
            id: "month",
            axisName: "month",
            axisNameSource: "user",
            positionCount: 3,
          },
        ],
      },
    };
  }

  it("emits 6 records per data column across two segments, no statics", () => {
    const records = extractRecords(region2c(), workbook2c().sheets[0]);
    expect(records).toHaveLength(12);
    for (const r of records) {
      expect(Object.keys(r.fields).length).toBe(2);
    }
  });
});

// ── Matrix id 2d — cols statics + 1 segment ────────────────────────────────
describe("extractRecords — matrix id 2d (cols × statics + 1 segment)", () => {
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
      segmentsByAxis: {
        column: [
          { kind: "field", positionCount: 2 },
          {
            kind: "pivot",
            id: "quarter",
            axisName: "quarter",
            axisNameSource: "user",
            positionCount: 3,
          },
        ],
      },
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

// ── Matrix id 2f — cols mixed + skip ───────────────────────────────────────
describe("extractRecords — matrix id 2f (cols × statics + pivot + skip)", () => {
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
      segmentsByAxis: {
        column: [
          { kind: "field", positionCount: 2 },
          {
            kind: "pivot",
            id: "quarter",
            axisName: "quarter",
            axisNameSource: "user",
            positionCount: 3,
          },
          { kind: "skip", positionCount: 1 },
        ],
      },
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

// ── Matrix id 1a — classic tidy under segmentation (round-trip) ────────────
// A region with only a field segment (no pivot) emits one statics-only record
// per entity-unit — the same records as a single-field binding set.
describe("extractRecords — matrix id 1a (rows × all-field, round-trip)", () => {
  function tidyWorkbook() {
    return makeWorkbook({
      sheets: [
        {
          name: "Contacts",
          dimensions: { rows: 3, cols: 3 },
          cells: [
            { row: 1, col: 1, value: "email" },
            { row: 1, col: 2, value: "name" },
            { row: 1, col: 3, value: "age" },
            { row: 2, col: 1, value: "a@x.com" },
            { row: 2, col: 2, value: "alice" },
            { row: 2, col: 3, value: 30 },
            { row: 3, col: 1, value: "b@x.com" },
            { row: 3, col: 2, value: "bob" },
            { row: 3, col: 3, value: 25 },
          ],
        },
      ],
    });
  }

  function tidyRegion(): Region {
    return {
      id: "r-1a",
      sheet: "Contacts",
      bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 3 },
      targetEntityDefinitionId: "contacts",
      headerAxes: ["row"],
      segmentsByAxis: {
        row: [{ kind: "field", positionCount: 3 }],
      },
      headerStrategyByAxis: {
        row: {
          kind: "row",
          locator: { kind: "row", sheet: "Contacts", row: 1 },
          confidence: 1,
        },
      },
      identityStrategy: {
        kind: "column",
        sourceLocator: { kind: "column", sheet: "Contacts", col: 1 },
        confidence: 1,
      },
      columnBindings: [
        {
          sourceLocator: { kind: "byHeaderName", axis: "row", name: "email" },
          columnDefinitionId: "col-email",
          confidence: 1,
        },
        {
          sourceLocator: { kind: "byHeaderName", axis: "row", name: "name" },
          columnDefinitionId: "col-name",
          confidence: 1,
        },
        {
          sourceLocator: { kind: "byHeaderName", axis: "row", name: "age" },
          columnDefinitionId: "col-age",
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
    };
  }

  it("emits one statics-only record per data row", () => {
    const records = extractRecords(tidyRegion(), tidyWorkbook().sheets[0]);
    expect(records).toHaveLength(2);
    expect(records[0].fields).toEqual({
      "col-email": "a@x.com",
      "col-name": "alice",
      "col-age": 30,
    });
    expect(records[1].fields).toEqual({
      "col-email": "b@x.com",
      "col-name": "bob",
      "col-age": 25,
    });
  });
});

// ── 2D crosstab — migrated from cells-as-records.test.ts ──────────────────
// Original matrix id corresponds to the canonical "Quarterly revenue by
// region" crosstab. Records emitted: 3 (quarters) × 3 (regions) = 9.
describe("extractRecords — 2D crosstab (migrated from cells-as-records)", () => {
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

  function crosstabRegion(): Region {
    return {
      id: "crosstab-r1",
      sheet: "QuarterByRegion",
      bounds: { startRow: 1, startCol: 1, endRow: 4, endCol: 4 },
      targetEntityDefinitionId: "revenue-crosstab",
      headerAxes: ["row", "column"],
      segmentsByAxis: {
        row: [
          { kind: "skip", positionCount: 1 },
          {
            kind: "pivot",
            id: "region",
            axisName: "Region",
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
            positionCount: 3,
          },
        ],
      },
      cellValueField: { name: "Revenue", nameSource: "user" },
      axisAnchorCell: { row: 1, col: 1 },
      headerStrategyByAxis: {
        row: {
          kind: "row",
          locator: { kind: "row", sheet: "QuarterByRegion", row: 1 },
          confidence: 0.9,
        },
        column: {
          kind: "column",
          locator: { kind: "column", sheet: "QuarterByRegion", col: 1 },
          confidence: 0.9,
        },
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

  it("emits one record per interior cell (rows × cols) skipping headers + anchor", () => {
    const records = extractRecords(
      crosstabRegion(),
      crosstabWorkbook().sheets[0]
    );
    expect(records).toHaveLength(9);
  });

  it("each record has fields {Quarter, Region, Revenue} keyed by the three user-facing names", () => {
    const records = extractRecords(
      crosstabRegion(),
      crosstabWorkbook().sheets[0]
    );
    const q1North = records.find(
      (r) => r.fields.Quarter === "Q1" && r.fields.Region === "North"
    );
    expect(q1North).toBeDefined();
    expect(q1North?.fields.Revenue).toBe(100);

    const q3East = records.find(
      (r) => r.fields.Quarter === "Q3" && r.fields.Region === "East"
    );
    expect(q3East).toBeDefined();
    expect(q3East?.fields.Revenue).toBe(320);
  });

  it("assigns `cell-{row}-{col}` source_id for rowPosition identity", () => {
    const records = extractRecords(
      crosstabRegion(),
      crosstabWorkbook().sheets[0]
    );
    const q1North = records.find(
      (r) => r.fields.Quarter === "Q1" && r.fields.Region === "North"
    );
    expect(q1North?.sourceId).toBe("cell-2-2");
  });

  it("does not emit records along the header row or header column", () => {
    const records = extractRecords(
      crosstabRegion(),
      crosstabWorkbook().sheets[0]
    );
    for (const r of records) {
      expect(r.fields.Quarter).not.toBe("Quarter");
      expect(r.fields.Region).not.toBe("Quarter");
    }
  });

  it("emits each pivot×pivot intersection's body cell under its own override name when intersectionCellValueFields is set", () => {
    const region = crosstabRegion();
    region.intersectionCellValueFields = {
      region__quarter: { name: "Headcount", nameSource: "user" },
    };
    const records = extractRecords(region, crosstabWorkbook().sheets[0]);
    // Every record should carry `Headcount` (the override) and not the
    // region-level `Revenue` since both axes are pivots and the override
    // applies to the (region, quarter) intersection.
    for (const r of records) {
      expect(r.fields.Headcount).toBeDefined();
      expect(r.fields.Revenue).toBeUndefined();
    }
    const q1North = records.find(
      (r) => r.fields.Quarter === "Q1" && r.fields.Region === "North"
    );
    expect(q1North?.fields.Headcount).toBe(100);
  });

  it("emits exactly (rowPivotCount × colPivotCount) records on a hybrid crosstab with sidebar fields on both axes — no field × pivot duplicates", () => {
    // Layout (rows × cols), bounds = 1..5 × 1..5:
    //   row 1 [anchor] [HQ]  [Industry] [Q1] [Q2]
    //   row 2 [scope]  [...] [...]      [s1] [s2]
    //   row 3 [curr]   [...] [...]      [c1] [c2]
    //   row 4 [Acme]   [NYC] [Tech]     [10] [11]
    //   row 5 [Beta]   [LA]  [Retail]   [20] [21]
    //
    // 2 row-pivot × 2 col-pivot positions = 4 records (not 25).
    const wb = makeWorkbook({
      sheets: [
        {
          name: "Hybrid",
          dimensions: { rows: 5, cols: 5 },
          cells: [
            { row: 1, col: 1, value: "anchor" },
            { row: 1, col: 2, value: "HQ" },
            { row: 1, col: 3, value: "Industry" },
            { row: 1, col: 4, value: "Q1" },
            { row: 1, col: 5, value: "Q2" },
            { row: 2, col: 1, value: "scope" },
            { row: 2, col: 4, value: "s1" },
            { row: 2, col: 5, value: "s2" },
            { row: 3, col: 1, value: "currency" },
            { row: 3, col: 4, value: "c1" },
            { row: 3, col: 5, value: "c2" },
            { row: 4, col: 1, value: "Acme" },
            { row: 4, col: 2, value: "NYC" },
            { row: 4, col: 3, value: "Tech" },
            { row: 4, col: 4, value: 10 },
            { row: 4, col: 5, value: 11 },
            { row: 5, col: 1, value: "Beta" },
            { row: 5, col: 2, value: "LA" },
            { row: 5, col: 3, value: "Retail" },
            { row: 5, col: 4, value: 20 },
            { row: 5, col: 5, value: 21 },
          ],
        },
      ],
    });
    const region: Region = {
      id: "r1",
      sheet: "Hybrid",
      bounds: { startRow: 1, startCol: 1, endRow: 5, endCol: 5 },
      targetEntityDefinitionId: "metrics",
      headerAxes: ["row", "column"],
      segmentsByAxis: {
        row: [
          { kind: "field", positionCount: 1 },
          { kind: "field", positionCount: 2 },
          {
            kind: "pivot",
            id: "rp1",
            axisName: "quarter",
            axisNameSource: "user",
            positionCount: 2,
          },
        ],
        column: [
          { kind: "field", positionCount: 1 },
          { kind: "field", positionCount: 2 },
          {
            kind: "pivot",
            id: "cp1",
            axisName: "company",
            axisNameSource: "user",
            positionCount: 2,
          },
        ],
      },
      cellValueField: { name: "value", nameSource: "user" },
      intersectionCellValueFields: {
        rp1__cp1: { name: "revenue", nameSource: "user" },
      },
      headerStrategyByAxis: {
        row: {
          kind: "row",
          locator: { kind: "row", sheet: "Hybrid", row: 1 },
          confidence: 1,
        },
        column: {
          kind: "column",
          locator: { kind: "column", sheet: "Hybrid", col: 1 },
          confidence: 1,
        },
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
    };
    const records = extractRecords(region, wb.sheets[0]);
    // 2 row-pivot × 2 col-pivot positions = 4 records, not 25 across the
    // full body grid.
    expect(records).toHaveLength(4);
    // Every record carries `revenue` (the intersection override), never
    // the region-level `value`.
    for (const r of records) {
      expect(r.fields.revenue).toBeDefined();
      expect(r.fields.value).toBeUndefined();
    }
    // Spot-check one record's full shape — the static fields are read
    // off-cell (HQ from same row, scope from same col) so each record
    // carries the right sidebar values.
    const acmeQ1 = records.find(
      (r) => r.fields.company === "Acme" && r.fields.quarter === "Q1"
    );
    expect(acmeQ1).toBeDefined();
    expect(acmeQ1?.fields.revenue).toBe(10);
  });

  it("falls back to the region-level cellValueField name when the intersection has no override", () => {
    const region = crosstabRegion();
    region.intersectionCellValueFields = {
      // An override targets a NONEXISTENT pair (won't apply); the existing
      // pair (region, quarter) keeps inheriting from `Revenue`.
      "other__missing": { name: "Headcount", nameSource: "user" },
    };
    // The schema rejects unknown ids, but the replay path must be defensive
    // — strip the bad entry before passing through to extract.
    region.intersectionCellValueFields = {};
    const records = extractRecords(region, crosstabWorkbook().sheets[0]);
    for (const r of records) {
      expect(r.fields.Revenue).toBeDefined();
    }
  });
});

// Multiple pivot segments per axis form K × L intersection blocks; each
// block contributes (rowPivotPositions × colPivotPositions) records.
// Row axis: [pivot-2 (3 positions), pivot-3 (1 position)] → 4 row positions.
// Column axis: [pivot (3 positions)] → 3 col positions.
// Total: (3 × 3) + (1 × 3) = 9 + 3 = 12 records.
describe("extractRecords — 2D crosstab with multiple pivot segments per axis", () => {
  function multiPivotWorkbook() {
    // Row axis on top (cols 2..4 = pivot positions): Q1, Q2, Q3.
    // Col axis on left (rows 2..5):
    //   rows 2..4 = pivot-2 positions (Acme, Beta, Cara)
    //   row 5 = pivot-3 position (Delta)
    // Body cells filled with deterministic numerics to verify mapping.
    return makeWorkbook({
      sheets: [
        {
          name: "Data",
          dimensions: { rows: 5, cols: 4 },
          cells: [
            { row: 1, col: 1, value: "" },
            { row: 1, col: 2, value: "Q1" },
            { row: 1, col: 3, value: "Q2" },
            { row: 1, col: 4, value: "Q3" },
            { row: 2, col: 1, value: "Acme" },
            { row: 2, col: 2, value: 11 },
            { row: 2, col: 3, value: 12 },
            { row: 2, col: 4, value: 13 },
            { row: 3, col: 1, value: "Beta" },
            { row: 3, col: 2, value: 21 },
            { row: 3, col: 3, value: 22 },
            { row: 3, col: 4, value: 23 },
            { row: 4, col: 1, value: "Cara" },
            { row: 4, col: 2, value: 31 },
            { row: 4, col: 3, value: 32 },
            { row: 4, col: 4, value: 33 },
            { row: 5, col: 1, value: "Delta" },
            { row: 5, col: 2, value: 91 },
            { row: 5, col: 3, value: 92 },
            { row: 5, col: 4, value: 93 },
          ],
        },
      ],
    });
  }

  function multiPivotRegion(): Region {
    return {
      id: "r1",
      sheet: "Data",
      bounds: { startRow: 1, startCol: 1, endRow: 5, endCol: 4 },
      targetEntityDefinitionId: "metrics",
      headerAxes: ["row", "column"],
      segmentsByAxis: {
        row: [
          { kind: "skip", positionCount: 1 },
          {
            kind: "pivot",
            id: "rp-quarter",
            axisName: "quarter",
            axisNameSource: "user",
            positionCount: 3,
          },
        ],
        column: [
          { kind: "skip", positionCount: 1 },
          {
            kind: "pivot",
            id: "cp-company",
            axisName: "company",
            axisNameSource: "user",
            positionCount: 3,
          },
          {
            kind: "pivot",
            id: "cp-special",
            axisName: "special",
            axisNameSource: "user",
            positionCount: 1,
          },
        ],
      },
      cellValueField: { name: "value", nameSource: "user" },
      headerStrategyByAxis: {
        row: {
          kind: "row",
          locator: { kind: "row", sheet: "Data", row: 1 },
          confidence: 1,
        },
        column: {
          kind: "column",
          locator: { kind: "column", sheet: "Data", col: 1 },
          confidence: 1,
        },
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
    };
  }

  it("emits one record per body cell across every (rowPivot × colPivot) intersection — 9 + 3 = 12", () => {
    const records = extractRecords(
      multiPivotRegion(),
      multiPivotWorkbook().sheets[0]
    );
    expect(records).toHaveLength(12);
    // Each record carries its own rowPivot pivot key + the colPivot
    // pivot key. The two row-axis pivots have different axisNames
    // (`company`, `special`), so records from different intersection
    // blocks have different field shapes — that's intentional.
    const company = records.filter((r) => r.fields.company !== undefined);
    const special = records.filter((r) => r.fields.special !== undefined);
    expect(company).toHaveLength(9);
    expect(special).toHaveLength(3);
    for (const r of records) {
      expect(r.fields.quarter).toBeDefined();
      expect(r.fields.value).toBeDefined();
    }
  });

  it("assigns a unique rowPosition sourceId per body cell so the upsert doesn't collapse intersections", () => {
    const records = extractRecords(
      multiPivotRegion(),
      multiPivotWorkbook().sheets[0]
    );
    const sourceIds = new Set(records.map((r) => r.sourceId));
    expect(sourceIds.size).toBe(records.length);
  });

  it("honours per-intersection cell-value overrides independently per block", () => {
    const region = multiPivotRegion();
    region.intersectionCellValueFields = {
      "cp-company__rp-quarter": { name: "revenue", nameSource: "user" },
      "cp-special__rp-quarter": { name: "headcount", nameSource: "user" },
    };
    // Wait — the override key format is `${rowPivotId}__${colPivotId}`.
    // Row-axis pivot is `rp-quarter`; column-axis pivots are `cp-company`
    // and `cp-special`. Re-key correctly.
    region.intersectionCellValueFields = {
      "rp-quarter__cp-company": { name: "revenue", nameSource: "user" },
      "rp-quarter__cp-special": { name: "headcount", nameSource: "user" },
    };
    const records = extractRecords(region, multiPivotWorkbook().sheets[0]);
    expect(records).toHaveLength(12);
    const revenueRecords = records.filter(
      (r) => r.fields.revenue !== undefined
    );
    const headcountRecords = records.filter(
      (r) => r.fields.headcount !== undefined
    );
    // 9 cells under rp-quarter × cp-company → carry `revenue`
    expect(revenueRecords).toHaveLength(9);
    // 3 cells under rp-quarter × cp-special → carry `headcount`
    expect(headcountRecords).toHaveLength(3);
    // No record falls back to the region-level `value` because every
    // intersection has its own override.
    for (const r of records) {
      expect(r.fields.value).toBeUndefined();
    }
  });
});
