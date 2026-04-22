import { describe, it, expect, jest } from "@jest/globals";

import type { InterpretInput } from "../../../plan/index.js";
import { createInitialState } from "../../state.js";
import { detectRegions } from "../detect-regions.js";
import { detectHeaders } from "../detect-headers.js";
import { recommendRecordsAxisName } from "../recommend-records-axis-name.js";
import type { AxisNameRecommenderFn } from "../../types.js";

function pivotedNoNameInput(): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Sheet1",
          dimensions: { rows: 5, cols: 5 },
          cells: [
            { row: 1, col: 1, value: "" },
            { row: 1, col: 2, value: "Jan" },
            { row: 1, col: 3, value: "Feb" },
            { row: 1, col: 4, value: "Mar" },
            { row: 1, col: 5, value: "Apr" },
            { row: 2, col: 1, value: "Revenue" },
            { row: 3, col: 1, value: "Cost" },
            { row: 4, col: 1, value: "Profit" },
          ],
        },
      ],
    },
    regionHints: [
      {
        sheet: "Sheet1",
        bounds: { startRow: 1, startCol: 1, endRow: 4, endCol: 5 },
        targetEntityDefinitionId: "monthly",
        orientation: "columns-as-records",
        headerAxis: "row",
      },
    ],
  };
}

