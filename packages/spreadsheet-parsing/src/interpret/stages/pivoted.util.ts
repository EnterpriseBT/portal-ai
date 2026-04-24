import {
  isPivoted as regionIsPivoted,
  type Region,
  type Segment,
} from "../../plan/index.js";

/**
 * A region is *pivoted* when it carries at least one pivot-kind segment along
 * either axis. Re-exported from the plan helper so stage code has a local
 * import point.
 */
export function isPivoted(region: Region): boolean {
  return regionIsPivoted(region);
}

/**
 * Which axis carries field-name labels — i.e., the axis the classifier should
 * scan. For 1D regions that's the single declared header axis. For crosstab
 * (2D) regions, field-name classification is not meaningful in PR-1 and the
 * stage returns `null`.
 */
export function fieldNamesAxis(region: Region): "row" | "column" | null {
  if (region.headerAxes.length === 1) return region.headerAxes[0];
  return null;
}

export type SegmentsByAxis = { row?: Segment[]; column?: Segment[] };

function hintHasUserSourcedPivot(segments: SegmentsByAxis | undefined): boolean {
  if (!segments) return false;
  for (const axis of ["row", "column"] as const) {
    for (const seg of segments[axis] ?? []) {
      if (seg.kind === "pivot" && seg.axisNameSource === "user") return true;
    }
  }
  return false;
}

function hasAnySegments(segments: SegmentsByAxis | undefined): boolean {
  if (!segments) return false;
  return Boolean(segments.row?.length || segments.column?.length);
}

/**
 * Resolve the segmentation a stage should act on for a region. Hint segments
 * win when they contain a user-sourced pivot — the user has pinned a specific
 * layout and the heuristic detector's re-clustering must not override it.
 * Otherwise the detect-segments output (per-region `computed`) is returned
 * unchanged, and an empty/absent input yields `undefined` so callers can
 * decide how to short-circuit.
 *
 * Kept in this util so classify-field-segments, recommend-segment-axis-names,
 * and propose-bindings share a single precedence rule — any divergence
 * produces bindings that the final region shape disagrees with.
 */
export function resolveEffectiveSegments(
  region: Region,
  computed: SegmentsByAxis | undefined
): SegmentsByAxis | undefined {
  const hint = region.segmentsByAxis;
  if (hintHasUserSourcedPivot(hint)) return hint;
  if (hasAnySegments(computed)) return computed;
  return undefined;
}
