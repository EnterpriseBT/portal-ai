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

export type Orientation = "rows-as-records" | "columns-as-records" | "cells-as-records";
export type HeaderAxis = "row" | "column" | "none";

export type ConfidenceBand = "green" | "yellow" | "red";

export type WarningSeverity = "info" | "warn" | "blocker";

export type WarningCode =
  | "AMBIGUOUS_HEADER"
  | "MIXED_COLUMN_TYPES"
  | "DUPLICATE_IDENTITY_VALUES"
  | "IDENTITY_COLUMN_HAS_BLANKS"
  | "UNRECOGNIZED_COLUMN"
  | "REGION_BOUNDS_UNCERTAIN"
  | "MULTIPLE_HEADER_CANDIDATES"
  | "SHEET_MAY_BE_NON_DATA"
  | "PIVOTED_REGION_MISSING_AXIS_NAME";

export type RegionWarning = {
  code: WarningCode;
  severity: WarningSeverity;
  message: string;
  suggestedFix?: string;
  locator?: { sheetId?: string; bounds?: CellBounds; column?: number; row?: number };
};

export type IdentityStrategyKind = "column" | "composite" | "rowPosition";
export type HeaderStrategyKind = "row" | "column" | "rowLabels";

export type ColumnBindingDraft = {
  sourceLocator: string;
  columnDefinitionId: string | null;
  columnDefinitionLabel?: string;
  confidence: number;
  rationale?: string;
};

export type RecordsAxisName = {
  name: string;
  /**
   * Where the name came from.
   * - "user" — the user typed it.
   * - "ai" — the interpreter LLM inferred it.
   * - "anchor-cell" — auto-populated from the region's axis-anchor cell value.
   */
  source: "user" | "ai" | "anchor-cell";
  confidence?: number;
};

export type BoundsMode = "absolute" | "untilEmpty" | "matchesPattern";

/**
 * A skip rule omits a record (row or column depending on orientation) during extraction.
 *
 * - `blank` — the record's cells are all empty.
 * - `cellMatches` — the record's cell at `crossAxisIndex` matches `pattern`.
 *   `crossAxisIndex` is an absolute sheet-level index (column for rows-as-records,
 *   row for columns-as-records). For `cells-as-records`, the rule applies to rows by default;
 *   set `axis: "column"` to target columns instead.
 *   Null and undefined cells are coerced to `""` before regex testing, so `^$`
 *   matches both empty-string and null/missing cells.
 *
 * Skip rules serve two purposes in `untilEmpty` regions:
 *   1. Records matching any skip rule are omitted from the extracted output.
 *   2. Skipped records do NOT count toward the terminator — only consecutive
 *      *unskippable* blank records (see `DEFAULT_UNTIL_EMPTY_TERMINATOR_COUNT`)
 *      can terminate extension.
 */
export type SkipRule =
  | { kind: "blank" }
  | {
      kind: "cellMatches";
      /** Absolute sheet-level index; `undefined` means the user has not selected one yet. */
      crossAxisIndex: number | undefined;
      pattern: string;
      axis?: "row" | "column";
    };

/** Default consecutive-blank-record count that terminates an `untilEmpty` region. */
export const DEFAULT_UNTIL_EMPTY_TERMINATOR_COUNT = 2;

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
  skipRules?: SkipRule[];
  /** Consecutive unskippable blank records required to terminate `untilEmpty`. Defaults to `DEFAULT_UNTIL_EMPTY_TERMINATOR_COUNT`. */
  untilEmptyTerminatorCount?: number;
  headerStrategy?: { kind: HeaderStrategyKind; confidence?: number };
  identityStrategy?: { kind: IdentityStrategyKind; sourceLocator?: string; confidence?: number };
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
