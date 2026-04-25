/**
 * Frontend-facing types for the region editor.
 *
 * Draft shapes (`RegionDraft`, `ColumnBindingDraft`) are deliberately loose —
 * the user is mid-edit, so optional fields and nullable entity IDs are
 * expected. Validation happens via `validateRegion()` in
 * `region-editor-validation.util.ts` before the draft is sent to the backend.
 *
 * The draft mirrors the canonical `Region` shape (`headerAxes`,
 * `segmentsByAxis`, `cellValueField`, `recordAxisTerminator`,
 * `recordsAxis`) with every field optional so mid-edit state is
 * representable. Preview-only shapes (`Workbook`, `SheetPreview`,
 * `EntityOption`, `EntityLegendEntry`, `DriftReportPreview`) are rendering
 * types for this editor; they do not correspond to a backend contract.
 */

import type {
  AxisMember,
  CellValueField,
  HeaderStrategyKind,
  IdentityStrategyKind,
  Segment,
  SkipRuleAxis,
  Terminator,
  WarningCode,
  WarningSeverity,
} from "@portalai/core/contracts";
import type { ColumnDataType } from "@portalai/core/models";

// ── Re-export canonical enum types so existing imports keep resolving ────
export type {
  AxisMember,
  CellValueField,
  HeaderStrategyKind,
  IdentityStrategyKind,
  RecordsAxisName,
  Segment,
  SkipRule,
  Terminator,
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

  /**
   * Edit-time transport for the underlying source-field name on synthetic
   * locators (`pivot:<segId>` / `cellValueField`). The popover's "Axis
   * name" / "Field name" input writes here; the workflow's synthetic
   * patch helpers route the value onto `segment.axisName` /
   * `cellValueField.name`. Static (real) columnBindings have their source
   * name baked into the locator string and ignore this field.
   */
  sourceField?: string;
};

export type RegionDraft = {
  id: string;
  sheetId: string;
  bounds: CellBounds;
  proposedLabel?: string;
  targetEntityDefinitionId: string | null;
  targetEntityLabel?: string;
  /**
   * PR-4 segment model. Optional on the draft because the user can build up
   * toward a valid region incrementally (e.g. a freshly-drawn region has
   * `headerAxes: ["row"]` + a single field segment; promoting to crosstab
   * adds a `column` entry + a skip segment at the intersection).
   */
  headerAxes?: AxisMember[];
  segmentsByAxis?: { row?: Segment[]; column?: Segment[] };
  cellValueField?: CellValueField;
  recordAxisTerminator?: Terminator;
  /**
   * Records axis for headerless regions (required by the canonical schema's
   * refinement 5 when `headerAxes.length === 0`). Optional on the draft
   * because the user can build up toward a headerless shape incrementally.
   */
  recordsAxis?: AxisMember;
  /**
   * Optional override for the axis-name anchor cell. When unset, the anchor
   * defaults to the top-left of the region — `(bounds.startRow, bounds.startCol)`.
   * Only meaningful when the region has at least one pivot segment; must be
   * within bounds.
   */
  axisAnchorCell?: CellCoord;
  /**
   * User-supplied overrides for auto-generated field names on a headerless
   * region. Keyed by the default name (e.g. "columnA"), mapped to the
   * override (e.g. "customerName").
   */
  columnOverrides?: Record<string, string>;
  skipRules?: SkipRuleDraft[];
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

