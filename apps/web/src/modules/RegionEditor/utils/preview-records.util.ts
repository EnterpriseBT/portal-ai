/**
 * Build a preview table of records for the region configuration, given the
 * sheet's raw cell data. The output is intentionally approximate — it doesn't
 * run the full interpreter or honour every binding override — but it faithfully
 * reflects how the current segment/pivot layout carves the region into fields
 * and records. Unlabeled/missing pieces become visible placeholders so the
 * user can spot gaps before committing.
 */

import type { Segment } from "@portalai/core/contracts";

import { colIndexToLetter } from "./a1-notation.util";
import type { CellValue, RegionDraft, SheetPreview } from "./region-editor.types";

export type PreviewValue = string | number | null;
export type PreviewRow = Record<string, PreviewValue>;

export interface PreviewColumn {
  key: string;
  label: string;
  /** True when the label is a positional placeholder (unlabeled header, headerless axis). */
  placeholder: boolean;
}

export interface PreviewResult {
  columns: PreviewColumn[];
  rows: PreviewRow[];
  shape: string;
  truncated: boolean;
  notes: string[];
}

const PREVIEW_ROW_LIMIT = 25;

function readCell(
  sheet: SheetPreview,
  row: number,
  col: number
): PreviewValue {
  const raw = sheet.cells[row]?.[col];
  if (raw === undefined || raw === null || raw === "") return null;
  return raw as CellValue;
}

function coerceHeaderLabel(
  raw: PreviewValue,
  fallbackLabel: string
): { label: string; placeholder: boolean } {
  if (raw === null || raw === undefined) {
    return { label: fallbackLabel, placeholder: true };
  }
  const text = String(raw).trim();
  if (!text) return { label: fallbackLabel, placeholder: true };
  return { label: text, placeholder: false };
}

/**
 * Produce a unique stable key for a column — handles duplicate header values
 * (common in messy spreadsheets) by suffixing `_2`, `_3`, etc.
 */
function uniqueKey(base: string, seen: Set<string>): string {
  if (!seen.has(base)) {
    seen.add(base);
    return base;
  }
  let i = 2;
  while (seen.has(`${base}_${i}`)) i++;
  const key = `${base}_${i}`;
  seen.add(key);
  return key;
}

function pivotAxisName(seg: Segment, placeholder: string): {
  label: string;
  placeholder: boolean;
} {
  if (seg.kind !== "pivot") return { label: placeholder, placeholder: true };
  const name = seg.axisName.trim();
  if (!name) return { label: placeholder, placeholder: true };
  return { label: name, placeholder: false };
}

function segmentOffsets(segments: Segment[]): number[] {
  const out: number[] = [];
  let offset = 0;
  for (const seg of segments) {
    out.push(offset);
    offset += seg.positionCount;
  }
  return out;
}

// ── Headerless ────────────────────────────────────────────────────────────

function buildHeaderless(
  region: RegionDraft,
  sheet: SheetPreview
): PreviewResult {
  const recordsAxis = region.recordsAxis ?? "column";
  const { startRow, endRow, startCol, endCol } = region.bounds;
  const columns: PreviewColumn[] = [];
  const seenKeys = new Set<string>();
  const rows: PreviewRow[] = [];
  const notes: string[] = [
    "Headerless region — field names are positional placeholders until the Review step.",
  ];
  let truncated = false;

  if (recordsAxis === "column") {
    // Rows are records; columns are positional fields.
    for (let c = startCol; c <= endCol; c++) {
      const label = `Column ${colIndexToLetter(c)}`;
      const key = uniqueKey(label, seenKeys);
      columns.push({ key, label, placeholder: true });
    }
    for (let r = startRow; r <= endRow; r++) {
      if (rows.length >= PREVIEW_ROW_LIMIT) {
        truncated = true;
        break;
      }
      const row: PreviewRow = {};
      columns.forEach((col, i) => {
        row[col.key] = readCell(sheet, r, startCol + i);
      });
      rows.push(row);
    }
  } else {
    // Columns are records; rows are positional fields.
    for (let r = startRow; r <= endRow; r++) {
      const label = `Row ${r + 1}`;
      const key = uniqueKey(label, seenKeys);
      columns.push({ key, label, placeholder: true });
    }
    for (let c = startCol; c <= endCol; c++) {
      if (rows.length >= PREVIEW_ROW_LIMIT) {
        truncated = true;
        break;
      }
      const row: PreviewRow = {};
      columns.forEach((col, i) => {
        row[col.key] = readCell(sheet, startRow + i, c);
      });
      rows.push(row);
    }
  }

  return {
    columns,
    rows,
    shape: `Headerless (${recordsAxis === "column" ? "rows" : "columns"} as records)`,
    truncated,
    notes,
  };
}

