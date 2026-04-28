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
import { toNormalizedKey } from "./classifier-heuristic.util.js";
import { resolveEffectiveSegments } from "./pivoted.util.js";

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
    // `sourceAxis` is set by `classify-field-segments` per axis loop,
    // so even on a 2D crosstab each classification knows which axis its
    // `sourceCol` references. Fall back to the legacy single-axis
    // routing only when the classifier didn't supply it (custom
    // classifier, or headerless region).
    const effectiveAxis: AxisMember | null = c.sourceAxis ?? headerAxis;
    if (effectiveAxis === null) {
      // Headerless region (no header axes declared and no per-classification
      // sourceAxis): use byPositionIndex along the records-axis's
      // opposite. `sourceCol` is the absolute sheet coord along the
      // header axis of the classifier (which for headerless falls back
      // to row iteration); convert to an axis-relative 1-based index.
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
    } else if (c.fromHeaderOverride) {
      // Header override — the user has stated an explicit name for this
      // position, which wins over whatever the cell happens to contain.
      // We pin the binding to the position (`byHeaderName` would search
      // the sheet for the override string and might match nothing) and
      // attach a derived `normalizedKey` so the override surfaces all
      // the way through commit. `toNormalizedKey` coerces the override
      // into the schema's `^[a-z][a-z0-9_]*$` shape (e.g. `"Year"` →
      // `"year"`, `"2020"` → `"f_2020"`).
      const start =
        effectiveAxis === "row"
          ? region.bounds.startCol
          : region.bounds.startRow;
      const normalizedKey = toNormalizedKey(c.sourceHeader);
      out.push({
        sourceLocator: {
          kind: "byPositionIndex",
          axis: effectiveAxis,
          index: c.sourceCol - start + 1,
        },
        columnDefinitionId: c.columnDefinitionId,
        confidence: c.confidence,
        rationale: c.rationale,
        ...(normalizedKey ? { normalizedKey } : {}),
      });
    } else {
      out.push({
        sourceLocator: {
          kind: "byHeaderName",
          axis: effectiveAxis,
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
 * Fallback segmentsByAxis when detect-segments didn't produce an entry for
 * the region (e.g. headerless). Mirrors the PR-1 adapter: synthesize a
 * single field segment spanning the full axis for every declared header
 * axis, preserving anything the hint pre-seeded.
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
 * Per-segment axis-name precedence. `axisNameSource === "user"` wins
 * outright — neither the recommender nor the heuristic can overwrite it.
 * For every other pivot segment, the recommender's suggestion (keyed by
 * segment id) overrides the heuristic default; absent that, the heuristic
 * output passes through unchanged.
 */
function applyAxisNameSuggestions(
  region: Region,
  suggestions: Map<string, RecordsAxisNameSuggestion>
): Region["segmentsByAxis"] {
  const apply = (segs: Segment[] | undefined): Segment[] | undefined => {
    if (!segs) return segs;
    return segs.map((s) => {
      if (s.kind !== "pivot") return s;
      if (s.axisNameSource === "user") return s;
      const suggestion = suggestions.get(s.id);
      if (!suggestion) return s;
      return {
        ...s,
        axisName: suggestion.name,
        axisNameSource: "ai",
      };
    });
  };
  const row = apply(region.segmentsByAxis?.row);
  const column = apply(region.segmentsByAxis?.column);
  if (!row && !column) return undefined;
  return { row, column };
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

    // Segments — hints with an explicit user-sourced pivot win outright
    // (users pinning an axisName opt out of the heuristic). Otherwise
    // adopt the detect-segments output, falling back to the PR-1 adapter
    // (field segment per declared axis) when the stage didn't run for
    // this region (e.g. headerless).
    const effective = resolveEffectiveSegments(
      region,
      state.segmentsByRegion.get(region.id)
    );
    if (effective) {
      next = { ...next, segmentsByAxis: effective };
    } else {
      next = { ...next, segmentsByAxis: ensureSegments(next) };
    }

    // cellValueField — adopt the detect-segments seed unless the hint
    // supplied a user-sourced name (user wins over heuristic).
    const computedCellValueField = state.cellValueFieldByRegion.get(region.id);
    if (computedCellValueField && next.cellValueField?.nameSource !== "user") {
      next = { ...next, cellValueField: computedCellValueField };
    }

    // Apply AI axis-name suggestions to pivot segments (keyed by segment id).
    next = {
      ...next,
      segmentsByAxis: applyAxisNameSuggestions(
        next,
        state.segmentAxisNameSuggestions
      ),
    };

    // Column bindings: each classification carries its own `sourceAxis`
    // when produced by `classify-field-segments`, so crosstab regions
    // route correctly per-classification (row-axis fields → axis "row",
    // column-axis fields → axis "column"). The `scanAxis` argument
    // remains as the legacy fallback for 1D regions whose classifier
    // didn't stamp `sourceAxis` on each entry.
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
