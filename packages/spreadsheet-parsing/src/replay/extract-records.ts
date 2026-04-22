import type {
  ColumnBinding,
  ExtractedRecord,
  Region,
  SkipRule,
} from "../plan/index.js";
import type { CellValue, Sheet, WorkbookCell } from "../workbook/types.js";
import { computeChecksum } from "./checksum.js";
import { extractSegmentedRecords } from "./extract-segmented-records.js";
import { deriveSourceId } from "./identity.js";
import { resolveHeaders, type HeaderLayout } from "./resolve-headers.js";
import { resolveRegionBounds, type ResolvedBounds } from "./resolve-bounds.js";

function cellValue(cell: WorkbookCell | undefined): CellValue {
  return cell ? cell.value : null;
}

function cellText(cell: WorkbookCell | undefined): string {
  if (!cell || cell.value === null) return "";
  if (cell.value instanceof Date) return cell.value.toISOString();
  if (typeof cell.value === "boolean") return cell.value ? "true" : "false";
  return String(cell.value);
}

function ruleMatchesRecord(
  rule: SkipRule,
  recordAxisIndex: number,
  secondaryAxisIndex: number,
  sheet: Sheet,
  region: Region,
  bounds: ResolvedBounds
): boolean {
  if (rule.kind === "blank") {
    if (region.orientation === "rows-as-records") {
      for (let c = bounds.startCol; c <= bounds.endCol; c++) {
        if (cellText(sheet.cell(recordAxisIndex, c)) !== "") return false;
      }
      return true;
    }
    if (region.orientation === "columns-as-records") {
      for (let r = bounds.startRow; r <= bounds.endRow; r++) {
        if (cellText(sheet.cell(r, recordAxisIndex)) !== "") return false;
      }
      return true;
    }
    // cells-as-records: check the single cell
    return cellText(sheet.cell(recordAxisIndex, secondaryAxisIndex)) === "";
  }

  // cellMatches
  const re = new RegExp(rule.pattern);
  if (region.orientation === "cells-as-records") {
    const axis = rule.axis ?? "row";
    if (axis === "row") {
      const cell = cellText(
        sheet.cell(recordAxisIndex, rule.crossAxisIndex + 1)
      );
      return re.test(cell);
    }
    const cell = cellText(
      sheet.cell(rule.crossAxisIndex + 1, secondaryAxisIndex)
    );
    return re.test(cell);
  }
  if (region.orientation === "rows-as-records") {
    const cell = cellText(sheet.cell(recordAxisIndex, rule.crossAxisIndex + 1));
    return re.test(cell);
  }
  // columns-as-records
  const cell = cellText(sheet.cell(rule.crossAxisIndex + 1, recordAxisIndex));
  return re.test(cell);
}

function headerCoordForBinding(
  binding: ColumnBinding,
  headers: HeaderLayout
): number | undefined {
  if (binding.sourceLocator.kind === "byColumnIndex") {
    return binding.sourceLocator.col;
  }
  return headers.coordByLabel.get(binding.sourceLocator.name);
}

function extractFromRowRecord(
  region: Region,
  sheet: Sheet,
  bounds: ResolvedBounds,
  headers: HeaderLayout,
  row: number
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const binding of region.columnBindings) {
    const col = headerCoordForBinding(binding, headers);
    if (col === undefined) continue;
    fields[binding.columnDefinitionId] = cellValue(sheet.cell(row, col));
  }
  return fields;
}

function extractFromColumnRecord(
  region: Region,
  sheet: Sheet,
  bounds: ResolvedBounds,
  headers: HeaderLayout,
  col: number
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const binding of region.columnBindings) {
    const coord = headerCoordForBinding(binding, headers);
    if (coord === undefined) continue;
    // For columns-as-records, coordByLabel maps to a row index.
    fields[binding.columnDefinitionId] = cellValue(sheet.cell(coord, col));
  }
  // Attach records-axis label (from the axis anchor row).
  if (region.recordsAxisName) {
    const axisRow = region.axisAnchorCell?.row ?? bounds.startRow;
    fields[region.recordsAxisName.name] = cellValue(sheet.cell(axisRow, col));
  }
  return fields;
}

