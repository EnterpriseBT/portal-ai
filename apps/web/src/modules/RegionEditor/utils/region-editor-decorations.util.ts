import type {
  CellBounds,
  CellCoord,
  CellValue,
  RegionDraft,
  Segment,
  SheetPreview,
  SkipRuleDraft,
} from "./region-editor.types";

/** Resolve the region's axis-name anchor cell, defaulting to the top-left of bounds. */
export function resolveAnchorCell(region: RegionDraft): CellCoord {
  return (
    region.axisAnchorCell ?? {
      row: region.bounds.startRow,
      col: region.bounds.startCol,
    }
  );
}

/**
 * Read the non-blank string value (if any) at the region's anchor cell. Used to
 * propose a default `recordsAxisName` when the user hasn't supplied one.
 * Numeric or blank anchors return `null` — we don't auto-default numeric axis names.
 */
export function anchorCellValue(
  region: RegionDraft,
  sheet: SheetPreview
): string | null {
  const anchor = resolveAnchorCell(region);
  const v = sheet.cells?.[anchor.row]?.[anchor.col];
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed ? trimmed : null;
}

export type DecorationKind =
  | "header"
  | "rowAxisLabel"
  | "colAxisLabel"
  | "axisNameAnchor"
  | "cellValue"
  | "skipped";

export interface RegionDecoration {
  kind: DecorationKind;
  bounds: CellBounds;
  label?: string;
}

/** Solid fills shown over the region background. Kept transparent so cell text stays legible. */
export const DECORATION_COLOR: Record<DecorationKind, string> = {
  header: "rgba(37, 99, 235, 0.22)",
  rowAxisLabel: "rgba(147, 51, 234, 0.22)",
  colAxisLabel: "rgba(219, 39, 119, 0.22)",
  axisNameAnchor: "rgba(234, 88, 12, 0.38)",
  cellValue: "rgba(13, 148, 136, 0.12)",
  skipped: "rgba(100, 116, 139, 0.18)",
};

/** Optional secondary styling — used by skipped to get the striped "excluded" treatment. */
export const DECORATION_BACKGROUND_IMAGE: Partial<
  Record<DecorationKind, string>
> = {
  skipped:
    "repeating-linear-gradient(45deg, rgba(100,116,139,0.45) 0 6px, transparent 6px 12px)",
};

export const DECORATION_LABEL: Record<DecorationKind, string> = {
  header: "Header",
  rowAxisLabel: "Row axis labels",
  colAxisLabel: "Column axis labels",
  axisNameAnchor: "Axis name",
  cellValue: "Cell values",
  skipped: "Skipped",
};

function cellBlank(v: CellValue | undefined): boolean {
  return v === null || v === undefined || v === "";
}

function rowIsBlank(
  cells: CellValue[][],
  row: number,
  startCol: number,
  endCol: number
): boolean {
  for (let c = startCol; c <= endCol; c++) {
    if (!cellBlank(cells[row]?.[c])) return false;
  }
  return true;
}

function colIsBlank(
  cells: CellValue[][],
  col: number,
  startRow: number,
  endRow: number
): boolean {
  for (let r = startRow; r <= endRow; r++) {
    if (!cellBlank(cells[r]?.[col])) return false;
  }
  return true;
}

