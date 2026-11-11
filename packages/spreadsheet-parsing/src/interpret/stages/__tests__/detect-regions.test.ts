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
    // The hint covers 5×5, so the sheet must too (#1008 checks bounds).
    input.workbook.sheets[0].dimensions = { rows: 5, cols: 5 };
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

  // #1008: a hint's bounds were taken on trust. A region past the sheet got
  // a 200 with impossible bounds; an inverted one failed the final plan
  // parse as a 500 (or #1002's misleading "no header row").
  describe("bounds checked against the sheet (#1008)", () => {
    function hint(
      bounds: {
        startRow: number;
        startCol: number;
        endRow: number;
        endCol: number;
      },
      sheet = "Sheet1"
    ) {
      return {
        sheet,
        bounds,
        targetEntityDefinitionId: "contacts",
        headerAxes: ["row" as const],
      };
    }

    function wide(): InterpretInput {
      return {
        workbook: {
          sheets: [
            {
              name: "Wide",
              dimensions: { rows: 4, cols: 28 },
              cells: [{ row: 1, col: 1, value: "a" }],
            },
          ],
        },
        regionHints: [
          hint({ startRow: 1, startCol: 1, endRow: 4, endCol: 30 }, "Wide"),
        ],
      };
    }

    it("rejects a region past the sheet's last row", () => {
      expect(() =>
        detectRegions(
          createInitialState(
            makeInput([
              hint({ startRow: 2, startCol: 1, endRow: 50, endCol: 2 }),
            ])
          )
        )
      ).toThrow(
        'UNSUPPORTED_LAYOUT_SHAPE: Region A2:B50 on "Sheet1" runs past the sheet\'s last row (3). Redraw it inside the sheet.'
      );
    });

    it("rejects a region past the sheet's last column, naming its letters", () => {
      expect(() => detectRegions(createInitialState(wide()))).toThrow(
        'UNSUPPORTED_LAYOUT_SHAPE: Region A1:AD4 on "Wide" runs past the sheet\'s last column (AB). Redraw it inside the sheet.'
      );
    });

    it("rejects a region that starts after it ends, on rows and on columns", () => {
      expect(() =>
        detectRegions(
          createInitialState(
            makeInput([
              hint({ startRow: 3, startCol: 1, endRow: 1, endCol: 2 }),
            ])
          )
        )
      ).toThrow(
        'UNSUPPORTED_LAYOUT_SHAPE: Region A3:B1 on "Sheet1" starts after it ends (row 3 is below row 1). Redraw it.'
      );
      expect(() =>
        detectRegions(
          createInitialState(
            makeInput([
              hint({ startRow: 1, startCol: 3, endRow: 2, endCol: 1 }),
            ])
          )
        )
      ).toThrow(
        'UNSUPPORTED_LAYOUT_SHAPE: Region C1:A2 on "Sheet1" starts after it ends (column C is right of column A). Redraw it.'
      );
    });

    it("accepts a region ending exactly on the sheet's last row and column", () => {
      const state = detectRegions(
        createInitialState(
          makeInput([hint({ startRow: 1, startCol: 1, endRow: 3, endCol: 3 })])
        )
      );
      expect(state.detectedRegions[0].bounds).toEqual({
        startRow: 1,
        startCol: 1,
        endRow: 3,
        endCol: 3,
      });
    });

    it("names every bad region in one error, in hint order", () => {
      expect(() =>
        detectRegions(
          createInitialState(
            makeInput([
              hint({ startRow: 1, startCol: 1, endRow: 9, endCol: 2 }),
              hint({ startRow: 1, startCol: 1, endRow: 3, endCol: 2 }),
              hint({ startRow: 2, startCol: 2, endRow: 1, endCol: 2 }),
            ])
          )
        )
      ).toThrow(
        'UNSUPPORTED_LAYOUT_SHAPE: Region A1:B9 on "Sheet1" runs past the sheet\'s last row (3). Redraw it inside the sheet. ' +
          'Region B2:B1 on "Sheet1" starts after it ends (row 2 is below row 1). Redraw it.'
      );
    });

    it("still reports an unknown sheet as UNKNOWN_SHEET", () => {
      expect(() =>
        detectRegions(
          createInitialState(
            makeInput([
              hint({ startRow: 1, startCol: 1, endRow: 99, endCol: 2 }, "Nope"),
            ])
          )
        )
      ).toThrow(/^UNKNOWN_SHEET: /);
    });

    it("caps the error at 20 regions and counts the rest", () => {
      const hints = Array.from({ length: 25 }, (_, i) =>
        hint({ startRow: 1, startCol: 1, endRow: 10 + i, endCol: 2 })
      );
      let message = "";
      try {
        detectRegions(createInitialState(makeInput(hints)));
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message.match(/Region A1:B\d+/g)).toHaveLength(20);
      expect(message).toContain("Region A1:B29 on");
      expect(message).not.toContain("Region A1:B30 on");
      expect(message.endsWith(" And 5 more not shown.")).toBe(true);
    });

    it("says a region is on an empty sheet rather than naming no column", () => {
      const input: InterpretInput = {
        workbook: {
          sheets: [
            { name: "Blank", dimensions: { rows: 0, cols: 0 }, cells: [] },
          ],
        },
        regionHints: [
          hint({ startRow: 1, startCol: 1, endRow: 2, endCol: 2 }, "Blank"),
        ],
      };
      expect(() => detectRegions(createInitialState(input))).toThrow(
        'UNSUPPORTED_LAYOUT_SHAPE: Region A1:B2 on "Blank" is on an empty sheet. Pick a sheet with data.'
      );
    });
  });
});
