import type { AxisMember, Region } from "../plan/index.js";
import type { Sheet, WorkbookCell } from "../workbook/types.js";
import type { ResolvedBounds } from "./resolve-bounds.js";

export interface HeaderLayout {
  /**
   * The axis the header occupies (matches the `axis` passed in): "row" means
   * labels live along a single row; "column" means labels live along a single
   * column.
   */
  axis: AxisMember;
  /** 1-based sheet index of the header line (row if axis=row, col if axis=column). */
  index: number;
  /**
   * Label → sheet coord along the cross-axis where data for that label lives.
   * - axis=row: coord is a column index.
   * - axis=column: coord is a row index.
   */
  coordByLabel: Map<string, number>;
  /** Observed labels in position order. */
  labels: string[];
}

function cellText(cell: WorkbookCell | undefined): string {
  if (!cell || cell.value === null) return "";
  if (cell.value instanceof Date) return cell.value.toISOString();
  if (typeof cell.value === "boolean") return cell.value ? "true" : "false";
  return String(cell.value);
}

/**
 * Compute the header layout for a region on a specific axis. Returns
 * `undefined` when the region declares no header on that axis (headerless
 * region, or crosstab called with an axis not in `headerAxes`).
 */
export function resolveHeaders(
  region: Region,
  axis: AxisMember,
  sheet: Sheet,
  bounds: ResolvedBounds
): HeaderLayout | undefined {
  const strategy = region.headerStrategyByAxis?.[axis];
  if (!strategy) return undefined;

  const coordByLabel = new Map<string, number>();
  const labels: string[] = [];

  if (axis === "row") {
    // Header lives on one row; labels span columns.
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
    return { axis: "row", index: row, coordByLabel, labels };
  }

  // axis === "column": header lives in one column; labels span rows.
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
  return { axis: "column", index: col, coordByLabel, labels };
}