function regexSafe(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

function ruleMatchesRow(
  rule: SkipRuleDraft,
  row: number,
  cells: CellValue[][],
  bounds: CellBounds
): boolean {
  if (rule.kind === "blank") {
    return rowIsBlank(cells, row, bounds.startCol, bounds.endCol);
  }
  if (rule.crossAxisIndex === undefined) return false;
  const cell = cells[row]?.[rule.crossAxisIndex];
  const rx = regexSafe(rule.pattern);
  // Coerce null/undefined to "" so patterns like ^$ can match empty cells.
  return Boolean(rx && rx.test(cell == null ? "" : String(cell)));
}

function ruleMatchesCol(
  rule: SkipRuleDraft,
  col: number,
  cells: CellValue[][],
  bounds: CellBounds
): boolean {
  if (rule.kind === "blank") {
    return colIsBlank(cells, col, bounds.startRow, bounds.endRow);
  }
  if (rule.crossAxisIndex === undefined) return false;
  const cell = cells[rule.crossAxisIndex]?.[col];
  const rx = regexSafe(rule.pattern);
  // Coerce null/undefined to "" so patterns like ^$ can match empty cells.
  return Boolean(rx && rx.test(cell == null ? "" : String(cell)));
}

export function computeRegionDecorations(
  region: RegionDraft,
  sheet: SheetPreview
): RegionDecoration[] {
  const decorations: RegionDecoration[] = [];
  const { bounds, skipRules } = region;
  const { cells } = sheet;

  const axes = region.headerAxes ?? [];
  const crosstab = axes.length === 2;
  const hasRowHeader = axes.includes("row");
  const hasColHeader = axes.includes("column");
  const rowSegs = region.segmentsByAxis?.row ?? [];
  const colSegs = region.segmentsByAxis?.column ?? [];
  const rowPivot = rowSegs.find((s) => s.kind === "pivot");
  const colPivot = colSegs.find((s) => s.kind === "pivot");
  const pivoted = !!rowPivot || !!colPivot;

  const anchor = resolveAnchorCell(region);
  const anchorAtCorner =
    anchor.row === bounds.startRow && anchor.col === bounds.startCol;
  const anchorValue = anchorCellValue(region, sheet);

  // Header bands for 1D regions. The corner cell is carved out only when the
  // region is pivoted on that axis AND the anchor sits at the default
  // top-left; otherwise the header renders as a full band and the anchor
  // decoration layers on top.
  if (hasRowHeader && !crosstab) {
    decorations.push({
      kind: "header",
      bounds: {
        startRow: bounds.startRow,
        endRow: bounds.startRow,
        startCol:
          rowPivot && anchorAtCorner ? bounds.startCol + 1 : bounds.startCol,
        endCol: bounds.endCol,
      },
      label: "Header row",
    });
  } else if (hasColHeader && !crosstab) {
    decorations.push({
      kind: "header",
      bounds: {
        startRow:
          colPivot && anchorAtCorner ? bounds.startRow + 1 : bounds.startRow,
        endRow: bounds.endRow,
        startCol: bounds.startCol,
        endCol: bounds.startCol,
      },
      label: "Header column",
    });
  }

  // Crosstab: row-axis labels (leftmost column) and column-axis labels (top
  // row). Corner is carved out only when the anchor sits at the default
  // corner. Names come from the first pivot segment on each axis.
  if (crosstab) {
    decorations.push({
      kind: "rowAxisLabel",
      bounds: {
        startRow: anchorAtCorner ? bounds.startRow + 1 : bounds.startRow,
        endRow: bounds.endRow,
        startCol: bounds.startCol,
        endCol: bounds.startCol,
      },
      label: rowPivot?.axisName ?? "Row axis labels",
    });
    decorations.push({
      kind: "colAxisLabel",
      bounds: {
        startRow: bounds.startRow,
        endRow: bounds.startRow,
        startCol: anchorAtCorner ? bounds.startCol + 1 : bounds.startCol,
        endCol: bounds.endCol,
      },
      label: colPivot?.axisName ?? "Column axis labels",
    });
    // Inner data rectangle — each cell is an extracted record's value under
    // `cellValueField.name`. Guarded on the region being at least 2×2 so we
    // don't emit a zero-area decoration when bounds collapse to the label
    // bands.
    if (bounds.endRow > bounds.startRow && bounds.endCol > bounds.startCol) {
      decorations.push({
        kind: "cellValue",
        bounds: {
          startRow: bounds.startRow + 1,
          endRow: bounds.endRow,
          startCol: bounds.startCol + 1,
          endCol: bounds.endCol,
        },
        label: region.cellValueField?.name ?? "Cell values",
      });
    }
  }

  // Axis-name anchor — the cell where the pivot's axis name lives. Default
  // position is (startRow, startCol); the user may override via
  // region.axisAnchorCell. Rendered only on pivoted regions since that's
  // when the axis-name label matters.
  if (pivoted) {
    let names: string;
    if (crosstab) {
      // Legacy behavior: when the primary-axis name is unset, fall back
      // to the anchor cell's value ("student" etc.) so crosstab anchors
      // still get a useful label mid-edit.
      const rowName = rowPivot?.axisName || anchorValue || "";
      const colName = colPivot?.axisName ?? "";
      names = [rowName, colName].filter(Boolean).join(" × ");
    } else {
      const pivotAxisName = rowPivot?.axisName ?? colPivot?.axisName ?? "";
      names = pivotAxisName || anchorValue || "";
    }
    decorations.push({
      kind: "axisNameAnchor",
      bounds: {
        startRow: anchor.row,
        endRow: anchor.row,
        startCol: anchor.col,
        endCol: anchor.col,
      },
      label: names || "Axis name goes here",
    });
  }

  // Per-position field-segment skips — each `skipped[i] === true` flag on a
  // field segment marks one column (row-axis) or one row (column-axis) as
  // omitted from records. We surface that as the same striped "skipped"
  // decoration the skip-rules emit so the canvas reads consistently. The
  // overlay spans the full record area (excluding the header line itself —
  // the popover already disables the header input there) so the user can
  // see exactly which column / row will be dropped.
  for (const axis of axes) {
    const segments = axis === "row" ? rowSegs : colSegs;
    let offset = 0;
    for (const seg of segments) {
      if (seg.kind === "field" && seg.skipped) {
        for (let i = 0; i < seg.positionCount; i++) {
          if (seg.skipped[i] !== true) continue;
          if (axis === "row") {
            const col = bounds.startCol + offset + i;
            decorations.push({
              kind: "skipped",
              bounds: {
                startRow: bounds.startRow + 1,
                endRow: bounds.endRow,
                startCol: col,
                endCol: col,
              },
              label: "Skipped column",
            });
          } else {
            const row = bounds.startRow + offset + i;
            decorations.push({
              kind: "skipped",
              bounds: {
                startRow: row,
                endRow: row,
                startCol: bounds.startCol + 1,
                endCol: bounds.endCol,
              },
              label: "Skipped row",
            });
          }
        }
      }
      offset += seg.positionCount;
    }
  }

  // Skip rules — evaluated along the record axis. For crosstab, rules can
  // target rows or columns via `rule.axis`; for 1D, the record axis is the
  // axis opposite the header; for headerless, `region.recordsAxis` picks.
  if (skipRules && skipRules.length > 0) {
    const recordStartRow = hasRowHeader ? bounds.startRow + 1 : bounds.startRow;
    const recordStartCol = hasColHeader ? bounds.startCol + 1 : bounds.startCol;

    let evaluateRows: boolean;
    let evaluateCols: boolean;
    if (crosstab) {
      evaluateRows = skipRules.some(
        (r) =>
          r.kind === "blank" || (r.kind === "cellMatches" && r.axis !== "column")
      );
      evaluateCols = skipRules.some(
        (r) => r.kind === "cellMatches" && r.axis === "column"
      );
    } else if (hasRowHeader) {
      evaluateRows = true;
      evaluateCols = false;
    } else if (hasColHeader) {
      evaluateRows = false;
      evaluateCols = true;
    } else {
      // headerless: recordsAxis='column' means records run along the column
      // axis (each row is a record); recordsAxis='row' means each column is a
      // record.
      evaluateRows = region.recordsAxis !== "row";
      evaluateCols = region.recordsAxis === "row";
    }

    if (evaluateRows) {
      const startRow = crosstab ? bounds.startRow + 1 : recordStartRow;
      const startCol = crosstab ? bounds.startCol + 1 : bounds.startCol;
      const scanBounds: CellBounds = {
        startRow,
        endRow: bounds.endRow,
        startCol,
        endCol: bounds.endCol,
      };
      for (let row = startRow; row <= bounds.endRow; row++) {
        const match = skipRules.some((rule) =>
          ruleMatchesRow(rule, row, cells, scanBounds)
        );
        if (match) {
          decorations.push({
            kind: "skipped",
            bounds: {
              startRow: row,
              endRow: row,
              startCol: bounds.startCol,
              endCol: bounds.endCol,
            },
            label: "Skipped row",
          });
        }
      }
    }

    if (evaluateCols) {
      const startRow = crosstab ? bounds.startRow + 1 : bounds.startRow;
      const startCol = crosstab ? bounds.startCol + 1 : recordStartCol;
      const scanBounds: CellBounds = {
        startRow,
        endRow: bounds.endRow,
        startCol,
        endCol: bounds.endCol,
      };
      for (let col = startCol; col <= bounds.endCol; col++) {
        const match = skipRules.some((rule) =>
          ruleMatchesCol(rule, col, cells, scanBounds)
        );
        if (match) {
          decorations.push({
            kind: "skipped",
            bounds: {
              startRow: bounds.startRow,
              endRow: bounds.endRow,
              startCol: col,
              endCol: col,
            },
            label: "Skipped column",
          });
        }
      }
    }
  }

  return decorations;
}

/** The set of decoration kinds that actually appear for the given region — used by the legend. */
export function activeDecorationKinds(
  decorations: RegionDecoration[]
): DecorationKind[] {
  const set = new Set<DecorationKind>();
  for (const d of decorations) set.add(d.kind);
  return Array.from(set);
}

// ── Segment overlays ──────────────────────────────────────────────────────

export type SegmentOverlayKind = "field" | "pivot" | "skip";

export interface SegmentOverlay {
  axis: "row" | "column";
  /** 0-based index of this segment inside its axis's segments[] array. */
  segmentIndex: number;
  kind: SegmentOverlayKind;
  bounds: CellBounds;
  /** Optional descriptive label — for pivots this is the pivot's axisName. */
  label?: string;
  /** True when this is a dynamic-tail pivot that grows until a terminator. */
  dynamic?: boolean;
}

/** Strong segment-band fills keyed by kind. Opacity is bumped over the
 *  subdued header/axis-label decorations so segments remain readable when
 *  they layer on top of them. */
export const SEGMENT_OVERLAY_COLOR: Record<SegmentOverlayKind, string> = {
  field: "rgba(37, 99, 235, 0.32)",
  pivot: "rgba(147, 51, 234, 0.32)",
  skip: "rgba(100, 116, 139, 0.22)",
};

/** Secondary styling for the skip overlay — the same diagonal stripes used
 *  for the canonical "skipped" decoration so the two read as related. */
export const SEGMENT_OVERLAY_BACKGROUND_IMAGE: Partial<
  Record<SegmentOverlayKind, string>
> = {
  skip: "repeating-linear-gradient(45deg, rgba(100,116,139,0.38) 0 5px, transparent 5px 10px)",
};

/** Overlay border colour for each kind — matches the chip tone so grid and
 *  chip read as the same element. */
export const SEGMENT_OVERLAY_BORDER: Record<SegmentOverlayKind, string> = {
  field: "rgba(37, 99, 235, 0.75)",
  pivot: "rgba(147, 51, 234, 0.75)",
  skip: "rgba(100, 116, 139, 0.55)",
};

// ── Pivot intersection overlays ──────────────────────────────────────────

/**
 * Body-cell rectangle defined by `(row-axis pivot segment R, column-axis
 * pivot segment C)` — i.e. the cells whose row-axis position lies inside `R`
 * and whose column-axis position lies inside `C`. Documented in
 * `segment-intersection.md` as `<intersection-block>` and rendered by the
 * canvas as a single tinted rectangle with a composite axisName label so
 * the user can see which pivot pairing fans out into which body region.
 */
/**
 * The four "kinds" of body-cell intersection in a 2D crosstab. Keyed by
 * `(row-axis segment kind, column-axis segment kind)`; the off-diagonal
 * `field × pivot` and `pivot × field` collapse to a single visual kind
 * because they're symmetric semantically (one axis is static, the other
 * fans out — the body cell is the static axis's value either way), and
 * any cell where either axis is `<skip>` collapses to `skip-mixed`
 * regardless of the orthogonal kind.
 */
export type IntersectionKind =
  | "field-field"
  | "field-pivot"
  | "pivot-pivot"
  | "skip-mixed";

export interface IntersectionOverlay {
  /**
   * Stable id derived from the row/column segment indices (and pivot ids
   * when present). Pivot×pivot uses `${rowPivotId}__${colPivotId}` for
   * round-tripping with `intersectionCellValueFields`; non-pivot kinds
   * use `r${rowIdx}-c${colIdx}` since field/skip segments don't carry ids.
   */
  id: string;
  /** Intersection kind — drives the canvas tint + edit affordance. */
  kind: IntersectionKind;
  bounds: CellBounds;
  /** Set on `pivot-pivot` only — the segment ids participating. */
  rowPivotSegmentId?: string;
  colPivotSegmentId?: string;
  /**
   * Composite display label — `<axisName-row> × <axisName-col>`. Set on
   * `pivot-pivot` (where both names exist); omitted for other kinds since
   * field/skip segments don't carry an axisName.
   */
  label?: string;
  /**
   * Resolved cell-value field name for this intersection's body cells —
   * `region.intersectionCellValueFields[id].name` when an override is set,
   * otherwise `region.cellValueField.name`. Empty string when neither is
   * available. Set on `pivot-pivot` only; the canvas surfaces this on the
   * overlay so the user can see which field each block fans out into.
   */
  cellValueName?: string;
  /**
   * `true` when `region.intersectionCellValueFields[id]` is set — i.e. this
   * intersection has its own per-block override, distinct from the
   * region-level `cellValueField`. Set on `pivot-pivot` only.
   */
  cellValueOverridden?: boolean;
}

/**
 * Tints keyed by `IntersectionKind`. Each kind gets a distinct hue so the
 * user reads the body grid at a glance:
 *
 * - `field-field` blue (degenerate; both axes claim the cell)
 * - `field-pivot` violet (one axis static, the other fans out)
 * - `pivot-pivot` amber (the canonical intersection — editable)
 * - `skip-mixed`  gray (any axis is `<skip>` — body cell is dropped)
 */
export const INTERSECTION_OVERLAY_COLOR: Record<IntersectionKind, string> = {
  "field-field": "rgba(37, 99, 235, 0.14)",
  "field-pivot": "rgba(168, 85, 247, 0.16)",
  "pivot-pivot": "rgba(217, 119, 6, 0.18)",
  "skip-mixed": "rgba(100, 116, 139, 0.14)",
};

/** Borders matching the per-kind tint above; the label chip reuses these
 *  for its own background so the outline + chip read as one unit. */
export const INTERSECTION_OVERLAY_BORDER: Record<IntersectionKind, string> = {
  "field-field": "rgba(37, 99, 235, 0.55)",
  "field-pivot": "rgba(147, 51, 234, 0.55)",
  "pivot-pivot": "rgba(180, 83, 9, 0.65)",
  "skip-mixed": "rgba(100, 116, 139, 0.55)",
};

/** Diagonal-stripe pattern for `skip-mixed` so dropped cells read as
 *  excluded at a glance — same gesture skip-rule decorations use. */
export const INTERSECTION_OVERLAY_BACKGROUND_IMAGE: Partial<
  Record<IntersectionKind, string>
> = {
  "skip-mixed":
    "repeating-linear-gradient(45deg, rgba(100,116,139,0.32) 0 5px, transparent 5px 10px)",
};

function intersectionKind(
  rowKind: Segment["kind"],
  colKind: Segment["kind"]
): IntersectionKind {
  if (rowKind === "skip" || colKind === "skip") return "skip-mixed";
  if (rowKind === "pivot" && colKind === "pivot") return "pivot-pivot";
  if (rowKind === "field" && colKind === "field") return "field-field";
  return "field-pivot";
}

/**
 * Emit one overlay per body-cell rectangle defined by every
 * `(row-axis segment, column-axis segment)` pair on a 2D region — colored
 * by intersection kind. `pivot-pivot` overlays additionally carry the
 * pivot ids + composite axisName label + resolved cell-value name so the
 * canvas can render an editable label chip; the other kinds are
 * visual-only references.
 *
 * Bounds are clamped to body cells (header lines excluded). Returns `[]`
 * for 1D and headerless regions, where no axis pairing exists.
 */
export function computeIntersectionOverlays(
  region: RegionDraft
): IntersectionOverlay[] {
  const overlays: IntersectionOverlay[] = [];
  const axes = region.headerAxes ?? [];
  if (axes.length !== 2) return overlays;

  const rowSegs = region.segmentsByAxis?.row ?? [];
  const colSegs = region.segmentsByAxis?.column ?? [];
  const { startRow, startCol, endRow, endCol } = region.bounds;

  // Body cells start one past each axis's header line. Segments that
  // happen to begin at offset 0 (i.e. include the corner / header band)
  // still produce an overlay; we clamp the bounds so the overlay never
  // paints over a header-band decoration.
  const bodyStartRow = startRow + 1;
  const bodyStartCol = startCol + 1;

  let rowOffset = 0;
  for (let rIdx = 0; rIdx < rowSegs.length; rIdx++) {
    const r = rowSegs[rIdx];
    const blockStartCol = Math.max(bodyStartCol, startCol + rowOffset);
    const blockEndCol = Math.min(
      endCol,
      startCol + rowOffset + r.positionCount - 1
    );
    if (blockEndCol < blockStartCol) {
      rowOffset += r.positionCount;
      continue;
    }

    let colOffset = 0;
    for (let cIdx = 0; cIdx < colSegs.length; cIdx++) {
      const c = colSegs[cIdx];
      const blockStartRow = Math.max(bodyStartRow, startRow + colOffset);
      const blockEndRow = Math.min(
        endRow,
        startRow + colOffset + c.positionCount - 1
      );
      if (blockEndRow < blockStartRow) {
        colOffset += c.positionCount;
        continue;
      }

      const kind = intersectionKind(r.kind, c.kind);
      const bounds: CellBounds = {
        startRow: blockStartRow,
        endRow: blockEndRow,
        startCol: blockStartCol,
        endCol: blockEndCol,
      };

      if (kind === "pivot-pivot") {
        // Both segments are pivots — narrow the types in TS-friendly form
        // so we can read `id` and `axisName` off them. The discriminator
        // is the segment kind we just matched in `intersectionKind`.
        const rp = r as Extract<Segment, { kind: "pivot" }>;
        const cp = c as Extract<Segment, { kind: "pivot" }>;
        const rowName = rp.axisName.trim() || "(unnamed)";
        const colName = cp.axisName.trim() || "(unnamed)";
        const overlayId = `${rp.id}__${cp.id}`;
        const overrideField = region.intersectionCellValueFields?.[overlayId];
        const overrideName = overrideField?.name?.trim();
        const cellValueName =
          overrideName || region.cellValueField?.name?.trim() || "";
        overlays.push({
          id: overlayId,
          kind,
          rowPivotSegmentId: rp.id,
          colPivotSegmentId: cp.id,
          bounds,
          label: `${rowName} × ${colName}`,
          cellValueName,
          cellValueOverridden: !!overrideName,
        });
      } else {
        overlays.push({
          id: `r${rIdx}-c${cIdx}`,
          kind,
          bounds,
        });
      }

      colOffset += c.positionCount;
    }
    rowOffset += r.positionCount;
  }
  return overlays;
}

/**
 * Emit one overlay per segment on each header axis of the region. Row-axis
 * segments paint the first row of the region (the row-header band); column-axis
 * segments paint the first column. Segments only render on declared header
 * axes — a 1D region along a single axis returns overlays for that axis only;
 * a crosstab returns overlays for both; a headerless region returns none.
 */
export function computeSegmentOverlays(region: RegionDraft): SegmentOverlay[] {
  const overlays: SegmentOverlay[] = [];
  const axes = region.headerAxes ?? [];
  if (axes.length === 0) return overlays;

  const { bounds, segmentsByAxis } = region;

  for (const axis of axes) {
    const segments = segmentsByAxis?.[axis] ?? [];
    if (segments.length === 0) continue;
    let offset = 0;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const count = seg.positionCount;
      let segBounds: CellBounds;
      if (axis === "row") {
        segBounds = {
          startRow: bounds.startRow,
          endRow: bounds.startRow,
          startCol: bounds.startCol + offset,
          endCol: bounds.startCol + offset + count - 1,
        };
      } else {
        segBounds = {
          startRow: bounds.startRow + offset,
          endRow: bounds.startRow + offset + count - 1,
          startCol: bounds.startCol,
          endCol: bounds.startCol,
        };
      }
      const isPivot = seg.kind === "pivot";
      const label = isPivot
        ? seg.axisName.trim() || "(unnamed)"
        : undefined;
      overlays.push({
        axis,
        segmentIndex: i,
        kind: seg.kind,
        bounds: segBounds,
        label,
        dynamic: isPivot && !!seg.dynamic,
      });
      offset += count;
    }
  }
  return overlays;
}
