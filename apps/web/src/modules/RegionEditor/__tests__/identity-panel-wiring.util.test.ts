import { describe, it, expect, jest } from "@jest/globals";

import {
  buildIdentityUpdater,
  resolveLocatorOptionsFor,
} from "../utils/identity-panel-wiring.util";
import type { RegionDraft, Workbook } from "../utils/region-editor.types";

function makeWorkbook(): Workbook {
  return {
    sheets: [
      {
        id: "sheet_a",
        name: "Alpha",
        rowCount: 4,
        colCount: 3,
        cells: [
          ["id", "name", "age"],
          ["a-1", "alice", 30],
          ["a-2", "bob", 25],
          ["a-3", "carol", 40],
        ],
      },
    ],
  };
}

function makeRegion(overrides: Partial<RegionDraft> = {}): RegionDraft {
  return {
    id: "r1",
    sheetId: "sheet_a",
    bounds: { startRow: 0, endRow: 3, startCol: 0, endCol: 2 },
    headerAxes: ["row"],
    targetEntityDefinitionId: "ent",
    ...overrides,
  };
}

describe("resolveLocatorOptionsFor", () => {
  it("returns [] when the workbook is null", () => {
    expect(resolveLocatorOptionsFor(null, makeRegion())).toEqual([]);
  });

  it("returns [] when the region's sheetId can't be matched in the workbook", () => {
    expect(
      resolveLocatorOptionsFor(makeWorkbook(), makeRegion({ sheetId: "missing" }))
    ).toEqual([]);
  });

  it("delegates to computeLocatorOptions for a matched sheet", () => {
    const options = resolveLocatorOptionsFor(makeWorkbook(), makeRegion());
    expect(options.find((o) => o.label === "id")?.uniqueness).toBe("unique");
  });
});

describe("buildIdentityUpdater", () => {
  it("emits a rowPosition patch with source: 'user' when the change kind is rowPosition", () => {
    const onRegionUpdate = jest.fn();
    const update = buildIdentityUpdater({
      workbook: makeWorkbook(),
      regions: [makeRegion()],
      onRegionUpdate: onRegionUpdate as never,
    });
    update("r1", { kind: "rowPosition" });
    expect(onRegionUpdate).toHaveBeenCalledWith("r1", {
      identityStrategy: {
        kind: "rowPosition",
        source: "user",
        confidence: 0,
      },
    });
  });

  it("emits a column-locator patch with the resolved sheet name and 1-indexed coords", () => {
    const onRegionUpdate = jest.fn();
    const update = buildIdentityUpdater({
      workbook: makeWorkbook(),
      regions: [makeRegion()],
      onRegionUpdate: onRegionUpdate as never,
    });
    update("r1", {
      kind: "column",
      locator: { axis: "column", index: 0 },
    });
    expect(onRegionUpdate).toHaveBeenCalledWith("r1", {
      identityStrategy: {
        kind: "column",
        source: "user",
        confidence: 0.7,
        rawLocator: { kind: "column", sheet: "Alpha", col: 1 },
      },
    });
  });

  it("emits a row-locator patch for records-are-columns", () => {
    const onRegionUpdate = jest.fn();
    const update = buildIdentityUpdater({
      workbook: makeWorkbook(),
      regions: [makeRegion({ headerAxes: ["column"] })],
      onRegionUpdate: onRegionUpdate as never,
    });
    update("r1", { kind: "column", locator: { axis: "row", index: 2 } });
    expect(onRegionUpdate).toHaveBeenCalledWith("r1", {
      identityStrategy: {
        kind: "column",
        source: "user",
        confidence: 0.7,
        rawLocator: { kind: "row", sheet: "Alpha", row: 3 },
      },
    });
  });

  it("drops a column-locator change when the workbook is unavailable", () => {
    const onRegionUpdate = jest.fn();
    const update = buildIdentityUpdater({
      workbook: null,
      regions: [makeRegion()],
      onRegionUpdate: onRegionUpdate as never,
    });
    update("r1", { kind: "column", locator: { axis: "column", index: 0 } });
    expect(onRegionUpdate).not.toHaveBeenCalled();
  });
});