// ── 1D ────────────────────────────────────────────────────────────────────

/**
 * Common plan for a 1D (single-header-axis) region: for every segment on the
 * header axis, describe the static fields it contributes, the pivot it fans
 * out into, or the skip it absorbs.
 */
interface FieldColumn {
  key: string;
  label: string;
  placeholder: boolean;
  /** Position offset along the header axis (0-based, relative to segment start). */
  axisOffset: number;
}

interface OneDPlan {
  fieldColumns: FieldColumn[];
  pivot: {
    axisName: string;
    axisNamePlaceholder: boolean;
    valueFieldName: string;
    valueFieldPlaceholder: boolean;
    axisOffsets: number[];
    axisLabels: { label: string; placeholder: boolean }[];
  } | null;
  headerNotes: string[];
}

function plan1D(
  region: RegionDraft,
  sheet: SheetPreview,
  headerAxis: "row" | "column"
): OneDPlan {
  const segments = region.segmentsByAxis?.[headerAxis] ?? [];
  const offsets = segmentOffsets(segments);
  const { startRow, startCol } = region.bounds;
  const fieldColumns: FieldColumn[] = [];
  const seenKeys = new Set<string>();
  let pivot: OneDPlan["pivot"] = null;
  const headerNotes: string[] = [];

  segments.forEach((seg, segIdx) => {
    if (seg.kind === "skip") return;
    if (seg.kind === "field") {
      for (let i = 0; i < seg.positionCount; i++) {
        if (seg.skipped?.[i] === true) continue;
        const axisOffset = offsets[segIdx] + i;
        // Header cell: at (startRow, startCol + axisOffset) for row axis,
        //              at (startRow + axisOffset, startCol) for column axis.
        const cellRow = headerAxis === "row" ? startRow : startRow + axisOffset;
        const cellCol = headerAxis === "row" ? startCol + axisOffset : startCol;
        const rawLabel = readCell(sheet, cellRow, cellCol);
        const positional =
          headerAxis === "row"
            ? `Column ${colIndexToLetter(startCol + axisOffset)}`
            : `Row ${startRow + axisOffset + 1}`;
        const override = seg.headers?.[i]?.trim();
        const { label, placeholder } = override
          ? { label: override, placeholder: false }
          : coerceHeaderLabel(rawLabel, positional);
        const key = uniqueKey(placeholder ? positional : label, seenKeys);
        fieldColumns.push({ key, label, placeholder, axisOffset });
      }
      return;
    }
    // pivot
    if (pivot !== null) {
      headerNotes.push(
        "Only the first pivot segment is expanded in this preview."
      );
      return;
    }
    const axisName = pivotAxisName(seg, `Pivot #${segIdx + 1}`);
    const valueField = region.cellValueField?.name?.trim();
    const valuePlaceholder = !valueField;
    const axisOffsets: number[] = [];
    const axisLabels: { label: string; placeholder: boolean }[] = [];
    for (let i = 0; i < seg.positionCount; i++) {
      const axisOffset = offsets[segIdx] + i;
      const cellRow = headerAxis === "row" ? startRow : startRow + axisOffset;
      const cellCol = headerAxis === "row" ? startCol + axisOffset : startCol;
      const rawLabel = readCell(sheet, cellRow, cellCol);
      const positional =
        headerAxis === "row"
          ? `Column ${colIndexToLetter(startCol + axisOffset)}`
          : `Row ${startRow + axisOffset + 1}`;
      axisOffsets.push(axisOffset);
      axisLabels.push(coerceHeaderLabel(rawLabel, positional));
    }
    pivot = {
      axisName: axisName.label,
      axisNamePlaceholder: axisName.placeholder,
      valueFieldName: valueField || "value",
      valueFieldPlaceholder: valuePlaceholder,
      axisOffsets,
      axisLabels,
    };
  });

  return { fieldColumns, pivot, headerNotes };
}

