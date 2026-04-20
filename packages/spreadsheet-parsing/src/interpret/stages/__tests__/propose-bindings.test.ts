import { describe, it, expect } from "@jest/globals";

import type { InterpretInput } from "../../../plan/index.js";
import { RegionSchema } from "../../../plan/index.js";
import { createInitialState } from "../../state.js";
import { detectRegions } from "../detect-regions.js";
import { detectHeaders } from "../detect-headers.js";
import { detectIdentity } from "../detect-identity.js";
import { classifyColumns } from "../classify-columns.js";
import { recommendRecordsAxisName } from "../recommend-records-axis-name.js";
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
        orientation: "rows-as-records",
        headerAxis: "row",
      },
    ],
  };
}

async function runThrough(input: InterpretInput) {
  let state = detectRegions(createInitialState(input));
  state = detectHeaders(state);
  state = detectIdentity(state);
  state = await classifyColumns(state, {
    columnDefinitionCatalog: [
      { id: "col-email", label: "Email", normalizedKey: "email" },
      { id: "col-name", label: "Name", normalizedKey: "name" },
    ],
  });
  state = await recommendRecordsAxisName(state, {});
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
  });

  it("omits bindings that have no classified columnDefinitionId", async () => {
    const state = await runThrough(simpleInput());
    const region = state.detectedRegions[0];
    const hasAgeBinding = region.columnBindings.some(
      (b) =>
        b.sourceLocator.kind === "byHeaderName" &&
        b.sourceLocator.name === "age"
    );
    // `age` has no catalog match — should not become a ColumnBinding.
    expect(hasAgeBinding).toBe(false);
  });

  it("applies the user-supplied recordsAxisName (from hint) with source 'user' on pivoted regions", async () => {
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
              { row: 2, col: 1, value: "Revenue" },
              { row: 3, col: 1, value: "Cost" },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 3 },
          targetEntityDefinitionId: "monthly",
          orientation: "columns-as-records",
          headerAxis: "row",
          recordsAxisName: "Month",
        },
      ],
    };
    const state = await runThrough(input);
    const region = state.detectedRegions[0];
    expect(region.recordsAxisName).toEqual({ name: "Month", source: "user" });
  });

  it("applies AI-recommended axis names with source 'ai' and the suggestion's confidence", async () => {
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 3, cols: 3 },
            cells: [
              { row: 1, col: 1, value: "" },
              { row: 1, col: 2, value: "Jan" },
              { row: 1, col: 3, value: "Feb" },
              { row: 2, col: 1, value: "Revenue" },
              { row: 3, col: 1, value: "Cost" },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 3 },
          targetEntityDefinitionId: "monthly",
          orientation: "columns-as-records",
          headerAxis: "row",
        },
      ],
    };
    let state = detectRegions(createInitialState(input));
    state = detectHeaders(state);
    state = detectIdentity(state);
    state = await classifyColumns(state, {});
    state = await recommendRecordsAxisName(state, {
      axisNameRecommender: () => ({ name: "Month", confidence: 0.8 }),
    });
    state = proposeBindings(state);
    const region = state.detectedRegions[0];
    expect(region.recordsAxisName).toEqual({
      name: "Month",
      source: "ai",
      confidence: 0.8,
    });
  });

  it("picks the top-scored header strategy as the region's headerStrategy", async () => {
    const state = await runThrough(simpleInput());
    const region = state.detectedRegions[0];
    expect(region.headerStrategy).toBeDefined();
    expect(region.headerStrategy!.kind).toBe("row");
  });

  it("picks the top-scored identity strategy as the region's identityStrategy", async () => {
    const state = await runThrough(simpleInput());
    const region = state.detectedRegions[0];
    expect(region.identityStrategy.kind).toMatch(
      /column|composite|rowPosition/
    );
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
