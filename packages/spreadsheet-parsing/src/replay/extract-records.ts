import {
  DEFAULT_UNTIL_BLANK_COUNT,
  recordsAxisOf,
  sourceFieldFromBinding,
  type AxisMember,
  type BindingSourceLocator,
  type ExtractedRecord,
  type Region,
  type Segment,
  type SkipRule,
  type Terminator,
} from "../plan/index.js";
import type { CellValue, Sheet, WorkbookCell } from "../workbook/types.js";
import { computeChecksum } from "./checksum.js";
import { deriveSourceId, type IdentityContext } from "./identity.js";
import { resolveHeaders, type HeaderLayout } from "./resolve-headers.js";
import { resolveRegionBounds, type ResolvedBounds } from "./resolve-bounds.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function cellValue(cell: WorkbookCell | undefined): CellValue {
  return cell ? cell.value : null;
}

function cellText(cell: WorkbookCell | undefined): string {
  if (!cell || cell.value === null) return "";
  if (cell.value instanceof Date) return cell.value.toISOString();
  if (typeof cell.value === "boolean") return cell.value ? "true" : "false";
  return String(cell.value);
}

function startCoordAlong(axis: AxisMember, bounds: ResolvedBounds): number {
  // "Start coord along a header axis" = the first cross-axis position.
  // axis=row → positions index columns → start at startCol.
  // axis=column → positions index rows → start at startRow.
  return axis === "row" ? bounds.startCol : bounds.startRow;
}

function endCoordAlong(axis: AxisMember, bounds: ResolvedBounds): number {
  return axis === "row" ? bounds.endCol : bounds.endRow;
}

function setEndCoordAlong(
  bounds: ResolvedBounds,
  axis: AxisMember,
  value: number
): void {
  if (axis === "row") {
    bounds.endCol = value;
  } else {
    bounds.endRow = value;
  }
}

// ── Terminator scan (for dynamic tail segments) ────────────────────────────

/**
 * Walk a header axis starting at `startCoord` until `terminator` fires.
 * Returns the last coord claimed by the dynamic segment (inclusive).
 * `axis` is the header axis whose positions we are extending.
 */
function scanTerminator(
  terminator: Terminator,
  sheet: Sheet,
  axis: AxisMember,
  startCoord: number,
  crossStart: number,
  crossEnd: number,
  sheetEdge: number
): number {
  const isBlankLine = (coord: number): boolean => {
    if (axis === "row") {
      for (let r = crossStart; r <= crossEnd; r++) {
        if (cellText(sheet.cell(r, coord)) !== "") return false;
      }
      return true;
    }
    for (let c = crossStart; c <= crossEnd; c++) {
      if (cellText(sheet.cell(coord, c)) !== "") return false;
    }
    return true;
  };

  const firstCell = (coord: number): string =>
    axis === "row"
      ? cellText(sheet.cell(crossStart, coord))
      : cellText(sheet.cell(coord, crossStart));

  if (terminator.kind === "untilBlank") {
    const needed = terminator.consecutiveBlanks ?? DEFAULT_UNTIL_BLANK_COUNT;
    let lastData = startCoord - 1;
    let blanks = 0;
    for (let c = startCoord; c <= sheetEdge; c++) {
      if (isBlankLine(c)) {
        blanks++;
        if (blanks >= needed) break;
      } else {
        blanks = 0;
        lastData = c;
      }
    }
    return lastData;
  }
  const re = new RegExp(terminator.pattern);
  for (let c = startCoord; c <= sheetEdge; c++) {
    if (re.test(firstCell(c))) return c - 1;
  }
  return sheetEdge;
}

// ── Effective axis state (bounds + segments per axis) ──────────────────────

interface EffectiveAxisState {
  bounds: ResolvedBounds;
  segmentsByAxis: { row?: Segment[]; column?: Segment[] };
}

/**
 * Apply per-axis dynamic-tail segment extensions on top of the
 * terminator-extended bounds from `resolveRegionBounds`. For each axis with a
 * dynamic tail segment, scan the sheet past the tail's fixed floor until the
 * terminator fires; update both the segment's `positionCount` and the
 * corresponding bound.
 */
