import type {
  AxisMember,
  CellValueField,
  Region,
  Segment,
} from "../../plan/index.js";
import type { Sheet } from "../../workbook/index.js";
import type { InterpretState } from "../types.js";
import { readHeaderLineLabels } from "./header-line.util.js";
import {
  axisNameFor,
  classifyLabel,
  dynamicForTag,
  type LabelTag,
} from "./segment-patterns.js";

const DEFAULT_DYNAMIC_TERMINATOR = {
  kind: "untilBlank",
  consecutiveBlanks: 2,
} as const;

/**
 * Pick the header line index the stage should read along `axis`. Uses the
 * top-scored detect-headers candidate for the axis; falls back to the region
 * bounds' leading edge when detect-headers produced nothing (edge case).
 */
function pickHeaderIndex(
  region: Region,
  axis: AxisMember,
  state: InterpretState
): number {
  const candidates = state.headerCandidates.get(region.id) ?? [];
  const best = candidates.find((c) => c.axis === axis);
  if (best) return best.index;
  return axis === "row" ? region.bounds.startRow : region.bounds.startCol;
}

function clusterLabels(labels: string[], axis: AxisMember): Segment[] {
  const tags: LabelTag[] = labels.map(classifyLabel);
  if (tags.length === 0) return [];

  const segments: Segment[] = [];
  let runStart = 0;

  const pushRun = (tag: LabelTag, count: number): void => {
    if (tag === "field") {
      segments.push({ kind: "field", positionCount: count });
    } else if (tag === "skip") {
      segments.push({ kind: "skip", positionCount: count });
    } else {
      const axisName = axisNameFor(tag);
      segments.push({
        kind: "pivot",
        id: `segment_${tag}_${axis}`,
        axisName: axisName && axisName !== "" ? axisName : tag,
        axisNameSource: "ai",
        positionCount: count,
      });
    }
  };

  for (let i = 1; i <= tags.length; i++) {
    if (i === tags.length || tags[i] !== tags[runStart]) {
      pushRun(tags[runStart], i - runStart);
      runStart = i;
    }
  }

  // Tag the tail pivot segment dynamic when its tag permits open-ended sets.
  // Refinement 10 restricts dynamic to the last segment; mid-axis open-ended
  // pivots (rare) stay non-dynamic.
  const tail = segments[segments.length - 1];
  if (tail && tail.kind === "pivot") {
    const lastTag = tags[tags.length - 1];
    if (dynamicForTag(lastTag)) {
      tail.dynamic = { terminator: { ...DEFAULT_DYNAMIC_TERMINATOR } };
    }
  }

  return segments;
}

function anyPivot(segmentsByAxis: {
  row?: Segment[];
  column?: Segment[];
}): boolean {
  for (const axis of ["row", "column"] as const) {
    if (segmentsByAxis[axis]?.some((s) => s.kind === "pivot")) return true;
  }
  return false;
}

function cellLabel(sheet: Sheet, row: number, col: number): string {
  const cell = sheet.cell(row, col);
  if (!cell || cell.value === null || cell.value === undefined) return "";
  const v = cell.value;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v).trim();
}

function seedCellValueField(region: Region, sheet: Sheet): CellValueField {
  if (region.axisAnchorCell) {
    const value = cellLabel(
      sheet,
      region.axisAnchorCell.row,
      region.axisAnchorCell.col
    );
    if (value !== "") return { name: value, nameSource: "anchor-cell" };
  }
  return { name: "value", nameSource: "ai" };
}

/**
 * Stage 4 — `detect-segments`. For every region with at least one declared
 * header axis, read that axis's header line, classify each label against the
 * generic pattern bank, and collapse contiguous same-tag runs into segments.
 * Writes `segmentsByRegion` + `cellValueFieldByRegion` (for pivot-bearing
 * regions). Headerless regions skip — their segmentsByRegion entry stays
 * unset so `proposeBindings` falls back to the PR-1 adapter.
 */
export function detectSegments(state: InterpretState): InterpretState {
  const segmentsByRegion = new Map(state.segmentsByRegion);
  const cellValueFieldByRegion = new Map(state.cellValueFieldByRegion);

  for (const region of state.detectedRegions) {
    if (region.headerAxes.length === 0) continue;
    const sheet = state.workbook.sheets.find((s) => s.name === region.sheet);
    if (!sheet) continue;

    const segmentsByAxis: { row?: Segment[]; column?: Segment[] } = {};
    for (const axis of region.headerAxes) {
      const headerIndex = pickHeaderIndex(region, axis, state);
      const labels = readHeaderLineLabels(region, axis, sheet, headerIndex);
      segmentsByAxis[axis] = clusterLabels(labels, axis);
    }

    segmentsByRegion.set(region.id, segmentsByAxis);
    if (anyPivot(segmentsByAxis)) {
      cellValueFieldByRegion.set(region.id, seedCellValueField(region, sheet));
    }
  }

  return { ...state, segmentsByRegion, cellValueFieldByRegion };
}
