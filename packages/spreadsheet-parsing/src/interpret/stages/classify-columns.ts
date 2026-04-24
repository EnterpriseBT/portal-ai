import type { AxisMember, Region } from "../../plan/index.js";
import type { Sheet } from "../../workbook/index.js";
import { DEFAULT_INTERPRET_CONCURRENCY } from "../deps.js";
import type { InterpretDeps } from "../deps.js";
import type {
  ClassifierCandidate,
  ClassifierResult,
  ColumnClassification,
  ColumnDefinitionCatalogEntry,
  HeaderCandidate,
  InterpretState,
} from "../types.js";
import { pLimit } from "../util/p-limit.js";
import {
  headerLineCoords,
  readHeaderLineLabels,
} from "./header-line.util.js";
import { isPivoted } from "./pivoted.util.js";

const SAMPLE_LIMIT = 10;

function normalise(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function fieldNameHeaderAxis(region: Region): AxisMember | null {
  // Today's pipeline produces 1D regions only; the single declared header
  // axis is the one classify-columns scans.
  if (region.headerAxes.length === 1) return region.headerAxes[0];
  return null;
}

function candidatesFromHeader(
  header: HeaderCandidate,
  region: Region,
  sheet: Sheet
): ClassifierCandidate[] {
  const out: ClassifierCandidate[] = [];
  // For pivoted regions, the axis-anchor cell holds the pivot segment's
  // axis name (e.g. "Month") — not a field name. Skip it so the classifier
  // doesn't try to match it against a ColumnDefinition.
  const pivoted = isPivoted(region);
  const anchor = region.axisAnchorCell ?? {
    row: region.bounds.startRow,
    col: region.bounds.startCol,
  };
  const anchorCoord = header.axis === "row" ? anchor.col : anchor.row;
  const coords = headerLineCoords(region, header.axis, region.bounds);
  const labels = readHeaderLineLabels(region, header.axis, sheet, header.index);
  for (let i = 0; i < coords.length; i++) {
    const coord = coords[i];
    if (pivoted && coord === anchorCoord) continue;
    const sourceHeader = labels[i];
    if (sourceHeader === "") continue;
    const samples: string[] = [];
    if (header.axis === "row") {
      for (
        let r = header.index + 1;
        r <= region.bounds.endRow && samples.length < SAMPLE_LIMIT;
        r++
      ) {
        const c = sheet.cell(r, coord);
        if (c && c.value !== null) samples.push(String(c.value));
      }
    } else {
      for (
        let c = header.index + 1;
        c <= region.bounds.endCol && samples.length < SAMPLE_LIMIT;
        c++
      ) {
        const cell = sheet.cell(coord, c);
        if (cell && cell.value !== null) samples.push(String(cell.value));
      }
    }
    out.push({ sourceHeader, sourceCol: coord, samples });
  }
  return out;
}

function heuristicMatch(
  candidate: ClassifierCandidate,
  catalog: ColumnDefinitionCatalogEntry[]
): ColumnClassification {
  const needle = normalise(candidate.sourceHeader);
  for (const entry of catalog) {
    const label = normalise(entry.label);
    const key = entry.normalizedKey ? normalise(entry.normalizedKey) : null;
    if (label === needle || key === needle) {
      return {
        sourceHeader: candidate.sourceHeader,
        sourceCol: candidate.sourceCol,
        columnDefinitionId: entry.id,
        confidence: 0.75,
        rationale: "heuristic-exact-or-normalized-match",
      };
    }
  }
  return {
    sourceHeader: candidate.sourceHeader,
    sourceCol: candidate.sourceCol,
    columnDefinitionId: null,
    confidence: 0,
    rationale: "heuristic-no-match",
  };
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

/**
 * Stage 4 — classify each region's header cells to a `ColumnDefinition` id.
 */
export async function classifyColumns(
  state: InterpretState,
  deps: InterpretDeps = {}
): Promise<InterpretState> {
  const next = new Map(state.columnClassifications);
  const classifier = deps.classifier ?? runBuiltIn;
  const catalog = deps.columnDefinitionCatalog ?? [];

  type PendingWork = { regionId: string; candidates: ClassifierCandidate[] };
  const pending: PendingWork[] = [];
  for (const region of state.detectedRegions) {
    const scanAxis = fieldNameHeaderAxis(region);
    if (!scanAxis) {
      next.set(region.id, []);
      continue;
    }
    const sheet = state.workbook.sheets.find((s) => s.name === region.sheet);
    if (!sheet) {
      next.set(region.id, []);
      continue;
    }
    const headers = state.headerCandidates.get(region.id);
    const best = headers?.find((c) => c.axis === scanAxis);
    if (!best) {
      next.set(region.id, []);
      continue;
    }
    const candidates = candidatesFromHeader(best, region, sheet);
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
