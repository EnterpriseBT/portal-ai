/**
 * Pure, immutable operations over the canonical `Region` shape that the
 * RegionEditor's draft builder invokes from chip interactions. Each function
 * returns a new `Region` whose schema invariants hold — callers pipe the
 * result through `RegionSchema.safeParse` in tests (and in the container's
 * commit path) without further massaging.
 */

import type {
  AxisMember,
  CellValueField,
  HeaderStrategy,
  Region,
  Segment,
  Terminator,
} from "@portalai/core/contracts";

type PivotInit = {
  axisName: string;
  axisNameSource?: "user" | "ai" | "anchor-cell";
};

// ── Shared helpers ────────────────────────────────────────────────────────

function axisSegments(region: Region, axis: AxisMember): Segment[] {
  return region.segmentsByAxis?.[axis] ?? [];
}

function axisSpan(region: Region, axis: AxisMember): number {
  const { startRow, startCol, endRow, endCol } = region.bounds;
  return axis === "row" ? endCol - startCol + 1 : endRow - startRow + 1;
}

function withBoundsSpan(
  region: Region,
  axis: AxisMember,
  newSpan: number
): Region {
  const { startRow, startCol, endRow, endCol } = region.bounds;
  if (axis === "row") {
    return {
      ...region,
      bounds: { startRow, startCol, endRow, endCol: startCol + newSpan - 1 },
    };
  }
  return {
    ...region,
    bounds: { startRow, startCol, endRow: startRow + newSpan - 1, endCol },
  };
}

function hasAnyPivot(region: Region): boolean {
  for (const axis of ["row", "column"] as const) {
    if (axisSegments(region, axis).some((s) => s.kind === "pivot")) return true;
  }
  return false;
}

function uniquePivotId(region: Region, prefix = "pivot"): string {
  const existing = new Set<string>();
  for (const axis of ["row", "column"] as const) {
    for (const seg of axisSegments(region, axis)) {
      if (seg.kind === "pivot") existing.add(seg.id);
    }
  }
  let i = 1;
  while (existing.has(`${prefix}-${i}`)) i++;
  return `${prefix}-${i}`;
}

function defaultHeaderStrategy(
  region: Region,
  axis: AxisMember
): HeaderStrategy {
  if (axis === "row") {
    return {
      kind: "row",
      locator: {
        kind: "row",
        sheet: region.sheet,
        row: region.bounds.startRow,
      },
      confidence: 1,
    };
  }
  return {
    kind: "column",
    locator: {
      kind: "column",
      sheet: region.sheet,
      col: region.bounds.startCol,
    },
    confidence: 1,
  };
}

/**
 * Merge runs of adjacent same-kind non-pivot segments. Pivot segments are
 * never merged — each pivot carries its own `id` + `axisName` and two
 * adjacent pivots are distinct by intent. Field segments concat their
 * per-position `headers` and `skipped` arrays (padding absent halves with
 * empty strings / `false`) so user-set overrides survive a coalesce.
 */
function coalesceSegments(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const seg of segments) {
    const tail = out[out.length - 1];
    if (!tail || tail.kind !== seg.kind) {
      out.push(seg);
      continue;
    }
    if (tail.kind === "field" && seg.kind === "field") {
      const merged: Extract<Segment, { kind: "field" }> = {
        kind: "field",
        positionCount: tail.positionCount + seg.positionCount,
      };
      const headers = mergeFieldArrays(
        tail.headers,
        seg.headers,
        tail.positionCount,
        seg.positionCount,
        ""
      );
      if (headers) merged.headers = headers;
      const skipped = mergeFieldArrays(
        tail.skipped,
        seg.skipped,
        tail.positionCount,
        seg.positionCount,
        false
      );
      if (skipped) merged.skipped = skipped;
      out[out.length - 1] = merged;
      continue;
    }
    if (tail.kind === "skip" && seg.kind === "skip") {
      out[out.length - 1] = {
        kind: "skip",
        positionCount: tail.positionCount + seg.positionCount,
      };
      continue;
    }
    out.push(seg);
  }
  return out;
}

function padArray<T>(values: T[] | undefined, count: number, fill: T): T[] {
  if (values && values.length === count) return [...values];
  const out = new Array<T>(count).fill(fill);
  if (values) {
    for (let i = 0; i < Math.min(values.length, count); i++) out[i] = values[i];
  }
  return out;
}

