import type { AxisMember, Segment } from "@portalai/core/contracts";

import type { CellBounds, RegionDraft } from "./region-editor.types";

/**
 * Adjust an axis's segment list so its `positionCount` total stays
 * aligned with a new region span.
 *
 * Axis convention: `segmentsByAxis.row` segments span the COLUMN
 * direction (their positionCount = number of columns in the region),
 * and `segmentsByAxis.column` segments span the ROW direction. So a
 * row-axis segment grows when the region gains columns; a
 * column-axis segment grows when the region gains rows.
 *
 * Expand: the trailing segment absorbs the entire delta.
 * Shrink: the trailing segment shrinks; if its positionCount would
 *   fall to ≤ 0 the segment is dropped and the residual shrink is
 *   applied to the new tail (recursively, until the delta is
 *   consumed or every segment has been dropped).
 */
function adjustTailSegment(
  segments: Segment[] | undefined,
  delta: number
): Segment[] | undefined {
  if (delta === 0) return segments;
  if (!segments || segments.length === 0) return segments;
  const next = segments.map((s) => ({ ...s }));
  let remaining = delta;
  while (remaining < 0 && next.length > 0) {
    const tail = next[next.length - 1]!;
    if (tail.positionCount + remaining <= 0) {
      // The tail can't absorb the full shrink — drop it and apply
      // what's left to the segment behind it.
      remaining += tail.positionCount;
      next.pop();
    } else {
      next[next.length - 1] = {
        ...tail,
        positionCount: tail.positionCount + remaining,
      };
      remaining = 0;
    }
  }
  if (remaining > 0 && next.length > 0) {
    const tail = next[next.length - 1]!;
    next[next.length - 1] = {
      ...tail,
      positionCount: tail.positionCount + remaining,
    };
  }
  return next;
}

function boundsEqual(a: CellBounds, b: CellBounds): boolean {
  return (
    a.startRow === b.startRow &&
    a.endRow === b.endRow &&
    a.startCol === b.startCol &&
    a.endCol === b.endCol
  );
}

/**
 * Recompute a region's `segmentsByAxis` to match a new bounds rect.
 * Pure — does NOT mutate; returns the new object (or undefined when
 * the region had no segments). Returned shape preserves the axis
 * key/value invariants the consumer expects: keys are present only
 * when their array has at least one entry.
 */
export function adjustSegmentsForBoundsChange(
  prevBounds: CellBounds,
  nextBounds: CellBounds,
  segmentsByAxis: RegionDraft["segmentsByAxis"]
): RegionDraft["segmentsByAxis"] {
  if (!segmentsByAxis) return undefined;
  const prevColSpan = prevBounds.endCol - prevBounds.startCol + 1;
  const nextColSpan = nextBounds.endCol - nextBounds.startCol + 1;
  const colDelta = nextColSpan - prevColSpan;

  const prevRowSpan = prevBounds.endRow - prevBounds.startRow + 1;
  const nextRowSpan = nextBounds.endRow - nextBounds.startRow + 1;
  const rowDelta = nextRowSpan - prevRowSpan;

  const adjusted: { row?: Segment[]; column?: Segment[] } = {};
  for (const axis of ["row", "column"] as AxisMember[]) {
    const delta = axis === "row" ? colDelta : rowDelta;
    const adjustedSegs = adjustTailSegment(segmentsByAxis[axis], delta);
    if (adjustedSegs && adjustedSegs.length > 0) {
      adjusted[axis] = adjustedSegs;
    }
  }
  return Object.keys(adjusted).length > 0 ? adjusted : undefined;
}

/**
 * Merge a `Partial<RegionDraft>` patch into a region. When the patch
 * carries a `bounds` change, the region's segments are auto-adjusted
 * via `adjustSegmentsForBoundsChange` — so canvas drag-resize, the
 * manual bounds inputs, and any other future bounds-changing path
 * all keep `segmentsByAxis` consistent with the new span without
 * each caller re-implementing the math.
 */
export function mergeRegionUpdate(
  region: RegionDraft,
  updates: Partial<RegionDraft>
): RegionDraft {
  if (!updates.bounds || boundsEqual(region.bounds, updates.bounds)) {
    return { ...region, ...updates };
  }
  const segmentsByAxis = adjustSegmentsForBoundsChange(
    region.bounds,
    updates.bounds,
    updates.segmentsByAxis ?? region.segmentsByAxis
  );
  return {
    ...region,
    ...updates,
    segmentsByAxis,
  };
}
