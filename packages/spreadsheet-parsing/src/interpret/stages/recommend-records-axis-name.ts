import type { AxisMember, Region, Segment } from "../../plan/index.js";
import type { Sheet } from "../../workbook/index.js";
import { DEFAULT_INTERPRET_CONCURRENCY } from "../deps.js";
import type { InterpretDeps } from "../deps.js";
import type { InterpretState } from "../types.js";
import { pLimit } from "../util/p-limit.js";

const MAX_AXIS_LABELS = 30;

type PivotSegment = Extract<Segment, { kind: "pivot" }>;

function firstPivotSegment(region: Region): {
  segment: PivotSegment;
  axis: AxisMember;
} | null {
  for (const axis of ["row", "column"] as const) {
    for (const seg of region.segmentsByAxis?.[axis] ?? []) {
      if (seg.kind === "pivot") return { segment: seg, axis };
    }
  }
  return null;
}

/**
 * Collect the pivot segment's labels along its header axis, skipping the
 * axis-anchor position (which holds the axis *name*, not a label).
 */
function collectPivotLabels(
  region: Region,
  sheet: Sheet,
  axis: AxisMember
): string[] {
  const anchor = region.axisAnchorCell ?? {
    row: region.bounds.startRow,
    col: region.bounds.startCol,
  };
  const labels: string[] = [];
  if (axis === "row") {
    const row = anchor.row;
    for (let c = region.bounds.startCol; c <= region.bounds.endCol; c++) {
      if (c === anchor.col) continue;
      const cell = sheet.cell(row, c);
      if (cell && cell.value !== null) labels.push(String(cell.value));
    }
  } else {
    const col = anchor.col;
    for (let r = region.bounds.startRow; r <= region.bounds.endRow; r++) {
      if (r === anchor.row) continue;
      const cell = sheet.cell(r, col);
      if (cell && cell.value !== null) labels.push(String(cell.value));
    }
  }
  return labels
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .slice(0, MAX_AXIS_LABELS);
}

/**
 * Stage 5 — fires for each pivot-bearing region whose pivot segment does not
 * already carry a user-supplied `axisName`. Calls the injected recommender
 * once per eligible pivot segment; default returns null which leaves the
 * region unchanged. Suggestions are keyed by pivot-segment id.
 */
export async function recommendRecordsAxisName(
  state: InterpretState,
  deps: InterpretDeps = {}
): Promise<InterpretState> {
  const next = new Map(state.segmentAxisNameSuggestions);
  const recommender = deps.axisNameRecommender;
  if (!recommender) return { ...state, segmentAxisNameSuggestions: next };

  type PendingWork = { segmentId: string; labels: string[] };
  const pending: PendingWork[] = [];
  for (const region of state.detectedRegions) {
    const pivot = firstPivotSegment(region);
    if (!pivot) continue;
    if (pivot.segment.axisNameSource === "user") continue;
    const sheet = state.workbook.sheets.find((s) => s.name === region.sheet);
    if (!sheet) continue;
    const labels = collectPivotLabels(region, sheet, pivot.axis);
    if (labels.length === 0) continue;
    pending.push({ segmentId: pivot.segment.id, labels });
  }

  const limit = pLimit(deps.concurrency ?? DEFAULT_INTERPRET_CONCURRENCY);
  const results = await Promise.all(
    pending.map((work) =>
      limit(() => Promise.resolve(recommender(work.labels)))
    )
  );
  for (let i = 0; i < pending.length; i++) {
    const raw = results[i];
    const suggestion =
      raw && typeof raw === "object" && "suggestion" in raw
        ? raw.suggestion
        : raw;
    if (suggestion && suggestion.name.trim() !== "") {
      next.set(pending[i].segmentId, suggestion);
    }
  }
  return { ...state, segmentAxisNameSuggestions: next };
}
