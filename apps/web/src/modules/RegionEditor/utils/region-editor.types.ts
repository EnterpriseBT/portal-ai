/**
 * Frontend-facing types for the region editor.
 *
 * Enum-like shapes (orientation, header axis, bounds mode, records-axis
 * source, skip rule, warning codes, etc.) are **derived** from
 * `@portalai/core/contracts` — which re-exports from `@portalai/spreadsheet-parsing`.
 * Do not introduce parallel string-literal unions; extend the parser module
 * when a new value is needed so the backend remains the canonical owner.
 *
 * Draft shapes (`RegionDraft`, `ColumnBindingDraft`) are deliberately loose —
 * the user is mid-edit, so optional fields and nullable entity IDs are
 * expected. Validation happens via `validateRegion()` in
 * `region-editor-validation.util.ts` before the draft is sent to the backend.
 *
 * Preview-only shapes (`Workbook`, `SheetPreview`, `EntityOption`,
 * `EntityLegendEntry`, `DriftReportPreview`) are rendering types for this
 * editor; they do not correspond to a backend contract.
 */

import type {
  BoundsMode,
  HeaderAxis,
  HeaderStrategyKind,
  IdentityStrategyKind,
  Orientation,
  RecordsAxisName,
  SkipRuleAxis,
  WarningCode,
  WarningSeverity,
} from "@portalai/core/contracts";

// ── Re-export canonical enum types so existing imports keep resolving ────
export type {
  BoundsMode,
  HeaderAxis,
  HeaderStrategyKind,
  IdentityStrategyKind,
  Orientation,
  RecordsAxisName,
  SkipRule,
  WarningCode,
  WarningSeverity,
} from "@portalai/core/contracts";

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
  confidence: number;
  rationale?: string;
};

export type RegionDraft = {
  id: string;
  sheetId: string;
  bounds: CellBounds;
  boundsMode?: BoundsMode;
  boundsPattern?: string;
  proposedLabel?: string;
  targetEntityDefinitionId: string | null;
  targetEntityLabel?: string;
  orientation: Orientation;
  headerAxis: HeaderAxis;
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
};

export type DriftReportPreview = {
  severity: WarningSeverity;
  identityChanging: boolean;
  fetchedAt: string;
  notes?: string;
};

// ── Re-exports of canonical constants consumers previously pulled from here
export { DEFAULT_UNTIL_EMPTY_TERMINATOR_COUNT } from "@portalai/core/contracts";
