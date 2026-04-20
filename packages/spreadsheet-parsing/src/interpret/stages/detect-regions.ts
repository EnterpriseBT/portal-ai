import type { Region, RegionHint } from "../../plan/index.js";
import type { InterpretState } from "../types.js";

/**
 * Deterministic, counter-based region id generator. Phase 3 does not require
 * UUIDs — region ids are consumed as opaque strings by downstream stages and
 * the orchestrator. Phase 6's DB repository may swap this for UUIDs at the
 * commit boundary.
 */
function regionIdFromHint(hint: RegionHint, index: number): string {
  return `region-${index + 1}-${hint.sheet}-${hint.bounds.startRow}x${hint.bounds.startCol}`;
}

/**
 * Skeleton region produced from a hint. `detect-headers`, `detect-identity`,
 * `classify-columns`, and `propose-bindings` progressively fill in the rest.
 * Phase 3's orchestrator doesn't need every field populated at this point;
 * the final assembly happens in `propose-bindings`.
 */
function skeletonRegionFromHint(hint: RegionHint, index: number): Region {
  const now = Date.now();
  void now;
  const region: Region = {
    id: regionIdFromHint(hint, index),
    sheet: hint.sheet,
    bounds: { ...hint.bounds },
    boundsMode: "absolute",
    targetEntityDefinitionId: hint.targetEntityDefinitionId,
    orientation: hint.orientation,
    headerAxis: hint.headerAxis,
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
  if (hint.recordsAxisName) {
    region.recordsAxisName = { name: hint.recordsAxisName, source: "user" };
  }
  if (hint.secondaryRecordsAxisName) {
    region.secondaryRecordsAxisName = {
      name: hint.secondaryRecordsAxisName,
      source: "user",
    };
  }
  if (hint.cellValueName) {
    region.cellValueName = { name: hint.cellValueName, source: "user" };
  }
  if (hint.axisAnchorCell) {
    region.axisAnchorCell = { ...hint.axisAnchorCell };
  }
  return region;
}

/**
 * Stage 1 — populate `detectedRegions` from hints. Auto-detect without hints
 * is a Phase 4 feature; for now, absence of hints raises
 * `UNSUPPORTED_LAYOUT_SHAPE`.
 */
export function detectRegions(state: InterpretState): InterpretState {
  const hints = state.input.regionHints;
  if (!hints || hints.length === 0) {
    throw new Error(
      "UNSUPPORTED_LAYOUT_SHAPE: regionHints are required (auto-detect lands in Phase 4)"
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
