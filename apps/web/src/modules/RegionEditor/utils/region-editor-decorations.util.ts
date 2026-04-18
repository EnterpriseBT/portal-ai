import type {
  CellBounds,
  CellValue,
  RegionDraft,
  SheetPreview,
  SkipRule,
} from "./region-editor.types";

export type DecorationKind =
  | "header"
  | "rowAxisLabel"
  | "colAxisLabel"
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
  skipped: "rgba(100, 116, 139, 0.18)",
};

/** Optional secondary styling — used by skipped to get the striped "excluded" treatment. */
export const DECORATION_BACKGROUND_IMAGE: Partial<Record<DecorationKind, string>> = {
  skipped:
    "repeating-linear-gradient(45deg, rgba(100,116,139,0.45) 0 6px, transparent 6px 12px)",
};

export const DECORATION_LABEL: Record<DecorationKind, string> = {
  header: "Header",
  rowAxisLabel: "Row axis labels",
  colAxisLabel: "Column axis labels",
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
  rule: SkipRule,
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
  return Boolean(rx && cell != null && rx.test(String(cell)));
}

function ruleMatchesCol(
  rule: SkipRule,
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
  return Boolean(rx && cell != null && rx.test(String(cell)));
}

export function computeRegionDecorations(
  region: RegionDraft,
  sheet: SheetPreview
): RegionDecoration[] {
  const decorations: RegionDecoration[] = [];
  const { bounds, orientation, headerAxis, skipRules } = region;
  const { cells } = sheet;

  // Header row/column (skipped for crosstab and for headerAxis: "none")
  if (orientation !== "cells-as-records") {
    if (headerAxis === "row") {
      decorations.push({
        kind: "header",
        bounds: {
          startRow: bounds.startRow,
          endRow: bounds.startRow,
          startCol: bounds.startCol,
          endCol: bounds.endCol,
        },
        label: "Header row",
      });
    } else if (headerAxis === "column") {
      decorations.push({
        kind: "header",
        bounds: {
          startRow: bounds.startRow,
          endRow: bounds.endRow,
          startCol: bounds.startCol,
          endCol: bounds.startCol,
        },
        label: "Header column",
      });
    }
  }

  // Crosstab: row-axis labels (leftmost column minus the corner cell) and
  // column-axis labels (top row minus the corner cell).
  if (orientation === "cells-as-records") {
    decorations.push({
      kind: "rowAxisLabel",
      bounds: {
        startRow: bounds.startRow + 1,
        endRow: bounds.endRow,
        startCol: bounds.startCol,
        endCol: bounds.startCol,
      },
      label: region.recordsAxisName?.name ?? "Row axis labels",
    });
    decorations.push({
      kind: "colAxisLabel",
      bounds: {
        startRow: bounds.startRow,
        endRow: bounds.startRow,
        startCol: bounds.startCol + 1,
        endCol: bounds.endCol,
      },
      label: region.secondaryRecordsAxisName?.name ?? "Column axis labels",
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
        skipRules.some((r) => r.kind === "blank" || (r.kind === "cellMatches" && r.axis !== "column")));
    const evaluateCols =
      orientation === "columns-as-records" ||
      (orientation === "cells-as-records" &&
        skipRules.some((r) => r.kind === "cellMatches" && r.axis === "column"));

    if (evaluateRows) {
      const startRow =
        orientation === "cells-as-records" ? bounds.startRow + 1 : recordStartRow;
      const startCol =
        orientation === "cells-as-records" ? bounds.startCol + 1 : bounds.startCol;
      const scanBounds: CellBounds = {
        startRow,
        endRow: bounds.endRow,
        startCol,
        endCol: bounds.endCol,
      };
      for (let row = startRow; row <= bounds.endRow; row++) {
        const match = skipRules.some((rule) => ruleMatchesRow(rule, row, cells, scanBounds));
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
        orientation === "cells-as-records" ? bounds.startRow + 1 : bounds.startRow;
      const startCol =
        orientation === "cells-as-records" ? bounds.startCol + 1 : recordStartCol;
      const scanBounds: CellBounds = {
        startRow,
        endRow: bounds.endRow,
        startCol,
        endCol: bounds.endCol,
      };
      for (let col = startCol; col <= bounds.endCol; col++) {
        const match = skipRules.some((rule) => ruleMatchesCol(rule, col, cells, scanBounds));
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
