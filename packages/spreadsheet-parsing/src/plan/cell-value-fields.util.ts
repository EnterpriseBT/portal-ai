import type { AxisMember } from "./enums.js";
import type { CellValueField } from "./region.schema.js";

/** The parts of a region, draft or hint the cell-value rule reads. */
export interface CellValueFieldShape {
  headerAxes?: readonly AxisMember[];
  segmentsByAxis?: {
    row?: ReadonlyArray<{ kind: string; id?: string }>;
    column?: ReadonlyArray<{ kind: string; id?: string }>;
  };
  cellValueField?: CellValueField;
  intersectionCellValueFields?: Record<string, CellValueField>;
}

/**
 * The region rule for cell-value fields (`region.schema` refinements 7 and
 * 6a), applied to a region whose segments and cell-value fields came from
 * different places (#998):
 *
 *   - no pivot segment: no `cellValueField` and no intersection fields;
 *   - a pivot segment and no `cellValueField`: `defaultField`, when given;
 *   - an `intersectionCellValueFields` key must be
 *     `<rowPivotId>__<colPivotId>` naming pivots that exist, on a region
 *     with two header axes (when `headerAxes` is known).
 *
 * Interpret runs it once it has settled a region's segments, so a hint's
 * cell-value fields can't contradict the segments interpret used (they
 * failed the final plan parse as a 500). The web's merge after interpret
 * runs it as a backstop, and the region editor's panel keeps drafts to the
 * same rule as the user edits them.
 */
export function reconcileCellValueFields<T extends CellValueFieldShape>(
  region: T,
  { defaultField }: { defaultField?: CellValueField } = {}
): T {
  const pivotIds = (axis: AxisMember) =>
    new Set(
      (region.segmentsByAxis?.[axis] ?? []).flatMap((s) =>
        s.kind === "pivot" && s.id ? [s.id] : []
      )
    );
  const rowPivots = pivotIds("row");
  const colPivots = pivotIds("column");
  const out: T = { ...region };

  if (rowPivots.size + colPivots.size === 0) {
    delete out.cellValueField;
    delete out.intersectionCellValueFields;
    return out;
  }
  if (!out.cellValueField && defaultField) {
    out.cellValueField = { ...defaultField };
  }

  if (out.intersectionCellValueFields) {
    const twoAxes =
      region.headerAxes === undefined || region.headerAxes.length === 2;
    const kept = Object.fromEntries(
      Object.entries(out.intersectionCellValueFields).filter(([key]) => {
        if (!twoAxes) return false;
        const sep = key.indexOf("__");
        return (
          sep > 0 &&
          rowPivots.has(key.slice(0, sep)) &&
          colPivots.has(key.slice(sep + 2))
        );
      })
    );
    if (Object.keys(kept).length > 0) out.intersectionCellValueFields = kept;
    else delete out.intersectionCellValueFields;
  }
  return out;
}
