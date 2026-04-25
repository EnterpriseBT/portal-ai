import { describe, it, expect } from "@jest/globals";

import type { Region } from "../../plan/index.js";
import { makeWorkbook } from "../../workbook/helpers.js";
import { detectRegionDrift, rollUpDrift } from "../drift.js";

function contactsRegion(overrides: Partial<Region> = {}): Region {
  return {
    id: "r1",
    sheet: "Sheet1",
    bounds: { startRow: 1, startCol: 1, endRow: 4, endCol: 3 },
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
    identityStrategy: {
      kind: "column",
      sourceLocator: { kind: "column", sheet: "Sheet1", col: 1 },
      confidence: 0.9,
    },
    columnBindings: [
      {
        sourceLocator: { kind: "byHeaderName", axis: "row", name: "email" },
        columnDefinitionId: "col-email",
        confidence: 0.9,
      },
      {
        sourceLocator: { kind: "byHeaderName", axis: "row", name: "name" },
        columnDefinitionId: "col-name",
        confidence: 0.9,
      },
      {
        sourceLocator: { kind: "byHeaderName", axis: "row", name: "age" },
        columnDefinitionId: "col-age",
        confidence: 0.8,
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

const baselineWorkbook = () =>
  makeWorkbook({
    sheets: [
      {
        name: "Sheet1",
        dimensions: { rows: 4, cols: 3 },
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
          { row: 4, col: 1, value: "c@x.com" },
          { row: 4, col: 2, value: "carol" },
          { row: 4, col: 3, value: 40 },
        ],
      },
    ],
  });

describe("detectRegionDrift — added-columns", () => {
  it("flags added-columns as warn with addedColumns: 'halt'", () => {
    const wb = makeWorkbook({
      sheets: [
        {
          name: "Sheet1",
          dimensions: { rows: 2, cols: 4 },
          cells: [
            { row: 1, col: 1, value: "email" },
            { row: 1, col: 2, value: "name" },
            { row: 1, col: 3, value: "age" },
            { row: 1, col: 4, value: "unexpected" },
            { row: 2, col: 1, value: "a@x.com" },
            { row: 2, col: 2, value: "alice" },
            { row: 2, col: 3, value: 30 },
            { row: 2, col: 4, value: "x" },
          ],
        },
      ],
    });
    const region = contactsRegion({
      bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 4 },
      segmentsByAxis: {
        row: [{ kind: "field", positionCount: 4 }],
      },
    });
    const drift = detectRegionDrift(region, wb.sheets[0]);
    expect(drift.kinds).toContain("added-columns");
    expect(drift.withinTolerance).toBe(false);
    expect(rollUpDrift([drift]).severity).toBe("warn");
    expect(rollUpDrift([drift]).identityChanging).toBe(false);
  });

  it("does not flag pivot-segment header positions as added columns", () => {
    // Pure-pivot region — header row contains only pivot label values
    // (Jan/Feb/Mar). Those positions belong to a `kind: "pivot"` segment
    // and have no place in `columnBindings`. Treating them as added
    // columns made any pivot region trip `LAYOUT_PLAN_DRIFT_HALT` on
    // commit unless the region carried `addedColumns: "auto-apply"`.
    // Drift now looks only at field-segment positions for the
    // addedColumns gate.
    const wb = makeWorkbook({
      sheets: [
        {
          name: "Sheet1",
          dimensions: { rows: 2, cols: 3 },
          cells: [
            { row: 1, col: 1, value: "Jan" },
            { row: 1, col: 2, value: "Feb" },
            { row: 1, col: 3, value: "Mar" },
            { row: 2, col: 1, value: 10 },
            { row: 2, col: 2, value: 20 },
            { row: 2, col: 3, value: 30 },
          ],
        },
      ],
    });
    const region: Region = {
      id: "r1",
      sheet: "Sheet1",
      bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 3 },
      targetEntityDefinitionId: "monthly",
      headerAxes: ["row"],
      segmentsByAxis: {
        row: [
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
          locator: { kind: "row", sheet: "Sheet1", row: 1 },
          confidence: 0.95,
        },
      },
      identityStrategy: { kind: "rowPosition", confidence: 0.6 },
      columnBindings: [],
      skipRules: [],
      drift: {
        headerShiftRows: 0,
        addedColumns: "halt",
        removedColumns: { max: 0, action: "halt" },
      },
      confidence: { region: 0.9, aggregate: 0.9 },
      warnings: [],
    };
    const drift = detectRegionDrift(region, wb.sheets[0]);
    expect(drift.kinds).not.toContain("added-columns");
    expect(drift.withinTolerance).toBe(true);
  });

  it("silently drops added columns when addedColumns: 'auto-apply'", () => {
    const wb = makeWorkbook({
      sheets: [
        {
          name: "Sheet1",
          dimensions: { rows: 2, cols: 4 },
          cells: [
            { row: 1, col: 1, value: "email" },
            { row: 1, col: 2, value: "name" },
            { row: 1, col: 3, value: "age" },
            { row: 1, col: 4, value: "extra" },
            { row: 2, col: 1, value: "a@x.com" },
            { row: 2, col: 2, value: "alice" },
            { row: 2, col: 3, value: 30 },
            { row: 2, col: 4, value: "x" },
          ],
        },
      ],
    });
    const region = contactsRegion({
      bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 4 },
      segmentsByAxis: {
        row: [{ kind: "field", positionCount: 4 }],
      },
      drift: {
        headerShiftRows: 0,
        addedColumns: "auto-apply",
        removedColumns: { max: 0, action: "halt" },
      },
    });
    const drift = detectRegionDrift(region, wb.sheets[0]);
    expect(drift.withinTolerance).toBe(true);
    expect(rollUpDrift([drift]).severity).toBe("info");
  });
});