function build1D(
  region: RegionDraft,
  sheet: SheetPreview,
  headerAxis: "row" | "column"
): PreviewResult {
  const { fieldColumns, pivot, headerNotes } = plan1D(
    region,
    sheet,
    headerAxis
  );
  const { startRow, endRow, startCol, endCol } = region.bounds;
  const recordAxisStart = headerAxis === "row" ? startRow + 1 : startCol + 1;
  const recordAxisEnd = headerAxis === "row" ? endRow : endCol;
  const crossAxisStart = headerAxis === "row" ? startCol : startRow;
  const seenKeys = new Set<string>();

  // Register field columns into a stable ordering + unique keys.
  const outColumns: PreviewColumn[] = [];
  for (const fc of fieldColumns) {
    const key = uniqueKey(fc.label, seenKeys);
    outColumns.push({ key, label: fc.label, placeholder: fc.placeholder });
    // Remap the fc to its chosen output key so readRow below can find it.
    fc.key = key;
  }
  let pivotAxisKey: string | null = null;
  let pivotValueKey: string | null = null;
  if (pivot) {
    pivotAxisKey = uniqueKey(pivot.axisName, seenKeys);
    pivotValueKey = uniqueKey(pivot.valueFieldName, seenKeys);
    outColumns.push({
      key: pivotAxisKey,
      label: pivot.axisName,
      placeholder: pivot.axisNamePlaceholder,
    });
    outColumns.push({
      key: pivotValueKey,
      label: pivot.valueFieldName,
      placeholder: pivot.valueFieldPlaceholder,
    });
  }

  const rows: PreviewRow[] = [];
  let truncated = false;

  for (let recIdx = recordAxisStart; recIdx <= recordAxisEnd; recIdx++) {
    if (rows.length >= PREVIEW_ROW_LIMIT) {
      truncated = true;
      break;
    }
    const staticFields: PreviewRow = {};
    for (const fc of fieldColumns) {
      const cellRow =
        headerAxis === "row" ? recIdx : startRow + fc.axisOffset;
      const cellCol =
        headerAxis === "row"
          ? crossAxisStart + fc.axisOffset
          : recIdx;
      staticFields[fc.key] = readCell(sheet, cellRow, cellCol);
    }
    if (!pivot) {
      rows.push(staticFields);
      continue;
    }
    // Fan out: one preview row per pivot position.
    pivot.axisOffsets.forEach((axisOffset, i) => {
      if (rows.length >= PREVIEW_ROW_LIMIT) {
        truncated = true;
        return;
      }
      const cellRow =
        headerAxis === "row" ? recIdx : startRow + axisOffset;
      const cellCol =
        headerAxis === "row" ? crossAxisStart + axisOffset : recIdx;
      const value = readCell(sheet, cellRow, cellCol);
      const axisLabel = pivot!.axisLabels[i];
      rows.push({
        ...staticFields,
        [pivotAxisKey!]: axisLabel.placeholder
          ? axisLabel.label
          : axisLabel.label,
        [pivotValueKey!]: value,
      });
    });
  }

  const shape = pivot
    ? `Pivoted — ${headerAxis} axis fans out into ${pivot.axisOffsets.length} position${pivot.axisOffsets.length === 1 ? "" : "s"}`
    : `Tidy — ${headerAxis === "row" ? "rows as records" : "columns as records"}`;

  return {
    columns: outColumns,
    rows,
    shape,
    truncated,
    notes: headerNotes,
  };
}

// ── Crosstab ──────────────────────────────────────────────────────────────

interface RowFieldPos {
  kind: "field";
  /** Sheet column governed by this row-axis position. */
  col: number;
  /** Field name from the row-axis header at this column (or override). */
  header: string;
  placeholder: boolean;
}
interface RowPivotPos {
  kind: "pivot";
  col: number;
  segmentId: string;
  axisName: string;
  axisNamePlaceholder: boolean;
}
type RowAxisPos = RowFieldPos | RowPivotPos;

interface ColFieldPos {
  kind: "field";
  /** Sheet row governed by this column-axis position. */
  row: number;
  header: string;
  placeholder: boolean;
}
interface ColPivotPos {
  kind: "pivot";
  row: number;
  segmentId: string;
  axisName: string;
  axisNamePlaceholder: boolean;
}
type ColAxisPos = ColFieldPos | ColPivotPos;

