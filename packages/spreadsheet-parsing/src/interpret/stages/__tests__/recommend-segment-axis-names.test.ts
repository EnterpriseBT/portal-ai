import { describe, it, expect, jest } from "@jest/globals";

import type { InterpretInput } from "../../../plan/index.js";
import { createInitialState } from "../../state.js";
import type { InterpretState } from "../../types.js";
import { detectHeaders } from "../detect-headers.js";
import { detectIdentity } from "../detect-identity.js";
import { detectRegions } from "../detect-regions.js";
import { detectSegments } from "../detect-segments.js";
import { recommendSegmentAxisNames } from "../recommend-segment-axis-names.js";
import type { AxisNameRecommenderFn } from "../../types.js";

function prepare(input: InterpretInput): InterpretState {
  let state = createInitialState(input);
  state = detectRegions(state);
  state = detectHeaders(state);
  state = detectIdentity(state);
  state = detectSegments(state);
  return state;
}

/**
 * Canonical 1e input (statics + 2 pivots on the row axis). detect-segments
 * produces `row: [field(2), pivot(quarter, 3), pivot(month, 3)]` with
 * ai-sourced axis names — both pivots are recommender-eligible.
 */
function canonicalInput(): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Sheet1",
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
    },
    regionHints: [
      {
        sheet: "Sheet1",
        bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 8 },
        targetEntityDefinitionId: "companies",
        headerAxes: ["row"],
      },
    ],
  };
}

