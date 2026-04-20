/**
 * Internal types used across `interpret()` stages. These are not re-exported
 * from the package barrel — consumers interact only through the `interpret()`
 * function and the public `InterpretInput` / `LayoutPlan` / `InterpretDeps`
 * types. Stage authors import from this file directly.
 */

import type {
  IdentityStrategy,
  Region,
  RegionHint,
  Warning,
} from "../plan/index.js";
import type { Workbook } from "../workbook/index.js";

/**
 * A candidate header row/column discovered by `detect-headers`, scored so
 * `propose-bindings` can pick the best one. The heuristic default produces
 * one or more candidates per region; the Phase 4 LLM stage can override.
 */
export interface HeaderCandidate {
  /** Axis this candidate describes — matches the region's `headerAxis`. */
  axis: "row" | "column";
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
  /** 1-based column index in the sheet (for `byColumnIndex` fallback). */
  sourceCol: number;
  /** Matched ColumnDefinition id, or `null` if no confident match. */
  columnDefinitionId: string | null;
  /** Classifier confidence in [0, 1]. */
  confidence: number;
  /** Short rationale the classifier emitted. */
  rationale?: string;
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
  recordsAxisNameSuggestions: Map<string, RecordsAxisNameSuggestion>;
  reconcileDiff?: ReconcileDiff;
  confidence: Map<string, RegionConfidence>;
  warnings: Warning[];
}

/**
 * Narrow view of `InterpretInput` for stage consumption — the adapted
 * Workbook handle replaces the serialisable shape from the input contract so
 * stage functions can call `sheet.cell(r, c)` without reconstructing
 * accessors per stage.
 */
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

/**
 * Token + latency summary that LLM-backed deps optionally report alongside
 * their functional result so `interpret()` can emit
 * `interpret.stage.completed` and `interpret.cost.summary` events.
 */
export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  modelId?: string;
}

/**
 * Rich return shape for the classifier — mirrors the legacy `ColumnClassification[]`
 * as an optional upgrade path. Consumers (api-side factories) that want to
 * contribute to `interpret()`'s cost summary return the object form; consumers
 * that don't care just return the array.
 */
export interface ClassifierResult {
  classifications: ColumnClassification[];
  usage?: LlmUsage;
}

/**
 * Injectable classifier — resolves source headers to `ColumnDefinition` ids.
 * The default built-in classifier does exact + normalised-key matching only;
 * Phase 4 replaces the default with an LLM-backed implementation without
 * touching stage code. Return either the plain `ColumnClassification[]` or
 * the object form that includes `usage` for observability.
 */
export type ClassifierFn = (
  candidates: ClassifierCandidate[],
  catalog: ColumnDefinitionCatalogEntry[]
) =>
  | Promise<ColumnClassification[] | ClassifierResult>
  | ColumnClassification[]
  | ClassifierResult;

/**
 * Rich return shape for axis-name recommender.
 */
export interface AxisNameRecommenderResult {
  suggestion: RecordsAxisNameSuggestion | null;
  usage?: LlmUsage;
}

/**
 * Injectable axis-name recommender — invoked only for pivoted regions whose
 * user has not supplied a `recordsAxisName`. The default built-in returns
 * `null` (no recommendation); Phase 4 wires the narrow AI sub-call.
 */
export type AxisNameRecommenderFn = (
  axisLabels: string[]
) =>
  | Promise<RecordsAxisNameSuggestion | null | AxisNameRecommenderResult>
  | RecordsAxisNameSuggestion
  | null
  | AxisNameRecommenderResult;

/**
 * Minimal structured logger the parser module can emit into without depending
 * on Pino. Consumers (`apps/api`) wire a real pino instance — the call shape
 * `(obj, msg?) => void` matches pino's signature.
 */
export interface ParserLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
  debug?(obj: Record<string, unknown>, msg?: string): void;
}
