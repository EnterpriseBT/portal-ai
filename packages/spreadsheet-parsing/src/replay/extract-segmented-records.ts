import type { ExtractedRecord, Region } from "../plan/index.js";
import type { CellValue, Sheet, WorkbookCell } from "../workbook/types.js";
import { computeChecksum } from "./checksum.js";
import { deriveSourceId } from "./identity.js";
import { resolveRegionBounds } from "./resolve-bounds.js";
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

  // Phase C: rows-as-records + headerAxis:row. Other combinations throw
  // until later phases wire them up.
  if (region.orientation === "rows-as-records" && region.headerAxis === "row") {
    return emitRowsWithRowHeader(region, sheet, bounds.endRow, bounds.startRow, bounds.startCol, bounds.endCol, headers);
  }

  throw unsupported(region);
}

function emitRowsWithRowHeader(
  region: Region,
  sheet: Sheet,
  endRow: number,
  startRow: number,
  startCol: number,
  endCol: number,
  headers: HeaderLayout
): ExtractedRecord[] {
  const records: ExtractedRecord[] = [];
  // Field positions → columnDefinitionId, populated from columnBindings.
  const bindingByCol = new Map<number, string>();
  for (const binding of region.columnBindings) {
    const col =
      binding.sourceLocator.kind === "byColumnIndex"
        ? binding.sourceLocator.col
        : headers.coordByLabel.get(binding.sourceLocator.name);
    if (col !== undefined) bindingByCol.set(col, binding.columnDefinitionId);
  }

  const headerRow = headers.direction === "row" ? headers.index : startRow;
  const dataStart = Math.max(startRow, headerRow + 1);

  const positionRoles = region.positionRoles!;
  const segments = region.pivotSegments!;

  for (let row = dataStart; row <= endRow; row++) {
    const statics: Record<string, CellValue> = {};
    for (let c = startCol; c <= endCol; c++) {
      const role = positionRoles[c - startCol];
      if (role.kind !== "field") continue;
      const columnDefinitionId = bindingByCol.get(c);
      if (!columnDefinitionId) continue;
      statics[columnDefinitionId] = cellValue(sheet.cell(row, c));
    }

    const baseSourceId = deriveSourceId(region.identityStrategy, {
      sheet,
      orientation: region.orientation,
      row,
      col: 0,
    });

    for (const segment of segments) {
      for (let c = startCol; c <= endCol; c++) {
        const role = positionRoles[c - startCol];
        if (role.kind !== "pivotLabel" || role.segmentId !== segment.id) continue;
        const label = cellText(sheet.cell(headerRow, c));
        const value = cellValue(sheet.cell(row, c));
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
      }
    }
  }

  return records;
}