function computeEffective(
  region: Region,
  sheet: Sheet,
  baseBounds: ResolvedBounds
): EffectiveAxisState {
  const bounds: ResolvedBounds = { ...baseBounds };
  const result: EffectiveAxisState = {
    bounds,
    segmentsByAxis: {},
  };

  for (const axis of ["row", "column"] as const) {
    const segs = region.segmentsByAxis?.[axis];
    if (!segs || segs.length === 0) continue;

    // Check for a dynamic tail segment.
    const tail = segs[segs.length - 1];
    const isDynamicPivot =
      tail.kind === "pivot" && tail.dynamic !== undefined;

    if (!isDynamicPivot) {
      result.segmentsByAxis[axis] = segs.slice();
      continue;
    }

    const fixedCount = segs
      .slice(0, -1)
      .reduce((acc, s) => acc + s.positionCount, 0);
    const headerStart = startCoordAlong(axis, bounds);
    const tailStart = headerStart + fixedCount;
    const crossStart =
      axis === "row" ? bounds.startRow : bounds.startCol;
    const crossEnd =
      axis === "row" ? bounds.endRow : bounds.endCol;
    const sheetEdge =
      axis === "row" ? sheet.dimensions.cols : sheet.dimensions.rows;

    const tailSeg = tail as Extract<Segment, { kind: "pivot" }>;
    const scannedEnd = scanTerminator(
      tailSeg.dynamic!.terminator,
      sheet,
      axis,
      tailStart,
      crossStart,
      crossEnd,
      sheetEdge
    );
    const dynamicCount = Math.max(
      tailSeg.positionCount,
      scannedEnd - tailStart + 1
    );

    const newTail: Segment = { ...tailSeg, positionCount: dynamicCount };
    const nextSegs = segs.slice(0, -1).concat(newTail);
    result.segmentsByAxis[axis] = nextSegs;

    // Extend bounds along the header axis to cover the dynamic tail.
    const newEnd = tailStart + dynamicCount - 1;
    if (newEnd > endCoordAlong(axis, bounds)) {
      setEndCoordAlong(bounds, axis, newEnd);
    }
  }

  return result;
}

// ── Segments → per-position expansion ──────────────────────────────────────

interface ExpandedPosition {
  segment: Segment;
  offsetInSegment: number;
  /** Sheet coord: col for axis=row, row for axis=column. */
  coord: number;
}

function expandSegmentsToPositions(
  segments: Segment[],
  startCoord: number
): ExpandedPosition[] {
  const out: ExpandedPosition[] = [];
  let coord = startCoord;
  for (const segment of segments) {
    for (let offset = 0; offset < segment.positionCount; offset++) {
      out.push({ segment, offsetInSegment: offset, coord });
      coord++;
    }
  }
  return out;
}

// ── Binding resolution ─────────────────────────────────────────────────────

interface ResolvedBindingCoord {
  axis: AxisMember;
  coord: number;
}

function resolveBindingCoord(
  locator: BindingSourceLocator,
  sheet: Sheet,
  bounds: ResolvedBounds,
  headersByAxis: { row?: HeaderLayout; column?: HeaderLayout }
): ResolvedBindingCoord | undefined {
  if (locator.kind === "byPositionIndex") {
    const start = startCoordAlong(locator.axis, bounds);
    return { axis: locator.axis, coord: start + locator.index - 1 };
  }
  const headers = headersByAxis[locator.axis];
  if (!headers) return undefined;
  const coord = headers.coordByLabel.get(locator.name);
  if (coord === undefined) return undefined;
  return { axis: locator.axis, coord };
}

/**
 * Given a resolved binding coord and the two "record coords" (row, col that
 * identify the record/cell being emitted), return the cell to read.
 *
 * - axis=row: coord is a column; we cross with the record's row.
 * - axis=column: coord is a row; we cross with the record's column.
 */
function readBindingCell(
  binding: ResolvedBindingCoord,
  recordRow: number,
  recordCol: number,
  sheet: Sheet
): CellValue {
  if (binding.axis === "row") {
    return cellValue(sheet.cell(recordRow, binding.coord));
  }
  return cellValue(sheet.cell(binding.coord, recordCol));
}

// ── Skip rule evaluation ───────────────────────────────────────────────────

