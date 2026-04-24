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
import { heuristicMatch } from "./classifier-heuristic.util.js";
import {
  headerLineCoords,
  readHeaderLineLabels,
} from "./header-line.util.js";
import { resolveEffectiveSegments } from "./pivoted.util.js";

const SAMPLE_LIMIT = 10;

function collectSamples(
  region: Region,
  axis: AxisMember,
  headerIndex: number,
  coord: number,
  sheet: Sheet
): string[] {
  const samples: string[] = [];
  if (axis === "row") {
    for (
      let r = headerIndex + 1;
      r <= region.bounds.endRow && samples.length < SAMPLE_LIMIT;
      r++
    ) {
      const c = sheet.cell(r, coord);
      if (c && c.value !== null) samples.push(String(c.value));
    }
  } else {
    for (
      let c = headerIndex + 1;
      c <= region.bounds.endCol && samples.length < SAMPLE_LIMIT;
      c++
    ) {
      const cell = sheet.cell(coord, c);
      if (cell && cell.value !== null) samples.push(String(cell.value));
    }
  }
  return samples;
}

/**
 * Walk `segments` along `axis` and emit one `ClassifierCandidate` per
 * position inside a `kind: "field"` segment. Pivot and skip positions are
 * dropped — they're classified by other stages (or not at all).
 */
function candidatesForAxisFieldSegments(
  region: Region,
  axis: AxisMember,
  segments: Segment[],
  headerIndex: number,
  sheet: Sheet
): ClassifierCandidate[] {
  const out: ClassifierCandidate[] = [];
  const coords = headerLineCoords(region, axis, region.bounds);
  const labels = readHeaderLineLabels(region, axis, sheet, headerIndex);
  let offset = 0;
  for (const segment of segments) {
    if (segment.kind === "field") {
      for (let k = 0; k < segment.positionCount; k++) {
        const i = offset + k;
        if (i >= coords.length) break;
        const sourceHeader = labels[i];
        if (sourceHeader === "") continue;
        out.push({
          sourceHeader,
          sourceCol: coords[i],
          samples: collectSamples(region, axis, headerIndex, coords[i], sheet),
        });
      }
    }
    offset += segment.positionCount;
  }
  return out;
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

function pickHeaderIndex(
  state: InterpretState,
  regionId: string,
  axis: AxisMember
): number | null {
  const candidates = state.headerCandidates.get(regionId) ?? [];
  const best = candidates.find((c) => c.axis === axis);
  return best ? best.index : null;
}

/**
 * Stage 5 — per-field-segment classifier. Reads the segmentation produced
 * by `detect-segments` and forwards only positions inside `kind: "field"`
 * segments to the injected classifier. Pivot and skip positions are
 * dropped. Headerless regions and regions whose axes have no field
 * segments short-circuit (classifier not called).
 */
export async function classifyFieldSegments(
  state: InterpretState,
  deps: InterpretDeps = {}
): Promise<InterpretState> {
  const next = new Map(state.columnClassifications);
  const classifier = deps.classifier ?? runBuiltIn;
  const catalog = deps.columnDefinitionCatalog ?? [];

  type PendingWork = { regionId: string; candidates: ClassifierCandidate[] };
  const pending: PendingWork[] = [];

  for (const region of state.detectedRegions) {
    if (region.headerAxes.length === 0) {
      next.set(region.id, []);
      continue;
    }
    const sheet = state.workbook.sheets.find((s) => s.name === region.sheet);
    if (!sheet) {
      next.set(region.id, []);
      continue;
    }
    const segmentsByAxis = resolveEffectiveSegments(
      region,
      state.segmentsByRegion.get(region.id)
    );
    const candidates: ClassifierCandidate[] = [];
    for (const axis of region.headerAxes) {
      const segments = segmentsByAxis?.[axis];
      if (!segments || segments.length === 0) continue;
      const headerIndex = pickHeaderIndex(state, region.id, axis);
      if (headerIndex === null) continue;
      candidates.push(
        ...candidatesForAxisFieldSegments(
          region,
          axis,
          segments,
          headerIndex,
          sheet
        )
      );
    }
    if (candidates.length === 0) {
      next.set(region.id, []);
      continue;
    }
    pending.push({ regionId: region.id, candidates });
  }

  const limit = pLimit(deps.concurrency ?? DEFAULT_INTERPRET_CONCURRENCY);
  const results = await Promise.all(
    pending.map((work) =>
      limit(() => Promise.resolve(classifier(work.candidates, catalog)))
    )
  );
  for (let i = 0; i < pending.length; i++) {
    const result = results[i];
    const classifications: ColumnClassification[] = Array.isArray(result)
      ? result
      : (result as ClassifierResult).classifications;
    next.set(pending[i].regionId, classifications);
  }
  return { ...state, columnClassifications: next };
}
