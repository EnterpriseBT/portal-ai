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

describe("computeRegionDecorations — axisNameAnchor", () => {
  test("rows-as-records + headerAxis:column emits a single-cell anchor and carves the corner from the header column", () => {
    const region = baseRegion({
      orientation: "rows-as-records",
      headerAxis: "column",
      recordsAxisName: { name: "Region", source: "user" },
    });
    const s = sheet(Array.from({ length: 5 }, () => Array(4).fill("x")));
    const decos = computeRegionDecorations(region, s);

    const anchor = decos.filter((d) => d.kind === "axisNameAnchor");
    expect(anchor).toHaveLength(1);
    expect(anchor[0].bounds).toEqual({
      startRow: 0,
      endRow: 0,
      startCol: 0,
      endCol: 0,
    });
    expect(anchor[0].label).toBe("Region");

    const header = decos.filter((d) => d.kind === "header");
    expect(header).toHaveLength(1);
    expect(header[0].bounds).toEqual({
      startRow: 1, // corner carved out
      endRow: 4,
      startCol: 0,
      endCol: 0,
    });
  });

  test("columns-as-records + headerAxis:row emits a single-cell anchor and carves the corner from the header row", () => {
    const region = baseRegion({
      orientation: "columns-as-records",
      headerAxis: "row",
      recordsAxisName: { name: "Region", source: "ai", confidence: 0.8 },
    });
    const s = sheet(Array.from({ length: 5 }, () => Array(4).fill("x")));
    const decos = computeRegionDecorations(region, s);

    const anchor = decos.filter((d) => d.kind === "axisNameAnchor");
    expect(anchor).toHaveLength(1);
    expect(anchor[0].bounds).toEqual({
      startRow: 0,
      endRow: 0,
      startCol: 0,
      endCol: 0,
    });

    const header = decos.filter((d) => d.kind === "header");
    expect(header).toHaveLength(1);
    expect(header[0].bounds).toEqual({
      startRow: 0,
      endRow: 0,
      startCol: 1, // corner carved out
      endCol: 3,
    });
  });

  test("cells-as-records emits an anchor at the corner with both axis names", () => {
    const region = baseRegion({
      orientation: "cells-as-records",
      headerAxis: "row",
      recordsAxisName: { name: "Region", source: "user" },
      secondaryRecordsAxisName: { name: "Quarter", source: "user" },
    });
    const s = sheet(Array.from({ length: 5 }, () => Array(4).fill("x")));
    const decos = computeRegionDecorations(region, s);

    const anchor = decos.filter((d) => d.kind === "axisNameAnchor");
    expect(anchor).toHaveLength(1);
    expect(anchor[0].bounds).toEqual({
      startRow: 0,
      endRow: 0,
      startCol: 0,
      endCol: 0,
    });
    expect(anchor[0].label).toBe("Region × Quarter");
  });

  test("non-pivoted shapes emit no anchor", () => {
    const rowsRow = computeRegionDecorations(
      baseRegion({ orientation: "rows-as-records", headerAxis: "row" }),
      sheet(Array.from({ length: 5 }, () => Array(4).fill("x")))
    );
    const colsCol = computeRegionDecorations(
      baseRegion({ orientation: "columns-as-records", headerAxis: "column" }),
      sheet(Array.from({ length: 5 }, () => Array(4).fill("x")))
    );
    expect(rowsRow.filter((d) => d.kind === "axisNameAnchor")).toHaveLength(0);
    expect(colsCol.filter((d) => d.kind === "axisNameAnchor")).toHaveLength(0);
  });

  test("anchor falls back to placeholder label when recordsAxisName is unset", () => {
    const region = baseRegion({
      orientation: "rows-as-records",
      headerAxis: "column",
    });
    const s = sheet(Array.from({ length: 5 }, () => Array(4).fill("x")));
    const decos = computeRegionDecorations(region, s);
    const anchor = decos.find((d) => d.kind === "axisNameAnchor");
    expect(anchor?.label).toBe("Axis name goes here");
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

  test("cellMatches rule with undefined crossAxisIndex produces no skip decoration", () => {
    const cells = [
      ["H1", "H2"],
      ["a", "b"],
      ["c", "d"],
    ];
    const region = baseRegion({
      bounds: { startRow: 0, endRow: 2, startCol: 0, endCol: 1 },
      skipRules: [{ kind: "cellMatches", crossAxisIndex: undefined, pattern: ".*" }],
    });
    const s = sheet(cells);
    const skipped = computeRegionDecorations(region, s).filter((d) => d.kind === "skipped");
    expect(skipped).toHaveLength(0);
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