/**
 * Resize a field segment's `positionCount` and keep its parallel
 * `headers` / `skipped` arrays in lock-step. Truncates when shrinking,
 * pads with empty string / `false` when growing, and drops the parallel
 * arrays entirely when they reduce to all-empty / all-false. Use this
 * anywhere a field segment's `positionCount` mutates — `headers` and
 * `skipped` carry the schema's `length === positionCount` invariant
 * (refinement 3a) so a bare `{ ...seg, positionCount: n }` spread
 * silently violates the schema.
 */
export function resizeFieldSegment(
  seg: Extract<Segment, { kind: "field" }>,
  nextPositionCount: number
): Extract<Segment, { kind: "field" }> {
  if (nextPositionCount === seg.positionCount) return seg;
  const out: Extract<Segment, { kind: "field" }> = {
    kind: "field",
    positionCount: nextPositionCount,
  };
  if (seg.headers !== undefined) {
    const next =
      seg.headers.length > nextPositionCount
        ? seg.headers.slice(0, nextPositionCount)
        : [
            ...seg.headers,
            ...new Array<string>(
              nextPositionCount - seg.headers.length
            ).fill(""),
          ];
    if (next.some((h) => h.trim() !== "")) out.headers = next;
  }
  if (seg.skipped !== undefined) {
    const next =
      seg.skipped.length > nextPositionCount
        ? seg.skipped.slice(0, nextPositionCount)
        : [
            ...seg.skipped,
            ...new Array<boolean>(
              nextPositionCount - seg.skipped.length
            ).fill(false),
          ];
    if (next.some((v) => v)) out.skipped = next;
  }
  return out;
}

/**
 * Resize a segment of any kind, preserving kind-specific metadata.
 * Pivots and skips have no per-position arrays so they round-trip
 * positionCount cleanly via spread; fields delegate to
 * `resizeFieldSegment`.
 */
export function resizeSegment(
  seg: Segment,
  nextPositionCount: number
): Segment {
  if (seg.kind === "field") return resizeFieldSegment(seg, nextPositionCount);
  return { ...seg, positionCount: nextPositionCount };
}

function mergeFieldArrays<T>(
  aValues: T[] | undefined,
  bValues: T[] | undefined,
  aCount: number,
  bCount: number,
  fill: T
): T[] | undefined {
  if (aValues === undefined && bValues === undefined) return undefined;
  return [
    ...padArray(aValues, aCount, fill),
    ...padArray(bValues, bCount, fill),
  ];
}

/**
 * Auto-sync `cellValueField` with pivot presence (refinement 7): present iff
 * at least one pivot segment exists. When a pivot appears and no
 * cellValueField is set, seed a placeholder so the region remains
 * schema-valid; the user names it via the `cellValueField.name` input.
 */
function syncCellValueField(region: Region): Region {
  const pivot = hasAnyPivot(region);
  if (pivot && !region.cellValueField) {
    return {
      ...region,
      cellValueField: { name: "value", nameSource: "user" },
    };
  }
  if (!pivot && region.cellValueField) {
    const { cellValueField: _drop, ...rest } = region;
    return rest as Region;
  }
  return region;
}

function setSegments(
  region: Region,
  axis: AxisMember,
  segments: Segment[]
): Region {
  const byAxis = { ...(region.segmentsByAxis ?? {}) };
  byAxis[axis] = segments;
  return { ...region, segmentsByAxis: byAxis };
}

// ── splitSegment ─────────────────────────────────────────────────────────

export function splitSegment(
  region: Region,
  axis: AxisMember,
  segmentIndex: number,
  offset: number
): Region {
  const segments = axisSegments(region, axis);
  const seg = segments[segmentIndex];
  if (!seg) {
    throw new Error(
      `splitSegment: no segment at index ${segmentIndex} on axis "${axis}"`
    );
  }
  if (offset < 1 || offset >= seg.positionCount) {
    throw new Error(
      `splitSegment: offset ${offset} is outside segment (valid range 1..${seg.positionCount - 1})`
    );
  }
  if (seg.kind === "pivot" && seg.dynamic) {
    throw new Error(
      `splitSegment: cannot split a dynamic pivot segment (would create a mid-axis dynamic segment on "${axis}")`
    );
  }
  if (seg.kind !== "field") {
    throw new Error(
      `splitSegment: splitting "${seg.kind}" segments is not supported`
    );
  }
  const head: Extract<Segment, { kind: "field" }> = {
    kind: "field",
    positionCount: offset,
  };
  const tail: Extract<Segment, { kind: "field" }> = {
    kind: "field",
    positionCount: seg.positionCount - offset,
  };
  if (seg.headers) {
    head.headers = seg.headers.slice(0, offset);
    tail.headers = seg.headers.slice(offset);
  }
  if (seg.skipped) {
    head.skipped = seg.skipped.slice(0, offset);
    tail.skipped = seg.skipped.slice(offset);
  }
  const next = [...segments];
  next.splice(segmentIndex, 1, head, tail);
  return setSegments(region, axis, next);
}

