import type { AxisMember, Region, Segment } from "../../plan/index.js";
import type { Sheet } from "../../workbook/index.js";
import { DEFAULT_INTERPRET_CONCURRENCY } from "../deps.js";
import type { InterpretDeps } from "../deps.js";
import type {
  ClassifierCandidate,
  ClassifierResult,
  ColumnClassification,
  ColumnDefinitionCatalogEntry,
  InterpretState,
} from "../types.js";
import { pLimit } from "../util/p-limit.js";
import {
  applyDefaultColumnDefinition,
  heuristicMatch,
} from "./classifier-heuristic.util.js";
import { headerLineCoords } from "./header-line.util.js";

const SAMPLE_LIMIT = 10;

type LogicalFieldTarget =
  | { kind: "pivotSegment"; segmentId: string }
  | { kind: "cellValueField" };

interface PendingWork {
  regionId: string;
  candidates: ClassifierCandidate[];
  /**
   * Index-aligned with `candidates` — each candidate's sourceHeader is a
   * user-facing name (pivot `axisName` or `cellValueField.name`), not a sheet
   * header, so the routing target can't be recovered from the classification
   * alone.
   */
  targets: LogicalFieldTarget[];
}

async function runBuiltIn(
  candidates: ClassifierCandidate[],
  catalog: ColumnDefinitionCatalogEntry[] | undefined
): Promise<ColumnClassification[]> {
  if (!catalog || catalog.length === 0) {
    return candidates.map((c) => ({
      sourceHeader: c.sourceHeader,
      sourceCol: c.sourceCol,
      columnDefinitionId: null,
      confidence: 0,
      rationale: "no-catalog",
    }));
  }
  return candidates.map((c) => heuristicMatch(c, catalog));
}

function pivotSegmentHeaderIndex(
  region: Region,
  axis: AxisMember
): number | undefined {
  const locator = region.headerStrategyByAxis?.[axis]?.locator;
  if (!locator) return undefined;
  if (locator.kind === "row") return locator.row;
  if (locator.kind === "column") return locator.col;
  return undefined;
}

function collectPivotSegmentLabels(
  region: Region,
  axis: AxisMember,
  segment: Extract<Segment, { kind: "pivot" }>,
  offset: number,
  sheet: Sheet
): string[] {
  const headerIndex = pivotSegmentHeaderIndex(region, axis);
  if (headerIndex === undefined) return [];
  const coords = headerLineCoords(region, axis, region.bounds);
  const out: string[] = [];
  for (let i = 0; i < segment.positionCount; i++) {
    const coord = coords[offset + i];
    if (coord === undefined) break;
    const cell =
      axis === "row" ? sheet.cell(headerIndex, coord) : sheet.cell(coord, headerIndex);
    if (cell && cell.value !== null && cell.value !== undefined) {
      const v = cell.value;
      const label =
        v instanceof Date
          ? v.toISOString()
          : typeof v === "boolean"
            ? v
              ? "true"
              : "false"
            : String(v).trim();
      if (label !== "") out.push(label);
    }
    if (out.length >= SAMPLE_LIMIT) break;
  }
  return out;
}

function collectCellValueSamples(region: Region, sheet: Sheet): string[] {
  // Sample the interior of the region — the body cells a pivot segment
  // would ultimately emit as the cell value. Skip the outermost row and
  // column so the sample looks like data, not labels; this is rough but
  // good enough to help the classifier distinguish e.g. money from counts.
  const out: string[] = [];
  for (let r = region.bounds.startRow + 1; r <= region.bounds.endRow; r++) {
    for (let c = region.bounds.startCol + 1; c <= region.bounds.endCol; c++) {
      const cell = sheet.cell(r, c);
      if (!cell || cell.value === null || cell.value === undefined) continue;
      out.push(String(cell.value));
      if (out.length >= SAMPLE_LIMIT) return out;
    }
  }
  return out;
}

function pivotSegmentsWithOffset(
  region: Region
): Array<{
  axis: AxisMember;
  segment: Extract<Segment, { kind: "pivot" }>;
  offset: number;
}> {
  const out: Array<{
    axis: AxisMember;
    segment: Extract<Segment, { kind: "pivot" }>;
    offset: number;
  }> = [];
  for (const axis of ["row", "column"] as const) {
    let offset = 0;
    for (const seg of region.segmentsByAxis?.[axis] ?? []) {
      if (seg.kind === "pivot") out.push({ axis, segment: seg, offset });
      offset += seg.positionCount;
    }
  }
  return out;
}

function buildPendingWork(
  region: Region,
  sheet: Sheet
): PendingWork | undefined {
  const pivots = pivotSegmentsWithOffset(region);
  if (pivots.length === 0) return undefined;

  const candidates: ClassifierCandidate[] = [];
  const targets: LogicalFieldTarget[] = [];

  for (const { axis, segment, offset } of pivots) {
    candidates.push({
      sourceHeader: segment.axisName,
      sourceCol: 0,
      samples: collectPivotSegmentLabels(region, axis, segment, offset, sheet),
    });
    targets.push({ kind: "pivotSegment", segmentId: segment.id });
  }

  if (region.cellValueField) {
    candidates.push({
      sourceHeader: region.cellValueField.name,
      sourceCol: 0,
      samples: collectCellValueSamples(region, sheet),
    });
    targets.push({ kind: "cellValueField" });
  }

  return { regionId: region.id, candidates, targets };
}