function walkRowAxis(
  segs: Segment[],
  startRow: number,
  startCol: number,
  sheet: SheetPreview
): RowAxisPos[] {
  const out: RowAxisPos[] = [];
  let offset = 0;
  for (const seg of segs) {
    if (seg.kind === "skip") {
      offset += seg.positionCount;
      continue;
    }
    if (seg.kind === "field") {
      for (let i = 0; i < seg.positionCount; i++) {
        if (seg.skipped?.[i] === true) continue;
        const col = startCol + offset + i;
        const headerRaw = readCell(sheet, startRow, col);
        const positional = `Column ${colIndexToLetter(col)}`;
        const override = seg.headers?.[i]?.trim();
        const { label, placeholder } = override
          ? { label: override, placeholder: false }
          : coerceHeaderLabel(headerRaw, positional);
        out.push({ kind: "field", col, header: label, placeholder });
      }
      offset += seg.positionCount;
      continue;
    }
    // pivot
    const axisName = pivotAxisName(seg, `Pivot @ ${offset}`);
    for (let i = 0; i < seg.positionCount; i++) {
      const col = startCol + offset + i;
      out.push({
        kind: "pivot",
        col,
        segmentId: seg.id,
        axisName: axisName.label,
        axisNamePlaceholder: axisName.placeholder,
      });
    }
    offset += seg.positionCount;
  }
  return out;
}

function walkColAxis(
  segs: Segment[],
  startRow: number,
  startCol: number,
  sheet: SheetPreview
): ColAxisPos[] {
  const out: ColAxisPos[] = [];
  let offset = 0;
  for (const seg of segs) {
    if (seg.kind === "skip") {
      offset += seg.positionCount;
      continue;
    }
    if (seg.kind === "field") {
      for (let i = 0; i < seg.positionCount; i++) {
        if (seg.skipped?.[i] === true) continue;
        const row = startRow + offset + i;
        const headerRaw = readCell(sheet, row, startCol);
        const positional = `Row ${row + 1}`;
        const override = seg.headers?.[i]?.trim();
        const { label, placeholder } = override
          ? { label: override, placeholder: false }
          : coerceHeaderLabel(headerRaw, positional);
        out.push({ kind: "field", row, header: label, placeholder });
      }
      offset += seg.positionCount;
      continue;
    }
    // pivot
    const axisName = pivotAxisName(seg, `Pivot @ ${offset}`);
    for (let i = 0; i < seg.positionCount; i++) {
      const row = startRow + offset + i;
      out.push({
        kind: "pivot",
        row,
        segmentId: seg.id,
        axisName: axisName.label,
        axisNamePlaceholder: axisName.placeholder,
      });
    }
    offset += seg.positionCount;
  }
  return out;
}