function ruleMatchesRecord(
  rule: SkipRule,
  region: Region,
  sheet: Sheet,
  bounds: ResolvedBounds,
  recordRow: number,
  recordCol: number
): boolean {
  const numAxes = region.headerAxes.length;
  if (rule.kind === "blank") {
    if (numAxes === 2) {
      return cellText(sheet.cell(recordRow, recordCol)) === "";
    }
    // 1D / headerless: whole line blank.
    const recAxis = recordsAxisOf(region);
    if (recAxis === "row" || (numAxes === 1 && region.headerAxes[0] === "row")) {
      for (let c = bounds.startCol; c <= bounds.endCol; c++) {
        if (cellText(sheet.cell(recordRow, c)) !== "") return false;
      }
      return true;
    }
    // records iterate cols → line is a column.
    for (let r = bounds.startRow; r <= bounds.endRow; r++) {
      if (cellText(sheet.cell(r, recordCol)) !== "") return false;
    }
    return true;
  }

  // cellMatches
  const re = new RegExp(rule.pattern);
  if (numAxes === 2) {
    const axis = rule.axis ?? "row";
    if (axis === "row") {
      return re.test(cellText(sheet.cell(recordRow, rule.crossAxisIndex + 1)));
    }
    return re.test(cellText(sheet.cell(rule.crossAxisIndex + 1, recordCol)));
  }
  // 1D / headerless
  const headerAxis = region.headerAxes[0];
  if (headerAxis === "row" || (numAxes === 0 && region.recordsAxis === "row")) {
    return re.test(cellText(sheet.cell(recordRow, rule.crossAxisIndex + 1)));
  }
  return re.test(cellText(sheet.cell(rule.crossAxisIndex + 1, recordCol)));
}

// ── Headerless emit ────────────────────────────────────────────────────────

function extractHeaderless(
  region: Region,
  sheet: Sheet,
  bounds: ResolvedBounds
): ExtractedRecord[] {
  const recordsAxis = region.recordsAxis!;
  const out: ExtractedRecord[] = [];

  const iterStart =
    recordsAxis === "row" ? bounds.startRow : bounds.startCol;
  const iterEnd = recordsAxis === "row" ? bounds.endRow : bounds.endCol;

  for (let coord = iterStart; coord <= iterEnd; coord++) {
    const recordRow = recordsAxis === "row" ? coord : 0;
    const recordCol = recordsAxis === "column" ? coord : 0;
    if (
      region.skipRules.some((rule) =>
        ruleMatchesRecord(rule, region, sheet, bounds, recordRow, recordCol)
      )
    ) {
      continue;
    }
    const fields: Record<string, unknown> = {};
    for (const binding of region.columnBindings) {
      const resolved = resolveBindingCoord(binding.sourceLocator, sheet, bounds, {});
      if (!resolved) continue;
      fields[sourceFieldFromBinding(binding)] = readBindingCell(
        resolved,
        recordRow,
        recordCol,
        sheet
      );
    }
    out.push(buildRecord(region, recordRow, recordCol, sheet, fields));
  }
  return out;
}

// ── 1D emit (segmented; statics-only is a degenerate segmented case) ───────

