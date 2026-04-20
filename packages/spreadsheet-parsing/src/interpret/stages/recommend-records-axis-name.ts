import type { Region } from "../../plan/index.js";
import type { Sheet } from "../../workbook/index.js";
import type { InterpretDeps } from "../deps.js";
import type { HeaderCandidate, InterpretState } from "../types.js";

const MAX_AXIS_LABELS = 30;

function isPivoted(region: Region): boolean {
  if (region.orientation === "cells-as-records") return true;
  if (
    region.orientation === "columns-as-records" &&
    region.headerAxis === "row"
  ) {
    return true;
  }
  if (
    region.orientation === "rows-as-records" &&
    region.headerAxis === "column"
  ) {
    return true;
  }
  return false;
}

function collectAxisLabelsFromHeader(
  header: HeaderCandidate,
  sheet: Sheet,
  region: Region
): string[] {
  const labels = header.labels.slice();
  // The axis-name anchor cell (top-left) is *not* an axis label; drop it.
  const anchor = region.axisAnchorCell ?? {
    row: region.bounds.startRow,
    col: region.bounds.startCol,
  };
  if (header.axis === "row" && header.index === anchor.row) {
    // Drop the cell at anchor.col — the column offset within the labels array
    // is (anchor.col - region.bounds.startCol).
    const idx = anchor.col - region.bounds.startCol;
    if (idx >= 0 && idx < labels.length) labels.splice(idx, 1);
  }
  if (header.axis === "column" && header.index === anchor.col) {
    const idx = anchor.row - region.bounds.startRow;
    if (idx >= 0 && idx < labels.length) labels.splice(idx, 1);
  }
  return labels
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .slice(0, MAX_AXIS_LABELS);
}

/**
 * Stage 5 — only fires for pivoted regions that do not already carry a
 * user-supplied `recordsAxisName`. Calls the injected recommender (LLM-backed
 * in Phase 4); default returns null (no recommendation), which leaves the
 * plan unchanged and lets `score-and-warn` decide whether to block the plan.
 */
export async function recommendRecordsAxisName(
  state: InterpretState,
  deps: InterpretDeps = {}
): Promise<InterpretState> {
  const next = new Map(state.recordsAxisNameSuggestions);
  const recommender = deps.axisNameRecommender;
  for (const region of state.detectedRegions) {
    if (!isPivoted(region)) continue;
    if (region.recordsAxisName && region.recordsAxisName.source === "user")
      continue;
    if (!recommender) continue;

    const sheet = state.workbook.sheets.find((s) => s.name === region.sheet);
    if (!sheet) continue;
    const headers = state.headerCandidates.get(region.id);
    const best = headers?.[0];
    if (!best) continue;

    const labels = collectAxisLabelsFromHeader(best, sheet, region);
    const raw = await recommender(labels);
    const suggestion =
      raw && typeof raw === "object" && "suggestion" in raw
        ? raw.suggestion
        : raw;
    if (suggestion && suggestion.name.trim() !== "") {
      next.set(region.id, suggestion);
    }
  }
  return { ...state, recordsAxisNameSuggestions: next };
}
