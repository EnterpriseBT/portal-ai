import { describe, it, expect } from "@jest/globals";

import type { InterpretInput } from "../../../plan/index.js";
import { createInitialState } from "../../state.js";
import { detectRegions } from "../detect-regions.js";
import { detectHeaders } from "../detect-headers.js";
import { detectIdentity } from "../detect-identity.js";
import { classifyColumns } from "../classify-columns.js";
import { recommendRecordsAxisName } from "../recommend-records-axis-name.js";
import { proposeBindings } from "../propose-bindings.js";
import { scoreAndWarn } from "../score-and-warn.js";

async function run(input: InterpretInput) {
  let state = detectRegions(createInitialState(input));
  state = detectHeaders(state);
  state = detectIdentity(state);
  state = await classifyColumns(state, {});
  state = await recommendRecordsAxisName(state, {});
  state = proposeBindings(state);
  return scoreAndWarn(state);
}

function wellFormed(): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Sheet1",
          dimensions: { rows: 3, cols: 2 },
          cells: [
            { row: 1, col: 1, value: "id" },
            { row: 1, col: 2, value: "name" },
            { row: 2, col: 1, value: "a-1" },
            { row: 2, col: 2, value: "alice" },
            { row: 3, col: 1, value: "a-2" },
            { row: 3, col: 2, value: "bob" },
          ],
        },
      ],
    },
    regionHints: [
      {
        sheet: "Sheet1",
        bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 2 },
        targetEntityDefinitionId: "contacts",
        orientation: "rows-as-records",
        headerAxis: "row",
      },
    ],
  };
}

describe("scoreAndWarn", () => {
  it("emits ROW_POSITION_IDENTITY at 'warn' when the region's identity falls back to rowPosition", async () => {
    // A sheet where no column is unique and no composite is unique either.
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 4, cols: 2 },
            cells: [
              { row: 1, col: 1, value: "team" },
              { row: 1, col: 2, value: "member" },
              { row: 2, col: 1, value: "a" },
              { row: 2, col: 2, value: "alice" },
              { row: 3, col: 1, value: "a" },
              { row: 3, col: 2, value: "alice" },
              { row: 4, col: 1, value: "b" },
              { row: 4, col: 2, value: "bob" },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 4, endCol: 2 },
          targetEntityDefinitionId: "team-members",
          orientation: "rows-as-records",
          headerAxis: "row",
        },
      ],
    };
    const state = await run(input);
    const region = state.detectedRegions[0];
    const warn = region.warnings.find(
      (w) => w.code === "ROW_POSITION_IDENTITY"
    );
    expect(warn).toBeDefined();
    expect(warn?.severity).toBe("warn");
  });

  it("emits PIVOTED_REGION_MISSING_AXIS_NAME as a blocker when a pivoted region has no axis name", async () => {
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
    const state = await run(input);
    const region = state.detectedRegions[0];
    const warn = region.warnings.find(
      (w) => w.code === "PIVOTED_REGION_MISSING_AXIS_NAME"
    );
    expect(warn).toBeDefined();
    expect(warn?.severity).toBe("blocker");
  });

  it("emits UNRECOGNIZED_COLUMN for each unmatched classification", async () => {
    const input = wellFormed();
    const state = await run(input);
    const region = state.detectedRegions[0];
    // "id" and "name" are classified with null columnDefinitionId because no catalog was supplied.
    const unrecognized = region.warnings.filter(
      (w) => w.code === "UNRECOGNIZED_COLUMN"
    );
    expect(unrecognized.length).toBeGreaterThanOrEqual(1);
  });

  it("populates region.confidence with aggregate ≤ 1 and region ≤ 1", async () => {
    const state = await run(wellFormed());
    const region = state.detectedRegions[0];
    expect(region.confidence.region).toBeGreaterThanOrEqual(0);
    expect(region.confidence.region).toBeLessThanOrEqual(1);
    expect(region.confidence.aggregate).toBeGreaterThanOrEqual(0);
    expect(region.confidence.aggregate).toBeLessThanOrEqual(1);
  });

  it("does not emit ROW_POSITION_IDENTITY for regions with a column identity", async () => {
    const state = await run(wellFormed());
    const region = state.detectedRegions[0];
    const warn = region.warnings.find(
      (w) => w.code === "ROW_POSITION_IDENTITY"
    );
    expect(warn).toBeUndefined();
  });
});
