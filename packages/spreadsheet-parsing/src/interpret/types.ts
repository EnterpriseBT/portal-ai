/**
 * Internal types used across `interpret()` stages. These are not re-exported
 * from the package barrel — consumers interact only through the `interpret()`
 * function and the public `InterpretInput` / `LayoutPlan` / `InterpretDeps`
 * types. Stage authors import from this file directly.
 */

import type {
  AxisMember,
  CellValueField,
  IdentityStrategy,
  Region,
  RegionHint,
  Segment,
  Warning,
} from "../plan/index.js";
import type { Workbook } from "../workbook/index.js";

/**
 * A candidate header row/column discovered by `detect-headers`, scored so
 * `propose-bindings` can pick the best one. The heuristic default produces
 * one or more candidates per (region, axis); the Phase 4 LLM stage can
 * override.
 */
export interface HeaderCandidate {
  /** Axis this candidate describes — one of the region's declared header axes. */
  axis: AxisMember;
  /** 1-based sheet index of the header row (when axis === "row") or column. */
  index: number;
  /** Extracted header labels in reading order. Empty slots become `""`. */
  labels: string[];
  /** Heuristic score in [0, 1]; consumers compare across candidates only. */
  score: number;
  /** Short human-readable rationale for the UI / trace. */
  rationale: string;
}

export interface IdentityCandidate {
  strategy: IdentityStrategy;
  /** Heuristic score in [0, 1]; higher is better. */
  score: number;
  /** Short rationale recorded on warnings / trace. */
  rationale: string;
}

/**
 * Classification of a single source column against the `ColumnDefinition`
 * catalog the consumer provides via `InterpretDeps.classifier`.
 */
export interface ColumnClassification {
  /** Header label as discovered by `detect-headers`. */
  sourceHeader: string;
  /**
   * Axis-relative coordinate of the classified position. For axis="row"
   * (a row-of-headers axis) this is a sheet column index; for
   * axis="column" (a column-of-headers axis) it is a sheet row index.
   * Naming is historical — when this stage only handled tidy regions the
   * axis was always row, so the coord was always a column. Crosstabs may
   * surface either, so always read this together with `sourceAxis` (when
   * set) to disambiguate.
   */
  sourceCol: number;
  /**
   * Header axis the classification came from — "row" for a row-of-headers
   * axis, "column" for a column-of-headers axis. Set by
   * `classify-field-segments` when iterating the region's declared
   * `headerAxes` so `propose-bindings` can route each classification to
   * the right `byPositionIndex` axis on a 2D crosstab. Optional for
   * backwards compatibility with custom classifiers that don't supply it
   * — `propose-bindings` then falls back to legacy single-axis routing.
   */
  sourceAxis?: AxisMember;
  /** Matched ColumnDefinition id, or `null` if no confident match. */
  columnDefinitionId: string | null;
  /** Classifier confidence in [0, 1]. */
  confidence: number;
  /** Short rationale the classifier emitted. */
  rationale?: string;
  /**
   * Set by `classify-field-segments` when `sourceHeader` was synthesised
   * from a field-segment `headers[i]` override (typically because the
   * underlying header cell was blank). `propose-bindings` reads this flag
   * to emit a `byPositionIndex` locator — `byHeaderName` would fail at
   * replay since the override name doesn't appear in the sheet.
   */
  fromHeaderOverride?: boolean;
}

export interface RegionConfidence {
  region: number;
  aggregate: number;
}

export interface ReconcileDiff {
  /** Region ids preserved (matched to a prior region by fingerprint). */
  preserved: string[];
  /** Region ids that are new in this plan. */
  added: string[];
  /** Prior region ids that no longer appear. */
  removed: string[];
  /** Regions whose identity strategy changed (requires user confirmation). */
  identityChanged: string[];
}

/** Shape of the axis-name recommender's output. */
export interface RecordsAxisNameSuggestion {
  name: string;
  confidence: number;
}

/** Mutable state threaded through every stage. */
export interface InterpretState {
  input: InterpretInputView;
  workbook: Workbook;
  detectedRegions: Region[];
  headerCandidates: Map<string, HeaderCandidate[]>;
  identityCandidates: Map<string, IdentityCandidate[]>;
  columnClassifications: Map<string, ColumnClassification[]>;
  /** Keyed by pivot segment id (not region id). */
  segmentAxisNameSuggestions: Map<string, RecordsAxisNameSuggestion>;
  /** Seeded from hints; propose-bindings writes segments onto the region. */
  segmentsByRegion: Map<
    string,
    { row?: Segment[]; column?: Segment[] } | undefined
  >;
  cellValueFieldByRegion: Map<string, CellValueField | undefined>;
  reconcileDiff?: ReconcileDiff;
  confidence: Map<string, RegionConfidence>;
  warnings: Warning[];
}

export interface InterpretInputView {
  regionHints?: RegionHint[];
  priorPlan?: import("../plan/index.js").LayoutPlan;
  userHints?: import("../plan/index.js").UserHints;
}

/** Descriptor passed into `ClassifierFn`. */
export interface ClassifierCandidate {
  sourceHeader: string;
  sourceCol: number;
  /** Sample of distinct cell values from the column (capped in caller). */
  samples: string[];
}

export interface ColumnDefinitionCatalogEntry {
  id: string;
  label: string;
  normalizedKey?: string;
  description?: string;
  type?: string;
}

export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  modelId?: string;
}

export interface ClassifierResult {
  classifications: ColumnClassification[];
  usage?: LlmUsage;
}

export type ClassifierFn = (
  candidates: ClassifierCandidate[],
  catalog: ColumnDefinitionCatalogEntry[]
) =>
  | Promise<ColumnClassification[] | ClassifierResult>
  | ColumnClassification[]
  | ClassifierResult;

export interface AxisNameRecommenderResult {
  suggestion: RecordsAxisNameSuggestion | null;
  usage?: LlmUsage;
}

export type AxisNameRecommenderFn = (
  axisLabels: string[]
) =>
  | Promise<RecordsAxisNameSuggestion | null | AxisNameRecommenderResult>
  | RecordsAxisNameSuggestion
  | null
  | AxisNameRecommenderResult;

export interface ParserLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
  debug?(obj: Record<string, unknown>, msg?: string): void;
}
