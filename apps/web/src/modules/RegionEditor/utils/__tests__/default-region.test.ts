import { describe, it, expect } from "@jest/globals";

import {
  RegionSchema,
  type ColumnBinding,
} from "@portalai/core/contracts";

import { defaultRegionForBounds } from "../default-region.util";

function bindingsForNames(names: string[]): ColumnBinding[] {
  return names.map((name) => ({
    sourceLocator: { kind: "byHeaderName", axis: "row", name },
    columnDefinitionId: "placeholder",
    confidence: 0.5,
  }));
}

describe("defaultRegionForBounds", () => {
  it("emits classic tidy: headerAxes=['row'], one field segment, byHeaderName bindings with axis:'row' across row 1", () => {
    const proposedBindings = bindingsForNames(["name", "email", "age", "city"]);
    const region = defaultRegionForBounds(
      { sheet: "S1", startRow: 1, startCol: 1, endRow: 10, endCol: 4 },
      {
        targetEntityDefinitionId: "entity-1",
        proposedBindings,
      }
    );

    expect(region.headerAxes).toEqual(["row"]);
    expect(region.segmentsByAxis?.row).toEqual([
      { kind: "field", positionCount: 4 },
    ]);
    expect(region.columnBindings).toHaveLength(4);
    expect(
      region.columnBindings.every(
        (b) =>
          b.sourceLocator.kind === "byHeaderName" &&
          b.sourceLocator.axis === "row"
      )
    ).toBe(true);
    expect(region.cellValueField).toBeUndefined();
    expect(region.recordsAxis).toBeUndefined();
    expect(region.sheet).toBe("S1");
    expect(region.targetEntityDefinitionId).toBe("entity-1");
    expect(region.bounds).toEqual({
      startRow: 1,
      startCol: 1,
      endRow: 10,
      endCol: 4,
    });
    expect(region.headerStrategyByAxis?.row).toMatchObject({
      kind: "row",
      locator: { kind: "row", sheet: "S1", row: 1 },
    });
    expect(typeof region.id).toBe("string");
    expect(region.id.length).toBeGreaterThan(0);
  });

  it("validates against RegionSchema", () => {
    const proposedBindings = bindingsForNames(["a", "b", "c"]);
    const region = defaultRegionForBounds(
      { sheet: "Sheet1", startRow: 2, startCol: 3, endRow: 12, endCol: 5 },
      {
        targetEntityDefinitionId: "entity-42",
        proposedBindings,
      }
    );
    const parsed = RegionSchema.safeParse(region);
    if (!parsed.success) {
      throw new Error(
        `RegionSchema validation failed:\n${JSON.stringify(parsed.error.issues, null, 2)}`
      );
    }
    // positionCount covers the full column span (endCol - startCol + 1 === 3).
    expect(parsed.data.segmentsByAxis?.row).toEqual([
      { kind: "field", positionCount: 3 },
    ]);
    // headerStrategy locator picks up the caller-supplied bounds.startRow.
    expect(parsed.data.headerStrategyByAxis?.row?.locator).toMatchObject({
      kind: "row",
      sheet: "Sheet1",
      row: 2,
    });
  });
});
