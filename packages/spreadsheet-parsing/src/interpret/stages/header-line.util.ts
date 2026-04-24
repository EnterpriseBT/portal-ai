import type { AxisMember, Region } from "../../plan/index.js";
import type { Sheet, WorkbookCell } from "../../workbook/types.js";

/**
 * Rectangular bounds along which to walk a header line. Structurally
 * compatible with `Region["bounds"]` and `replay/ResolvedBounds`, so callers
 * may pass either. Declared locally so this helper stays in the main
 * (browser-safe) entry without reaching into `/replay`.
 */
export interface HeaderLineBounds {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

function assertAxisInHeader(region: Region, axis: AxisMember): void {
  if (!region.headerAxes.includes(axis)) {
    throw new Error(
      `axis "${axis}" is not in region.headerAxes [${region.headerAxes.join(", ")}]`
    );
  }
}

function labelFromCell(cell: WorkbookCell | undefined): string {
  if (!cell || cell.value === null || cell.value === undefined) return "";
  const v = cell.value;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v).trim();
}

/**
 * Sheet-space coordinates along `axis` for a single header line, in position
 * order. Row axis → sheet-col indices; column axis → sheet-row indices. Throws
 * if the axis is not declared in `region.headerAxes`.
 */
export function headerLineCoords(
  region: Region,
  axis: AxisMember,
  bounds: HeaderLineBounds
): number[] {
  assertAxisInHeader(region, axis);
  const out: number[] = [];
  if (axis === "row") {
    for (let c = bounds.startCol; c <= bounds.endCol; c++) out.push(c);
  } else {
    for (let r = bounds.startRow; r <= bounds.endRow; r++) out.push(r);
  }
  return out;
}

/**
 * Labels read from a single header line, in position order. Length and order
 * match `headerLineCoords(region, axis, region.bounds)`; blank cells yield an
 * empty string so callers can rely on index alignment. Throws if the axis is
 * not declared in `region.headerAxes`.
 */
export function readHeaderLineLabels(
  region: Region,
  axis: AxisMember,
  sheet: Sheet,
  headerIndex: number
): string[] {
  const coords = headerLineCoords(region, axis, region.bounds);
  return coords.map((coord) =>
    axis === "row"
      ? labelFromCell(sheet.cell(headerIndex, coord))
      : labelFromCell(sheet.cell(coord, headerIndex))
  );
}
