import type {
  CellBounds,
  CellCoord,
  CellValue,
  RegionDraft,
  SheetPreview,
  SkipRuleDraft,
} from "./region-editor.types";

/** Resolve the region's axis-name anchor cell, defaulting to the top-left of bounds. */
export function resolveAnchorCell(region: RegionDraft): CellCoord {
  return (
    region.axisAnchorCell ?? {
      row: region.bounds.startRow,
      col: region.bounds.startCol,
    }
  );
}

/**
 * Read the non-blank string value (if any) at the region's anchor cell. Used to
 * propose a default `recordsAxisName` when the user hasn't supplied one.
 * Numeric or blank anchors return `null` — we don't auto-default numeric axis names.
 */
export function anchorCellValue(
  region: RegionDraft,
  sheet: SheetPreview
): string | null {
  const anchor = resolveAnchorCell(region);
  const v = sheet.cells?.[anchor.row]?.[anchor.col];
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed ? trimmed : null;
}

export type DecorationKind =
  | "header"
  | "rowAxisLabel"
  | "colAxisLabel"
  | "axisNameAnchor"
  | "cellValue"
  | "skipped";

export interface RegionDecoration {
  kind: DecorationKind;
  bounds: CellBounds;
  label?: string;
}

/** Solid fills shown over the region background. Kept transparent so cell text stays legible. */
export const DECORATION_COLOR: Record<DecorationKind, string> = {
  header: "rgba(37, 99, 235, 0.22)",
  rowAxisLabel: "rgba(147, 51, 234, 0.22)",
  colAxisLabel: "rgba(219, 39, 119, 0.22)",
  axisNameAnchor: "rgba(234, 88, 12, 0.38)",
  cellValue: "rgba(13, 148, 136, 0.12)",
  skipped: "rgba(100, 116, 139, 0.18)",
};

/** Optional secondary styling — used by skipped to get the striped "excluded" treatment. */
export const DECORATION_BACKGROUND_IMAGE: Partial<
  Record<DecorationKind, string>
> = {
  skipped:
    "repeating-linear-gradient(45deg, rgba(100,116,139,0.45) 0 6px, transparent 6px 12px)",
};

export const DECORATION_LABEL: Record<DecorationKind, string> = {
  header: "Header",
  rowAxisLabel: "Row axis labels",
  colAxisLabel: "Column axis labels",
  axisNameAnchor: "Axis name",
  cellValue: "Cell values",
  skipped: "Skipped",
};

function cellBlank(v: CellValue | undefined): boolean {
  return v === null || v === undefined || v === "";
}

function rowIsBlank(
  cells: CellValue[][],
  row: number,
  startCol: number,
  endCol: number
): boolean {
  for (let c = startCol; c <= endCol; c++) {
    if (!cellBlank(cells[row]?.[c])) return false;
  }
  return true;
}

function colIsBlank(
  cells: CellValue[][],
  col: number,
  startRow: number,
  endRow: number
): boolean {
  for (let r = startRow; r <= endRow; r++) {
    if (!cellBlank(cells[r]?.[col])) return false;
  }
  return true;
}

