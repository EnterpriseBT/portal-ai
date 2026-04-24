/**
 * Frontend-facing types for the region editor.
 *
 * Draft shapes (`RegionDraft`, `ColumnBindingDraft`) are deliberately loose —
 * the user is mid-edit, so optional fields and nullable entity IDs are
 * expected. Validation happens via `validateRegion()` in
 * `region-editor-validation.util.ts` before the draft is sent to the backend.
 *
 * The PR-1 schema collapse removed `Orientation`, `HeaderAxis`, and
 * `BoundsMode` from the canonical parser module — PR-4 will rework this
 * editor's draft shape around `headerAxes` + `segmentsByAxis`. Until then
 * the draft keeps the Phase-1 field names as frontend-only unions so the
 * in-progress editor UI keeps rendering; the draft-to-plan mapper in
 * `layout-plan-mapping.util.ts` is what emits the new canonical shape.
 *
 * Preview-only shapes (`Workbook`, `SheetPreview`, `EntityOption`,
 * `EntityLegendEntry`, `DriftReportPreview`) are rendering types for this
 * editor; they do not correspond to a backend contract.
 */

import type {
  HeaderStrategyKind,
  IdentityStrategyKind,
  RecordsAxisName,
  SkipRuleAxis,
  WarningCode,
  WarningSeverity,
} from "@portalai/core/contracts";
import type { ColumnDataType } from "@portalai/core/models";

// ── Re-export canonical enum types so existing imports keep resolving ────
export type {
  HeaderStrategyKind,
  IdentityStrategyKind,
  RecordsAxisName,
  SkipRule,
  WarningCode,
  WarningSeverity,
} from "@portalai/core/contracts";

// ── Frontend-only draft unions (PR-1 stopgap; PR-4 replaces these) ──────
export type BoundsModeDraft = "absolute" | "untilEmpty" | "matchesPattern";
export type HeaderAxisDraft = "row" | "column" | "none";
export type OrientationDraft =
  | "rows-as-records"
  | "columns-as-records"
  | "cells-as-records";

/** @deprecated Use the new canonical `headerAxes` + `segmentsByAxis` shape emitted by the draft-to-plan mapper. */
export const DEFAULT_UNTIL_EMPTY_TERMINATOR_COUNT = 3;

/**
 * Draft form of a SkipRule — identical to the canonical `SkipRule` except
 * that `crossAxisIndex` may be `undefined` while the user has not yet picked
 * a row or column. Validation (`validateRegion`) rejects drafts with an
 * undefined `crossAxisIndex` before submission.
 */
export type SkipRuleDraft =
  | { kind: "blank" }
  | {
      kind: "cellMatches";
      crossAxisIndex: number | undefined;
      pattern: string;
      axis?: SkipRuleAxis;
    };

// ── Preview / rendering types (frontend-only) ────────────────────────────

export type CellCoord = { row: number; col: number };

export type CellBounds = {
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
};

export type CellValue = string | number | null;

export type SheetPreview = {
  id: string;
  name: string;
  rowCount: number;
  colCount: number;
  cells: CellValue[][];
  fetchedAt?: string;
};

export type Workbook = {
  sheets: SheetPreview[];
  fetchedAt?: string;
  sourceLabel?: string;
};

export type ConfidenceBand = "green" | "yellow" | "red";

// ── Warning shape reused from the canonical Warning but with a UI-friendly locator
// (cell coords resolved against the preview, not the abstract Locator union).

export type RegionWarning = {
  code: WarningCode;
  severity: WarningSeverity;
  message: string;
  suggestedFix?: string;
  locator?: {
    sheetId?: string;
    bounds?: CellBounds;
    column?: number;
    row?: number;
  };
};

// ── Draft types ───────────────────────────────────────────────────────────