function buildCrosstab(
  region: RegionDraft,
  sheet: SheetPreview
): PreviewResult {
  const rowSegs = region.segmentsByAxis?.row ?? [];
  const colSegs = region.segmentsByAxis?.column ?? [];
  const { startRow, startCol } = region.bounds;
  const notes: string[] = [];
  const seenKeys = new Set<string>();

  const rowAxisItems = walkRowAxis(rowSegs, startRow, startCol, sheet);
  const colAxisItems = walkColAxis(colSegs, startRow, startCol, sheet);

  const rowFieldPositions = rowAxisItems.filter(
    (i): i is RowFieldPos => i.kind === "field"
  );
  const colFieldPositions = colAxisItems.filter(
    (i): i is ColFieldPos => i.kind === "field"
  );
  const rowPivotPositions = rowAxisItems.filter(
    (i): i is RowPivotPos => i.kind === "pivot"
  );
  const colPivotPositions = colAxisItems.filter(
    (i): i is ColPivotPos => i.kind === "pivot"
  );

  // Build columns in the order: row-axis fields, col-axis fields, row-axis
  // pivot axisNames, col-axis pivot axisNames, then one column per distinct
  // cell-value field name (region default + every per-intersection override
  // that introduces a new name).
  const columns: PreviewColumn[] = [];
  const rowFieldKeyByCol = new Map<number, string>();
  for (const f of rowFieldPositions) {
    const positional = `Column ${colIndexToLetter(f.col)}`;
    const key = uniqueKey(f.placeholder ? positional : f.header, seenKeys);
    columns.push({ key, label: f.header, placeholder: f.placeholder });
    rowFieldKeyByCol.set(f.col, key);
  }
  const colFieldKeyByRow = new Map<number, string>();
  for (const f of colFieldPositions) {
    const positional = `Row ${f.row + 1}`;
    const key = uniqueKey(f.placeholder ? positional : f.header, seenKeys);
    columns.push({ key, label: f.header, placeholder: f.placeholder });
    colFieldKeyByRow.set(f.row, key);
  }
  const rowPivotKeyBySegId = new Map<string, string>();
  const seenRowPivots = new Set<string>();
  for (const p of rowPivotPositions) {
    if (seenRowPivots.has(p.segmentId)) continue;
    seenRowPivots.add(p.segmentId);
    const key = uniqueKey(p.axisName, seenKeys);
    columns.push({ key, label: p.axisName, placeholder: p.axisNamePlaceholder });
    rowPivotKeyBySegId.set(p.segmentId, key);
  }
  const colPivotKeyBySegId = new Map<string, string>();
  const seenColPivots = new Set<string>();
  for (const p of colPivotPositions) {
    if (seenColPivots.has(p.segmentId)) continue;
    seenColPivots.add(p.segmentId);
    const key = uniqueKey(p.axisName, seenKeys);
    columns.push({ key, label: p.axisName, placeholder: p.axisNamePlaceholder });
    colPivotKeyBySegId.set(p.segmentId, key);
  }

  const cellValueDefault = region.cellValueField?.name?.trim() ?? "";
  const distinctCellValueNames = new Set<string>();
  if (cellValueDefault) distinctCellValueNames.add(cellValueDefault);
  if (region.intersectionCellValueFields) {
    for (const f of Object.values(region.intersectionCellValueFields)) {
      const name = f?.name?.trim();
      if (name) distinctCellValueNames.add(name);
    }
  }
  if (distinctCellValueNames.size === 0) distinctCellValueNames.add("value");
  const cellValueKeyByName = new Map<string, string>();
  for (const name of distinctCellValueNames) {
    const placeholder = !cellValueDefault && name === "value";
    const key = uniqueKey(name, seenKeys);
    columns.push({ key, label: name, placeholder });
    cellValueKeyByName.set(name, key);
  }
  const cellValueNameFor = (rowSegId: string, colSegId: string): string => {
    const intersectionId = `${rowSegId}__${colSegId}`;
    const override =
      region.intersectionCellValueFields?.[intersectionId]?.name?.trim();
    return override || cellValueDefault || "value";
  };

  // Records exist at (row-axis pivot position × col-axis pivot position) body
  // cells. Skip and field-only quadrants emit no record. Each record reads:
  //   - row-axis field columns: cell(record's row, fieldCol)
  //   - col-axis field columns: cell(fieldRow, record's col)
  //   - row-axis pivot key: cell(startRow, record's col)
  //   - col-axis pivot key: cell(record's row, startCol)
  //   - cell value: cell(record's row, record's col)
  const rows: PreviewRow[] = [];
  let truncated = false;
  outer: for (const cp of colPivotPositions) {
    for (const rp of rowPivotPositions) {
      if (rows.length >= PREVIEW_ROW_LIMIT) {
        truncated = true;
        break outer;
      }
      const record: PreviewRow = {};
      for (const [fieldCol, key] of rowFieldKeyByCol.entries()) {
        record[key] = readCell(sheet, cp.row, fieldCol);
      }
      for (const [fieldRow, key] of colFieldKeyByRow.entries()) {
        record[key] = readCell(sheet, fieldRow, rp.col);
      }
      const rowPivotKey = rowPivotKeyBySegId.get(rp.segmentId);
      if (rowPivotKey) {
        record[rowPivotKey] = readCell(sheet, startRow, rp.col);
      }
      const colPivotKey = colPivotKeyBySegId.get(cp.segmentId);
      if (colPivotKey) {
        record[colPivotKey] = readCell(sheet, cp.row, startCol);
      }
      const cellValueName = cellValueNameFor(rp.segmentId, cp.segmentId);
      const cellValueKey = cellValueKeyByName.get(cellValueName);
      if (cellValueKey) {
        record[cellValueKey] = readCell(sheet, cp.row, rp.col);
      }
      rows.push(record);
    }
  }

  if (rowPivotPositions.length === 0 || colPivotPositions.length === 0) {
    notes.push(
      "Crosstab — both axes need at least one pivot segment to produce records."
    );
  }

  const shape =
    rowPivotPositions.length === 0 || colPivotPositions.length === 0
      ? "Crosstab — incomplete (one or both axes have no pivot)"
      : `Crosstab — one record per (row-pivot × column-pivot) intersection`;

  return { columns, rows, shape, truncated, notes };
}

// ── Entry point ───────────────────────────────────────────────────────────

export function buildPreviewRecords(
  region: RegionDraft,
  sheet: SheetPreview
): PreviewResult {
  const axes = region.headerAxes ?? [];
  if (axes.length === 0) return buildHeaderless(region, sheet);
  if (axes.length === 1) return build1D(region, sheet, axes[0]);
  return buildCrosstab(region, sheet);
}
