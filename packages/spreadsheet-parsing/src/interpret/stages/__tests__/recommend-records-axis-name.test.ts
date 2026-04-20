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

  it("the default recommender returns null (no AI in Phase 3)", async () => {
    let state = detectRegions(createInitialState(pivotedNoNameInput()));
    state = detectHeaders(state);
    state = await recommendRecordsAxisName(state, {});
    const regionId = state.detectedRegions[0].id;
    expect(state.recordsAxisNameSuggestions.get(regionId)).toBeUndefined();
  });
});
