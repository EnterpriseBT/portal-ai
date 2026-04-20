import type { Region } from "../plan/index.js";
import type { Sheet, WorkbookCell } from "../workbook/types.js";
import type { ResolvedBounds } from "./resolve-bounds.js";

export type HeaderAxisDirection = "row" | "column" | "none";

export interface HeaderLayout {
  direction: HeaderAxisDirection;
  /** 1-based sheet index of the header slice (row or column). */
  index: number;
  /**
   * Map from header-label → the sheet coordinate where data values for that
   * label live. For rows-as-records this is a column index; for
   * columns-as-records with rowLabels this is a row index.
   */
  coordByLabel: Map<string, number>;
  /** Observed labels (sorted by their offset in the region). */
  labels: string[];
}

function cellText(cell: WorkbookCell | undefined): string {
  if (!cell || cell.value === null) return "";
  if (cell.value instanceof Date) return cell.value.toISOString();
  if (typeof cell.value === "boolean") return cell.value ? "true" : "false";
  return String(cell.value);
}

/**
 * Compute the header layout for a region given the resolved bounds. Returns
 * the axis and index of the header slice plus a label→coord map the extractor
 * uses to resolve `byHeaderName` bindings.
 *
 * For `headerAxis === "none"` returns a direction: "none" layout with an
 * empty map; consumers should use `byColumnIndex` bindings in that case.
 */
export function resolveHeaders(
  region: Region,
  sheet: Sheet,
  bounds: ResolvedBounds
): HeaderLayout {
  if (region.headerAxis === "none" || !region.headerStrategy) {
    return {
      direction: "none",
      index: 0,
      coordByLabel: new Map(),
      labels: [],
    };
  }

  const strategy = region.headerStrategy;
  const coordByLabel = new Map<string, number>();
  const labels: string[] = [];

  if (strategy.kind === "row") {
    const row =
      strategy.locator.kind === "row"
        ? strategy.locator.row
        : strategy.locator.kind === "cell"
          ? strategy.locator.row
          : bounds.startRow;
    for (let c = bounds.startCol; c <= bounds.endCol; c++) {
      const label = cellText(sheet.cell(row, c));
      labels.push(label);
      if (label !== "" && !coordByLabel.has(label)) {
        coordByLabel.set(label, c);
      }
    }
    return { direction: "row", index: row, coordByLabel, labels };
  }

  if (strategy.kind === "column") {
    const col =
      strategy.locator.kind === "column"
        ? strategy.locator.col
        : strategy.locator.kind === "cell"
          ? strategy.locator.col
          : bounds.startCol;
    for (let r = bounds.startRow; r <= bounds.endRow; r++) {
      const label = cellText(sheet.cell(r, col));
      labels.push(label);
      if (label !== "" && !coordByLabel.has(label)) {
        coordByLabel.set(label, r);
      }
    }
    return { direction: "column", index: col, coordByLabel, labels };
  }

  // "rowLabels" — field names live in a column; each row's first cell is
  // a field name for columns-as-records records.
  const col =
    strategy.locator.kind === "column"
      ? strategy.locator.col
      : strategy.locator.kind === "cell"
        ? strategy.locator.col
        : bounds.startCol;
  for (let r = bounds.startRow; r <= bounds.endRow; r++) {
    const label = cellText(sheet.cell(r, col));
    labels.push(label);
    if (label !== "" && !coordByLabel.has(label)) {
      coordByLabel.set(label, r);
    }
  }
  return { direction: "column", index: col, coordByLabel, labels };
}
