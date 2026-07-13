/**
 * Compute the dropdown options for the IdentityPanel — one entry per
 * candidate column (records-are-rows) or row (records-are-columns) inside
 * the region's bounds. Each entry carries a `uniqueness` flag derived from
 * a live walk of the workbook's cached cells; the IdentityPanel renders
 * the flag as a tag (`unique` / `may have duplicates` / `all blank`).
 *
 * Live compute, not pre-compute (see `RECORD_IDENTITY_REVIEW.spec.md` §9 Q3
 * and the Phase D plan §D.3): the editor already holds the workbook in
 * memory, so a per-render walk is cheaper than persisting a `uniqueness`
 * map on the plan and invalidating it on every cell edit. Memoize the
 * result on `region.bounds + region.id` at the call site if the option
 * count grows large.
 *
 * 2D crosstabs return `[]` — single-locator identity is meaningless when
 * each body cell is its own record. The IdentityPanel's `Use position-
 * based ids` sentinel covers that case.
 */

import type {
  CellValue,
  RegionDraft,
  SheetPreview,
} from "./region-editor.types";

/**
 * `"unique"` / `"non-unique"` / `"all-blank"` are conclusive verdicts
 * over every row in the region's range. `"unknown"` is the sliced-sheet
 * verdict: at least one row in the range isn't loaded into
 * `sheet.cells` yet, so we can't tell. The commit-time drift gate is
 * the authoritative check in that case — see
 * `assertDriftAllowsCommit` / `LAYOUT_PLAN_DRIFT_IDENTITY_CHANGED`.
 */
export type LocatorUniqueness =
  | "unique"
  | "non-unique"
  | "all-blank"
  | "unknown";

export interface LocatorOption {
  /** Stable opaque key used by the dropdown's selection state. */
  key: string;
  /** Header-cell value to render in the dropdown; falls back to a placeholder. */
  label: string;
  uniqueness: LocatorUniqueness;
  /**
   * The axis the locator points at — `"column"` for records-are-rows
   * (locator is a column), `"row"` for records-are-columns. Pairs with
   * `index` to produce the structured `Locator` written onto the draft.
   */
  axis: "row" | "column";
  /** 0-based index along the chosen axis (column or row). */
  index: number;
}

function cellText(value: CellValue | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function recordsAxisOfDraft(region: RegionDraft): "row" | "column" | undefined {
  if (region.headerAxes && region.headerAxes.length === 1) {
    return region.headerAxes[0];
  }
  if ((region.headerAxes?.length ?? 0) === 0 && region.recordsAxis) {
    return region.recordsAxis;
  }
  return undefined;
}

function classifyUniqueness(
  values: string[],
  anyUnloaded: boolean
): LocatorUniqueness {
  // If even one row in the range isn't loaded into `sheet.cells`, the
  // verdict isn't authoritative — sliced sheets (>~30 visible rows on
  // a large workbook) read the rest as `undefined` and would otherwise
  // be lumped in with genuine blanks, producing a false `"unique"`
  // verdict that the commit-time drift gate then rejects.
  if (anyUnloaded) return "unknown";
  const nonEmpty = values.filter((v) => v !== "");
  if (nonEmpty.length === 0) return "all-blank";
  if (new Set(nonEmpty).size !== nonEmpty.length) return "non-unique";
  // A column/row with only one non-empty value is technically unique but
  // also useless as an identity locator. We still flag it as `unique` so
  // the user can pick it (e.g. small sheets) — the inline "may have
  // duplicates" warning is for ambiguous picks, not for sparse ones.
  return "unique";
}

export function computeLocatorOptions(
  region: RegionDraft,
  sheet: SheetPreview
): LocatorOption[] {
  const recAxis = recordsAxisOfDraft(region);
  if (!recAxis) return [];

  const { bounds } = region;
  const out: LocatorOption[] = [];

  if (recAxis === "row") {
    // Records iterate rows; locator picks a column. Header lives at the
    // top of the region — `bounds.startRow` is the header row by convention
    // (the editor's preview pipeline uses the same default).
    const headerRow = bounds.startRow;
    const dataStart = headerRow + 1;
    // Pre-compute which rows in the data range are loaded — sliced
    // sheets leave `sheet.cells[r]` as `undefined` for rows the canvas
    // hasn't fetched yet. The per-column scan below downgrades the
    // verdict to `"unknown"` whenever this is true.
    let anyUnloaded = false;
    for (let r = dataStart; r <= bounds.endRow; r++) {
      if (sheet.cells[r] === undefined) {
        anyUnloaded = true;
        break;
      }
    }
    for (let c = bounds.startCol; c <= bounds.endCol; c++) {
      const headerCell = cellText(sheet.cells[headerRow]?.[c]);
      const values: string[] = [];
      for (let r = dataStart; r <= bounds.endRow; r++) {
        const row = sheet.cells[r];
        if (row === undefined) continue;
        values.push(cellText(row[c]));
      }
      out.push({
        key: `col:${c}`,
        label: headerCell.trim() !== "" ? headerCell : `col ${c + 1}`,
        uniqueness: classifyUniqueness(values, anyUnloaded),
        axis: "column",
        index: c,
      });
    }
    return out;
  }

  // recAxis === "column": records iterate columns; locator picks a row.
  const headerCol = bounds.startCol;
  const dataStart = headerCol + 1;
  for (let r = bounds.startRow; r <= bounds.endRow; r++) {
    const headerCell = cellText(sheet.cells[r]?.[headerCol]);
    // For pivoted records (records-are-columns), an unloaded header row
    // means we can't tell the row's values at all — flag the whole row's
    // option as `"unknown"`. Inner-cell unloads are folded into the same
    // verdict since the data range is along columns of a single loaded
    // row; an unloaded source row implies no data at all.
    if (sheet.cells[r] === undefined) {
      out.push({
        key: `row:${r}`,
        label: `row ${r + 1}`,
        uniqueness: "unknown",
        axis: "row",
        index: r,
      });
      continue;
    }
    const values: string[] = [];
    for (let c = dataStart; c <= bounds.endCol; c++) {
      values.push(cellText(sheet.cells[r]?.[c]));
    }
    out.push({
      key: `row:${r}`,
      label: headerCell.trim() !== "" ? headerCell : `row ${r + 1}`,
      uniqueness: classifyUniqueness(values, false),
      axis: "row",
      index: r,
    });
  }
  return out;
}
