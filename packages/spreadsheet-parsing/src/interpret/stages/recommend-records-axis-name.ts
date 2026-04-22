import type { Region } from "../../plan/index.js";
import type { Sheet } from "../../workbook/index.js";
import { DEFAULT_INTERPRET_CONCURRENCY } from "../deps.js";
import type { InterpretDeps } from "../deps.js";
import type { InterpretState } from "../types.js";
import { pLimit } from "../util/p-limit.js";
import { isPivoted } from "./pivoted.util.js";

const MAX_AXIS_LABELS = 30;

/**
 * Collect the records-axis labels for a pivoted region. These live on the
 * `headerAxis` line (the row/col that carries per-record identifiers like
 * `Jan, Feb, Mar`), with the axis-anchor cell excluded because that cell
 * holds the records-axis **name** ("Month"), not a label. Decoupled from
 * the detect-headers stage because that stage now scans the field-names
 * axis (orthogonal) for pivoted regions and would hand us the wrong labels.
 */
function collectRecordsAxisLabels(region: Region, sheet: Sheet): string[] {
  const anchor = region.axisAnchorCell ?? {
    row: region.bounds.startRow,
    col: region.bounds.startCol,
  };
  const labels: string[] = [];
  if (region.headerAxis === "row") {
    const row = anchor.row;
    for (let c = region.bounds.startCol; c <= region.bounds.endCol; c++) {
      if (c === anchor.col) continue;
      const cell = sheet.cell(row, c);
      if (cell && cell.value !== null) labels.push(String(cell.value));
    }
  } else if (region.headerAxis === "column") {
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
  if (!recommender) return { ...state, recordsAxisNameSuggestions: next };

  // Synchronous prep pass — collect axis labels for every region that
  // actually needs a recommendation. Skips pivoted regions with user-supplied
  // names and non-pivoted regions entirely.
  type PendingWork = { regionId: string; labels: string[] };
  const pending: PendingWork[] = [];
  for (const region of state.detectedRegions) {
    if (!isPivoted(region)) continue;
    if (region.recordsAxisName && region.recordsAxisName.source === "user")
      continue;
    const sheet = state.workbook.sheets.find((s) => s.name === region.sheet);
    if (!sheet) continue;
    const labels = collectRecordsAxisLabels(region, sheet);
    if (labels.length === 0) continue;
    pending.push({ regionId: region.id, labels });
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
      next.set(pending[i].regionId, suggestion);
    }
  }
  return { ...state, recordsAxisNameSuggestions: next };
}
