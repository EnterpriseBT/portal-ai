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
 * A `ClassifierCandidate` together with the metadata `propose-bindings`
 * needs to choose a locator kind. The classifier sees only the public
 * `ClassifierCandidate` fields; `fromHeaderOverride` is preserved on the
 * resulting `ColumnClassification` (see runBuiltIn / classifier callers).
 */
interface AnnotatedCandidate {
  candidate: ClassifierCandidate;
  fromHeaderOverride: boolean;
  /**
   * Header axis the candidate came from. Stamped onto the resulting
   * `ColumnClassification.sourceAxis` so `propose-bindings` can route
   * each binding to the right axis on a 2D crosstab — column-axis
   * classifications must use `byPositionIndex.axis: "column"` and an
   * index relative to `bounds.startRow`, not `startCol`.
   */
  sourceAxis: AxisMember;
}

/**
 * Walk `segments` along `axis` and emit one `ClassifierCandidate` per
 * position inside a `kind: "field"` segment. Pivot and skip positions are
 * dropped — they're classified by other stages (or not at all).
 *
 * Per-position field-segment overrides on `kind === "field"`:
 *   - `skipped[i] === true` drops the position outright (no candidate).
 *   - `headers[i]` (when non-empty) replaces the cell-derived `sourceHeader`
 *     unconditionally — the override is the user's stated intent and wins
 *     over whatever the cell happens to say (blank, mislabelled, or just
 *     a value the user wants to rename). Candidates produced from an
 *     override are flagged `fromHeaderOverride` so `propose-bindings`
 *     emits a `byPositionIndex` binding (the override name may not appear
 *     in the sheet at all) and writes a derived `normalizedKey`.
 */
function candidatesForAxisFieldSegments(
  region: Region,
  axis: AxisMember,
  segments: Segment[],
  headerIndex: number,
  sheet: Sheet
): AnnotatedCandidate[] {
  const out: AnnotatedCandidate[] = [];
  const coords = headerLineCoords(region, axis, region.bounds);
  const labels = readHeaderLineLabels(region, axis, sheet, headerIndex);
  let offset = 0;
  for (const segment of segments) {
    if (segment.kind === "field") {
      for (let k = 0; k < segment.positionCount; k++) {
        const i = offset + k;
        if (i >= coords.length) break;
        if (segment.skipped?.[k] === true) continue;
        const override = segment.headers?.[k]?.trim();
        const sourceHeader = override ? override : labels[i];
        if (sourceHeader === "") continue;
        out.push({
          candidate: {
            sourceHeader,
            sourceCol: coords[i],
            samples: collectSamples(
              region,
              axis,
              headerIndex,
              coords[i],
              sheet
            ),
          },
          fromHeaderOverride: !!override,
          sourceAxis: axis,
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

  type PendingWork = {
    regionId: string;
    candidates: ClassifierCandidate[];
    annotations: AnnotatedCandidate[];
  };
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
    const annotated: AnnotatedCandidate[] = [];
    for (const axis of region.headerAxes) {
      const segments = segmentsByAxis?.[axis];
      if (!segments || segments.length === 0) continue;
      const headerIndex = pickHeaderIndex(state, region.id, axis);
      if (headerIndex === null) continue;
      annotated.push(
        ...candidatesForAxisFieldSegments(
          region,
          axis,
          segments,
          headerIndex,
          sheet
        )
      );
    }
    if (annotated.length === 0) {
      next.set(region.id, []);
      continue;
    }
    pending.push({
      regionId: region.id,
      candidates: annotated.map((a) => a.candidate),
      annotations: annotated,
    });
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
    // Re-attach the `fromHeaderOverride` flag and `sourceAxis` — the
    // classifier (which may be user-supplied) doesn't see or preserve
    // them. The classifier contract is to return classifications in the
    // same order as the input candidates, so we zip by index.
    const annotated = classifications.map((c, idx) => {
      const ann = pending[i].annotations[idx];
      if (!ann) return c;
      const next: ColumnClassification = { ...c, sourceAxis: ann.sourceAxis };
      if (ann.fromHeaderOverride) next.fromHeaderOverride = true;
      return next;
    });
    next.set(
      pending[i].regionId,
      applyDefaultColumnDefinition(
        annotated,
        deps.defaultColumnDefinitionId
      )
    );
  }
  return { ...state, columnClassifications: next };
}
