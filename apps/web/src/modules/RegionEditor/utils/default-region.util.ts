/**
 * Classic-tidy default Region constructor used when the user commits new
 * bounds in the editor. The caller is responsible for reading row 1 of the
 * selected sheet and producing one `byHeaderName` `ColumnBinding` per
 * column; the region emitted here wires those bindings with a single field
 * segment spanning the bounds, a row-strategy header anchor, and sensible
 * defaults for identity + drift. A user who does not open any segment
 * chips sees the same tidy behavior they would have seen before segments
 * landed.
 */

import type { ColumnBinding, Region } from "@portalai/core/contracts";

export type Bounds = {
  sheet: string;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
};

export type DefaultRegionInputs = {
  targetEntityDefinitionId: string;
  proposedBindings: ColumnBinding[];
  /** Optional override — callers that need a stable id (e.g. matching a
   * pre-existing draft row) may supply one. Otherwise a fresh id is minted. */
  id?: string;
};

function defaultDriftKnobs(): Region["drift"] {
  return {
    headerShiftRows: 0,
    addedColumns: "halt",
    removedColumns: { max: 0, action: "halt" },
  };
}

function mintRegionId(sheet: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${sheet}-r${suffix}`;
}

export function defaultRegionForBounds(
  bounds: Bounds,
  { targetEntityDefinitionId, proposedBindings, id }: DefaultRegionInputs
): Region {
  const { sheet, startRow, startCol, endRow, endCol } = bounds;
  const positionCount = endCol - startCol + 1;
  return {
    id: id ?? mintRegionId(sheet),
    sheet,
    bounds: { startRow, startCol, endRow, endCol },
    targetEntityDefinitionId,
    headerAxes: ["row"],
    segmentsByAxis: {
      row: [{ kind: "field", positionCount }],
    },
    headerStrategyByAxis: {
      row: {
        kind: "row",
        locator: { kind: "row", sheet, row: startRow },
        confidence: 1,
      },
    },
    identityStrategy: { kind: "rowPosition", confidence: 0.6 },
    columnBindings: proposedBindings,
    skipRules: [],
    drift: defaultDriftKnobs(),
    confidence: { region: 1, aggregate: 1 },
    warnings: [],
  };
}