function extractFromCrosstabCell(
  region: Region,
  sheet: Sheet,
  bounds: ResolvedBounds,
  row: number,
  col: number
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const anchor = region.axisAnchorCell ?? {
    row: bounds.startRow,
    col: bounds.startCol,
  };
  if (region.recordsAxisName) {
    fields[region.recordsAxisName.name] = cellValue(
      sheet.cell(row, anchor.col)
    );
  }
  if (region.secondaryRecordsAxisName) {
    fields[region.secondaryRecordsAxisName.name] = cellValue(
      sheet.cell(anchor.row, col)
    );
  }
  if (region.cellValueName) {
    fields[region.cellValueName.name] = cellValue(sheet.cell(row, col));
  }
  return fields;
}

/**
 * Walk a region and emit one `ExtractedRecord` per record slot, honouring
 * orientation, skip rules, identity strategy, and axis-name attachment.
 */
export function extractRecords(
  region: Region,
  sheet: Sheet
): ExtractedRecord[] {
  // Segmented regions (see docs/REGION_CONFIG.schema_replay.spec.md) own
  // their own emit loop because the record count per entity-unit depends on
  // position roles and per-segment pivotLabel counts.
  if (region.positionRoles && region.pivotSegments) {
    return extractSegmentedRecords(region, sheet);
  }

  const bounds = resolveRegionBounds(region, sheet);
  const headers = resolveHeaders(region, sheet, bounds);
  const records: ExtractedRecord[] = [];

  const emit = (
    row: number,
    col: number,
    fields: Record<string, unknown>
  ): void => {
    const sourceId = deriveSourceId(region.identityStrategy, {
      sheet,
      orientation: region.orientation,
      row,
      col,
    });
    records.push({
      regionId: region.id,
      targetEntityDefinitionId: region.targetEntityDefinitionId,
      sourceId,
      checksum: computeChecksum(fields),
      fields,
    });
  };

  if (region.orientation === "rows-as-records") {
    const headerRow = headers.direction === "row" ? headers.index : undefined;
    const startRow =
      headerRow !== undefined
        ? Math.max(bounds.startRow, headerRow + 1)
        : bounds.startRow;
    for (let row = startRow; row <= bounds.endRow; row++) {
      if (
        region.skipRules.some((rule) =>
          ruleMatchesRecord(rule, row, 0, sheet, region, bounds)
        )
      ) {
        continue;
      }
      emit(row, 0, extractFromRowRecord(region, sheet, bounds, headers, row));
    }
    return records;
  }

  if (region.orientation === "columns-as-records") {
    const headerCol =
      headers.direction === "column" ? headers.index : undefined;
    const startCol =
      headerCol !== undefined
        ? Math.max(bounds.startCol, headerCol + 1)
        : bounds.startCol;
    for (let col = startCol; col <= bounds.endCol; col++) {
      if (
        region.skipRules.some((rule) =>
          ruleMatchesRecord(rule, col, 0, sheet, region, bounds)
        )
      ) {
        continue;
      }
      emit(
        0,
        col,
        extractFromColumnRecord(region, sheet, bounds, headers, col)
      );
    }
    return records;
  }

  // cells-as-records
  const anchor = region.axisAnchorCell ?? {
    row: bounds.startRow,
    col: bounds.startCol,
  };
  for (let row = anchor.row + 1; row <= bounds.endRow; row++) {
    for (let col = anchor.col + 1; col <= bounds.endCol; col++) {
      if (
        region.skipRules.some((rule) =>
          ruleMatchesRecord(rule, row, col, sheet, region, bounds)
        )
      ) {
        continue;
      }
      emit(row, col, extractFromCrosstabCell(region, sheet, bounds, row, col));
    }
  }
  return records;
}