describe("detectRegionDrift — removed-columns", () => {
  it("is a blocker when removed-columns exceed removedColumns.max", () => {
    const wb = makeWorkbook({
      sheets: [
        {
          name: "Sheet1",
          dimensions: { rows: 2, cols: 2 },
          cells: [
            { row: 1, col: 1, value: "email" },
            { row: 2, col: 1, value: "a@x.com" },
          ],
        },
      ],
    });
    const region = contactsRegion({
      bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 2 },
      segmentsByAxis: {
        row: [{ kind: "field", positionCount: 2 }],
      },
      drift: {
        headerShiftRows: 0,
        addedColumns: "halt",
        removedColumns: { max: 0, action: "halt" },
      },
    });
    const drift = detectRegionDrift(region, wb.sheets[0]);
    expect(drift.kinds).toContain("removed-columns");
    expect(rollUpDrift([drift]).severity).toBe("blocker");
  });

  it("is within tolerance when removed-columns count ≤ removedColumns.max", () => {
    const wb = makeWorkbook({
      sheets: [
        {
          name: "Sheet1",
          dimensions: { rows: 2, cols: 2 },
          cells: [
            { row: 1, col: 1, value: "email" },
            { row: 2, col: 1, value: "a@x.com" },
          ],
        },
      ],
    });
    const region = contactsRegion({
      bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 2 },
      segmentsByAxis: {
        row: [{ kind: "field", positionCount: 2 }],
      },
      columnBindings: [
        {
          sourceLocator: { kind: "byHeaderName", axis: "row", name: "email" },
          columnDefinitionId: "col-email",
          confidence: 0.9,
        },
        {
          sourceLocator: { kind: "byHeaderName", axis: "row", name: "name" },
          columnDefinitionId: "col-name",
          confidence: 0.9,
        },
      ],
      drift: {
        headerShiftRows: 0,
        addedColumns: "halt",
        removedColumns: { max: 1, action: "halt" },
      },
    });
    const drift = detectRegionDrift(region, wb.sheets[0]);
    expect(drift.withinTolerance).toBe(true);
  });
});

