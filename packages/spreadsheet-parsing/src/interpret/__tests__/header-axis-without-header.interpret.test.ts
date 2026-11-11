import { describe, it, expect, jest } from "@jest/globals";

import type { InterpretInput, RegionHint } from "../../plan/index.js";
import { interpret } from "../index.js";
import type { AxisNameRecommenderFn, ClassifierFn } from "../types.js";

// #1002: a region that declares a header axis but has no row (or column)
// scoring as a header left the plan without a header strategy, and the final
// plan parse failed. The route answered a scrubbed 500.
function accounts(bounds: RegionHint["bounds"]): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Pivot",
          dimensions: { rows: 9, cols: 7 },
          cells: [
            { row: 2, col: 2, value: "Account" },
            { row: 2, col: 3, value: "Product" },
            { row: 2, col: 4, value: "2020" },
            { row: 2, col: 5, value: "2021" },
            { row: 3, col: 2, value: "Google" },
            { row: 3, col: 3, value: "Product 1" },
            { row: 3, col: 4, value: 100 },
            { row: 3, col: 5, value: 200 },
            { row: 4, col: 2, value: "Microsoft" },
            { row: 4, col: 3, value: "Product 2" },
            { row: 4, col: 4, value: 150 },
            { row: 4, col: 5, value: 250 },
            // Below the table: a blank row, a one-cell note, a blank.
            { row: 7, col: 2, value: "a note about the table" },
          ],
        },
      ],
    },
    regionHints: [
      {
        sheet: "Pivot",
        bounds,
        targetEntityDefinitionId: "accounts",
        headerAxes: ["row"],
        segmentsByAxis: {
          row: [
            {
              kind: "field",
              positionCount: bounds.endCol - bounds.startCol + 1,
            },
          ],
        },
      },
    ],
  };
}

describe("interpret — a header axis with no two-label row (#1002)", () => {
  it("interprets a one-column region with a header to a valid plan", async () => {
    const plan = await interpret(
      accounts({ startRow: 2, startCol: 2, endRow: 4, endCol: 2 })
    );
    const region = plan.regions[0];
    expect(region.headerStrategyByAxis?.row?.locator).toEqual({
      kind: "row",
      sheet: "Pivot",
      row: 2,
    });
    expect(region.segmentsByAxis?.row).toEqual([
      { kind: "field", positionCount: 1 },
    ]);
  });

  it("rejects a region with no header row as an input error, before any model call", async () => {
    const classifier = jest.fn<ClassifierFn>(() => []);
    const axisNameRecommender = jest.fn<AxisNameRecommenderFn>(() => null);
    await expect(
      interpret(accounts({ startRow: 6, startCol: 2, endRow: 8, endCol: 5 }), {
        classifier,
        axisNameRecommender,
      })
    ).rejects.toThrow(
      /^UNSUPPORTED_LAYOUT_SHAPE: region B6:E8 on "Pivot" has no header row/
    );
    expect(classifier).not.toHaveBeenCalled();
    expect(axisNameRecommender).not.toHaveBeenCalled();
  });
});
