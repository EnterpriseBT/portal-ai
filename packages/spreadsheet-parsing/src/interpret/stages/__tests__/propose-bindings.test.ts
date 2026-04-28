import { describe, it, expect } from "@jest/globals";

import type { InterpretInput, Segment } from "../../../plan/index.js";
import { RegionSchema } from "../../../plan/index.js";
import { createInitialState } from "../../state.js";
import { detectRegions } from "../detect-regions.js";
import { detectHeaders } from "../detect-headers.js";
import { detectIdentity } from "../detect-identity.js";
import { detectSegments } from "../detect-segments.js";
import { classifyFieldSegments } from "../classify-field-segments.js";
import { classifyLogicalFields } from "../classify-logical-fields.js";
import { recommendSegmentAxisNames } from "../recommend-segment-axis-names.js";
import { proposeBindings } from "../propose-bindings.js";

function simpleInput(): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Sheet1",
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
    },
    regionHints: [
      {
        sheet: "Sheet1",
        bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 3 },
        targetEntityDefinitionId: "contacts",
        headerAxes: ["row"],
      },
    ],
  };
}

async function runThrough(input: InterpretInput) {
  let state = detectRegions(createInitialState(input));
  state = detectHeaders(state);
  state = detectIdentity(state);
  state = detectSegments(state);
  state = await classifyFieldSegments(state, {
    columnDefinitionCatalog: [
      { id: "col-email", label: "Email", normalizedKey: "email" },
      { id: "col-name", label: "Name", normalizedKey: "name" },
    ],
  });
  state = await recommendSegmentAxisNames(state, {});
  state = proposeBindings(state);
  return state;
}