function applyClassificationsToRegion(
  region: Region,
  work: PendingWork,
  classifications: ColumnClassification[]
): Region {
  // Align classifications back to targets. Classifier responses are free to
  // reorder or omit entries, so match by sourceHeader — candidates within
  // one region's logical-field batch are name-unique by construction (the
  // axisName of each pivot segment + a single cellValueField.name; schema
  // refinement 4 makes pivot ids unique and cellValueField.name is distinct
  // from any axisName in a well-formed region).
  const byHeader = new Map(classifications.map((c) => [c.sourceHeader, c]));

  let pivotTouched = false;
  const remap = (segs: Segment[] | undefined): Segment[] | undefined => {
    if (!segs) return segs;
    return segs.map((s) => {
      if (s.kind !== "pivot") return s;
      // Find the target-matched candidate for this segment.
      for (let i = 0; i < work.targets.length; i++) {
        const t = work.targets[i];
        if (t.kind !== "pivotSegment" || t.segmentId !== s.id) continue;
        const classification = byHeader.get(work.candidates[i].sourceHeader);
        if (!classification || classification.columnDefinitionId === null) return s;
        pivotTouched = true;
        return { ...s, columnDefinitionId: classification.columnDefinitionId };
      }
      return s;
    });
  };

  let next: Region = region;
  const rowSegs = remap(region.segmentsByAxis?.row);
  const colSegs = remap(region.segmentsByAxis?.column);
  if (pivotTouched) {
    next = {
      ...next,
      segmentsByAxis: {
        row: rowSegs,
        column: colSegs,
      },
    };
  }

  if (region.cellValueField) {
    const idx = work.targets.findIndex((t) => t.kind === "cellValueField");
    if (idx !== -1) {
      const classification = byHeader.get(work.candidates[idx].sourceHeader);
      if (classification && classification.columnDefinitionId !== null) {
        next = {
          ...next,
          cellValueField: {
            ...region.cellValueField,
            columnDefinitionId: classification.columnDefinitionId,
          },
        };
      }
    }
  }

  return next;
}

/**
 * Stage 7 — classify the logical fields a pivoted region emits. For each
 * pivot segment, run the segment's `axisName` through the injected classifier
 * and persist the matched ColumnDefinition id on `segment.columnDefinitionId`.
 * Do the same for `region.cellValueField.name` → `cellValueField.columnDefinitionId`.
 *
 * Runs after `proposeBindings` so the final `segmentsByAxis` (user-sourced
 * pivot hints already applied, AI axis-name suggestions merged) is what drives
 * classification. Regions with no pivot segment are a no-op.
 *
 * The injected `classifier` is reused unchanged — logical-field candidates
 * share the same `ClassifierFn` contract as header-line candidates so
 * consumers don't have to register a second dep. Routing back to segment
 * vs. cellValueField slots uses a sidecar target map keyed by candidate
 * order so name collisions with real header labels are impossible.
 */
export async function classifyLogicalFields(
  state: InterpretState,
  deps: InterpretDeps = {}
): Promise<InterpretState> {
  const classifier = deps.classifier ?? runBuiltIn;
  const catalog = deps.columnDefinitionCatalog ?? [];

  const pending: PendingWork[] = [];
  for (const region of state.detectedRegions) {
    const sheet = state.workbook.sheets.find((s) => s.name === region.sheet);
    if (!sheet) continue;
    const work = buildPendingWork(region, sheet);
    if (work && work.candidates.length > 0) pending.push(work);
  }
  if (pending.length === 0) return state;

  const limit = pLimit(deps.concurrency ?? DEFAULT_INTERPRET_CONCURRENCY);
  const results = await Promise.all(
    pending.map((work) =>
      limit(() => Promise.resolve(classifier(work.candidates, catalog)))
    )
  );

  const workByRegion = new Map<string, PendingWork>();
  const classificationsByRegion = new Map<string, ColumnClassification[]>();
  for (let i = 0; i < pending.length; i++) {
    const work = pending[i];
    const result = results[i];
    const classifications: ColumnClassification[] = Array.isArray(result)
      ? result
      : (result as ClassifierResult).classifications;
    workByRegion.set(work.regionId, work);
    classificationsByRegion.set(
      work.regionId,
      applyDefaultColumnDefinition(
        classifications,
        deps.defaultColumnDefinitionId
      )
    );
  }

  const detectedRegions = state.detectedRegions.map((region) => {
    const work = workByRegion.get(region.id);
    const classifications = classificationsByRegion.get(region.id);
    if (!work || !classifications) return region;
    return applyClassificationsToRegion(region, work, classifications);
  });

  return { ...state, detectedRegions };
}