function extract1D(
  region: Region,
  sheet: Sheet,
  effective: EffectiveAxisState
): ExtractedRecord[] {
  const headerAxis = region.headerAxes[0];
  const headers = resolveHeaders(region, headerAxis, sheet, effective.bounds);
  const headersByAxis: { row?: HeaderLayout; column?: HeaderLayout } = {};
  if (headers) headersByAxis[headerAxis] = headers;

  const segments = effective.segmentsByAxis[headerAxis] ?? [];
  const positions = expandSegmentsToPositions(
    segments,
    startCoordAlong(headerAxis, effective.bounds)
  );
  const hasPivot = segments.some((s) => s.kind === "pivot");

  // Determine entity-unit iteration axis. Records iterate along the opposite
  // (cross) axis of the header line: for headerAxis="row" (row of labels),
  // each record = one row excluding the header row.
  const entityAxis = headerAxis;
  const entityStart =
    entityAxis === "row" ? effective.bounds.startRow : effective.bounds.startCol;
  const entityEnd =
    entityAxis === "row" ? effective.bounds.endRow : effective.bounds.endCol;
  const headerIndex = headers?.index;
  const entityFirst =
    headerIndex !== undefined
      ? Math.max(entityStart, headerIndex + 1)
      : entityStart;

  const out: ExtractedRecord[] = [];

  // Pre-resolve columnBindings once — statics map: position coord →
  // sourceFieldKey (the binding's human-readable source name). We key on the
  // source field rather than `columnDefinitionId` because two bindings on the
  // same region may share a colDefId (the AI can map two distinct source
  // columns to the same target column type), and the cell write below is
  // last-write-wins per key — so colDefId-keyed writes silently overwrite the
  // first binding's value with the second's.
  const staticsByPosition = new Map<number, string>();
  for (const binding of region.columnBindings) {
    const resolved = resolveBindingCoord(
      binding.sourceLocator,
      sheet,
      effective.bounds,
      headersByAxis
    );
    if (!resolved) continue;
    staticsByPosition.set(resolved.coord, sourceFieldFromBinding(binding));
  }

  for (let entity = entityFirst; entity <= entityEnd; entity++) {
    const recordRow = entityAxis === "row" ? entity : 0;
    const recordCol = entityAxis === "column" ? entity : 0;

    if (
      region.skipRules.some((rule) =>
        ruleMatchesRecord(rule, region, sheet, effective.bounds, recordRow, recordCol)
      )
    ) {
      continue;
    }

    // Collect statics by walking only field-segment positions. Using the
    // binding map keyed by coord keeps statics-only (all-field) and mixed
    // shapes unified.
    const statics: Record<string, unknown> = {};
    for (const position of positions) {
      if (position.segment.kind !== "field") continue;
      const sourceFieldKey = staticsByPosition.get(position.coord);
      if (!sourceFieldKey) continue;
      statics[sourceFieldKey] =
        entityAxis === "row"
          ? cellValue(sheet.cell(entity, position.coord))
          : cellValue(sheet.cell(position.coord, entity));
    }

    const identityCtx: IdentityContext = {
      sheet,
      row: recordRow,
      col: recordCol,
    };
    const baseSourceId = deriveSourceId(region.identityStrategy, identityCtx);

    if (!hasPivot) {
      // All-field or statics-only region. Emit one record per entity.
      out.push(
        finalizeRecord(region, recordRow, recordCol, sheet, baseSourceId, statics)
      );
      continue;
    }

    // Pivot-bearing region. Emit one record per pivot-label position per
    // entity. Skip "skip" and "field" positions.
    for (const position of positions) {
      if (position.segment.kind !== "pivot") continue;
      const segment = position.segment;
      const label =
        entityAxis === "row"
          ? cellText(sheet.cell(headers!.index, position.coord))
          : cellText(sheet.cell(position.coord, headers!.index));
      const value =
        entityAxis === "row"
          ? cellValue(sheet.cell(entity, position.coord))
          : cellValue(sheet.cell(position.coord, entity));
      const cellValueName = region.cellValueField!.name;
      const fields: Record<string, unknown> = {
        ...statics,
        [segment.axisName]: label,
        [cellValueName]: value,
      };
      const sourceId = `${baseSourceId}::${segment.id}::${label}`;
      out.push(
        finalizeRecord(region, recordRow, recordCol, sheet, sourceId, fields)
      );
    }
  }
  return out;
}

// ── 2D emit (crosstab) ─────────────────────────────────────────────────────

