import type { RegionDraft } from "./region-editor.types";

/**
 * A compact directional label for a region's record-axis direction. The
 * editor surfaces this next to the region's bounds caption and header pill
 * so the user has a single visual cue for "records run ↓ / → / ↘".
 */
export type OrientationDraft =
  | "rows-as-records"
  | "columns-as-records"
  | "cells-as-records";

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
 * Derive the orientation label for a draft region. The draft's `headerAxes`
 * + pivot presence is the single source of truth:
 *
 *   - crosstab (headerAxes.length === 2) → "cells-as-records"
 *   - 1D with the record axis running ↓ → "rows-as-records"
 *   - 1D with the record axis running → → "columns-as-records"
 *
 * The record axis of a 1D region is the axis opposite its header axis,
 * unless a pivot segment on the header axis flips the interpretation (axis
 * values become fields on records that run the SAME direction as the
 * header). Headerless drafts fall back to `recordsAxis`, defaulting to
 * rows-as-records when nothing has been picked yet.
 */
export function orientationFromDraft(draft: RegionDraft): OrientationDraft {
  const axes = draft.headerAxes ?? [];
  if (axes.length === 2) return "cells-as-records";
  if (axes.length === 1) {
    const headerAxis = axes[0];
    const pivoted = hasPivotOnAxis(draft, headerAxis);
    if (headerAxis === "row") {
      return pivoted ? "columns-as-records" : "rows-as-records";
    }
    return pivoted ? "rows-as-records" : "columns-as-records";
  }
  // Headerless.
  return draft.recordsAxis === "row" ? "columns-as-records" : "rows-as-records";
}

export function isDraftPivoted(draft: RegionDraft): boolean {
  return (
    hasPivotOnAxis(draft, "row") || hasPivotOnAxis(draft, "column")
  );
}

export function isDraftCrosstab(draft: RegionDraft): boolean {
  return (draft.headerAxes ?? []).length === 2;
}

function hasPivotOnAxis(
  draft: RegionDraft,
  axis: "row" | "column"
): boolean {
  const segs = draft.segmentsByAxis?.[axis];
  if (!segs) return false;
  return segs.some((s) => s.kind === "pivot");
}