// ── convertSegmentKind ───────────────────────────────────────────────────

export function convertSegmentKind(
  region: Region,
  axis: AxisMember,
  segmentIndex: number,
  toKind: "field" | "pivot" | "skip",
  init?: PivotInit
): Region {
  const segments = axisSegments(region, axis);
  const seg = segments[segmentIndex];
  if (!seg) {
    throw new Error(
      `convertSegmentKind: no segment at index ${segmentIndex} on axis "${axis}"`
    );
  }
  let replacement: Segment;
  if (toKind === "field") {
    replacement = { kind: "field", positionCount: seg.positionCount };
  } else if (toKind === "skip") {
    replacement = { kind: "skip", positionCount: seg.positionCount };
  } else {
    // pivot — reuse existing pivot id when converting a pivot → pivot
    // (axis-name rename case); fresh id otherwise.
    const id = seg.kind === "pivot" ? seg.id : uniquePivotId(region);
    const axisName = init?.axisName ?? (seg.kind === "pivot" ? seg.axisName : "");
    if (!axisName) {
      throw new Error(
        `convertSegmentKind: axisName is required when converting to a pivot segment`
      );
    }
    replacement = {
      kind: "pivot",
      id,
      axisName,
      axisNameSource: init?.axisNameSource ?? "user",
      positionCount: seg.positionCount,
    };
  }
  const nextSegments = [...segments];
  nextSegments.splice(segmentIndex, 1, replacement);
  const merged = coalesceSegments(nextSegments);
  return syncCellValueField(setSegments(region, axis, merged));
}

// ── addHeaderAxis / removeHeaderAxis ─────────────────────────────────────

export function addHeaderAxis(region: Region, axis: AxisMember): Region {
  if (region.headerAxes.includes(axis)) return region;
  const span = axisSpan(region, axis);
  const headerAxes = [...region.headerAxes, axis];
  const segmentsByAxis = {
    ...(region.segmentsByAxis ?? {}),
    [axis]: [{ kind: "skip" as const, positionCount: span }],
  };
  const headerStrategyByAxis = {
    ...(region.headerStrategyByAxis ?? {}),
    [axis]: defaultHeaderStrategy(region, axis),
  };
  const next: Region = {
    ...region,
    headerAxes,
    segmentsByAxis,
    headerStrategyByAxis,
  };
  // If we were headerless (unlikely entry point — promotion from 1D is the
  // primary use case), clear recordsAxis since refinement 5 forbids it
  // alongside a declared header axis.
  if (region.recordsAxis !== undefined && headerAxes.length > 0) {
    const { recordsAxis: _drop, ...rest } = next;
    return rest as Region;
  }
  return next;
}

export function removeHeaderAxis(region: Region, axis: AxisMember): Region {
  if (!region.headerAxes.includes(axis)) return region;
  if (region.headerAxes.length < 2) {
    throw new Error(
      `removeHeaderAxis: cannot remove the only header axis on a 1D region; use a headerless conversion instead`
    );
  }
  const headerAxes = region.headerAxes.filter((a) => a !== axis);
  const { [axis]: _droppedSeg, ...restSegs } = region.segmentsByAxis ?? {};
  const { [axis]: _droppedStrat, ...restStrats } =
    region.headerStrategyByAxis ?? {};
  const columnBindings = region.columnBindings.filter(
    (b) => b.sourceLocator.axis !== axis
  );
  const next: Region = {
    ...region,
    headerAxes,
    segmentsByAxis: restSegs,
    headerStrategyByAxis: restStrats,
    columnBindings,
  };
  // A crosstab's axisAnchorCell is paired to both pivot axes; once we drop
  // to 1D it no longer has a clear meaning. Clear it — the user can reset
  // it if needed.
  if (region.axisAnchorCell) {
    const { axisAnchorCell: _drop, ...rest } = next;
    return syncCellValueField(rest as Region);
  }
  return syncCellValueField(next);
}