describe("recommendRecordsAxisName", () => {
  it("invokes the injected recommender only for pivoted regions with no user-supplied recordsAxisName", async () => {
    const recommender: jest.MockedFunction<AxisNameRecommenderFn> = jest.fn(
      async () => ({
        name: "Month",
        confidence: 0.8,
      })
    );
    let state = detectRegions(createInitialState(pivotedNoNameInput()));
    state = detectHeaders(state);
    state = await recommendRecordsAxisName(state, {
      axisNameRecommender: recommender,
    });
    const regionId = state.detectedRegions[0].id;
    expect(recommender).toHaveBeenCalledTimes(1);
    expect(state.recordsAxisNameSuggestions.get(regionId)).toEqual({
      name: "Month",
      confidence: 0.8,
    });
  });

  it("forwards the axis labels to the recommender (bounded sample)", async () => {
    const recommender: jest.MockedFunction<AxisNameRecommenderFn> = jest.fn(
      async () => null
    );
    let state = detectRegions(createInitialState(pivotedNoNameInput()));
    state = detectHeaders(state);
    await recommendRecordsAxisName(state, { axisNameRecommender: recommender });
    const [labels] = recommender.mock.calls[0] ?? [[]];
    expect(labels).toEqual(["Jan", "Feb", "Mar", "Apr"]);
  });

  it("skips invocation when the region is not pivoted (rows-as-records + headerAxis 'row')", async () => {
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 2, cols: 2 },
            cells: [
              { row: 1, col: 1, value: "a" },
              { row: 1, col: 2, value: "b" },
              { row: 2, col: 1, value: "1" },
              { row: 2, col: 2, value: "2" },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 2 },
          targetEntityDefinitionId: "x",
          orientation: "rows-as-records",
          headerAxis: "row",
        },
      ],
    };
    const recommender = jest.fn(async () => null);
    let state = detectRegions(createInitialState(input));
    state = detectHeaders(state);
    state = await recommendRecordsAxisName(state, {
      axisNameRecommender: recommender,
    });
    expect(recommender).not.toHaveBeenCalled();
    const regionId = state.detectedRegions[0].id;
    expect(state.recordsAxisNameSuggestions.get(regionId)).toBeUndefined();
  });

  it("skips invocation when the user already supplied a recordsAxisName via hint", async () => {
    const input = pivotedNoNameInput();
    input.regionHints![0].recordsAxisName = "Month";
    const recommender = jest.fn(async () => null);
    let state = detectRegions(createInitialState(input));
    state = detectHeaders(state);
    await recommendRecordsAxisName(state, { axisNameRecommender: recommender });
    expect(recommender).not.toHaveBeenCalled();
  });

  it("reads records-axis labels from headerAxis direction, not from detect-headers (pivoted cols-as-records + row)", async () => {
    // detect-headers now scans the field-names axis for pivoted regions —
    // the recommender must still get the records-axis labels (Q1..Q4) from
    // the `headerAxis` line, excluding the anchor cell "metric".
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 5, cols: 5 },
            cells: [
              { row: 1, col: 1, value: "metric" },
              { row: 1, col: 2, value: "Q1" },
              { row: 1, col: 3, value: "Q2" },
              { row: 1, col: 4, value: "Q3" },
              { row: 1, col: 5, value: "Q4" },
              { row: 2, col: 1, value: "revenue" },
              { row: 3, col: 1, value: "cost" },
              { row: 4, col: 1, value: "profit" },
              { row: 5, col: 1, value: "headcount" },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 5, endCol: 5 },
          targetEntityDefinitionId: "metrics",
          orientation: "columns-as-records",
          headerAxis: "row",
        },
      ],
    };
    const recommender: jest.MockedFunction<AxisNameRecommenderFn> = jest.fn(
      async () => ({ name: "Quarter", confidence: 0.9 })
    );
    let state = detectRegions(createInitialState(input));
    state = detectHeaders(state);
    state = await recommendRecordsAxisName(state, {
      axisNameRecommender: recommender,
    });
    expect(recommender).toHaveBeenCalledTimes(1);
    const [labels] = recommender.mock.calls[0];
    expect(labels).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    const regionId = state.detectedRegions[0].id;
    expect(state.recordsAxisNameSuggestions.get(regionId)).toEqual({
      name: "Quarter",
      confidence: 0.9,
    });
  });

  it("fans out across pivoted regions concurrently, bounded by the concurrency cap", async () => {
    // Three pivoted regions, each requiring a recommender call.
    const input: InterpretInput = {
      workbook: {
        sheets: ["A", "B", "C"].map((name) => ({
          name,
          dimensions: { rows: 4, cols: 5 },
          cells: [
            { row: 1, col: 1, value: "" },
            { row: 1, col: 2, value: "Jan" },
            { row: 1, col: 3, value: "Feb" },
            { row: 1, col: 4, value: "Mar" },
            { row: 1, col: 5, value: "Apr" },
            { row: 2, col: 1, value: "Revenue" },
            { row: 3, col: 1, value: "Cost" },
            { row: 4, col: 1, value: "Profit" },
          ],
        })),
      },
      regionHints: ["A", "B", "C"].map((sheet) => ({
        sheet,
        bounds: { startRow: 1, startCol: 1, endRow: 4, endCol: 5 },
        targetEntityDefinitionId: `ent-${sheet}`,
        orientation: "columns-as-records",
        headerAxis: "row",
      })),
    };

    let active = 0;
    let peak = 0;
    const recommender: jest.MockedFunction<AxisNameRecommenderFn> = jest.fn(
      async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
        return { name: "Month", confidence: 0.8 };
      }
    );

    let state = detectRegions(createInitialState(input));
    state = detectHeaders(state);
    state = await recommendRecordsAxisName(state, {
      axisNameRecommender: recommender,
      concurrency: 3,
    });
    expect(recommender).toHaveBeenCalledTimes(3);
    expect(peak).toBeGreaterThanOrEqual(2);
    expect(peak).toBeLessThanOrEqual(3);
    for (const region of state.detectedRegions) {
      expect(state.recordsAxisNameSuggestions.get(region.id)).toEqual({
        name: "Month",
        confidence: 0.8,
      });
    }
  });

  it("the default recommender returns null (no AI in Phase 3)", async () => {
    let state = detectRegions(createInitialState(pivotedNoNameInput()));
    state = detectHeaders(state);
    state = await recommendRecordsAxisName(state, {});
    const regionId = state.detectedRegions[0].id;
    expect(state.recordsAxisNameSuggestions.get(regionId)).toBeUndefined();
  });
});