describe("proposeBindings", () => {
  it("assembles a Region whose columnBindings map sourceLocator → columnDefinitionId with confidence", async () => {
    const state = await runThrough(simpleInput());
    const region = state.detectedRegions[0];
    expect(region.columnBindings.length).toBeGreaterThan(0);
    const byHeader = new Map(
      region.columnBindings.map((b) => [
        b.sourceLocator.kind === "byHeaderName" ? b.sourceLocator.name : "",
        b,
      ])
    );
    const email = byHeader.get("email");
    expect(email?.columnDefinitionId).toBe("col-email");
    expect(email?.confidence).toBeGreaterThan(0);
    expect(email?.rationale).toBeDefined();
    expect(email?.sourceLocator.kind).toBe("byHeaderName");
    if (email?.sourceLocator.kind === "byHeaderName") {
      expect(email.sourceLocator.axis).toBe("row");
    }
  });

  it("omits bindings that have no classified columnDefinitionId", async () => {
    const state = await runThrough(simpleInput());
    const region = state.detectedRegions[0];
    const hasAgeBinding = region.columnBindings.some(
      (b) =>
        b.sourceLocator.kind === "byHeaderName" &&
        b.sourceLocator.name === "age"
    );
    expect(hasAgeBinding).toBe(false);
  });

  it("preserves a user-supplied pivot segment axisName with source 'user'", async () => {
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 3, cols: 3 },
            cells: [
              { row: 1, col: 1, value: "Metric" },
              { row: 1, col: 2, value: "Jan" },
              { row: 1, col: 3, value: "Feb" },
              { row: 2, col: 1, value: 10 },
              { row: 2, col: 2, value: 20 },
              { row: 3, col: 1, value: 30 },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 3 },
          targetEntityDefinitionId: "monthly",
          headerAxes: ["row"],
          segmentsByAxis: {
            row: [
              { kind: "skip", positionCount: 1 },
              {
                kind: "pivot",
                id: "month",
                axisName: "Month",
                axisNameSource: "user",
                positionCount: 2,
              },
            ],
          },
          cellValueField: { name: "revenue", nameSource: "user" },
          axisAnchorCell: { row: 1, col: 1 },
        },
      ],
    };
    const state = await runThrough(input);
    const region = state.detectedRegions[0];
    const pivot = region.segmentsByAxis?.row?.find((s) => s.kind === "pivot");
    expect(pivot).toBeDefined();
    if (pivot?.kind === "pivot") {
      expect(pivot.axisName).toBe("Month");
      expect(pivot.axisNameSource).toBe("user");
    }
  });

  it("applies AI-recommended axis name with source 'ai' to a pivot segment lacking a user name", async () => {
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 2, cols: 3 },
            cells: [
              { row: 1, col: 1, value: "" },
              { row: 1, col: 2, value: "Jan" },
              { row: 1, col: 3, value: "Feb" },
              { row: 2, col: 1, value: 100 },
              { row: 2, col: 2, value: 200 },
              { row: 2, col: 3, value: 300 },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 3 },
          targetEntityDefinitionId: "monthly",
          headerAxes: ["row"],
          segmentsByAxis: {
            row: [
              { kind: "skip", positionCount: 1 },
              {
                kind: "pivot",
                id: "month",
                axisName: "month",
                axisNameSource: "anchor-cell",
                positionCount: 2,
              },
            ],
          },
          cellValueField: { name: "revenue", nameSource: "user" },
          axisAnchorCell: { row: 1, col: 1 },
        },
      ],
    };
    let state = detectRegions(createInitialState(input));
    state = detectHeaders(state);
    state = detectIdentity(state);
    state = detectSegments(state);
    state = await classifyFieldSegments(state, {});
    state = await recommendSegmentAxisNames(state, {
      axisNameRecommender: () => ({ name: "Month", confidence: 0.8 }),
    });
    state = proposeBindings(state);
    const region = state.detectedRegions[0];
    const pivot = region.segmentsByAxis?.row?.find(
      (s): s is Extract<Segment, { kind: "pivot" }> => s.kind === "pivot"
    );
    expect(pivot).toBeDefined();
    expect(pivot?.axisName).toBe("Month");
    expect(pivot?.axisNameSource).toBe("ai");
  });

  it("picks the top-scored header strategy as headerStrategyByAxis[axis]", async () => {
    const state = await runThrough(simpleInput());
    const region = state.detectedRegions[0];
    expect(region.headerStrategyByAxis?.row).toBeDefined();
    expect(region.headerStrategyByAxis?.row?.kind).toBe("row");
  });

  it("picks the top-scored identity strategy as the region's identityStrategy", async () => {
    const state = await runThrough(simpleInput());
    const region = state.detectedRegions[0];
    expect(region.identityStrategy.kind).toMatch(
      /column|composite|rowPosition/
    );
  });

  it("synthesizes a field segment when the hint didn't carry one", async () => {
    const state = await runThrough(simpleInput());
    const region = state.detectedRegions[0];
    expect(region.segmentsByAxis?.row).toBeDefined();
    expect(region.segmentsByAxis!.row![0].kind).toBe("field");
  });

  it("produces a region that satisfies RegionSchema", async () => {
    const state = await runThrough(simpleInput());
    const region = state.detectedRegions[0];
    const result = RegionSchema.safeParse(region);
    if (!result.success) {
      throw new Error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it("emits byPositionIndex for a field-segment header override over a blank cell", async () => {
    // Column 1's header cell is blank; the user's hint sets headers[0] = "year".
    // The classifier should produce a candidate from the override; propose-bindings
    // should pin it to the position because byHeaderName: "year" wouldn't match
    // the blank cell at replay time.
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 4, cols: 3 },
            // Row 1 is the header — col 1 deliberately blank. Data rows
            // are all numeric so detect-headers' string-heavy scoring
            // unambiguously prefers row 1.
            cells: [
              { row: 1, col: 1, value: "" },
              { row: 1, col: 2, value: "name" },
              { row: 1, col: 3, value: "email" },
              { row: 2, col: 1, value: 1 },
              { row: 2, col: 2, value: 2 },
              { row: 2, col: 3, value: 3 },
              { row: 3, col: 1, value: 4 },
              { row: 3, col: 2, value: 5 },
              { row: 3, col: 3, value: 6 },
              { row: 4, col: 1, value: 7 },
              { row: 4, col: 2, value: 8 },
              { row: 4, col: 3, value: 9 },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 4, endCol: 3 },
          targetEntityDefinitionId: "rows",
          headerAxes: ["row"],
          segmentsByAxis: {
            row: [
              {
                kind: "field",
                positionCount: 3,
                headers: ["year", "", ""],
              } as Segment,
            ],
          },
        },
      ],
    };
    let state = detectRegions(createInitialState(input));
    state = detectHeaders(state);
    state = detectIdentity(state);
    state = detectSegments(state);
    state = await classifyFieldSegments(state, {
      columnDefinitionCatalog: [
        { id: "col-year", label: "Year", normalizedKey: "year" },
        { id: "col-name", label: "Name", normalizedKey: "name" },
        { id: "col-email", label: "Email", normalizedKey: "email" },
      ],
    });
    state = await recommendSegmentAxisNames(state, {});
    state = proposeBindings(state);
    const region = state.detectedRegions[0];

    const yearBinding = region.columnBindings.find(
      (b) => b.columnDefinitionId === "col-year"
    );
    expect(yearBinding).toBeDefined();
    expect(yearBinding?.sourceLocator.kind).toBe("byPositionIndex");
    if (yearBinding?.sourceLocator.kind === "byPositionIndex") {
      expect(yearBinding.sourceLocator.axis).toBe("row");
      expect(yearBinding.sourceLocator.index).toBe(1);
    }
    // The override flows through as a normalizedKey so commit produces a
    // FieldMapping under the user's stated name even though the binding
    // is positional.
    expect(yearBinding?.normalizedKey).toBe("year");

    // Cell-derived headers should still use byHeaderName.
    const nameBinding = region.columnBindings.find(
      (b) => b.columnDefinitionId === "col-name"
    );
    expect(nameBinding?.sourceLocator.kind).toBe("byHeaderName");
    expect(nameBinding?.normalizedKey).toBeUndefined();
  });

  it("coerces a digit-leading override into a valid normalizedKey via an `f_` prefix", async () => {
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 4, cols: 2 },
            // Row 1 has clearly textual headers so detect-headers picks it
            // unambiguously. Both columns are overridden — col 1 with a
            // digit-leading string ("2020"), col 2 with a normal string.
            cells: [
              { row: 1, col: 1, value: "" },
              { row: 1, col: 2, value: "name" },
              { row: 2, col: 1, value: 1 },
              { row: 2, col: 2, value: 2 },
              { row: 3, col: 1, value: 3 },
              { row: 3, col: 2, value: 4 },
              { row: 4, col: 1, value: 5 },
              { row: 4, col: 2, value: 6 },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 4, endCol: 2 },
          targetEntityDefinitionId: "rows",
          headerAxes: ["row"],
          segmentsByAxis: {
            row: [
              {
                kind: "field",
                positionCount: 2,
                headers: ["2020", ""],
              } as Segment,
            ],
          },
        },
      ],
    };
    let state = detectRegions(createInitialState(input));
    state = detectHeaders(state);
    state = detectIdentity(state);
    state = detectSegments(state);
    state = await classifyFieldSegments(state, {
      // Fall through to a fallback definition so a binding is produced
      // even though the catalog won't match either header.
      defaultColumnDefinitionId: "col-text",
    });
    state = await recommendSegmentAxisNames(state, {});
    state = proposeBindings(state);
    const region = state.detectedRegions[0];
    const overrideBinding = region.columnBindings.find(
      (b) =>
        b.sourceLocator.kind === "byPositionIndex" &&
        b.sourceLocator.index === 1
    );
    expect(overrideBinding?.normalizedKey).toBe("f_2020");
  });

  // Regression: a 2D crosstab with field segments on BOTH axes (sidebar
  // fields next to a pivot on each axis) — column-axis field
  // classifications must emit byPositionIndex with axis "column" and an
  // index relative to bounds.startRow, not the row-axis bounds.startCol.
  // Pre-fix, ALL classifications got axis "row" and were re-keyed off
  // startCol, mis-mapping col-axis fields onto row-axis pivot positions.
  it("routes crosstab field classifications to the correct axis (mixed segments on both axes)", async () => {
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 7, cols: 7 },
            cells: [
              // Row 1 = row-axis header line. Skip(1) corner + field(2)
              // sidebar (HQ, Industry) + pivot(4) quarters.
              { row: 1, col: 1, value: "" },
              { row: 1, col: 2, value: "HQ" },
              { row: 1, col: 3, value: "Industry" },
              { row: 1, col: 4, value: "Q1" },
              { row: 1, col: 5, value: "Q2" },
              { row: 1, col: 6, value: "Q3" },
              { row: 1, col: 7, value: "Q4" },
              // Col 1 = column-axis header line. Skip(1) corner + field(2)
              // sidebar (scope, currency) + pivot(4) companies. Cells set
              // for rows 2..7.
              { row: 2, col: 1, value: "scope" },
              { row: 3, col: 1, value: "currency" },
              { row: 4, col: 1, value: "Acme" },
              { row: 5, col: 1, value: "Beta" },
              { row: 6, col: 1, value: "Cara" },
              { row: 7, col: 1, value: "Delta" },
              // Body cells (numeric) — values aren't important for this
              // routing test, just need to be present so detect-headers
              // doesn't pick a different row.
              ...Array.from({ length: 6 }, (_, r) =>
                Array.from({ length: 6 }, (__, c) => ({
                  row: r + 2,
                  col: c + 2,
                  value: r * 10 + c + 1,
                }))
              ).flat(),
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 7, endCol: 7 },
          targetEntityDefinitionId: "metrics",
          headerAxes: ["row", "column"],
          segmentsByAxis: {
            row: [
              { kind: "field", positionCount: 3, skipped: [true, false, false] },
              {
                kind: "pivot",
                id: "pivot-1",
                axisName: "quarter",
                axisNameSource: "user",
                positionCount: 4,
              } as Segment,
            ],
            column: [
              { kind: "field", positionCount: 3, skipped: [true, false, false] },
              {
                kind: "pivot",
                id: "pivot-2",
                axisName: "company",
                axisNameSource: "user",
                positionCount: 4,
              } as Segment,
            ],
          },
          cellValueField: { name: "value", nameSource: "user" },
        },
      ],
    };
    const catalog = [
      { id: "col-hq", label: "HQ", normalizedKey: "hq" },
      { id: "col-industry", label: "Industry", normalizedKey: "industry" },
      { id: "col-scope", label: "Scope", normalizedKey: "scope" },
      { id: "col-currency", label: "Currency", normalizedKey: "currency" },
    ];
    let state = detectRegions(createInitialState(input));
    state = detectHeaders(state);
    state = detectIdentity(state);
    state = detectSegments(state);
    state = await classifyFieldSegments(state, {
      columnDefinitionCatalog: catalog,
    });
    state = await recommendSegmentAxisNames(state, {});
    state = proposeBindings(state);
    const region = state.detectedRegions[0];

    const byColDefId = new Map(
      region.columnBindings.map((b) => [b.columnDefinitionId, b])
    );

    // Cell-derived headers use byHeaderName, but the AXIS must reflect
    // where the field lives — that's the regression.
    const hq = byColDefId.get("col-hq");
    expect(hq).toBeDefined();
    expect(hq?.sourceLocator.axis).toBe("row");
    const industry = byColDefId.get("col-industry");
    expect(industry?.sourceLocator.axis).toBe("row");

    const scope = byColDefId.get("col-scope");
    expect(scope).toBeDefined();
    expect(scope?.sourceLocator.axis).toBe("column");
    const currency = byColDefId.get("col-currency");
    expect(currency?.sourceLocator.axis).toBe("column");
  });

  // Multiple pivot segments per axis: each pivot's axisName + each
  // intersection's cellValueField round-trips through classify-logical-fields
  // and lands on its own slot. Verifies the K × L intersection model holds
  // through the classification stages.
  it("threads classifications onto every pivot segment + every intersection cellValueField on a multi-pivot crosstab", async () => {
    const input: InterpretInput = {
      workbook: {
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
      },
      regionHints: [
        {
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
              } as Segment,
            ],
            column: [
              { kind: "skip", positionCount: 1 },
              {
                kind: "pivot",
                id: "cp-company",
                axisName: "company",
                axisNameSource: "user",
                positionCount: 3,
              } as Segment,
              {
                kind: "pivot",
                id: "cp-special",
                axisName: "special",
                axisNameSource: "user",
                positionCount: 1,
              } as Segment,
            ],
          },
          cellValueField: { name: "value", nameSource: "user" },
          intersectionCellValueFields: {
            "rp-quarter__cp-company": { name: "revenue", nameSource: "user" },
            "rp-quarter__cp-special": { name: "headcount", nameSource: "user" },
          },
        },
      ],
    };
    const catalog = [
      { id: "col-quarter", label: "Quarter", normalizedKey: "quarter" },
      { id: "col-company", label: "Company", normalizedKey: "company" },
      { id: "col-special", label: "Special", normalizedKey: "special" },
      { id: "col-revenue", label: "Revenue", normalizedKey: "revenue" },
      { id: "col-headcount", label: "Headcount", normalizedKey: "headcount" },
    ];
    let state = detectRegions(createInitialState(input));
    state = detectHeaders(state);
    state = detectIdentity(state);
    state = detectSegments(state);
    state = await classifyFieldSegments(state, {
      columnDefinitionCatalog: catalog,
    });
    state = await recommendSegmentAxisNames(state, {});
    state = proposeBindings(state);
    state = await classifyLogicalFields(state, {
      columnDefinitionCatalog: catalog,
    });
    const region = state.detectedRegions[0];

    // Each pivot segment carries its classifier-resolved columnDefinitionId.
    const rowPivot = region.segmentsByAxis?.row?.find(
      (s): s is Extract<Segment, { kind: "pivot" }> => s.kind === "pivot"
    );
    const colPivots = (region.segmentsByAxis?.column ?? []).filter(
      (s): s is Extract<Segment, { kind: "pivot" }> => s.kind === "pivot"
    );
    expect(rowPivot?.columnDefinitionId).toBe("col-quarter");
    expect(colPivots).toHaveLength(2);
    expect(colPivots[0].columnDefinitionId).toBe("col-company");
    expect(colPivots[1].columnDefinitionId).toBe("col-special");

    // Each intersection's cellValueField gets its own classification.
    expect(
      region.intersectionCellValueFields?.["rp-quarter__cp-company"]
        ?.columnDefinitionId
    ).toBe("col-revenue");
    expect(
      region.intersectionCellValueFields?.["rp-quarter__cp-special"]
        ?.columnDefinitionId
    ).toBe("col-headcount");
  });
});