// ── addFieldSegment / removeSegment ──────────────────────────────────────

export function addFieldSegment(
  region: Region,
  axis: AxisMember,
  atIndex: number,
  positionCount: number
): Region {
  if (positionCount < 1) {
    throw new Error(
      `addFieldSegment: positionCount must be ≥ 1 (got ${positionCount})`
    );
  }
  if (!region.headerAxes.includes(axis)) {
    throw new Error(
      `addFieldSegment: axis "${axis}" is not a declared header axis`
    );
  }
  const segments = axisSegments(region, axis);
  const clamped = Math.max(0, Math.min(atIndex, segments.length));
  const next = [...segments];
  next.splice(clamped, 0, { kind: "field", positionCount });
  const merged = coalesceSegments(next);
  const grown = withBoundsSpan(region, axis, axisSpan(region, axis) + positionCount);
  return setSegments(grown, axis, merged);
}

export function removeSegment(
  region: Region,
  axis: AxisMember,
  segmentIndex: number
): Region {
  const segments = axisSegments(region, axis);
  const seg = segments[segmentIndex];
  if (!seg) {
    throw new Error(
      `removeSegment: no segment at index ${segmentIndex} on axis "${axis}"`
    );
  }
  if (segments.length === 1) {
    throw new Error(
      `removeSegment: cannot remove the only segment on axis "${axis}" — use removeHeaderAxis to collapse instead`
    );
  }
  const shrink = seg.positionCount;
  const next = [...segments];
  next.splice(segmentIndex, 1);
  const merged = coalesceSegments(next);
  const shrunk = withBoundsSpan(
    region,
    axis,
    axisSpan(region, axis) - shrink
  );
  return syncCellValueField(setSegments(shrunk, axis, merged));
}

// ── setCellValueField ────────────────────────────────────────────────────

export function setCellValueField(
  region: Region,
  field: CellValueField | undefined
): Region {
  if (!hasAnyPivot(region)) {
    if (!region.cellValueField) return region;
    const { cellValueField: _drop, ...rest } = region;
    return rest as Region;
  }
  if (!field) {
    const { cellValueField: _drop, ...rest } = region;
    return rest as Region;
  }
  return { ...region, cellValueField: field };
}

// ── setSegmentDynamic ────────────────────────────────────────────────────

export function setSegmentDynamic(
  region: Region,
  axis: AxisMember,
  segmentIndex: number,
  terminator: Terminator | null
): Region {
  const segments = axisSegments(region, axis);
  const seg = segments[segmentIndex];
  if (!seg) {
    throw new Error(
      `setSegmentDynamic: no segment at index ${segmentIndex} on axis "${axis}"`
    );
  }
  if (seg.kind !== "pivot") {
    throw new Error(
      `setSegmentDynamic: only pivot segments can be dynamic (got "${seg.kind}")`
    );
  }
  if (terminator === null) {
    if (!seg.dynamic) return region;
    const { dynamic: _drop, ...rest } = seg;
    const next = [...segments];
    next[segmentIndex] = rest;
    return setSegments(region, axis, next);
  }
  if (segmentIndex !== segments.length - 1) {
    throw new Error(
      `setSegmentDynamic: dynamic segment must be the tail segment on axis "${axis}" (refinement 10)`
    );
  }
  const otherDynamic = segments.some(
    (s, i) => i !== segmentIndex && s.kind === "pivot" && s.dynamic
  );
  if (otherDynamic) {
    throw new Error(
      `setSegmentDynamic: axis "${axis}" already has a dynamic segment — only one dynamic pivot per axis is allowed`
    );
  }
  const next = [...segments];
  next[segmentIndex] = { ...seg, dynamic: { terminator } };
  return setSegments(region, axis, next);
}

// ── setRecordAxisTerminator ──────────────────────────────────────────────

export function setRecordAxisTerminator(
  region: Region,
  terminator: Terminator | null
): Region {
  if (region.headerAxes.length === 2) {
    throw new Error(
      `setRecordAxisTerminator: recordAxisTerminator is not allowed on a crosstab (2D) region (refinement 11)`
    );
  }
  if (terminator === null) {
    if (!region.recordAxisTerminator) return region;
    const { recordAxisTerminator: _drop, ...rest } = region;
    return rest as Region;
  }
  return { ...region, recordAxisTerminator: terminator };
}
