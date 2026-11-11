import type { Region, RegionHint } from "../../plan/index.js";
import { columnLetters, formatA1Range } from "../../workbook/index.js";
import type { SheetDimensions } from "../../workbook/index.js";
import { inputError } from "../input-error.js";
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
  if (hint.identityStrategy) {
    // Copy verbatim — `detectIdentity` honors `source: "user"` to short-
    // circuit the heuristic, otherwise it overwrites the strategy as usual.
    region.identityStrategy = { ...hint.identityStrategy };
  }
  return region;
}

/**
 * #1008: what's wrong with a hint's bounds on its sheet, one sentence each.
 * A hint's bounds are only checked for being positive integers, so a region
 * past the sheet came back with impossible bounds, and an inverted one failed
 * the final plan parse as a 500.
 */
function boundsProblems(
  hint: RegionHint,
  dimensions: SheetDimensions
): string[] {
  const { startRow, startCol, endRow, endCol } = hint.bounds;
  const region = `Region ${formatA1Range(hint.bounds)} on "${hint.sheet}"`;
  // An empty sheet has no last row or column to name.
  if (dimensions.rows === 0 || dimensions.cols === 0) {
    return [`${region} is on an empty sheet. Pick a sheet with data.`];
  }
  const problems: string[] = [];
  if (startRow > endRow) {
    problems.push(
      `${region} starts after it ends (row ${startRow} is below row ${endRow}). Redraw it.`
    );
  }
  if (startCol > endCol) {
    problems.push(
      `${region} starts after it ends (column ${columnLetters(startCol)} is right of column ${columnLetters(endCol)}). Redraw it.`
    );
  }
  if (Math.max(startRow, endRow) > dimensions.rows) {
    problems.push(
      `${region} runs past the sheet's last row (${dimensions.rows}). Redraw it inside the sheet.`
    );
  }
  if (Math.max(startCol, endCol) > dimensions.cols) {
    problems.push(
      `${region} runs past the sheet's last column (${columnLetters(dimensions.cols)}). Redraw it inside the sheet.`
    );
  }
  return problems;
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

  const dimensionsBySheet = new Map(
    state.workbook.sheets.map((s) => [s.name, s.dimensions])
  );
  const problems: string[] = [];
  const detectedRegions: Region[] = hints.map((hint, i) => {
    const dimensions = dimensionsBySheet.get(hint.sheet);
    if (!dimensions) {
      throw new Error(
        `UNKNOWN_SHEET: regionHint references sheet "${hint.sheet}" which is not in the workbook`
      );
    }
    problems.push(...boundsProblems(hint, dimensions));
    return skeletonRegionFromHint(hint, i);
  });
  // Every bad hint at once, as #1002's header check does, and before header
  // detection and the model stages, so an inverted region isn't misreported
  // as headerless and a bad hint costs no model call. The API answers the
  // prefix as a 400 with this message.
  if (problems.length > 0) throw inputError(problems);

  return { ...state, detectedRegions };
}