function extract2D(
  region: Region,
  sheet: Sheet,
  effective: EffectiveAxisState
): ExtractedRecord[] {
  const rowHeaders = resolveHeaders(region, "row", sheet, effective.bounds);
  const colHeaders = resolveHeaders(region, "column", sheet, effective.bounds);
  const headersByAxis: { row?: HeaderLayout; column?: HeaderLayout } = {};
  if (rowHeaders) headersByAxis.row = rowHeaders;
  if (colHeaders) headersByAxis.column = colHeaders;

  const rowSegments = effective.segmentsByAxis.row ?? [];
  const colSegments = effective.segmentsByAxis.column ?? [];
  const rowPositions = expandSegmentsToPositions(
    rowSegments,
    effective.bounds.startCol
  );
  const colPositions = expandSegmentsToPositions(
    colSegments,
    effective.bounds.startRow
  );

  const cellValueFieldName = region.cellValueField?.name;

  // Statics bindings resolve once; on 2D, the binding's axis determines which
  // record-coord it crosses (entityRow for axis=row; entityCol for axis=column).
  // Keyed by the binding's source-field name (not `columnDefinitionId`) so
  // two bindings sharing a colDefId emit separate fields instead of
  // last-write-wins clobbering each other.
  interface ResolvedStatic {
    sourceFieldKey: string;
    resolved: ResolvedBindingCoord;
  }
  const statics: ResolvedStatic[] = [];
  for (const binding of region.columnBindings) {
    const resolved = resolveBindingCoord(
      binding.sourceLocator,
      sheet,
      effective.bounds,
      headersByAxis
    );
    if (!resolved) continue;
    statics.push({
      sourceFieldKey: sourceFieldFromBinding(binding),
      resolved,
    });
  }

  const out: ExtractedRecord[] = [];
  for (const rp of rowPositions) {
    // rp.coord is a col; the row-header row provides labels.
    for (const cp of colPositions) {
      // cp.coord is a row.
      const cellRow = cp.coord;
      const cellCol = rp.coord;

      // Records exist only at (row-axis pivot × column-axis pivot) body
      // cells. Field positions on either axis contribute static sidebar
      // values to the pivot×pivot records (read from the same row/col),
      // not their own records — emitting one for every non-skip cell
      // would double-write static-field values (the body cell at a
      // field column equals the static field's value for that row, so
      // a record there would carry the same value under both the
      // static field name AND the cell-value name).
      if (rp.segment.kind !== "pivot" || cp.segment.kind !== "pivot") {
        continue;
      }

      if (
        region.skipRules.some((rule) =>
          ruleMatchesRecord(rule, region, sheet, effective.bounds, cellRow, cellCol)
        )
      ) {
        continue;
      }

      const fields: Record<string, unknown> = {};

      // Statics: read each binding using (cellRow, cellCol) as record coords.
      for (const s of statics) {
        fields[s.sourceFieldKey] = readBindingCell(
          s.resolved,
          cellRow,
          cellCol,
          sheet
        );
      }

      // Row-axis pivot contribution: label from row-header at this col.
      if (rowHeaders) {
        fields[rp.segment.axisName] = cellText(
          sheet.cell(rowHeaders.index, rp.coord)
        );
      }
      // Column-axis pivot contribution: label from col-header at this row.
      if (colHeaders) {
        fields[cp.segment.axisName] = cellText(
          sheet.cell(cp.coord, colHeaders.index)
        );
      }
      // Cell value — when the user has supplied a per-intersection
      // override (`region.intersectionCellValueFields[
      // `${rowPivotId}__${colPivotId}`]`), emit under that override's
      // name so each (rowPivot, colPivot) block lands in its own
      // FieldMapping. Fall back to the region-level `cellValueField.name`
      // when no override is set on this intersection.
      let effectiveCellValueName = cellValueFieldName;
      if (region.intersectionCellValueFields) {
        const intersectionKey = `${rp.segment.id}__${cp.segment.id}`;
        const override = region.intersectionCellValueFields[intersectionKey];
        const overrideName = override?.name?.trim();
        if (overrideName) effectiveCellValueName = overrideName;
      }
      if (effectiveCellValueName) {
        fields[effectiveCellValueName] = cellValue(sheet.cell(cellRow, cellCol));
      }

      out.push(
        finalizeRecord(region, cellRow, cellCol, sheet, undefined, fields)
      );
    }
  }
  return out;
}

// ── Record finalization ────────────────────────────────────────────────────

function buildRecord(
  region: Region,
  recordRow: number,
  recordCol: number,
  sheet: Sheet,
  fields: Record<string, unknown>
): ExtractedRecord {
  const sourceId = deriveSourceId(region.identityStrategy, {
    sheet,
    row: recordRow,
    col: recordCol,
  });
  return {
    regionId: region.id,
    targetEntityDefinitionId: region.targetEntityDefinitionId,
    sourceId,
    checksum: computeChecksum(fields),
    fields,
  };
}

function finalizeRecord(
  region: Region,
  recordRow: number,
  recordCol: number,
  sheet: Sheet,
  sourceIdOverride: string | undefined,
  fields: Record<string, unknown>
): ExtractedRecord {
  const sourceId =
    sourceIdOverride !== undefined
      ? sourceIdOverride
      : deriveSourceId(region.identityStrategy, {
          sheet,
          row: recordRow,
          col: recordCol,
        });
  return {
    regionId: region.id,
    targetEntityDefinitionId: region.targetEntityDefinitionId,
    sourceId,
    checksum: computeChecksum(fields),
    fields,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Walk a region and emit one `ExtractedRecord` per record slot. The emit is
 * unified across tidy (0 or 1 header axis, no pivot), pivoted (1 header axis
 * with a pivot segment), and crosstab (2 header axes); each dispatch reads
 * identical inputs — bounds, segments, bindings — so segmented and tidy plans
 * round-trip to the same records.
 */
export function extractRecords(
  region: Region,
  sheet: Sheet
): ExtractedRecord[] {
  const baseBounds = resolveRegionBounds(region, sheet);
  const numAxes = region.headerAxes.length;

  if (numAxes === 0) return extractHeaderless(region, sheet, baseBounds);

  const effective = computeEffective(region, sheet, baseBounds);

  if (numAxes === 1) return extract1D(region, sheet, effective);
  return extract2D(region, sheet, effective);
}
