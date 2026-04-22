import type { ExtractedRecord, Region } from "../plan/index.js";
import type { CellValue, Sheet, WorkbookCell } from "../workbook/types.js";
import { computeChecksum } from "./checksum.js";
import { deriveSourceId, type IdentityContext } from "./identity.js";
import { resolveRegionBounds, type ResolvedBounds } from "./resolve-bounds.js";
import { resolveHeaders, type HeaderLayout } from "./resolve-headers.js";

function cellValue(cell: WorkbookCell | undefined): CellValue {
  return cell ? cell.value : null;
}

function cellText(cell: WorkbookCell | undefined): string {
  if (!cell || cell.value === null) return "";
  if (cell.value instanceof Date) return cell.value.toISOString();
  if (typeof cell.value === "boolean") return cell.value ? "true" : "false";
  return String(cell.value);
}

function unsupported(region: Region): Error {
  return new Error(
    `extractSegmentedRecords: (orientation=${region.orientation}, headerAxis=${region.headerAxis}) not yet supported`
  );
}

/**
 * Orientation-agnostic accessors produced by `buildDispatch`. The emit loop
 * iterates `entityUnits × positions` and asks the accessors for concrete
 * values, so it doesn't care whether entity-units are sheet rows or columns.
 */
interface Dispatch {
  entityUnits: number[];
  positions: number[];
  cellValueAt: (entityUnit: number, position: number) => CellValue;
  headerLabelAt: (position: number) => string;
  identityCtxFor: (entityUnit: number) => Pick<IdentityContext, "row" | "col">;
}

function buildDispatch(
  region: Region,
  sheet: Sheet,
  bounds: ResolvedBounds,
  headers: HeaderLayout
): Dispatch {
  // The emit loop is driven by `headerAxis`: it tells us which axis the
  // per-position header labels live on, and therefore which axis the entity
  // units iterate across (the perpendicular one). `orientation` is an
  // orthogonal flag that only influences `deriveSourceId` — pivoted variants
  // (rows-as-records + headerAxis:column, columns-as-records + headerAxis:row)
  // fall out naturally because they share layout with the non-pivoted case on
  // the same `headerAxis`.
  if (region.headerAxis === "row") {
    const headerRow = headers.direction === "row" ? headers.index : bounds.startRow;
    const dataStart = Math.max(bounds.startRow, headerRow + 1);
    const entityUnits = range(dataStart, bounds.endRow);
    const positions = range(bounds.startCol, bounds.endCol);
    return {
      entityUnits,
      positions,
      cellValueAt: (row, col) => cellValue(sheet.cell(row, col)),
      headerLabelAt: (col) => cellText(sheet.cell(headerRow, col)),
      identityCtxFor: (row) => ({ row, col: 0 }),
    };
  }

  if (region.headerAxis === "column") {
    const headerCol =
      headers.direction === "column" ? headers.index : bounds.startCol;
    const dataStart = Math.max(bounds.startCol, headerCol + 1);
    const entityUnits = range(dataStart, bounds.endCol);
    const positions = range(bounds.startRow, bounds.endRow);
    return {
      entityUnits,
      positions,
      cellValueAt: (col, row) => cellValue(sheet.cell(row, col)),
      headerLabelAt: (row) => cellText(sheet.cell(row, headerCol)),
      identityCtxFor: (col) => ({ row: 0, col }),
    };
  }

  throw unsupported(region);
}

function range(startInclusive: number, endInclusive: number): number[] {
  const out: number[] = [];
  for (let i = startInclusive; i <= endInclusive; i++) out.push(i);
  return out;
}

/**
 * Segmented replay for regions carrying `positionRoles` + `pivotSegments`.
 *
 * Phase-1 scope (see docs/REGION_CONFIG.schema_replay.spec.md): linear
 * orientations only. Crosstab is rejected at the schema layer.
 */
export function extractSegmentedRecords(
  region: Region,
  sheet: Sheet
): ExtractedRecord[] {
  if (!region.positionRoles || !region.pivotSegments) return [];
  if (region.orientation === "cells-as-records") {
    // Schema blocks this already; guard defensively.
    throw unsupported(region);
  }

  const bounds = resolveRegionBounds(region, sheet);
  const headers = resolveHeaders(region, sheet, bounds);
  const dispatch = buildDispatch(region, sheet, bounds, headers);

  const positionRoles = region.positionRoles;
  const segments = region.pivotSegments;

  // Map header-axis position → columnDefinitionId for field-role statics.
  const bindingByPosition = new Map<number, string>();
  for (const binding of region.columnBindings) {
    const coord =
      binding.sourceLocator.kind === "byColumnIndex"
        ? binding.sourceLocator.col
        : headers.coordByLabel.get(binding.sourceLocator.name);
    if (coord !== undefined)
      bindingByPosition.set(coord, binding.columnDefinitionId);
  }

  const records: ExtractedRecord[] = [];

  for (const entityUnit of dispatch.entityUnits) {
    const statics: Record<string, CellValue> = {};
    dispatch.positions.forEach((position, i) => {
      const role = positionRoles[i];
      if (role.kind !== "field") return;
      const columnDefinitionId = bindingByPosition.get(position);
      if (!columnDefinitionId) return;
      statics[columnDefinitionId] = dispatch.cellValueAt(entityUnit, position);
    });

    const ctx = dispatch.identityCtxFor(entityUnit);
    const baseSourceId = deriveSourceId(region.identityStrategy, {
      sheet,
      orientation: region.orientation,
      row: ctx.row,
      col: ctx.col,
    });

    for (const segment of segments) {
      dispatch.positions.forEach((position, i) => {
        const role = positionRoles[i];
        if (role.kind !== "pivotLabel" || role.segmentId !== segment.id) return;
        const label = dispatch.headerLabelAt(position);
        const value = dispatch.cellValueAt(entityUnit, position);
        const fields: Record<string, CellValue> = {
          ...statics,
          [segment.axisName]: label,
          [segment.valueFieldName]: value,
        };
        records.push({
          regionId: region.id,
          targetEntityDefinitionId: region.targetEntityDefinitionId,
          sourceId: `${baseSourceId}::${segment.id}::${label}`,
          checksum: computeChecksum(fields),
          fields,
        });
      });
    }
  }

  return records;
}
