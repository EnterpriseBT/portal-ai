import { describe, it, expect } from "@jest/globals";

import type { Region } from "../../plan/index.js";
import { makeWorkbook } from "../../workbook/helpers.js";
import { detectRegionDrift, rollUpDrift } from "../drift.js";

function contactsRegion(overrides: Partial<Region> = {}): Region {
  return {
    id: "r1",
    sheet: "Sheet1",
    bounds: { startRow: 1, startCol: 1, endRow: 4, endCol: 3 },
    boundsMode: "absolute",
    targetEntityDefinitionId: "contacts",
    orientation: "rows-as-records",
    headerAxis: "row",
    headerStrategy: {
      kind: "row",
      locator: { kind: "row", sheet: "Sheet1", row: 1 },
      confidence: 0.9,
    },
    identityStrategy: {
      kind: "column",
      sourceLocator: { kind: "column", sheet: "Sheet1", col: 1 },
      confidence: 0.9,
    },
    columnBindings: [
      {
        sourceLocator: { kind: "byHeaderName", name: "email" },
        columnDefinitionId: "col-email",
        confidence: 0.9,
      },
      {
        sourceLocator: { kind: "byHeaderName", name: "name" },
        columnDefinitionId: "col-name",
        confidence: 0.9,
      },
      {
        sourceLocator: { kind: "byHeaderName", name: "age" },
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
            { row: 1, col: 4, value: "unexpected" }, // new column
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
    });
    const drift = detectRegionDrift(region, wb.sheets[0]);
    expect(drift.kinds).toContain("added-columns");
    expect(drift.withinTolerance).toBe(false);
    expect(rollUpDrift([drift]).severity).toBe("warn");
    expect(rollUpDrift([drift]).identityChanging).toBe(false);
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
            // "name" and "age" columns gone
            { row: 2, col: 1, value: "a@x.com" },
          ],
        },
      ],
    });
    const region = contactsRegion({
      bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 2 },
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
            // "name" gone (1 removed, max=1 → within tolerance)
            { row: 2, col: 1, value: "a@x.com" },
          ],
        },
      ],
    });
    const region = contactsRegion({
      bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 2 },
      columnBindings: [
        {
          sourceLocator: { kind: "byHeaderName", name: "email" },
          columnDefinitionId: "col-email",
          confidence: 0.9,
        },
        {
          sourceLocator: { kind: "byHeaderName", name: "name" },
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
            // row 2 col 1 blank
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
            { row: 3, col: 1, value: "a@x.com" }, // duplicate
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

describe("detectRegionDrift — records-axis rename", () => {
  it("emits records-axis-value-renamed and sets identityChanging=true regardless of drift knobs", () => {
    // Compare the pivoted region's current axis labels to the plan's
    // records-axis anchor label — if the anchor value differs from the prior
    // anchor, that's an axis rename.
    const priorRegion = {
      ...contactsRegion(),
      orientation: "columns-as-records" as const,
      headerAxis: "column" as const,
      recordsAxisName: {
        name: "Month",
        source: "anchor-cell" as const,
        confidence: 0.9,
      },
      axisAnchorCell: { row: 1, col: 1 },
      headerStrategy: {
        kind: "rowLabels" as const,
        locator: { kind: "column" as const, sheet: "Sheet1", col: 1 },
        confidence: 0.9,
      },
      bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 4 },
      columnBindings: [
        {
          sourceLocator: { kind: "byHeaderName" as const, name: "Revenue" },
          columnDefinitionId: "col-revenue",
          confidence: 0.9,
        },
      ],
      drift: {
        headerShiftRows: 0,
        addedColumns: "auto-apply" as const,
        removedColumns: { max: 10, action: "auto-apply" as const },
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
