import type { Region, RegionHint } from "../../plan/index.js";
import type { InterpretState } from "../types.js";

function regionIdFromHint(hint: RegionHint, index: number): string {
  return `region-${index + 1}-${hint.sheet}-${hint.bounds.startRow}x${hint.bounds.startCol}`;
}

/**
 * Skeleton region produced from a hint. Later stages fill in
 * `headerStrategyByAxis`, `identityStrategy`, `columnBindings`, and any
 * segment/`cellValueField` fields not already carried on the hint.
 */
function skeletonRegionFromHint(hint: RegionHint, index: number): Region {
  const region: Region = {
    id: regionIdFromHint(hint, index),
    sheet: hint.sheet,
    bounds: { ...hint.bounds },
    targetEntityDefinitionId: hint.targetEntityDefinitionId,
    headerAxes: hint.headerAxes,
    identityStrategy: { kind: "rowPosition", confidence: 0 },
    columnBindings: [],
    skipRules: [],
    drift: {
      headerShiftRows: 0,
      addedColumns: "halt",
      removedColumns: { max: 0, action: "halt" },
    },
    confidence: { region: 0, aggregate: 0 },
    warnings: [],
  };
  if (hint.segmentsByAxis) {
    region.segmentsByAxis = {
      row: hint.segmentsByAxis.row
        ? hint.segmentsByAxis.row.map((s) => ({ ...s }))
        : undefined,
      column: hint.segmentsByAxis.column
        ? hint.segmentsByAxis.column.map((s) => ({ ...s }))
        : undefined,
    };
  }
  if (hint.cellValueField) {
    region.cellValueField = { ...hint.cellValueField };
  }
  if (hint.intersectionCellValueFields) {
    region.intersectionCellValueFields = Object.fromEntries(
      Object.entries(hint.intersectionCellValueFields).map(([id, f]) => [
        id,
        { ...f },
      ])
    );
  }
  if (hint.recordsAxis !== undefined) {
    region.recordsAxis = hint.recordsAxis;
  }
  if (hint.recordAxisTerminator) {
    region.recordAxisTerminator = { ...hint.recordAxisTerminator };
  }
  if (hint.axisAnchorCell) {
    region.axisAnchorCell = { ...hint.axisAnchorCell };
  }
  return region;
}

/**
 * Stage 1 — populate `detectedRegions` from hints. Auto-detect without hints
 * is a later-phase feature; absence of hints raises `UNSUPPORTED_LAYOUT_SHAPE`.
 */
export function detectRegions(state: InterpretState): InterpretState {
  const hints = state.input.regionHints;
  if (!hints || hints.length === 0) {
    throw new Error(
      "UNSUPPORTED_LAYOUT_SHAPE: regionHints are required (auto-detect lands in a later phase)"
    );
  }

  const knownSheets = new Set(state.workbook.sheets.map((s) => s.name));
  const detectedRegions: Region[] = hints.map((hint, i) => {
    if (!knownSheets.has(hint.sheet)) {
      throw new Error(
        `UNKNOWN_SHEET: regionHint references sheet "${hint.sheet}" which is not in the workbook`
      );
    }
    return skeletonRegionFromHint(hint, i);
  });

  return { ...state, detectedRegions };
}
