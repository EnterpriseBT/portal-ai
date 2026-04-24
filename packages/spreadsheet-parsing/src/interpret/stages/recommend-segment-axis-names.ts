import type { AxisMember, Region, Segment } from "../../plan/index.js";
import type { Sheet } from "../../workbook/index.js";
import { DEFAULT_INTERPRET_CONCURRENCY } from "../deps.js";
import type { InterpretDeps } from "../deps.js";
import type { InterpretState } from "../types.js";
import { pLimit } from "../util/p-limit.js";
import { readHeaderLineLabels } from "./header-line.util.js";
import { resolveEffectiveSegments } from "./pivoted.util.js";

const MAX_AXIS_LABELS = 30;

type PivotSegment = Extract<Segment, { kind: "pivot" }>;

function pickHeaderIndex(
  state: InterpretState,
  region: Region,
  axis: AxisMember
): number | null {
  const candidates = state.headerCandidates.get(region.id) ?? [];
  const best = candidates.find((c) => c.axis === axis);
  return best ? best.index : null;
}

/**
 * Read the slice of the header line covered by a single segment starting at
 * `offset` positions from the axis start. Blank labels are dropped; the
 * result is capped at `MAX_AXIS_LABELS` to keep prompts bounded.
 */
function collectSegmentLabels(
  region: Region,
  axis: AxisMember,
  segment: PivotSegment,
  offset: number,
  sheet: Sheet,
  headerIndex: number
): string[] {
  const allLabels = readHeaderLineLabels(region, axis, sheet, headerIndex);
  const out: string[] = [];
  for (let i = 0; i < segment.positionCount; i++) {
    const label = allLabels[offset + i];
    if (!label || label === "") continue;
    out.push(label);
    if (out.length >= MAX_AXIS_LABELS) break;
  }
  return out;
}

/**
 * Stage 6 — fires the injected axis-name recommender once per pivot segment
 * whose `axisNameSource !== "user"`. Reads segmentation from
 * `state.segmentsByRegion` (PR-2 detect-segments output); regions without
 * any pivot segment are a no-op. Suggestions are written to
 * `state.segmentAxisNameSuggestions` keyed by segment id and later applied
 * onto `region.segmentsByAxis` by `proposeBindings`.
 */
export async function recommendSegmentAxisNames(
  state: InterpretState,
  deps: InterpretDeps = {}
): Promise<InterpretState> {
  const recommender = deps.axisNameRecommender;
  const next = new Map(state.segmentAxisNameSuggestions);
  if (!recommender) return { ...state, segmentAxisNameSuggestions: next };

  type Pending = { segmentId: string; labels: string[] };
  const pending: Pending[] = [];

  for (const region of state.detectedRegions) {
    const segmentsByAxis = resolveEffectiveSegments(
      region,
      state.segmentsByRegion.get(region.id)
    );
    if (!segmentsByAxis) continue;
    const sheet = state.workbook.sheets.find((s) => s.name === region.sheet);
    if (!sheet) continue;
    for (const axis of region.headerAxes) {
      const segments = segmentsByAxis[axis];
      if (!segments || segments.length === 0) continue;
      const headerIndex = pickHeaderIndex(state, region, axis);
      if (headerIndex === null) continue;

      let offset = 0;
      for (const segment of segments) {
        if (segment.kind === "pivot" && segment.axisNameSource !== "user") {
          const labels = collectSegmentLabels(
            region,
            axis,
            segment,
            offset,
            sheet,
            headerIndex
          );
          if (labels.length > 0) {
            pending.push({ segmentId: segment.id, labels });
          }
        }
        offset += segment.positionCount;
      }
    }
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
