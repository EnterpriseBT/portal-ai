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
        const { label, placeholder } = coerceHeaderLabel(rawLabel, positional);
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

function buildCrosstab(
  region: RegionDraft,
  sheet: SheetPreview
): PreviewResult {
  const rowSegs = region.segmentsByAxis?.row ?? [];
  const colSegs = region.segmentsByAxis?.column ?? [];
  const rowPivot = rowSegs.find((s) => s.kind === "pivot") as
    | Extract<Segment, { kind: "pivot" }>
    | undefined;
  const colPivot = colSegs.find((s) => s.kind === "pivot") as
    | Extract<Segment, { kind: "pivot" }>
    | undefined;
  const { startRow, endRow, startCol, endCol } = region.bounds;
  const notes: string[] = [];

  const rowAxisName = rowPivot
    ? pivotAxisName(rowPivot, "Row axis")
    : { label: "Row axis", placeholder: true };
  const colAxisName = colPivot
    ? pivotAxisName(colPivot, "Column axis")
    : { label: "Column axis", placeholder: true };
  const valueField = region.cellValueField?.name?.trim();
  const valuePlaceholder = !valueField;

  const seenKeys = new Set<string>();
  const rowAxisKey = uniqueKey(rowAxisName.label, seenKeys);
  const colAxisKey = uniqueKey(colAxisName.label, seenKeys);
  const valueKey = uniqueKey(valueField || "value", seenKeys);
  const columns: PreviewColumn[] = [
    { key: rowAxisKey, label: rowAxisName.label, placeholder: rowAxisName.placeholder },
    { key: colAxisKey, label: colAxisName.label, placeholder: colAxisName.placeholder },
    { key: valueKey, label: valueField || "value", placeholder: valuePlaceholder },
  ];

  // Inner rectangle: everything except the first row (column-axis labels) and
  // first column (row-axis labels). If bounds collapse, no inner area.
  if (endRow <= startRow || endCol <= startCol) {
    return {
      columns,
      rows: [],
      shape: "Crosstab — region too small to expand",
      truncated: false,
      notes,
    };
  }

  const rows: PreviewRow[] = [];
  let truncated = false;
  outer: for (let r = startRow + 1; r <= endRow; r++) {
    const rowLabelRaw = readCell(sheet, r, startCol);
    const rowLabel = coerceHeaderLabel(rowLabelRaw, `Row ${r + 1}`);
    for (let c = startCol + 1; c <= endCol; c++) {
      if (rows.length >= PREVIEW_ROW_LIMIT) {
        truncated = true;
        break outer;
      }
      const colLabelRaw = readCell(sheet, startRow, c);
      const colLabel = coerceHeaderLabel(
        colLabelRaw,
        `Column ${colIndexToLetter(c)}`
      );
      rows.push({
        [rowAxisKey]: rowLabel.label,
        [colAxisKey]: colLabel.label,
        [valueKey]: readCell(sheet, r, c),
      });
    }
  }

  return {
    columns,
    rows,
    shape: "Crosstab — one record per inner cell",
    truncated,
    notes,
  };
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
