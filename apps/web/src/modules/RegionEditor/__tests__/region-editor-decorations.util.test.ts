import {
  activeDecorationKinds,
  computeRegionDecorations,
} from "../utils/region-editor-decorations.util";
import type { RegionDraft, SheetPreview } from "../utils/region-editor.types";

function sheet(cells: (string | number | null)[][]): SheetPreview {
  return {
    id: "s",
    name: "Sheet",
    rowCount: cells.length,
    colCount: cells[0]?.length ?? 0,
    cells,
  };
}

function baseRegion(overrides: Partial<RegionDraft> = {}): RegionDraft {
  return {
    id: "r",
    sheetId: "s",
    bounds: { startRow: 0, endRow: 4, startCol: 0, endCol: 3 },
    orientation: "rows-as-records",
    headerAxis: "row",
    targetEntityDefinitionId: "ent_a",
    ...overrides,
  };
}

describe("computeRegionDecorations — headers", () => {
  test("rows-as-records + headerAxis:row produces a single-row header decoration", () => {
    const region = baseRegion();
    const s = sheet(Array.from({ length: 5 }, () => Array(4).fill("x")));
    const decos = computeRegionDecorations(region, s);
    const headers = decos.filter((d) => d.kind === "header");
    expect(headers).toHaveLength(1);
    expect(headers[0].bounds).toEqual({
      startRow: 0,
      endRow: 0,
      startCol: 0,
      endCol: 3,
    });
  });

  test("columns-as-records + headerAxis:column produces a single-column header decoration", () => {
    const region = baseRegion({
      orientation: "columns-as-records",
      headerAxis: "column",
    });
    const s = sheet(Array.from({ length: 5 }, () => Array(4).fill("x")));
    const decos = computeRegionDecorations(region, s);
    const headers = decos.filter((d) => d.kind === "header");
    expect(headers).toHaveLength(1);
    expect(headers[0].bounds).toEqual({
      startRow: 0,
      endRow: 4,
      startCol: 0,
      endCol: 0,
    });
  });

  test("headerAxis:none produces no header decoration", () => {
    const region = baseRegion({ headerAxis: "none" });
    const s = sheet(Array.from({ length: 5 }, () => Array(4).fill("x")));
    const decos = computeRegionDecorations(region, s);
    expect(decos.filter((d) => d.kind === "header")).toHaveLength(0);
  });
});

describe("computeRegionDecorations — crosstab", () => {
  test("cells-as-records emits row-axis + column-axis label decorations", () => {
    const region = baseRegion({
      orientation: "cells-as-records",
      headerAxis: "row",
      recordsAxisName: { name: "Region", source: "user" },
      secondaryRecordsAxisName: { name: "Month", source: "user" },
    });
    const s = sheet(Array.from({ length: 5 }, () => Array(4).fill("x")));
    const decos = computeRegionDecorations(region, s);

    const rowLabels = decos.filter((d) => d.kind === "rowAxisLabel");
    const colLabels = decos.filter((d) => d.kind === "colAxisLabel");

    expect(rowLabels).toHaveLength(1);
    expect(rowLabels[0].bounds).toEqual({
      startRow: 1, // below the top-left corner cell
      endRow: 4,
      startCol: 0,
      endCol: 0,
    });

    expect(colLabels).toHaveLength(1);
    expect(colLabels[0].bounds).toEqual({
      startRow: 0,
      endRow: 0,
      startCol: 1,
      endCol: 3,
    });
  });
});

describe("computeRegionDecorations — skipped rows", () => {
  test("blank rule marks fully empty data rows as skipped", () => {
    // rows 0 = header; 1-2 data; 3 blank; 4 data.
    const cells = [
      ["H1", "H2", "H3"],
      ["a", "b", "c"],
      ["d", "e", "f"],
      ["", "", ""],
      ["g", "h", "i"],
    ];
    const region = baseRegion({
      bounds: { startRow: 0, endRow: 4, startCol: 0, endCol: 2 },
      skipRules: [{ kind: "blank" }],
    });
    const s = sheet(cells);
    const skipped = computeRegionDecorations(region, s).filter((d) => d.kind === "skipped");
    expect(skipped).toHaveLength(1);
    expect(skipped[0].bounds.startRow).toBe(3);
  });

  test("cellMatches rule marks rows whose identity-column cell matches the pattern", () => {
    const cells = [
      ["First", "Last", "Email"],
      ["Alice", "A", "a@x"],
      ["— NA Region —", "", ""],
      ["Bob", "B", "b@x"],
      ["Subtotal", "", ""],
      ["Carol", "C", "c@x"],
    ];
    const region = baseRegion({
      bounds: { startRow: 0, endRow: 5, startCol: 0, endCol: 2 },
      skipRules: [
        { kind: "cellMatches", crossAxisIndex: 0, pattern: "^—.*—$" },
        { kind: "cellMatches", crossAxisIndex: 0, pattern: "^Subtotal$" },
      ],
    });
    const s = sheet(cells);
    const skipped = computeRegionDecorations(region, s)
      .filter((d) => d.kind === "skipped")
      .map((d) => d.bounds.startRow);
    expect(skipped).toEqual([2, 4]);
  });
});

describe("computeRegionDecorations — skipped columns (columns-as-records)", () => {
  test("cellMatches rule with axis:'row' marks columns whose row-n cell matches", () => {
    // Row 0: header "Field" in col 0; q1, subtotal, q2 in cols 1-3.
    const cells = [
      ["Field", "Q1", "— Subtotal —", "Q2"],
      ["Eng", 1, 3, 2],
      ["Sales", 2, 5, 3],
    ];
    const region: RegionDraft = baseRegion({
      orientation: "columns-as-records",
      headerAxis: "column",
      bounds: { startRow: 0, endRow: 2, startCol: 0, endCol: 3 },
      skipRules: [
        { kind: "cellMatches", crossAxisIndex: 0, pattern: "^—.*—$", axis: "row" },
      ],
    });
    const s = sheet(cells);
    const skipped = computeRegionDecorations(region, s)
      .filter((d) => d.kind === "skipped")
      .map((d) => d.bounds.startCol);
    expect(skipped).toEqual([2]);
  });
});

describe("activeDecorationKinds", () => {
  test("dedupes repeated kinds", () => {
    const cells = [
      ["h", "h"],
      ["", ""],
      ["", ""],
    ];
    const region = baseRegion({
      bounds: { startRow: 0, endRow: 2, startCol: 0, endCol: 1 },
      skipRules: [{ kind: "blank" }],
    });
    const s = sheet(cells);
    const decos = computeRegionDecorations(region, s);
    expect(activeDecorationKinds(decos).sort()).toEqual(["header", "skipped"]);
  });
});
