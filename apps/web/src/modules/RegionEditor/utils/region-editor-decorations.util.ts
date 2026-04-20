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
  const { bounds, orientation, headerAxis, skipRules } = region;
  const { cells } = sheet;

  // A region is "pivoted" when the axis of record identity is unlabeled by the
  // data itself and the user must supply a name via recordsAxisName. In those
  // cases a single anchor cell — defaulting to the top-left corner but
  // user-overridable — is the location of the axis-name label.
  const pivotedRows =
    orientation === "rows-as-records" && headerAxis === "column";
  const pivotedCols =
    orientation === "columns-as-records" && headerAxis === "row";
  const crosstab = orientation === "cells-as-records";
  const anchor = resolveAnchorCell(region);
  const anchorAtCorner =
    anchor.row === bounds.startRow && anchor.col === bounds.startCol;
  const anchorValue = anchorCellValue(region, sheet);

  // Header row/column (skipped for crosstab and for headerAxis: "none").
  // For pivoted shapes the corner cell is carved out of the header band only
  // when the anchor sits at the default corner; when the user has overridden
  // the anchor elsewhere, the header renders as a full band and the anchor
  // decoration layers on top.
  if (orientation !== "cells-as-records") {
    if (headerAxis === "row") {
      decorations.push({
        kind: "header",
        bounds: {
          startRow: bounds.startRow,
          endRow: bounds.startRow,
          startCol:
            pivotedCols && anchorAtCorner
              ? bounds.startCol + 1
              : bounds.startCol,
          endCol: bounds.endCol,
        },
        label: "Header row",
      });
    } else if (headerAxis === "column") {
      decorations.push({
        kind: "header",
        bounds: {
          startRow:
            pivotedRows && anchorAtCorner
              ? bounds.startRow + 1
              : bounds.startRow,
          endRow: bounds.endRow,
          startCol: bounds.startCol,
          endCol: bounds.startCol,
        },
        label: "Header column",
      });
    }
  }

  // Crosstab: row-axis labels (leftmost column) and column-axis labels (top row).
  // Corner is carved out only when the anchor sits at the default corner.
  const primaryName = region.recordsAxisName?.name ?? anchorValue ?? undefined;
  const secondaryName = region.secondaryRecordsAxisName?.name;
  if (crosstab) {
    decorations.push({
      kind: "rowAxisLabel",
      bounds: {
        startRow: anchorAtCorner ? bounds.startRow + 1 : bounds.startRow,
        endRow: bounds.endRow,
        startCol: bounds.startCol,
        endCol: bounds.startCol,
      },
      label: primaryName ?? "Row axis labels",
    });
    decorations.push({
      kind: "colAxisLabel",
      bounds: {
        startRow: bounds.startRow,
        endRow: bounds.startRow,
        startCol: anchorAtCorner ? bounds.startCol + 1 : bounds.startCol,
        endCol: bounds.endCol,
      },
      label: secondaryName ?? "Column axis labels",
    });
    // Inner data rectangle — each cell is an extracted record's value under
    // `cellValueName`. Guarded on the region being at least 2×2 so we don't
    // emit a zero-area decoration when bounds collapse to the label bands.
    if (bounds.endRow > bounds.startRow && bounds.endCol > bounds.startCol) {
      decorations.push({
        kind: "cellValue",
        bounds: {
          startRow: bounds.startRow + 1,
          endRow: bounds.endRow,
          startCol: bounds.startCol + 1,
          endCol: bounds.endCol,
        },
        label: region.cellValueName?.name ?? "Cell values",
      });
    }
  }

  // Axis-name anchor — the cell where the user-provided axis name(s) apply.
  // Default position is (startRow, startCol); the user may override via
  // region.axisAnchorCell.
  if (pivotedRows || pivotedCols || crosstab) {
    const names = crosstab
      ? [primaryName, secondaryName].filter(Boolean).join(" × ")
      : (primaryName ?? "");
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

  // Skipped rows/columns — based on skip rules + orientation.
  if (skipRules && skipRules.length > 0) {
    const hasHeaderRow =
      orientation !== "cells-as-records" && headerAxis === "row";
    const hasHeaderCol =
      orientation !== "cells-as-records" && headerAxis === "column";

    const recordStartRow = hasHeaderRow ? bounds.startRow + 1 : bounds.startRow;
    const recordStartCol = hasHeaderCol ? bounds.startCol + 1 : bounds.startCol;

    const evaluateRows =
      orientation === "rows-as-records" ||
      (orientation === "cells-as-records" &&
        skipRules.some(
          (r) =>
            r.kind === "blank" ||
            (r.kind === "cellMatches" && r.axis !== "column")
        ));
    const evaluateCols =
      orientation === "columns-as-records" ||
      (orientation === "cells-as-records" &&
        skipRules.some((r) => r.kind === "cellMatches" && r.axis === "column"));

    if (evaluateRows) {
      const startRow =
        orientation === "cells-as-records"
          ? bounds.startRow + 1
          : recordStartRow;
      const startCol =
        orientation === "cells-as-records"
          ? bounds.startCol + 1
          : bounds.startCol;
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
      const startRow =
        orientation === "cells-as-records"
          ? bounds.startRow + 1
          : bounds.startRow;
      const startCol =
        orientation === "cells-as-records"
          ? bounds.startCol + 1
          : recordStartCol;
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
