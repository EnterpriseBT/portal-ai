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
        },
      ],
    },
    regionHints: [
      {
        sheet: "Sheet1",
        bounds: { startRow: 1, startCol: 1, endRow: 4, endCol: 5 },
        targetEntityDefinitionId: "monthly",
        headerAxes: ["row"],
        segmentsByAxis: {
          row: [
            { kind: "skip", positionCount: 1 },
            {
              kind: "pivot",
              id: "month-seg",
              axisName: "month",
              axisNameSource: "anchor-cell",
              positionCount: 4,
            },
          ],
        },
        cellValueField: { name: "revenue", nameSource: "user" },
        axisAnchorCell: { row: 1, col: 1 },
      },
    ],
  };
}

describe("recommendRecordsAxisName", () => {
  it("invokes the injected recommender only for pivot segments with no user-supplied axisName", async () => {
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
    expect(recommender).toHaveBeenCalledTimes(1);
    expect(state.segmentAxisNameSuggestions.get("month-seg")).toEqual({
      name: "Month",
      confidence: 0.8,
    });
  });

  it("forwards the axis labels to the recommender (anchor cell excluded)", async () => {
    const recommender: jest.MockedFunction<AxisNameRecommenderFn> = jest.fn(
      async () => null
    );
    let state = detectRegions(createInitialState(pivotedNoNameInput()));
    state = detectHeaders(state);
    await recommendRecordsAxisName(state, { axisNameRecommender: recommender });
    const [labels] = recommender.mock.calls[0] ?? [[]];
    expect(labels).toEqual(["Jan", "Feb", "Mar", "Apr"]);
  });

  it("skips invocation when the region has no pivot segment (tidy)", async () => {
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
          headerAxes: ["row"],
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
    expect(state.segmentAxisNameSuggestions.size).toBe(0);
  });

  it("skips invocation when the pivot segment's axisNameSource is 'user'", async () => {
    const input = pivotedNoNameInput();
    const seg = input.regionHints![0].segmentsByAxis!.row![1];
    if (seg.kind === "pivot") {
      seg.axisNameSource = "user";
      seg.axisName = "Month";
    }
    const recommender = jest.fn(async () => null);
    let state = detectRegions(createInitialState(input));
    state = detectHeaders(state);
    await recommendRecordsAxisName(state, { axisNameRecommender: recommender });
    expect(recommender).not.toHaveBeenCalled();
  });

  it("fans out across pivoted regions concurrently, bounded by the concurrency cap", async () => {
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
      regionHints: ["A", "B", "C"].map((sheet, i) => ({
        sheet,
        bounds: { startRow: 1, startCol: 1, endRow: 4, endCol: 5 },
        targetEntityDefinitionId: `ent-${sheet}`,
        headerAxes: ["row" as const],
        segmentsByAxis: {
          row: [
            { kind: "skip" as const, positionCount: 1 },
            {
              kind: "pivot" as const,
              id: `seg-${i}`,
              axisName: "month",
              axisNameSource: "anchor-cell" as const,
              positionCount: 4,
            },
          ],
        },
        cellValueField: { name: "revenue", nameSource: "user" as const },
        axisAnchorCell: { row: 1, col: 1 },
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
    for (let i = 0; i < 3; i++) {
      expect(state.segmentAxisNameSuggestions.get(`seg-${i}`)).toEqual({
        name: "Month",
        confidence: 0.8,
      });
    }
  });

  it("the default recommender (absent) produces no suggestions", async () => {
    let state = detectRegions(createInitialState(pivotedNoNameInput()));
    state = detectHeaders(state);
    state = await recommendRecordsAxisName(state, {});
    expect(state.segmentAxisNameSuggestions.size).toBe(0);
  });
});
