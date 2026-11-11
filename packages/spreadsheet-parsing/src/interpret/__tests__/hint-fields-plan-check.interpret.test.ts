import { describe, it, expect, jest } from "@jest/globals";

import { interpret } from "../index.js";
import type { ClassifierFn } from "../types.js";

// #1011: a hint field interpret copies through unrepaired used to fail the
// final plan parse (a scrubbed 500) after the model stages had run.
describe("interpret — hint fields the region rules reject (#1011)", () => {
  it("rejects a duplicated header axis as an input error, before any model call", async () => {
    const classifier = jest.fn<ClassifierFn>(() => []);
    await expect(
      interpret(
        {
          workbook: {
            sheets: [
              {
                name: "S",
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
              sheet: "S",
              bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 2 },
              targetEntityDefinitionId: "t",
              headerAxes: ["row", "row"],
            },
          ],
        },
        { classifier }
      )
    ).rejects.toThrow(
      'UNSUPPORTED_LAYOUT_SHAPE: Region A1:B2 on "S": headerAxes entries must be unique.'
    );
    expect(classifier).not.toHaveBeenCalled();
  });
});
