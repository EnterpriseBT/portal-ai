import {
  DEFAULT_WARNING_SEVERITY,
  type Region,
  type Segment,
  type Warning,
} from "../../plan/index.js";
import type { InterpretState, RegionConfidence } from "../types.js";

function emitWarning(
  warnings: Warning[],
  code: keyof typeof DEFAULT_WARNING_SEVERITY,
  message: string,
  extra: Partial<Warning> = {}
): void {
  warnings.push({
    code,
    severity: DEFAULT_WARNING_SEVERITY[code],
    message,
    ...extra,
  });
}

function computeRegionConfidence(
  region: Region,
  classificationsCount: number,
  classificationsResolved: number,
  headerScore: number
): RegionConfidence {
  if (classificationsCount === 0) {
    return { region: 0, aggregate: headerScore };
  }
  const coverage = classificationsResolved / classificationsCount;
  const bindingMean =
    region.columnBindings.length === 0
      ? 0
      : region.columnBindings.reduce((acc, b) => acc + b.confidence, 0) /
        region.columnBindings.length;
  const regionScore = 0.6 * bindingMean * coverage + 0.4 * headerScore;
  const aggregate = (regionScore + headerScore) / 2;
  return { region: regionScore, aggregate };
}

function duplicateTargetRegionIds(regions: readonly Region[]): Set<string> {
  const seenTargets = new Map<string, string>();
  const duplicates = new Set<string>();
  for (const region of regions) {
    if (!region.targetEntityDefinitionId) continue;
    const prior = seenTargets.get(region.targetEntityDefinitionId);
    if (prior !== undefined && prior !== region.id) {
      duplicates.add(region.id);
    } else {
      seenTargets.set(region.targetEntityDefinitionId, region.id);
    }
  }
  return duplicates;
}

function pivotSegments(region: Region): Segment[] {
  const out: Segment[] = [];
  for (const axis of ["row", "column"] as const) {
    for (const seg of region.segmentsByAxis?.[axis] ?? []) {
      if (seg.kind === "pivot") out.push(seg);
    }
  }
  return out;
}

function segmentMissingAxisName(segment: Segment, region: Region): boolean {
  if (segment.kind !== "pivot") return false;
  if (segment.axisName === "") return true;
  if (segment.axisNameSource === "anchor-cell") {
    // Anchor-cell sourced names require an axis anchor; missing/empty anchor
    // is treated as unresolved.
    if (!region.axisAnchorCell) return true;
  }
  return false;
}

/**
 * Stage 8 — consolidate per-stage signals into the plan's `confidence` fields
 * and emit structured `Warning`s on each region.
 */
export function scoreAndWarn(state: InterpretState): InterpretState {
  const duplicateTargets = duplicateTargetRegionIds(state.detectedRegions);
  const detectedRegions: Region[] = state.detectedRegions.map((region) => {
    const warnings: Warning[] = [...region.warnings];
    const headers = state.headerCandidates.get(region.id) ?? [];
    const classifications = state.columnClassifications.get(region.id) ?? [];
    const classificationsResolved = classifications.filter(
      (c) => c.columnDefinitionId !== null
    ).length;

    // ── DUPLICATE_ENTITY_TARGET (blocker) ────────────────────────────────
    if (duplicateTargets.has(region.id)) {
      emitWarning(
        warnings,
        "DUPLICATE_ENTITY_TARGET",
        `Two regions target the same entity "${region.targetEntityDefinitionId}" — each entity must be produced by at most one region.`
      );
    }

    // ── ROW_POSITION_IDENTITY ────────────────────────────────────────────
    if (region.identityStrategy.kind === "rowPosition") {
      emitWarning(
        warnings,
        "ROW_POSITION_IDENTITY",
        "Identity falls back to row position — breaks if rows reorder."
      );
    }

    // ── MULTIPLE_HEADER_CANDIDATES ───────────────────────────────────────
    if (headers.length > 1 && headers[0].score - headers[1].score < 0.1) {
      emitWarning(
        warnings,
        "MULTIPLE_HEADER_CANDIDATES",
        "Multiple rows scored similarly as the header — the top candidate may be wrong."
      );
    }

    // ── PIVOTED_REGION_MISSING_AXIS_NAME (blocker) ───────────────────────
    // Fires per pivot segment whose axis name isn't resolved. Crosstab regions
    // also require `cellValueField.name` to be set.
    for (const seg of pivotSegments(region)) {
      if (seg.kind !== "pivot") continue;
      if (segmentMissingAxisName(seg, region)) {
        emitWarning(
          warnings,
          "PIVOTED_REGION_MISSING_AXIS_NAME",
          `Pivot segment "${seg.id}" missing axis name — required before commit.`
        );
      }
    }
    const hasPivot = pivotSegments(region).length > 0;
    if (hasPivot && !region.cellValueField) {
      emitWarning(
        warnings,
        "PIVOTED_REGION_MISSING_AXIS_NAME",
        "Pivoted region missing cell-value field."
      );
    }

    // ── UNRECOGNIZED_COLUMN (info) ───────────────────────────────────────
    for (const c of classifications) {
      if (c.columnDefinitionId === null) {
        emitWarning(
          warnings,
          "UNRECOGNIZED_COLUMN",
          `Header "${c.sourceHeader}" has no matching ColumnDefinition — leaving unbound.`
        );
      }
    }

    const headerScore = headers[0]?.score ?? 0;
    const confidence = computeRegionConfidence(
      region,
      classifications.length,
      classificationsResolved,
      headerScore
    );

    return { ...region, warnings, confidence };
  });

  const confidenceMap = new Map<string, RegionConfidence>();
  for (const r of detectedRegions) confidenceMap.set(r.id, r.confidence);

  return { ...state, detectedRegions, confidence: confidenceMap };
}
