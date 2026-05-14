import type { AxisMember, Region } from "../../plan/index.js";
import type { Sheet, WorkbookCell } from "../../workbook/index.js";
import type { HeaderCandidate, InterpretState } from "../types.js";

const NUMERIC_RE = /^-?\d+(?:\.\d+)?$/;

function cellLabel(cell: WorkbookCell | undefined): string {
  if (!cell) return "";
  if (cell.value === null) return "";
  if (cell.value instanceof Date) return cell.value.toISOString();
  if (typeof cell.value === "boolean") return cell.value ? "true" : "false";
  return String(cell.value);
}

/**
 * Score a row/column of cells for its "header-ness". Signals:
 *   1. Non-empty cells dominate — a row of all blanks scores 0.
 *   2. Fraction of cells that are non-numeric strings.
 *   3. Distinct values — a header row rarely repeats a label.
 *   4. At least two cells — a single-cell row is more likely a title.
 */
function scoreHeaderRow(labels: string[]): number {
  if (labels.length === 0) return 0;
  const nonEmpty = labels.filter((l) => l.trim() !== "");
  if (nonEmpty.length < 2) return 0;

  const nonEmptyFraction = nonEmpty.length / labels.length;
  const nonNumericFraction =
    nonEmpty.filter((l) => !NUMERIC_RE.test(l.trim())).length / nonEmpty.length;
  const distinct = new Set(nonEmpty.map((l) => l.trim().toLowerCase()));
  const distinctFraction = distinct.size / nonEmpty.length;
  const widthBonus = Math.min(1, nonEmpty.length / 3);

  return (
    0.35 * nonEmptyFraction +
    0.35 * nonNumericFraction +
    0.2 * distinctFraction +
    0.1 * widthBonus
  );
}

function collectRowLabels(
  sheet: Sheet,
  row: number,
  startCol: number,
  endCol: number
): string[] {
  const labels: string[] = [];
  for (let c = startCol; c <= endCol; c++) {
    labels.push(cellLabel(sheet.cell(row, c)));
  }
  return labels;
}

function collectColLabels(
  sheet: Sheet,
  col: number,
  startRow: number,
  endRow: number
): string[] {
  const labels: string[] = [];
  for (let r = startRow; r <= endRow; r++) {
    labels.push(cellLabel(sheet.cell(r, col)));
  }
  return labels;
}

function candidatesForAxis(
  region: Region,
  sheet: Sheet,
  axis: AxisMember
): HeaderCandidate[] {
  const { bounds } = region;
  const out: HeaderCandidate[] = [];

  if (axis === "row") {
    for (let r = bounds.startRow; r <= bounds.endRow; r++) {
      const labels = collectRowLabels(sheet, r, bounds.startCol, bounds.endCol);
      const score = scoreHeaderRow(labels);
      if (score > 0) {
        out.push({
          axis: "row",
          index: r,
          labels,
          score,
          rationale: `Heuristic score ${score.toFixed(2)} (non-empty ${
            labels.filter((l) => l.trim() !== "").length
          }/${labels.length}).`,
        });
      }
    }
  } else {
    for (let c = bounds.startCol; c <= bounds.endCol; c++) {
      const labels = collectColLabels(sheet, c, bounds.startRow, bounds.endRow);
      const score = scoreHeaderRow(labels);
      if (score > 0) {
        out.push({
          axis: "column",
          index: c,
          labels,
          score,
          rationale: `Heuristic score ${score.toFixed(2)} (non-empty ${
            labels.filter((l) => l.trim() !== "").length
          }/${labels.length}).`,
        });
      }
    }
  }

  out.sort((a, b) => b.score - a.score || a.index - b.index);
  return out;
}

/**
 * Stage 2 — populate `headerCandidates` per region. Scans every axis in
 * `region.headerAxes` and merges the per-axis candidate lists (already sorted
 * by score within an axis). Skipped for headerless regions.
 *
 * Async only because of the `await sheet.loadRange(...)` — the underlying
 * `Sheet` may be a `LazySheet` whose row windows are backed by the chunked
 * Redis cache (see `docs/SPREADSHEET_PARSER_ROW_ASYNC.spec.md`). On an
 * `EagerSheet`, `loadRange` is a `Promise.resolve()` no-op.
 */
export async function detectHeaders(
  state: InterpretState
): Promise<InterpretState> {
  const next = new Map(state.headerCandidates);
  for (const region of state.detectedRegions) {
    const sheet = state.workbook.sheets.find((s) => s.name === region.sheet);
    if (!sheet) {
      next.set(region.id, []);
      continue;
    }
    // Cover every row the per-axis candidate walks scan. The row-axis
    // case reads cells `(r, c)` for `r ∈ [bounds.startRow, bounds.endRow]`;
    // the column-axis case reads cells `(r, c)` for the same row range.
    // One `loadRange` is enough for both.
    await sheet.loadRange(region.bounds.startRow, region.bounds.endRow);
    const merged: HeaderCandidate[] = [];
    for (const axis of region.headerAxes) {
      merged.push(...candidatesForAxis(region, sheet, axis));
    }
    next.set(region.id, merged);
  }
  return { ...state, headerCandidates: next };
}
