import { describe, it, expect } from "@jest/globals";

import type { InterpretInput } from "../../../plan/index.js";
import { createInitialState } from "../../state.js";
import { detectRegions } from "../detect-regions.js";

function makeInput(
  regionHints?: InterpretInput["regionHints"]
): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Sheet1",
          dimensions: { rows: 3, cols: 3 },
          cells: [
            { row: 1, col: 1, value: "name" },
            { row: 1, col: 2, value: "age" },
            { row: 2, col: 1, value: "alice" },
            { row: 2, col: 2, value: 30 },
            { row: 3, col: 1, value: "bob" },
            { row: 3, col: 2, value: 25 },
          ],
        },
      ],
    },
    regionHints,
  };
}

describe("detectRegions", () => {
  it("seeds one detected region per hint when hints are supplied", () => {
    const input = makeInput([
      {
        sheet: "Sheet1",
        bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 2 },
        targetEntityDefinitionId: "contacts",
        headerAxes: ["row"],
      },
    ]);
    const state = detectRegions(createInitialState(input));
    expect(state.detectedRegions).toHaveLength(1);
    const region = state.detectedRegions[0];
    expect(region.sheet).toBe("Sheet1");
    expect(region.targetEntityDefinitionId).toBe("contacts");
    expect(region.headerAxes).toEqual(["row"]);
    expect(region.bounds).toEqual({
      startRow: 1,
      startCol: 1,
      endRow: 3,
      endCol: 2,
    });
    expect(region.id).toMatch(/.+/);
  });

  it("produces N regions for N hints, each with a distinct id", () => {
    const input = makeInput([
      {
        sheet: "Sheet1",
        bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 2 },
        targetEntityDefinitionId: "a",
        headerAxes: ["row"],
      },
      {
        sheet: "Sheet1",
        bounds: { startRow: 1, startCol: 3, endRow: 3, endCol: 3 },
        targetEntityDefinitionId: "b",
        headerAxes: ["row"],
      },
    ]);
    const state = detectRegions(createInitialState(input));
    expect(state.detectedRegions).toHaveLength(2);
    const ids = new Set(state.detectedRegions.map((r) => r.id));
    expect(ids.size).toBe(2);
  });

  it("forwards segmentsByAxis / cellValueField / axisAnchorCell from hints", () => {
    const input = makeInput([
      {
        sheet: "Sheet1",
        bounds: { startRow: 1, startCol: 1, endRow: 5, endCol: 5 },
        targetEntityDefinitionId: "crosstab",
        headerAxes: ["row", "column"],
        segmentsByAxis: {
          row: [
            { kind: "skip", positionCount: 1 },
            {
              kind: "pivot",
              id: "region",
              axisName: "Region",
              axisNameSource: "user",
              positionCount: 4,
            },
          ],
          column: [
            { kind: "skip", positionCount: 1 },
            {
              kind: "pivot",
              id: "quarter",
              axisName: "Quarter",
              axisNameSource: "user",
              positionCount: 4,
            },
          ],
        },
        cellValueField: { name: "Revenue", nameSource: "user" },
        axisAnchorCell: { row: 1, col: 1 },
      },
    ]);
    const state = detectRegions(createInitialState(input));
    const region = state.detectedRegions[0];
    expect(region.segmentsByAxis?.row?.[1]).toMatchObject({
      kind: "pivot",
      axisName: "Region",
    });
    expect(region.segmentsByAxis?.column?.[1]).toMatchObject({
      kind: "pivot",
      axisName: "Quarter",
    });
    expect(region.cellValueField).toEqual({
      name: "Revenue",
      nameSource: "user",
    });
    expect(region.axisAnchorCell).toEqual({ row: 1, col: 1 });
  });

  it("throws UNSUPPORTED_LAYOUT_SHAPE when no hints are supplied", () => {
    const input = makeInput(undefined);
    expect(() => detectRegions(createInitialState(input))).toThrow(
      /UNSUPPORTED_LAYOUT_SHAPE/
    );
  });

  it("throws UNSUPPORTED_LAYOUT_SHAPE when hints is an empty array", () => {
    const input = makeInput([]);
    expect(() => detectRegions(createInitialState(input))).toThrow(
      /UNSUPPORTED_LAYOUT_SHAPE/
    );
  });

  it("throws if a hint references a sheet not present in the workbook", () => {
    const input = makeInput([
      {
        sheet: "Ghost",
        bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 2 },
        targetEntityDefinitionId: "x",
        headerAxes: ["row"],
      },
    ]);
    expect(() => detectRegions(createInitialState(input))).toThrow(/Ghost/i);
  });
});
