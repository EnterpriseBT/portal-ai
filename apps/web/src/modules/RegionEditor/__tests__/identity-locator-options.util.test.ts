import { describe, it, expect } from "@jest/globals";

import { computeLocatorOptions } from "../utils/identity-locator-options.util";
import type {
  RegionDraft,
  SheetPreview,
} from "../utils/region-editor.types";

function makeSheet(rows: (string | number | null)[][]): SheetPreview {
  return {
    id: "s1",
    name: "Sheet1",
    rowCount: rows.length,
    colCount: rows[0]?.length ?? 0,
    cells: rows,
  };
}

function baseRegion(
  overrides: Partial<RegionDraft> = {}
): RegionDraft {
  return {
    id: "r1",
    sheetId: "s1",
    bounds: { startRow: 0, endRow: 3, startCol: 0, endCol: 2 },
    headerAxes: ["row"],
    targetEntityDefinitionId: "ent",
    ...overrides,
  };
}

describe("computeLocatorOptions — records-are-rows (headerAxes: ['row'])", () => {
  it("flags a column with non-empty unique values as 'unique'", () => {
    const sheet = makeSheet([
      ["id", "name", "age"],
      ["a-1", "alice", 30],
      ["a-2", "bob", 25],
      ["a-3", "carol", 40],
    ]);
    const options = computeLocatorOptions(baseRegion(), sheet);
    const idCol = options.find((o) => o.label === "id");
    expect(idCol).toBeDefined();
    expect(idCol!.uniqueness).toBe("unique");
    expect(idCol!.axis).toBe("column");
  });

  it("flags a column with duplicates as 'non-unique'", () => {
    const sheet = makeSheet([
      ["id", "team", "age"],
      ["a-1", "alpha", 30],
      ["a-2", "alpha", 25],
      ["a-3", "beta", 40],
    ]);
    const options = computeLocatorOptions(baseRegion(), sheet);
    const teamCol = options.find((o) => o.label === "team");
    expect(teamCol).toBeDefined();
    expect(teamCol!.uniqueness).toBe("non-unique");
  });

  it("flags an all-empty column as 'all-blank'", () => {
    const sheet = makeSheet([
      ["id", "blank", "age"],
      ["a-1", null, 30],
      ["a-2", null, 25],
      ["a-3", null, 40],
    ]);
    const options = computeLocatorOptions(baseRegion(), sheet);
    const blankCol = options.find((o) => o.label === "blank");
    expect(blankCol).toBeDefined();
    expect(blankCol!.uniqueness).toBe("all-blank");
  });

  it("uses the cell value at bounds.startRow as the option label (header row convention)", () => {
    const sheet = makeSheet([
      ["id", "name", "age"],
      ["a-1", "alice", 30],
      ["a-2", "bob", 25],
    ]);
    const options = computeLocatorOptions(
      baseRegion({ bounds: { startRow: 0, endRow: 2, startCol: 0, endCol: 2 } }),
      sheet
    );
    expect(options.map((o) => o.label)).toEqual(["id", "name", "age"]);
  });

  it("emits one option per column inside the region's bounds", () => {
    const sheet = makeSheet([
      ["id", "name", "age", "extra"],
      ["a-1", "alice", 30, "x"],
      ["a-2", "bob", 25, "y"],
    ]);
    // bounds clip out the "extra" column.
    const options = computeLocatorOptions(
      baseRegion({ bounds: { startRow: 0, endRow: 2, startCol: 0, endCol: 2 } }),
      sheet
    );
    expect(options).toHaveLength(3);
    expect(options.every((o) => o.axis === "column")).toBe(true);
  });
});

describe("computeLocatorOptions — records-are-columns (headerAxes: ['column'])", () => {
  it("flags a row with non-empty unique values as 'unique'", () => {
    // Header column at col 0; records are columns 1..3.
    const sheet = makeSheet([
      ["id", "a-1", "a-2", "a-3"],
      ["name", "alice", "bob", "carol"],
      ["age", 30, 25, 40],
    ]);
    const options = computeLocatorOptions(
      baseRegion({
        headerAxes: ["column"],
        bounds: { startRow: 0, endRow: 2, startCol: 0, endCol: 3 },
      }),
      sheet
    );
    const idRow = options.find((o) => o.label === "id");
    expect(idRow).toBeDefined();
    expect(idRow!.uniqueness).toBe("unique");
    expect(idRow!.axis).toBe("row");
  });

  it("emits one option per row inside the region's bounds", () => {
    const sheet = makeSheet([
      ["id", "a-1", "a-2"],
      ["name", "alice", "bob"],
      ["age", 30, 25],
    ]);
    const options = computeLocatorOptions(
      baseRegion({
        headerAxes: ["column"],
        bounds: { startRow: 0, endRow: 2, startCol: 0, endCol: 2 },
      }),
      sheet
    );
    expect(options).toHaveLength(3);
    expect(options.every((o) => o.axis === "row")).toBe(true);
    expect(options.map((o) => o.label)).toEqual(["id", "name", "age"]);
  });
});

describe("computeLocatorOptions — 2D crosstab", () => {
  it("returns no options when both axes carry headers", () => {
    const sheet = makeSheet([
      ["", "Q1", "Q2"],
      ["Apple", 100, 110],
      ["Microsoft", 200, 210],
    ]);
    const options = computeLocatorOptions(
      baseRegion({
        headerAxes: ["row", "column"],
        bounds: { startRow: 0, endRow: 2, startCol: 0, endCol: 2 },
      }),
      sheet
    );
    expect(options).toEqual([]);
  });
});

describe("computeLocatorOptions — labels", () => {
  it("falls back to a 'col {index}'-style label when the header cell is empty", () => {
    const sheet = makeSheet([
      ["id", "", "age"],
      ["a-1", "alice", 30],
      ["a-2", "bob", 25],
    ]);
    const options = computeLocatorOptions(baseRegion(), sheet);
    // The blank-header col (index 1) is still listed; the label is a
    // synthetic placeholder so the dropdown can render something.
    const blankHeaderOption = options.find((o) => o.index === 1);
    expect(blankHeaderOption).toBeDefined();
    expect(blankHeaderOption!.label).toMatch(/^col 2$|^column 2$/i);
  });
});
