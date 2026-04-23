import type {
  AxisMember,
  ColumnBinding,
  HeaderStrategy,
  Region,
  Segment,
} from "../../plan/index.js";
import type {
  ColumnClassification,
  HeaderCandidate,
  IdentityCandidate,
  InterpretState,
  RecordsAxisNameSuggestion,
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
  region: Region,
  classifications: ColumnClassification[],
  headerAxis: AxisMember | null
): ColumnBinding[] {
  const out: ColumnBinding[] = [];
  for (const c of classifications) {
    if (c.columnDefinitionId === null) continue;
    if (headerAxis === null) {
      // Headerless region: use byPositionIndex along the records-axis's
      // opposite. `sourceCol` is the absolute sheet coord along the header
      // axis of the classifier (which for headerless falls back to row
      // iteration); convert to an axis-relative 1-based index.
      const axis: AxisMember =
        region.recordsAxis === "row" ? "column" : "row";
      const start =
        axis === "row" ? region.bounds.startCol : region.bounds.startRow;
      out.push({
        sourceLocator: {
          kind: "byPositionIndex",
          axis,
          index: c.sourceCol - start + 1,
        },
        columnDefinitionId: c.columnDefinitionId,
        confidence: c.confidence,
        rationale: c.rationale,
      });
    } else {
      out.push({
        sourceLocator: {
          kind: "byHeaderName",
          axis: headerAxis,
          name: c.sourceHeader,
        },
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

function positionSpan(region: Region, axis: AxisMember): number {
  return axis === "row"
    ? region.bounds.endCol - region.bounds.startCol + 1
    : region.bounds.endRow - region.bounds.startRow + 1;
}

/**
 * Ensure segmentsByAxis is populated for every declared header axis.
 * PR-1 behavior: hints may carry segments; if absent, synthesize a single
 * field segment spanning the full axis. Pivoted regions inherit their
 * pivot/skip segmentation from the hint.
 */
function ensureSegments(region: Region): Region["segmentsByAxis"] {
  const next: Region["segmentsByAxis"] = { ...region.segmentsByAxis };
  for (const axis of region.headerAxes) {
    if (next?.[axis] && next[axis]!.length > 0) continue;
    const span = positionSpan(region, axis);
    const seg: Segment = { kind: "field", positionCount: span };
    if (axis === "row") next.row = [seg];
    else next.column = [seg];
  }
  return next;
}

/**
 * Propagate AI-recommended axis names onto matching pivot segments that
 * weren't user-supplied.
 */
function applyAxisNameSuggestions(
  region: Region,
  suggestions: Map<string, RecordsAxisNameSuggestion>
): Region["segmentsByAxis"] {
  const apply = (segs: Segment[] | undefined): Segment[] | undefined => {
    if (!segs) return segs;
    return segs.map((s) => {
      if (s.kind !== "pivot") return s;
      const suggestion = suggestions.get(s.id);
      if (!suggestion) return s;
      if (s.axisNameSource === "user") return s;
      return {
        ...s,
        axisName: suggestion.name,
        axisNameSource: "ai",
      };
    });
  };
  return {
    row: apply(region.segmentsByAxis?.row),
    column: apply(region.segmentsByAxis?.column),
  };
}

/**
 * Stage 6 — assemble the final region shape. Writes:
 *   - `headerStrategyByAxis[axis]` for every declared header axis
 *   - `columnBindings` from classifications (axis-scoped locators)
 *   - `identityStrategy` from the best candidate
 *   - `segmentsByAxis` for every declared axis (hints preserved; default
 *     field-segment synthesised for tidy regions)
 *   - Propagates AI axis-name suggestions onto pivot segments
 */
export function proposeBindings(state: InterpretState): InterpretState {
  const detectedRegions: Region[] = state.detectedRegions.map((region) => {
    const headers = state.headerCandidates.get(region.id) ?? [];
    const identities = state.identityCandidates.get(region.id);
    const classifications = state.columnClassifications.get(region.id) ?? [];

    let next: Region = {
      ...region,
      identityStrategy: pickIdentity(identities),
    };

    // Header strategy per declared axis — pick the top candidate on each axis.
    if (region.headerAxes.length > 0) {
      const strategyByAxis: Region["headerStrategyByAxis"] = {
        ...region.headerStrategyByAxis,
      };
      for (const axis of region.headerAxes) {
        if (strategyByAxis?.[axis]) continue;
        const best = headers.find((h) => h.axis === axis);
        if (!best) continue;
        strategyByAxis[axis] = headerStrategyFromCandidate(region, best);
      }
      next = { ...next, headerStrategyByAxis: strategyByAxis };
    }

    // Segments — fill in missing axes with a default field segment.
    next = { ...next, segmentsByAxis: ensureSegments(next) };

    // Apply AI axis-name suggestions to pivot segments (keyed by segment id).
    next = {
      ...next,
      segmentsByAxis: applyAxisNameSuggestions(
        next,
        state.segmentAxisNameSuggestions
      ),
    };

    // Column bindings — 1D regions only. Crosstab binding assembly is
    // deferred to later phases since interpret() doesn't produce crosstabs
    // in PR-1.
    const scanAxis: AxisMember | null =
      next.headerAxes.length === 1 ? next.headerAxes[0] : null;
    next = {
      ...next,
      columnBindings: bindingsFromClassifications(
        next,
        classifications,
        scanAxis
      ),
    };

    return next;
  });

  return { ...state, detectedRegions };
}
