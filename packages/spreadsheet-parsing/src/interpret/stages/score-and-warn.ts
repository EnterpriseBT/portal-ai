import {
  DEFAULT_WARNING_SEVERITY,
  type Region,
  type Warning,
} from "../../plan/index.js";
import type { InterpretState, RegionConfidence } from "../types.js";
import { isPivoted } from "./pivoted.util.js";

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

/**
 * Weighted mean of binding confidences, weighted by field coverage
 * (1.0 when every header has a classification; lower when many are null).
 * Falls back to 0 when the region has no classifications at all.
 */
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

/**
 * Stage 8 — consolidate per-stage signals into the plan's `confidence` fields
 * and emit structured `Warning`s on each region. The warning severity map
 * from `DEFAULT_WARNING_SEVERITY` is the module-level default; consumers can
 * override at the UI layer via a `WarningPolicy` (Phase 4+).
 */
export function scoreAndWarn(state: InterpretState): InterpretState {
  const detectedRegions: Region[] = state.detectedRegions.map((region) => {
    const warnings: Warning[] = [...region.warnings];
    const headers = state.headerCandidates.get(region.id) ?? [];
    const classifications = state.columnClassifications.get(region.id) ?? [];
    const classificationsResolved = classifications.filter(
      (c) => c.columnDefinitionId !== null
    ).length;

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
    if (isPivoted(region) && !region.recordsAxisName) {
      emitWarning(
        warnings,
        "PIVOTED_REGION_MISSING_AXIS_NAME",
        "Pivoted region requires a records-axis name before it can commit."
      );
    }
    if (region.orientation === "cells-as-records") {
      if (!region.secondaryRecordsAxisName) {
        emitWarning(
          warnings,
          "PIVOTED_REGION_MISSING_AXIS_NAME",
          "Crosstab region missing secondary axis name."
        );
      }
      if (!region.cellValueName) {
        emitWarning(
          warnings,
          "PIVOTED_REGION_MISSING_AXIS_NAME",
          "Crosstab region missing cell-value name."
        );
      }
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

  // Roll up state.confidence map for the orchestrator's use.
  const confidenceMap = new Map<string, RegionConfidence>();
  for (const r of detectedRegions) confidenceMap.set(r.id, r.confidence);

  return { ...state, detectedRegions, confidence: confidenceMap };
}