export type ColumnBindingDraft = {
  sourceLocator: string;
  columnDefinitionId: string | null;
  columnDefinitionLabel?: string;
  /**
   * Resolved `ColumnDefinition.type` for the bound definition. Populated by
   * the container alongside `columnDefinitionLabel` via the org column-
   * definition catalog. Drives conditional editors in the binding popover
   * (reference picker, enum-values input, etc.).
   */
  columnDefinitionType?: ColumnDataType;
  confidence: number;
  rationale?: string;

  // ── User overrides (mirror ColumnBindingSchema) ──────────────────
  // See `docs/BINDING_OVERRIDES.spec.md`. All optional; commit falls back
  // to catalog defaults when unset, and the review-step binding editor
  // writes these through `onUpdateBinding`.
  excluded?: boolean;
  normalizedKey?: string;
  required?: boolean;
  defaultValue?: string | null;
  format?: string | null;
  enumValues?: string[] | null;
  refEntityKey?: string | null;
  refNormalizedKey?: string | null;
};

export type RegionDraft = {
  id: string;
  sheetId: string;
  bounds: CellBounds;
  boundsMode?: BoundsModeDraft;
  boundsPattern?: string;
  proposedLabel?: string;
  targetEntityDefinitionId: string | null;
  targetEntityLabel?: string;
  orientation: OrientationDraft;
  headerAxis: HeaderAxisDraft;
  recordsAxisName?: RecordsAxisName;
  secondaryRecordsAxisName?: RecordsAxisName;
  cellValueName?: RecordsAxisName;
  /**
   * Optional override for the axis-name anchor cell. When unset, the anchor
   * defaults to the top-left of the region — `(bounds.startRow, bounds.startCol)`.
   * Only meaningful for pivoted shapes (crosstabs, rows-as-records +
   * headerAxis:column, columns-as-records + headerAxis:row). Must be within bounds.
   */
  axisAnchorCell?: CellCoord;
  /**
   * User-supplied overrides for auto-generated field names (when headerAxis === "none").
   * Keyed by the default name (e.g. "columnA"), mapped to the override (e.g. "customerName").
   */
  columnOverrides?: Record<string, string>;
  skipRules?: SkipRuleDraft[];
  /** Consecutive unskippable blank records required to terminate `untilEmpty`. Defaults to `DEFAULT_UNTIL_EMPTY_TERMINATOR_COUNT`. */
  untilEmptyTerminatorCount?: number;
  headerStrategy?: { kind: HeaderStrategyKind; confidence?: number };
  identityStrategy?: {
    kind: IdentityStrategyKind;
    sourceLocator?: string;
    confidence?: number;
  };
  columnBindings?: ColumnBindingDraft[];
  confidence?: number;
  warnings?: RegionWarning[];
  drift?: RegionDriftState;
};

export type RegionDriftState = {
  flagged: boolean;
  kind?: "bounds" | "header" | "identity" | "columns";
  priorSummary?: string;
  observedSummary?: string;
  identityChanging?: boolean;
};

// ── UI aggregates ────────────────────────────────────────────────────────

export type EntityLegendEntry = {
  id: string;
  label: string;
  color: string;
  regionCount: number;
};

/**
 * An option for the region's target-entity picker.
 *
 * - `source: "db"` — an entity that already exists in the backend. `value` is the
 *   persisted entity ID.
 * - `source: "staged"` — an entity created inline by the user (either in this
 *   region or from another region in the same session). `value` is the entity key
 *   the user chose; persistence happens at commit.
 */
export type EntityOption = {
  value: string;
  label: string;
  source: "db" | "staged";
  /**
   * C2: for `source === "db"` options the owning connector instance's
   * display name, so the entity picker can show which connector already
   * owns the key (rendered as `<label> — <connectorInstanceName>`).
   * Staged options leave this undefined.
   */
  connectorInstanceName?: string;
};

export type DriftReportPreview = {
  severity: WarningSeverity;
  identityChanging: boolean;
  fetchedAt: string;
  notes?: string;
};

