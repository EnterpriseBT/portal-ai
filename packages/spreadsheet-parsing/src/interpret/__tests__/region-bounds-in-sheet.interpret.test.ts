import { describe, it, expect, jest } from "@jest/globals";

import type { InterpretInput, RegionHint } from "../../plan/index.js";
import { interpret } from "../index.js";
import type { ClassifierFn } from "../types.js";

// #1008: interpret took a hint's bounds on trust. A region past the sheet
// came back as a plan with impossible bounds, and an inverted one failed the
// final plan parse, which the route answered as a scrubbed 500.
function contacts(hint: Partial<RegionHint>): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Contacts",
          dimensions: { rows: 3, cols: 2 },
          cells: [
            { row: 1, col: 1, value: "email" },
            { row: 1, col: 2, value: "name" },
            { row: 2, col: 1, value: "a@x.com" },
            { row: 2, col: 2, value: "alice" },
            { row: 3, col: 1, value: "b@x.com" },
            { row: 3, col: 2, value: "bob" },
          ],
        },
      ],
    },
    regionHints: [
      {
        sheet: "Contacts",
        bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 2 },
        targetEntityDefinitionId: "contacts",
        headerAxes: ["row"],
        ...hint,
      },
    ],
  };
}

describe("interpret — region bounds inside the sheet (#1008)", () => {
  it("rejects a region past the sheet as an input error, before any model call", async () => {
    const classifier = jest.fn<ClassifierFn>(() => []);
    await expect(
      interpret(
        contacts({
          bounds: { startRow: 1, startCol: 1, endRow: 500, endCol: 2 },
        }),
        { classifier }
      )
    ).rejects.toThrow(
      /^UNSUPPORTED_LAYOUT_SHAPE: Region A1:B500 on "Contacts" runs past the sheet's last row \(3\)/
    );
    expect(classifier).not.toHaveBeenCalled();
  });

  it("rejects an inverted region as an input error, with or without a header axis", async () => {
    for (const headerAxes of [["row"] as const, [] as const]) {
      await expect(
        interpret(
          contacts({
            bounds: { startRow: 3, startCol: 1, endRow: 1, endCol: 2 },
            headerAxes: [...headerAxes],
            ...(headerAxes.length === 0 ? { recordsAxis: "row" as const } : {}),
          })
        )
      ).rejects.toThrow(
        /^UNSUPPORTED_LAYOUT_SHAPE: Region A3:B1 on "Contacts" starts after it ends/
      );
    }
  });

  it("still interprets a region inside the sheet", async () => {
    const plan = await interpret(contacts({}));
    expect(plan.regions[0].bounds).toEqual({
      startRow: 1,
      startCol: 1,
      endRow: 3,
      endCol: 2,
    });
  });
});