describe("recommendSegmentAxisNames", () => {
  it("invokes the recommender once per pivot segment with that segment's labels", async () => {
    const calls: string[][] = [];
    const recommender: jest.MockedFunction<AxisNameRecommenderFn> = jest.fn(
      async (labels) => {
        calls.push(labels);
        return {
          name: labels[0].startsWith("Q") ? "fiscalQuarter" : "month",
          confidence: 0.9,
        };
      }
    );
    const prepared = prepare(canonicalInput());
    await recommendSegmentAxisNames(prepared, {
      axisNameRecommender: recommender,
    });
    expect(recommender).toHaveBeenCalledTimes(2);
    // Each call should carry only its segment's labels (not the full axis).
    const sorted = calls.map((c) => c.join(",")).sort();
    expect(sorted).toEqual(["Jan,Feb,Mar", "Q1,Q2,Q3"]);
  });

  it("writes results into state.segmentAxisNameSuggestions keyed by segmentId", async () => {
    const recommender: jest.MockedFunction<AxisNameRecommenderFn> = jest.fn(
      async (labels) => ({
        name: labels[0].startsWith("Q") ? "fiscalQuarter" : "calendarMonth",
        confidence: 0.9,
      })
    );
    const prepared = prepare(canonicalInput());
    const state = await recommendSegmentAxisNames(prepared, {
      axisNameRecommender: recommender,
    });
    // detect-segments uses the ID scheme `segment_${tag}_${axis}`.
    expect(state.segmentAxisNameSuggestions.get("segment_quarter_row")).toEqual(
      { name: "fiscalQuarter", confidence: 0.9 }
    );
    expect(state.segmentAxisNameSuggestions.get("segment_month_row")).toEqual({
      name: "calendarMonth",
      confidence: 0.9,
    });
  });

  it("skips segments whose axisNameSource === 'user'", async () => {
    // Hint-pinned user pivot — detect-segments's output is ignored by
    // proposeBindings but recommend-segment-axis-names reads state.segmentsByRegion
    // (heuristic). To exercise the user-source skip, we mutate the heuristic
    // entry before calling the stage.
    const prepared = prepare(canonicalInput());
    const regionId = prepared.detectedRegions[0].id;
    const segs = prepared.segmentsByRegion.get(regionId)!;
    // Flip the quarter pivot's source to "user" so recommender skips it.
    const row = segs.row!;
    prepared.segmentsByRegion.set(regionId, {
      row: row.map((s) =>
        s.kind === "pivot" && s.id === "segment_quarter_row"
          ? { ...s, axisNameSource: "user" as const }
          : s
      ),
    });

    const recommender: jest.MockedFunction<AxisNameRecommenderFn> = jest.fn(
      async () => ({ name: "x", confidence: 1 })
    );
    await recommendSegmentAxisNames(prepared, {
      axisNameRecommender: recommender,
    });
    // Only the month pivot should fire; quarter is user-sourced.
    expect(recommender).toHaveBeenCalledTimes(1);
    const [labels] = recommender.mock.calls[0]!;
    expect(labels).toEqual(["Jan", "Feb", "Mar"]);
  });

  it("is a no-op for statics-only plans (no pivot segments)", async () => {
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 2, cols: 3 },
            cells: [
              { row: 1, col: 1, value: "email" },
              { row: 1, col: 2, value: "name" },
              { row: 1, col: 3, value: "age" },
              { row: 2, col: 1, value: "a@x.com" },
              { row: 2, col: 2, value: "alice" },
              { row: 2, col: 3, value: 30 },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 3 },
          targetEntityDefinitionId: "contacts",
          headerAxes: ["row"],
        },
      ],
    };
    const recommender: jest.MockedFunction<AxisNameRecommenderFn> = jest.fn();
    const prepared = prepare(input);
    const state = await recommendSegmentAxisNames(prepared, {
      axisNameRecommender: recommender,
    });
    expect(recommender).not.toHaveBeenCalled();
    expect(state.segmentAxisNameSuggestions.size).toBe(0);
  });

  it("fires once per axis on a 2D region (one segment per axis)", async () => {
    // crosstab-sales-leads layout: each axis carries field(1) + pivot.
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 5, cols: 5 },
            cells: [
              { row: 1, col: 1, value: "Sales" },
              { row: 1, col: 2, value: "Jan" },
              { row: 1, col: 3, value: "Feb" },
              { row: 1, col: 4, value: "Mar" },
              { row: 1, col: 5, value: "Apr" },
              { row: 2, col: 1, value: "Q1" },
              { row: 3, col: 1, value: "Q2" },
              { row: 4, col: 1, value: "Q3" },
              { row: 5, col: 1, value: "Q4" },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 5, endCol: 5 },
          targetEntityDefinitionId: "sales",
          headerAxes: ["row", "column"],
          axisAnchorCell: { row: 1, col: 1 },
        },
      ],
    };
    const recommender: jest.MockedFunction<AxisNameRecommenderFn> = jest.fn(
      async () => ({ name: "x", confidence: 1 })
    );
    const prepared = prepare(input);
    await recommendSegmentAxisNames(prepared, {
      axisNameRecommender: recommender,
    });
    expect(recommender).toHaveBeenCalledTimes(2);
  });

  it("fans out across pivoted regions concurrently, bounded by the concurrency cap", async () => {
    const input: InterpretInput = {
      workbook: {
        sheets: ["A", "B", "C"].map((name) => ({
          name,
          dimensions: { rows: 2, cols: 4 },
          cells: [
            { row: 1, col: 1, value: "name" },
            { row: 1, col: 2, value: "Q1" },
            { row: 1, col: 3, value: "Q2" },
            { row: 1, col: 4, value: "Q3" },
            { row: 2, col: 1, value: "Apple" },
            { row: 2, col: 2, value: 10 },
            { row: 2, col: 3, value: 20 },
            { row: 2, col: 4, value: 30 },
          ],
        })),
      },
      regionHints: ["A", "B", "C"].map((sheet) => ({
        sheet,
        bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 4 },
        targetEntityDefinitionId: `ent-${sheet}`,
        headerAxes: ["row" as const],
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
        return { name: "Quarter", confidence: 0.8 };
      }
    );

    const prepared = prepare(input);
    const state = await recommendSegmentAxisNames(prepared, {
      axisNameRecommender: recommender,
      concurrency: 3,
    });
    expect(recommender).toHaveBeenCalledTimes(3);
    expect(peak).toBeGreaterThanOrEqual(2);
    expect(peak).toBeLessThanOrEqual(3);
    expect(state.segmentAxisNameSuggestions.get("segment_quarter_row")).toEqual(
      { name: "Quarter", confidence: 0.8 }
    );
  });

  it("the default recommender (absent) produces no suggestions", async () => {
    const prepared = prepare(canonicalInput());
    const state = await recommendSegmentAxisNames(prepared, {});
    expect(state.segmentAxisNameSuggestions.size).toBe(0);
  });
});