function regexSafe(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

function ruleMatchesRow(
  rule: SkipRuleDraft,
  row: number,
  cells: CellValue[][],
  bounds: CellBounds
): boolean {
  if (rule.kind === "blank") {
    return rowIsBlank(cells, row, bounds.startCol, bounds.endCol);
  }
  if (rule.crossAxisIndex === undefined) return false;
  const cell = cells[row]?.[rule.crossAxisIndex];
  const rx = regexSafe(rule.pattern);
  // Coerce null/undefined to "" so patterns like ^$ can match empty cells.
  return Boolean(rx && rx.test(cell == null ? "" : String(cell)));
}

function ruleMatchesCol(
  rule: SkipRuleDraft,
  col: number,
  cells: CellValue[][],
  bounds: CellBounds
): boolean {
  if (rule.kind === "blank") {
    return colIsBlank(cells, col, bounds.startRow, bounds.endRow);
  }
  if (rule.crossAxisIndex === undefined) return false;
  const cell = cells[rule.crossAxisIndex]?.[col];
  const rx = regexSafe(rule.pattern);
  // Coerce null/undefined to "" so patterns like ^$ can match empty cells.
  return Boolean(rx && rx.test(cell == null ? "" : String(cell)));
}

export function computeRegionDecorations(
  region: RegionDraft,
  sheet: SheetPreview
): RegionDecoration[] {
  const decorations: RegionDecoration[] = [];
  const { bounds, skipRules } = region;
  const { cells } = sheet;

  const axes = region.headerAxes ?? [];
  const crosstab = axes.length === 2;
  const hasRowHeader = axes.includes("row");
  const hasColHeader = axes.includes("column");
  const rowSegs = region.segmentsByAxis?.row ?? [];
  const colSegs = region.segmentsByAxis?.column ?? [];
  const rowPivot = rowSegs.find((s) => s.kind === "pivot");
  const colPivot = colSegs.find((s) => s.kind === "pivot");
  const pivoted = !!rowPivot || !!colPivot;

  const anchor = resolveAnchorCell(region);
  const anchorAtCorner =
    anchor.row === bounds.startRow && anchor.col === bounds.startCol;
  const anchorValue = anchorCellValue(region, sheet);

  // Header bands for 1D regions. The corner cell is carved out only when the
  // region is pivoted on that axis AND the anchor sits at the default
  // top-left; otherwise the header renders as a full band and the anchor
  // decoration layers on top.
  if (hasRowHeader && !crosstab) {
    decorations.push({
      kind: "header",
      bounds: {
        startRow: bounds.startRow,
        endRow: bounds.startRow,
        startCol:
          rowPivot && anchorAtCorner ? bounds.startCol + 1 : bounds.startCol,
        endCol: bounds.endCol,
      },
      label: "Header row",
    });
  } else if (hasColHeader && !crosstab) {
    decorations.push({
      kind: "header",
      bounds: {
        startRow:
          colPivot && anchorAtCorner ? bounds.startRow + 1 : bounds.startRow,
        endRow: bounds.endRow,
        startCol: bounds.startCol,
        endCol: bounds.startCol,
      },
      label: "Header column",
    });
  }

  // Crosstab: row-axis labels (leftmost column) and column-axis labels (top
  // row). Corner is carved out only when the anchor sits at the default
  // corner. Names come from the first pivot segment on each axis.
  if (crosstab) {
    decorations.push({
      kind: "rowAxisLabel",
      bounds: {
        startRow: anchorAtCorner ? bounds.startRow + 1 : bounds.startRow,
        endRow: bounds.endRow,
        startCol: bounds.startCol,
        endCol: bounds.startCol,
      },
      label: rowPivot?.axisName ?? "Row axis labels",
    });
    decorations.push({
      kind: "colAxisLabel",
      bounds: {
        startRow: bounds.startRow,
        endRow: bounds.startRow,
        startCol: anchorAtCorner ? bounds.startCol + 1 : bounds.startCol,
        endCol: bounds.endCol,
      },
      label: colPivot?.axisName ?? "Column axis labels",
    });
    // Inner data rectangle — each cell is an extracted record's value under
    // `cellValueField.name`. Guarded on the region being at least 2×2 so we
    // don't emit a zero-area decoration when bounds collapse to the label
    // bands.
    if (bounds.endRow > bounds.startRow && bounds.endCol > bounds.startCol) {
      decorations.push({
        kind: "cellValue",
        bounds: {
          startRow: bounds.startRow + 1,
          endRow: bounds.endRow,
          startCol: bounds.startCol + 1,
          endCol: bounds.endCol,
        },
        label: region.cellValueField?.name ?? "Cell values",
      });
    }
  }

  // Axis-name anchor — the cell where the pivot's axis name lives. Default
  // position is (startRow, startCol); the user may override via
  // region.axisAnchorCell. Rendered only on pivoted regions since that's
  // when the axis-name label matters.
  if (pivoted) {
    let names: string;
    if (crosstab) {
      // Legacy behavior: when the primary-axis name is unset, fall back
      // to the anchor cell's value ("student" etc.) so crosstab anchors
      // still get a useful label mid-edit.
      const rowName = rowPivot?.axisName || anchorValue || "";
      const colName = colPivot?.axisName ?? "";
      names = [rowName, colName].filter(Boolean).join(" × ");
    } else {
      const pivotAxisName = rowPivot?.axisName ?? colPivot?.axisName ?? "";
      names = pivotAxisName || anchorValue || "";
    }
    decorations.push({
      kind: "axisNameAnchor",
      bounds: {
        startRow: anchor.row,
        endRow: anchor.row,
        startCol: anchor.col,
        endCol: anchor.col,
      },
      label: names || "Axis name goes here",
    });
  }

  // Skip rules — evaluated along the record axis. For crosstab, rules can
  // target rows or columns via `rule.axis`; for 1D, the record axis is the
  // axis opposite the header; for headerless, `region.recordsAxis` picks.
  if (skipRules && skipRules.length > 0) {
    const recordStartRow = hasRowHeader ? bounds.startRow + 1 : bounds.startRow;
    const recordStartCol = hasColHeader ? bounds.startCol + 1 : bounds.startCol;

    let evaluateRows: boolean;
    let evaluateCols: boolean;
    if (crosstab) {
      evaluateRows = skipRules.some(
        (r) =>
          r.kind === "blank" || (r.kind === "cellMatches" && r.axis !== "column")
      );
      evaluateCols = skipRules.some(
        (r) => r.kind === "cellMatches" && r.axis === "column"
      );
    } else if (hasRowHeader) {
      evaluateRows = true;
      evaluateCols = false;
    } else if (hasColHeader) {
      evaluateRows = false;
      evaluateCols = true;
    } else {
      // headerless: recordsAxis='column' means records run along the column
      // axis (each row is a record); recordsAxis='row' means each column is a
      // record.
      evaluateRows = region.recordsAxis !== "row";
      evaluateCols = region.recordsAxis === "row";
    }

    if (evaluateRows) {
      const startRow = crosstab ? bounds.startRow + 1 : recordStartRow;
      const startCol = crosstab ? bounds.startCol + 1 : bounds.startCol;
      const scanBounds: CellBounds = {
        startRow,
        endRow: bounds.endRow,
        startCol,
        endCol: bounds.endCol,
      };
      for (let row = startRow; row <= bounds.endRow; row++) {
        const match = skipRules.some((rule) =>
          ruleMatchesRow(rule, row, cells, scanBounds)
        );
        if (match) {
          decorations.push({
            kind: "skipped",
            bounds: {
              startRow: row,
              endRow: row,
              startCol: bounds.startCol,
              endCol: bounds.endCol,
            },
            label: "Skipped row",
          });
        }
      }
    }

    if (evaluateCols) {
      const startRow = crosstab ? bounds.startRow + 1 : bounds.startRow;
      const startCol = crosstab ? bounds.startCol + 1 : recordStartCol;
      const scanBounds: CellBounds = {
        startRow,
        endRow: bounds.endRow,
        startCol,
        endCol: bounds.endCol,
      };
      for (let col = startCol; col <= bounds.endCol; col++) {
        const match = skipRules.some((rule) =>
          ruleMatchesCol(rule, col, cells, scanBounds)
        );
        if (match) {
          decorations.push({
            kind: "skipped",
            bounds: {
              startRow: bounds.startRow,
              endRow: bounds.endRow,
              startCol: col,
              endCol: col,
            },
            label: "Skipped column",
          });
        }
      }
    }
  }

  return decorations;
}

/** The set of decoration kinds that actually appear for the given region — used by the legend. */
export function activeDecorationKinds(
  decorations: RegionDecoration[]
): DecorationKind[] {
  const set = new Set<DecorationKind>();
  for (const d of decorations) set.add(d.kind);
  return Array.from(set);
}
