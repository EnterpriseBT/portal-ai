import type {
  OrientationDraft,
  RegionDraft,
} from "./region-editor.types";

export function orientationArrow(orientation: OrientationDraft): string {
  switch (orientation) {
    case "rows-as-records":
      return "↓";
    case "columns-as-records":
      return "→";
    case "cells-as-records":
      return "↘";
  }
}

export function orientationArrowLabel(orientation: OrientationDraft): string {
  switch (orientation) {
    case "rows-as-records":
      return "Records run down (each row is a record)";
    case "columns-as-records":
      return "Records run across (each column is a record)";
    case "cells-as-records":
      return "Records are individual cells (crosstab)";
  }
}

/**
 * Derive the legacy `OrientationDraft` label from a draft. Prefers the PR-4
 * segment model (`headerAxes` + pivot presence) when present so the panel's
 * breadcrumb arrow stays in sync with segment edits; falls back to the
 * legacy `orientation` field for drafts that haven't been migrated yet.
 */
export function orientationFromDraft(draft: RegionDraft): OrientationDraft {
  const axes = draft.headerAxes;
  if (axes && axes.length > 0) {
    if (axes.length === 2) return "cells-as-records";
    // 1D with a pivot segment on the header axis means records run along
    // the *other* axis (pivoted). 1D without pivot is rows/columns-as-records.
    const headerAxis = axes[0];
    const pivoted = hasPivotOnAxis(draft, headerAxis);
    if (headerAxis === "row") {
      return pivoted ? "columns-as-records" : "rows-as-records";
    }
    return pivoted ? "rows-as-records" : "columns-as-records";
  }
  return draft.orientation;
}

/**
 * True when the region has at least one pivot segment (either axis). Used
 * to gate the `cellValueField.name` input and the dynamic-tail affordance.
 */
export function isDraftPivoted(draft: RegionDraft): boolean {
  if (hasPivotOnAxis(draft, "row") || hasPivotOnAxis(draft, "column")) {
    return true;
  }
  // Legacy fallback: a draft with orientation + headerAxis combinations
  // that imply a pivot (e.g. columns-as-records + headerAxis:row).
  const { orientation, headerAxis } = draft;
  if (orientation === "cells-as-records") return true;
  if (orientation === "columns-as-records" && headerAxis === "row") return true;
  if (orientation === "rows-as-records" && headerAxis === "column") return true;
  return false;
}

export function isDraftCrosstab(draft: RegionDraft): boolean {
  if (draft.headerAxes && draft.headerAxes.length === 2) return true;
  if (draft.headerAxes && draft.headerAxes.length > 0) return false;
  return draft.orientation === "cells-as-records";
}

function hasPivotOnAxis(
  draft: RegionDraft,
  axis: "row" | "column"
): boolean {
  const segs = draft.segmentsByAxis?.[axis];
  if (!segs) return false;
  return segs.some((s) => s.kind === "pivot");
}
