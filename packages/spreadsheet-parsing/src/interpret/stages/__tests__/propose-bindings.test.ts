import { describe, it, expect } from "@jest/globals";

import type { InterpretInput, Segment } from "../../../plan/index.js";
import { RegionSchema } from "../../../plan/index.js";
import { createInitialState } from "../../state.js";
import { detectRegions } from "../detect-regions.js";
import { detectHeaders } from "../detect-headers.js";
import { detectIdentity } from "../detect-identity.js";
import { detectSegments } from "../detect-segments.js";
import { classifyFieldSegments } from "../classify-field-segments.js";
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
});
