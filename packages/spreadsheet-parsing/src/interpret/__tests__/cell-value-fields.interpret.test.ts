import { describe, it, expect } from "@jest/globals";

import type { InterpretInput, RegionHint } from "../../plan/index.js";
import { interpret } from "../index.js";

// #998: interpret copies a hint's cell-value fields onto the region as
// given, but keeps the hint's segments only when the user authored them.
// When the two disagreed, the final plan parse threw and the route
// answered 500. Each case here is a hint the request schema accepts.
function contacts(hint: Partial<RegionHint>): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Contacts",
          dimensions: { rows: 4, cols: 3 },
          cells: [
            { row: 1, col: 1, value: "email" },
            { row: 1, col: 2, value: "name" },
            { row: 1, col: 3, value: "team" },
            { row: 2, col: 1, value: "a@x.com" },
            { row: 2, col: 2, value: "alice" },
            { row: 2, col: 3, value: "core" },
            { row: 3, col: 1, value: "b@x.com" },
            { row: 3, col: 2, value: "bob" },
            { row: 3, col: 3, value: "web" },
            { row: 4, col: 1, value: "c@x.com" },
            { row: 4, col: 2, value: "carol" },
            { row: 4, col: 3, value: "ops" },
          ],
        },
      ],
    },
    regionHints: [
      {
        sheet: "Contacts",
        bounds: { startRow: 1, startCol: 1, endRow: 4, endCol: 3 },
        targetEntityDefinitionId: "contacts",
        headerAxes: ["row"],
        ...hint,
      },
    ],
  };
}

const AI_PIVOT = {
  kind: "pivot" as const,
  id: "p1",
  axisName: "team",
  axisNameSource: "ai" as const,
  positionCount: 1,
};

describe("interpret — cell-value fields follow the segments it settles on (#998)", () => {
  it("drops a hint's cellValueField when its AI-named pivot isn't detected", async () => {
    const plan = await interpret(
      contacts({
        segmentsByAxis: {
          row: [{ kind: "field", positionCount: 2 }, AI_PIVOT],
        },
        cellValueField: { name: "value", nameSource: "user" },
      })
    );
    const region = plan.regions[0];
    expect(region.segmentsByAxis?.row?.some((s) => s.kind === "pivot")).toBe(
      false
    );
    expect(region.cellValueField).toBeUndefined();
  });

  it("gives a user-named pivot a cellValueField when the hint has none", async () => {
    const plan = await interpret(
      contacts({
        segmentsByAxis: {
          row: [
            { kind: "field", positionCount: 2 },
            { ...AI_PIVOT, axisNameSource: "user" },
          ],
        },
      })
    );
    const region = plan.regions[0];
    expect(region.segmentsByAxis?.row?.at(-1)).toMatchObject({
      kind: "pivot",
      axisNameSource: "user",
    });
    expect(region.cellValueField).toEqual({ name: "value", nameSource: "ai" });
  });

  it("drops a cellValueField from a hint with no segments when no pivot is detected", async () => {
    const plan = await interpret(
      contacts({ cellValueField: { name: "value", nameSource: "user" } })
    );
    expect(plan.regions[0].cellValueField).toBeUndefined();
  });

  it("drops intersection fields on a region with one header axis", async () => {
    const plan = await interpret(
      contacts({
        segmentsByAxis: {
          row: [
            { kind: "field", positionCount: 2 },
            { ...AI_PIVOT, axisNameSource: "user" },
          ],
        },
        cellValueField: { name: "value", nameSource: "user" },
        intersectionCellValueFields: {
          p1__c1: { name: "stale", nameSource: "user" },
        },
      })
    );
    expect(plan.regions[0].intersectionCellValueFields).toBeUndefined();
    expect(plan.regions[0].cellValueField).toEqual({
      name: "value",
      nameSource: "user",
    });
  });
});
