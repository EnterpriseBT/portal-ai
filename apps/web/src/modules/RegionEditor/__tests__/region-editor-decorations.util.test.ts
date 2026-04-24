import {
  activeDecorationKinds,
  anchorCellValue,
  computeRegionDecorations,
  computeSegmentOverlays,
} from "../utils/region-editor-decorations.util";
import type {
  CellBounds,
  RegionDraft,
  SheetPreview,
} from "../utils/region-editor.types";

function sheet(cells: (string | number | null)[][]): SheetPreview {
  return {
    id: "s",
    name: "Sheet",
    rowCount: cells.length,
    colCount: cells[0]?.length ?? 0,
    cells,
  };
}

/**
 * Legacy-shape overrides translated into the PR-4 segment model so the
 * suite's pre-PR-4 test cases keep working without a line-by-line rewrite.
 * Supports the same four inputs the pre-PR draft carried:
 *   - `orientation` × `headerAxis` → `headerAxes` + segment kind
 *   - `recordsAxisName` → pivot segment's `axisName` on the row axis
 *     (or column axis for 1D pivoted columns-as-records)
 *   - `secondaryRecordsAxisName` → column-axis pivot `axisName` (crosstab)
 *   - `cellValueName` → `cellValueField`
 */
type LegacyOverrides = {
  id?: string;
  sheetId?: string;
  bounds?: CellBounds;
  targetEntityDefinitionId?: string | null;
  orientation?: "rows-as-records" | "columns-as-records" | "cells-as-records";
  headerAxis?: "row" | "column" | "none";
  recordsAxisName?: {
    name: string;
    source: "user" | "ai" | "anchor-cell";
    confidence?: number;
  };
  secondaryRecordsAxisName?: {
    name: string;
    source: "user" | "ai" | "anchor-cell";
    confidence?: number;
  };
  cellValueName?: {
    name: string;
    source: "user" | "ai" | "anchor-cell";
  };
  axisAnchorCell?: { row: number; col: number };
  skipRules?: RegionDraft["skipRules"];
};