describe("detectRegionDrift — identity column", () => {
  it("emits identity-column-has-blanks when the identity column has null values in data rows", () => {
    const wb = makeWorkbook({
      sheets: [
        {
          name: "Sheet1",
          dimensions: { rows: 4, cols: 3 },
          cells: [
            { row: 1, col: 1, value: "email" },
            { row: 1, col: 2, value: "name" },
            { row: 1, col: 3, value: "age" },
            { row: 2, col: 2, value: "alice" },
            { row: 2, col: 3, value: 30 },
            { row: 3, col: 1, value: "b@x.com" },
            { row: 3, col: 2, value: "bob" },
            { row: 3, col: 3, value: 25 },
          ],
        },
      ],
    });
    const region = contactsRegion({
      bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 3 },
    });
    const drift = detectRegionDrift(region, wb.sheets[0]);
    expect(drift.kinds).toContain("identity-column-has-blanks");
  });

  it("emits duplicate-identity-values and marks identityChanging true / severity blocker", () => {
    const wb = makeWorkbook({
      sheets: [
        {
          name: "Sheet1",
          dimensions: { rows: 4, cols: 3 },
          cells: [
            { row: 1, col: 1, value: "email" },
            { row: 1, col: 2, value: "name" },
            { row: 1, col: 3, value: "age" },
            { row: 2, col: 1, value: "a@x.com" },
            { row: 2, col: 2, value: "alice" },
            { row: 2, col: 3, value: 30 },
            { row: 3, col: 1, value: "a@x.com" },
            { row: 3, col: 2, value: "bob" },
            { row: 3, col: 3, value: 25 },
          ],
        },
      ],
    });
    const region = contactsRegion({
      bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 3 },
    });
    const drift = detectRegionDrift(region, wb.sheets[0]);
    expect(drift.kinds).toContain("duplicate-identity-values");
    const roll = rollUpDrift([drift]);
    expect(roll.severity).toBe("blocker");
    expect(roll.identityChanging).toBe(true);
  });
});

describe("detectRegionDrift — records-axis anchor rename", () => {
  it("emits records-axis-value-renamed when a pivot segment's anchor-cell axisName has changed in the workbook", () => {
    const priorRegion: Region = {
      ...contactsRegion(),
      headerAxes: ["column"],
      segmentsByAxis: {
        column: [
          {
            kind: "pivot",
            id: "month",
            axisName: "Month",
            axisNameSource: "anchor-cell",
            positionCount: 2,
          },
        ],
      },
      cellValueField: { name: "Revenue", nameSource: "user" },
      axisAnchorCell: { row: 1, col: 1 },
      headerStrategyByAxis: {
        column: {
          kind: "rowLabels",
          locator: { kind: "column", sheet: "Sheet1", col: 1 },
          confidence: 0.9,
        },
      },
      bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 4 },
      columnBindings: [],
      drift: {
        headerShiftRows: 0,
        addedColumns: "auto-apply",
        removedColumns: { max: 10, action: "auto-apply" },
      },
    };
    const wb = makeWorkbook({
      sheets: [
        {
          name: "Sheet1",
          dimensions: { rows: 2, cols: 4 },
          cells: [
            // Anchor cell renamed — was "Month", now "Period"
            { row: 1, col: 1, value: "Period" },
            { row: 1, col: 2, value: "Jan" },
            { row: 1, col: 3, value: "Feb" },
            { row: 1, col: 4, value: "Mar" },
            { row: 2, col: 1, value: "Revenue" },
            { row: 2, col: 2, value: 100 },
            { row: 2, col: 3, value: 120 },
            { row: 2, col: 4, value: 130 },
          ],
        },
      ],
    });
    const drift = detectRegionDrift(priorRegion, wb.sheets[0]);
    expect(drift.kinds).toContain("records-axis-value-renamed");
    const roll = rollUpDrift([drift]);
    expect(roll.identityChanging).toBe(true);
  });
});

describe("rollUpDrift", () => {
  it("returns severity 'none' when no drift kinds are reported", () => {
    const wb = baselineWorkbook();
    const drift = detectRegionDrift(contactsRegion(), wb.sheets[0]);
    expect(drift.kinds).toEqual([]);
    expect(rollUpDrift([drift]).severity).toBe("none");
  });

  it("escalates to the highest severity across regions", () => {
    const roll = rollUpDrift([
      { regionId: "a", kinds: ["added-columns"], withinTolerance: false },
      {
        regionId: "b",
        kinds: ["duplicate-identity-values"],
        withinTolerance: false,
      },
    ]);
    expect(roll.severity).toBe("blocker");
  });
});
