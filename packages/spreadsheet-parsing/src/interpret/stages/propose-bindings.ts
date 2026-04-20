import type {
  ColumnBinding,
  HeaderStrategy,
  Region,
} from "../../plan/index.js";
import type {
  ColumnClassification,
  HeaderCandidate,
  IdentityCandidate,
  InterpretState,
} from "../types.js";

function headerStrategyFromCandidate(
  region: Region,
  candidate: HeaderCandidate
): HeaderStrategy {
  if (candidate.axis === "row") {
    return {
      kind: "row",
      locator: { kind: "row", sheet: region.sheet, row: candidate.index },
      confidence: candidate.score,
    };
  }
  return {
    kind: "column",
    locator: { kind: "column", sheet: region.sheet, col: candidate.index },
    confidence: candidate.score,
  };
}

function bindingsFromClassifications(
  classifications: ColumnClassification[],
  headerAxis: Region["headerAxis"]
): ColumnBinding[] {
  const out: ColumnBinding[] = [];
  for (const c of classifications) {
    if (c.columnDefinitionId === null) continue;
    if (headerAxis === "none") {
      out.push({
        sourceLocator: { kind: "byColumnIndex", col: c.sourceCol },
        columnDefinitionId: c.columnDefinitionId,
        confidence: c.confidence,
        rationale: c.rationale,
      });
    } else {
      out.push({
        sourceLocator: { kind: "byHeaderName", name: c.sourceHeader },
        columnDefinitionId: c.columnDefinitionId,
        confidence: c.confidence,
        rationale: c.rationale,
      });
    }
  }
  return out;
}

function pickIdentity(
  candidates: IdentityCandidate[] | undefined
): IdentityCandidate["strategy"] {
  if (!candidates || candidates.length === 0) {
    return { kind: "rowPosition", confidence: 0 };
  }
  return candidates[0].strategy;
}

/**
 * Stage 6 — assemble the final `Region[]`. Pulls:
 *   - the top header candidate → `headerStrategy`
 *   - classifications → `columnBindings`
 *   - identity candidates → `identityStrategy`
 *   - axis-name suggestions → `recordsAxisName` (with `source: "ai"`) when
 *     the user hasn't supplied a name
 *
 * Confidence roll-up lives in `score-and-warn`, so this stage leaves
 * `region.confidence` at its initial zeros.
 */
export function proposeBindings(state: InterpretState): InterpretState {
  const detectedRegions: Region[] = state.detectedRegions.map((region) => {
    const headers = state.headerCandidates.get(region.id) ?? [];
    const identities = state.identityCandidates.get(region.id);
    const classifications = state.columnClassifications.get(region.id) ?? [];
    const bestHeader = headers[0];
    const suggestion = state.recordsAxisNameSuggestions.get(region.id);

    const next: Region = {
      ...region,
      columnBindings: bindingsFromClassifications(
        classifications,
        region.headerAxis
      ),
      identityStrategy: pickIdentity(identities),
    };

    if (region.headerAxis !== "none" && bestHeader) {
      next.headerStrategy = headerStrategyFromCandidate(region, bestHeader);
    }

    // Records-axis name: hint (user) > suggestion (ai) > anchor-cell > nothing.
    if (!next.recordsAxisName && suggestion) {
      next.recordsAxisName = {
        name: suggestion.name,
        source: "ai",
        confidence: suggestion.confidence,
      };
    }

    return next;
  });

  return { ...state, detectedRegions };
}
