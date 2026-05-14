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

describe("computeLocatorOptions — sliced-sheet uniqueness", () => {
  // The IdentityPanel's `(unique)` tag used to be computed by treating
  // unloaded rows (sliced sheets — `sheet.cells[r] === undefined`) as
  // empty strings. That produced a false `unique` verdict on huge
  // sheets where only the visible window is loaded; the commit-time
  // drift gate then rejected the commit with
  // `LAYOUT_PLAN_DRIFT_IDENTITY_CHANGED`. The classifier now downgrades
  // to `unknown` whenever any row in the data range isn't loaded.

  function makeSlicedSheet(
    rowCount: number,
    loaded: (string | number | null)[][]
  ): SheetPreview {
    // `cells` is sparse: the first `loaded.length` entries are filled,
    // everything past that is `undefined` to mimic the canvas's
    // lazy-loaded preview window.
    return {
      id: "s1",
      name: "Sheet1",
      rowCount,
      colCount: loaded[0]?.length ?? 0,
      cells: loaded as unknown as SheetPreview["cells"],
    };
  }

  it("flags every column as 'unknown' when rows in the bounds range aren't loaded", () => {
    const sheet = makeSlicedSheet(2701, [
      ["Model", "Domain"],
      ["Claude", "Language"],
      ["GPT-5", "Language"],
    ]);
    const options = computeLocatorOptions(
      baseRegion({
        bounds: { startRow: 0, endRow: 2700, startCol: 0, endCol: 1 },
      }),
      sheet
    );
    const modelCol = options.find((o) => o.label === "Model");
    expect(modelCol).toBeDefined();
    // Without the fix this would mis-classify as `unique` from the 2
    // loaded rows; with it the verdict is `unknown` and the IdentityPanel
    // renders the softer "verified at commit" notice.
    expect(modelCol!.uniqueness).toBe("unknown");
  });

  it("still classifies normally when every row in the range is loaded", () => {
    const sheet = makeSlicedSheet(3, [
      ["id"],
      ["a-1"],
      ["a-2"],
    ]);
    const options = computeLocatorOptions(
      baseRegion({
        bounds: { startRow: 0, endRow: 2, startCol: 0, endCol: 0 },
      }),
      sheet
    );
    const idCol = options.find((o) => o.label === "id");
    expect(idCol!.uniqueness).toBe("unique");
  });

  it("flags a column-axis identity row as 'unknown' when its source row isn't loaded", () => {
    const sheet = makeSlicedSheet(50, [
      ["id", "a-1", "a-2"],
      ["name", "alice", "bob"],
      // rows 2..49 unloaded — the column-axis classifier walks rows
      // and an absent header row signals "I can't tell".
    ]);
    const options = computeLocatorOptions(
      baseRegion({
        headerAxes: ["column"],
        bounds: { startRow: 0, endRow: 49, startCol: 0, endCol: 2 },
      }),
      sheet
    );
    // The first two rows are loaded — those classifications are honest.
    const idRow = options.find((o) => o.label === "id");
    expect(idRow!.uniqueness).toBe("unique");
    // The unloaded rows surface as `unknown`.
    const unloaded = options.filter((o) => o.uniqueness === "unknown");
    expect(unloaded.length).toBeGreaterThan(0);
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
