import type { Region } from "../../plan/index.js";
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
import { isPivoted } from "./pivoted.util.js";

const SAMPLE_LIMIT = 10;

function normalise(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function headerAxisDisabled(region: Region): boolean {
  return region.headerAxis === "none";
}

function candidatesFromHeader(
  header: HeaderCandidate,
  region: Region,
  sheet: Sheet
): ClassifierCandidate[] {
  const out: ClassifierCandidate[] = [];
  // For pivoted regions, the axis-anchor cell holds the records-axis name
  // (e.g. "Month") — not a field name. Skip it so the classifier doesn't
  // try to match it against a ColumnDefinition.
  const pivoted = isPivoted(region);
  const anchor = region.axisAnchorCell ?? {
    row: region.bounds.startRow,
    col: region.bounds.startCol,
  };
  if (header.axis === "row") {
    for (let col = region.bounds.startCol; col <= region.bounds.endCol; col++) {
      if (pivoted && col === anchor.col) continue;
      const headerCell = sheet.cell(header.index, col);
      const sourceHeader =
        headerCell && headerCell.value !== null ? String(headerCell.value) : "";
      const samples: string[] = [];
      for (
        let r = header.index + 1;
        r <= region.bounds.endRow && samples.length < SAMPLE_LIMIT;
        r++
      ) {
        const c = sheet.cell(r, col);
        if (c && c.value !== null) samples.push(String(c.value));
      }
      if (sourceHeader !== "") {
        out.push({ sourceHeader, sourceCol: col, samples });
      }
    }
  } else {
    for (let row = region.bounds.startRow; row <= region.bounds.endRow; row++) {
      if (pivoted && row === anchor.row) continue;
      const headerCell = sheet.cell(row, header.index);
      const sourceHeader =
        headerCell && headerCell.value !== null ? String(headerCell.value) : "";
      const samples: string[] = [];
      for (
        let c = header.index + 1;
        c <= region.bounds.endCol && samples.length < SAMPLE_LIMIT;
        c++
      ) {
        const cell = sheet.cell(row, c);
        if (cell && cell.value !== null) samples.push(String(cell.value));
      }
      if (sourceHeader !== "") {
        out.push({ sourceHeader, sourceCol: row, samples });
      }
    }
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
 *
 * The built-in default does heuristic exact/normalised-key matching only —
 * per the `heuristic_vs_ai` memory, semantic matching is the AI prompt's job.
 * Consumers wire a real `ClassifierFn` in Phase 4 without touching this stage.
 *
 * The classifier dep may return either a plain `ColumnClassification[]` or the
 * richer `ClassifierResult` shape (with `usage` for observability). The
 * orchestrator wraps the dep so stages see the plain-array form and the
 * `usage` is intercepted for the `interpret.stage.completed` log event.
 */
export async function classifyColumns(
  state: InterpretState,
  deps: InterpretDeps = {}
): Promise<InterpretState> {
  const next = new Map(state.columnClassifications);
  const classifier = deps.classifier ?? runBuiltIn;
  const catalog = deps.columnDefinitionCatalog ?? [];

  // Synchronous prep pass — figure out which regions need an LLM call and
  // record empty classifications for the rest. Cheap and deterministic.
  type PendingWork = { regionId: string; candidates: ClassifierCandidate[] };
  const pending: PendingWork[] = [];
  for (const region of state.detectedRegions) {
    if (headerAxisDisabled(region)) {
      next.set(region.id, []);
      continue;
    }
    const sheet = state.workbook.sheets.find((s) => s.name === region.sheet);
    if (!sheet) {
      next.set(region.id, []);
      continue;
    }
    const headers = state.headerCandidates.get(region.id);
    const best = headers?.[0];
    if (!best) {
      next.set(region.id, []);
      continue;
    }
    const candidates = candidatesFromHeader(best, region, sheet);
    pending.push({ regionId: region.id, candidates });
  }

  // Fire the classifier across regions in parallel, capped by the shared
  // concurrency budget. `Promise.all(pending.map(...))` preserves input order
  // regardless of resolve order, so the final Map mirrors `detectedRegions`.
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