function baseRegion(overrides: LegacyOverrides = {}): RegionDraft {
  const bounds = overrides.bounds ?? {
    startRow: 0,
    endRow: 4,
    startCol: 0,
    endCol: 3,
  };
  const orientation = overrides.orientation ?? "rows-as-records";
  const headerAxis = overrides.headerAxis ?? "row";
  const rowSpan = bounds.endCol - bounds.startCol + 1;
  const colSpan = bounds.endRow - bounds.startRow + 1;

  const draft: RegionDraft = {
    id: overrides.id ?? "r",
    sheetId: overrides.sheetId ?? "s",
    bounds,
    targetEntityDefinitionId: overrides.targetEntityDefinitionId ?? "ent_a",
  };
  if (overrides.axisAnchorCell) draft.axisAnchorCell = overrides.axisAnchorCell;
  if (overrides.skipRules) draft.skipRules = overrides.skipRules;

  if (headerAxis === "none") {
    draft.headerAxes = [];
    draft.recordsAxis =
      orientation === "columns-as-records" ? "column" : "row";
    return draft;
  }

  if (orientation === "cells-as-records") {
    draft.headerAxes = ["row", "column"];
    draft.segmentsByAxis = {
      row: [
        {
          kind: "pivot",
          id: "row-pivot",
          axisName: overrides.recordsAxisName?.name ?? "",
          axisNameSource: overrides.recordsAxisName?.source ?? "user",
          positionCount: rowSpan,
        },
      ],
      column: [
        {
          kind: "pivot",
          id: "column-pivot",
          axisName: overrides.secondaryRecordsAxisName?.name ?? "",
          axisNameSource: overrides.secondaryRecordsAxisName?.source ?? "user",
          positionCount: colSpan,
        },
      ],
    };
    if (overrides.cellValueName) {
      draft.cellValueField = {
        name: overrides.cellValueName.name,
        nameSource: overrides.cellValueName.source,
      };
    }
    return draft;
  }

  // 1D region. Pivoted when the record axis is unlabeled by the data itself
  // (rows-as-records + column header, or columns-as-records + row header).
  const pivoted =
    (orientation === "rows-as-records" && headerAxis === "column") ||
    (orientation === "columns-as-records" && headerAxis === "row");
  const span = headerAxis === "row" ? rowSpan : colSpan;

  draft.headerAxes = [headerAxis];
  if (pivoted) {
    draft.segmentsByAxis = {
      [headerAxis]: [
        {
          kind: "pivot",
          id: `${headerAxis}-pivot`,
          axisName: overrides.recordsAxisName?.name ?? "",
          axisNameSource: overrides.recordsAxisName?.source ?? "user",
          positionCount: span,
        },
      ],
    };
    if (overrides.cellValueName) {
      draft.cellValueField = {
        name: overrides.cellValueName.name,
        nameSource: overrides.cellValueName.source,
      };
    }
  } else {
    draft.segmentsByAxis = {
      [headerAxis]: [{ kind: "field", positionCount: span }],
    };
  }
  return draft;
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

describe("computeRegionDecorations — crosstab cell-value overlay", () => {
  test("cells-as-records emits a cellValue decoration for the inner data rectangle labeled with cellValueName", () => {
    const region = baseRegion({
      orientation: "cells-as-records",
      headerAxis: "row",
      bounds: { startRow: 0, endRow: 4, startCol: 0, endCol: 3 },
      cellValueName: { name: "GPA", source: "user" },
    });
    const s = sheet(Array.from({ length: 5 }, () => Array(4).fill("x")));
    const decos = computeRegionDecorations(region, s);

    const cellValues = decos.filter((d) => d.kind === "cellValue");
    expect(cellValues).toHaveLength(1);
    expect(cellValues[0].bounds).toEqual({
      startRow: 1, // excludes top-row axis labels
      endRow: 4,
      startCol: 1, // excludes left-col axis labels
      endCol: 3,
    });
    expect(cellValues[0].label).toBe("GPA");
  });

  test("cellValue label falls back to placeholder when cellValueName is unset", () => {
    const region = baseRegion({
      orientation: "cells-as-records",
      headerAxis: "row",
      bounds: { startRow: 0, endRow: 4, startCol: 0, endCol: 3 },
    });
    const s = sheet(Array.from({ length: 5 }, () => Array(4).fill("x")));
    const decos = computeRegionDecorations(region, s);
    expect(decos.find((d) => d.kind === "cellValue")?.label).toBe(
      "Cell values"
    );
  });

  test("no cellValue decoration when the crosstab has zero inner area", () => {
    const region = baseRegion({
      orientation: "cells-as-records",
      headerAxis: "row",
      bounds: { startRow: 0, endRow: 0, startCol: 0, endCol: 3 },
    });
    const s = sheet(Array.from({ length: 1 }, () => Array(4).fill("x")));
    const decos = computeRegionDecorations(region, s);
    expect(decos.filter((d) => d.kind === "cellValue")).toHaveLength(0);
  });

  test("non-crosstab shapes never emit cellValue", () => {
    const rowsRow = computeRegionDecorations(
      baseRegion({
        orientation: "rows-as-records",
        headerAxis: "row",
        cellValueName: { name: "Should not appear", source: "user" },
      }),
      sheet(Array.from({ length: 5 }, () => Array(4).fill("x")))
    );
    expect(rowsRow.filter((d) => d.kind === "cellValue")).toHaveLength(0);
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

  test("anchor falls back to placeholder label when recordsAxisName and anchor cell are both empty", () => {
    const region = baseRegion({
      orientation: "rows-as-records",
      headerAxis: "column",
    });
    // Anchor cell (0,0) is blank — no name to propose.
    const s = sheet([
      ["", "x", "x", "x"],
      ["v", "x", "x", "x"],
      ["v", "x", "x", "x"],
      ["v", "x", "x", "x"],
      ["v", "x", "x", "x"],
    ]);
    const decos = computeRegionDecorations(region, s);
    const anchor = decos.find((d) => d.kind === "axisNameAnchor");
    expect(anchor?.label).toBe("Axis name goes here");
  });

  test("axisAnchorCell override relocates the anchor and suppresses the header carve-out", () => {
    const region = baseRegion({
      orientation: "rows-as-records",
      headerAxis: "column",
      bounds: { startRow: 3, endRow: 7, startCol: 0, endCol: 4 },
      axisAnchorCell: { row: 7, col: 0 }, // bottom-left instead of top-left
      recordsAxisName: { name: "Region", source: "user" },
    });
    const s = sheet(Array.from({ length: 10 }, () => Array(5).fill("x")));
    const decos = computeRegionDecorations(region, s);

    const anchor = decos.filter((d) => d.kind === "axisNameAnchor");
    expect(anchor).toHaveLength(1);
    expect(anchor[0].bounds).toEqual({
      startRow: 7,
      endRow: 7,
      startCol: 0,
      endCol: 0,
    });

    // Override → no corner carve-out; header spans the full column.
    const header = decos.filter((d) => d.kind === "header");
    expect(header).toHaveLength(1);
    expect(header[0].bounds).toEqual({
      startRow: 3,
      endRow: 7,
      startCol: 0,
      endCol: 0,
    });
  });

  test("anchor cell value is used as the decoration label when recordsAxisName is unset", () => {
    const cells = [
      ["", "", "", ""],
      ["", "", "", ""],
      ["", "", "", ""],
      ["student", "fall '06", "spring '06", "summer '06"],
      ["jane", 3.2, 3.4, 2.9],
      ["john", 3.6, 3.5, 3.8],
    ];
    const region = baseRegion({
      orientation: "cells-as-records",
      headerAxis: "row",
      bounds: { startRow: 3, endRow: 5, startCol: 0, endCol: 3 },
      // recordsAxisName intentionally unset — should fall back to anchor cell.
      secondaryRecordsAxisName: { name: "Semester", source: "user" },
    });
    const s = sheet(cells);
    const decos = computeRegionDecorations(region, s);
    const anchor = decos.find((d) => d.kind === "axisNameAnchor");
    expect(anchor?.label).toBe("student × Semester");
  });

  test("crosstab with overridden anchor skips the rowAxisLabel / colAxisLabel corner carve-out", () => {
    const region = baseRegion({
      orientation: "cells-as-records",
      headerAxis: "row",
      bounds: { startRow: 3, endRow: 7, startCol: 0, endCol: 4 },
      axisAnchorCell: { row: 3, col: 4 }, // top-right instead of top-left
      recordsAxisName: { name: "Region", source: "user" },
      secondaryRecordsAxisName: { name: "Quarter", source: "user" },
    });
    const s = sheet(Array.from({ length: 10 }, () => Array(5).fill("x")));
    const decos = computeRegionDecorations(region, s);

    const rowLabels = decos.filter((d) => d.kind === "rowAxisLabel");
    expect(rowLabels[0].bounds).toEqual({
      startRow: 3, // not carved — starts at top
      endRow: 7,
      startCol: 0,
      endCol: 0,
    });
    const colLabels = decos.filter((d) => d.kind === "colAxisLabel");
    expect(colLabels[0].bounds).toEqual({
      startRow: 3,
      endRow: 3,
      startCol: 0, // not carved — starts at left
      endCol: 4,
    });
    const anchor = decos.find((d) => d.kind === "axisNameAnchor");
    expect(anchor?.bounds).toEqual({
      startRow: 3,
      endRow: 3,
      startCol: 4,
      endCol: 4,
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
    const skipped = computeRegionDecorations(region, s).filter(
      (d) => d.kind === "skipped"
    );
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
      skipRules: [
        { kind: "cellMatches", crossAxisIndex: undefined, pattern: ".*" },
      ],
    });
    const s = sheet(cells);
    const skipped = computeRegionDecorations(region, s).filter(
      (d) => d.kind === "skipped"
    );
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

describe("computeRegionDecorations — cellMatches null/empty cell coercion", () => {
  test("cellMatches with ^$ matches null cells", () => {
    const cells: (string | number | null)[][] = [
      ["H1", "H2"],
      ["a", null],
      [null, "b"],
      ["c", "d"],
    ];
    const region = baseRegion({
      bounds: { startRow: 0, endRow: 3, startCol: 0, endCol: 1 },
      skipRules: [{ kind: "cellMatches", crossAxisIndex: 1, pattern: "^$" }],
    });
    const s = sheet(cells);
    const skipped = computeRegionDecorations(region, s)
      .filter((d) => d.kind === "skipped")
      .map((d) => d.bounds.startRow);
    expect(skipped).toEqual([1]);
  });

  test("cellMatches with ^$ matches empty-string cells", () => {
    const cells: (string | number | null)[][] = [
      ["H1", "H2"],
      ["a", ""],
      ["b", "x"],
    ];
    const region = baseRegion({
      bounds: { startRow: 0, endRow: 2, startCol: 0, endCol: 1 },
      skipRules: [{ kind: "cellMatches", crossAxisIndex: 1, pattern: "^$" }],
    });
    const s = sheet(cells);
    const skipped = computeRegionDecorations(region, s)
      .filter((d) => d.kind === "skipped")
      .map((d) => d.bounds.startRow);
    expect(skipped).toEqual([1]);
  });

  test("cellMatches with .* matches null cells", () => {
    const cells: (string | number | null)[][] = [
      ["H1", "H2"],
      ["a", null],
      ["b", "x"],
    ];
    const region = baseRegion({
      bounds: { startRow: 0, endRow: 2, startCol: 0, endCol: 1 },
      skipRules: [{ kind: "cellMatches", crossAxisIndex: 1, pattern: ".*" }],
    });
    const s = sheet(cells);
    const skipped = computeRegionDecorations(region, s)
      .filter((d) => d.kind === "skipped")
      .map((d) => d.bounds.startRow);
    // Both data rows match — null coerces to "" which matches .*
    expect(skipped).toEqual([1, 2]);
  });

  test("cellMatches null coercion works for column-axis rules", () => {
    const cells: (string | number | null)[][] = [
      ["Field", "Q1", "Q2"],
      ["Eng", 1, null],
      ["Sales", 2, 3],
    ];
    const region = baseRegion({
      orientation: "columns-as-records",
      headerAxis: "column",
      bounds: { startRow: 0, endRow: 2, startCol: 0, endCol: 2 },
      skipRules: [{ kind: "cellMatches", crossAxisIndex: 1, pattern: "^$" }],
    });
    const s = sheet(cells);
    const skipped = computeRegionDecorations(region, s)
      .filter((d) => d.kind === "skipped")
      .map((d) => d.bounds.startCol);
    // Col 2 has null at row 1 → coerced to "" → matches ^$
    expect(skipped).toEqual([2]);
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
        {
          kind: "cellMatches",
          crossAxisIndex: 0,
          pattern: "^—.*—$",
          axis: "row",
        },
      ],
    });
    const s = sheet(cells);
    const skipped = computeRegionDecorations(region, s)
      .filter((d) => d.kind === "skipped")
      .map((d) => d.bounds.startCol);
    expect(skipped).toEqual([2]);
  });
});

describe("anchorCellValue", () => {
  test("returns the string value at the default anchor cell (startRow, startCol)", () => {
    const s = sheet([
      ["", ""],
      ["", ""],
      ["", ""],
      ["student", "fall '06"],
      ["jane", 3.2],
    ]);
    const region = baseRegion({
      orientation: "cells-as-records",
      headerAxis: "row",
      bounds: { startRow: 3, endRow: 4, startCol: 0, endCol: 1 },
    });
    expect(anchorCellValue(region, s)).toBe("student");
  });

  test("honors an axisAnchorCell override", () => {
    const s = sheet([
      ["", ""],
      ["", ""],
      ["", ""],
      ["", "footer anchor"],
      ["jane", 3.2],
    ]);
    const region = baseRegion({
      orientation: "cells-as-records",
      headerAxis: "row",
      bounds: { startRow: 3, endRow: 4, startCol: 0, endCol: 1 },
      axisAnchorCell: { row: 3, col: 1 },
    });
    expect(anchorCellValue(region, s)).toBe("footer anchor");
  });

  test("returns null for numeric or blank anchor cells", () => {
    const s = sheet([
      ["", ""],
      ["", ""],
      ["", ""],
      [42, ""],
    ]);
    const region = baseRegion({
      orientation: "cells-as-records",
      headerAxis: "row",
      bounds: { startRow: 3, endRow: 3, startCol: 0, endCol: 1 },
    });
    expect(anchorCellValue(region, s)).toBe(null);
  });
});

describe("computeSegmentOverlays", () => {
  test("returns no overlays for a headerless region", () => {
    const region: RegionDraft = {
      id: "r",
      sheetId: "s",
      targetEntityDefinitionId: "ent_a",
      bounds: { startRow: 0, endRow: 3, startCol: 0, endCol: 3 },
      headerAxes: [],
      recordsAxis: "column",
    };
    expect(computeSegmentOverlays(region)).toEqual([]);
  });

  test("row-axis segments paint the top header row, one overlay per segment", () => {
    const region: RegionDraft = {
      id: "r",
      sheetId: "s",
      targetEntityDefinitionId: "ent_a",
      bounds: { startRow: 2, endRow: 10, startCol: 1, endCol: 5 },
      headerAxes: ["row"],
      segmentsByAxis: {
        row: [
          { kind: "field", positionCount: 2 },
          { kind: "skip", positionCount: 1 },
          { kind: "field", positionCount: 2 },
        ],
      },
    };
    const overlays = computeSegmentOverlays(region);
    expect(overlays).toHaveLength(3);
    expect(overlays[0]).toMatchObject({
      axis: "row",
      segmentIndex: 0,
      kind: "field",
      bounds: { startRow: 2, endRow: 2, startCol: 1, endCol: 2 },
    });
    expect(overlays[1]).toMatchObject({
      axis: "row",
      segmentIndex: 1,
      kind: "skip",
      bounds: { startRow: 2, endRow: 2, startCol: 3, endCol: 3 },
    });
    expect(overlays[2]).toMatchObject({
      axis: "row",
      segmentIndex: 2,
      kind: "field",
      bounds: { startRow: 2, endRow: 2, startCol: 4, endCol: 5 },
    });
  });

  test("pivot overlays include the axisName and a dynamic flag when the pivot grows", () => {
    const region: RegionDraft = {
      id: "r",
      sheetId: "s",
      targetEntityDefinitionId: "ent_a",
      bounds: { startRow: 0, endRow: 3, startCol: 0, endCol: 2 },
      headerAxes: ["row"],
      segmentsByAxis: {
        row: [
          {
            kind: "pivot",
            id: "p1",
            axisName: "Quarter",
            axisNameSource: "user",
            positionCount: 3,
            dynamic: { terminator: { kind: "untilBlank", consecutiveBlanks: 2 } },
          },
        ],
      },
    };
    const overlays = computeSegmentOverlays(region);
    expect(overlays).toHaveLength(1);
    expect(overlays[0]).toMatchObject({
      axis: "row",
      kind: "pivot",
      label: "Quarter",
      dynamic: true,
    });
  });

  test("falls back to (unnamed) when a pivot has no axisName yet", () => {
    const region: RegionDraft = {
      id: "r",
      sheetId: "s",
      targetEntityDefinitionId: "ent_a",
      bounds: { startRow: 0, endRow: 3, startCol: 0, endCol: 0 },
      headerAxes: ["column"],
      segmentsByAxis: {
        column: [
          {
            kind: "pivot",
            id: "p1",
            axisName: "",
            axisNameSource: "user",
            positionCount: 4,
          },
        ],
      },
    };
    expect(computeSegmentOverlays(region)[0]).toMatchObject({
      axis: "column",
      kind: "pivot",
      label: "(unnamed)",
      dynamic: false,
    });
  });

  test("crosstab emits overlays on both axes", () => {
    const region: RegionDraft = {
      id: "r",
      sheetId: "s",
      targetEntityDefinitionId: "ent_a",
      bounds: { startRow: 0, endRow: 4, startCol: 0, endCol: 4 },
      headerAxes: ["row", "column"],
      segmentsByAxis: {
        row: [
          { kind: "skip", positionCount: 1 },
          {
            kind: "pivot",
            id: "p1",
            axisName: "Region",
            axisNameSource: "user",
            positionCount: 4,
          },
        ],
        column: [
          { kind: "skip", positionCount: 1 },
          {
            kind: "pivot",
            id: "p2",
            axisName: "Quarter",
            axisNameSource: "user",
            positionCount: 4,
          },
        ],
      },
    };
    const overlays = computeSegmentOverlays(region);
    expect(overlays.filter((o) => o.axis === "row")).toHaveLength(2);
    expect(overlays.filter((o) => o.axis === "column")).toHaveLength(2);
    // Row-axis segments paint the top row; column-axis segments paint the left column.
    const rowPivot = overlays.find(
      (o) => o.axis === "row" && o.kind === "pivot"
    )!;
    expect(rowPivot.bounds).toEqual({
      startRow: 0,
      endRow: 0,
      startCol: 1,
      endCol: 4,
    });
    const colPivot = overlays.find(
      (o) => o.axis === "column" && o.kind === "pivot"
    )!;
    expect(colPivot.bounds).toEqual({
      startRow: 1,
      endRow: 4,
      startCol: 0,
      endCol: 0,
    });
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
