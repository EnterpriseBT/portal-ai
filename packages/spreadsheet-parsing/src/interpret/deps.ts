/**
 * Public dependency-injection surface for `interpret()`.
 *
 * Stages accept these as optional parameters. If a dep is omitted, stages fall
 * back to deterministic built-in heuristics — sufficient for fixture-level
 * testing and for snapshot uploads where no AI call is desired. Phase 4 wires
 * LLM-backed implementations in through the same slot.
 */

import type {
  AxisNameRecommenderFn,
  ClassifierFn,
  ColumnDefinitionCatalogEntry,
  ParserLogger,
} from "./types.js";

export interface InterpretDeps {
  /**
   * Matches source headers to ColumnDefinition ids. Default: heuristic
   * exact/normalised matching only — produces low-confidence suggestions
   * with `rationale: "heuristic-only"`.
   */
  classifier?: ClassifierFn;

  /**
   * Catalog of `ColumnDefinition` entries the classifier should consider.
   * When omitted, every binding lands with `columnDefinitionId: null` and
   * the `UNRECOGNIZED_COLUMN` warning. Consumers pass the user's org-level
   * catalog here.
   */
  columnDefinitionCatalog?: ColumnDefinitionCatalogEntry[];

  /**
   * Catalog id to fall back to when the classifier (heuristic or LLM) can't
   * confidently match a candidate. Treated as a "default text" landing spot
   * so the review step never shows an unbound field — the user can re-bind
   * any defaulted entry. When omitted, unmatched candidates keep
   * `columnDefinitionId: null` (legacy behavior). Consumers typically pass
   * the org's seeded `text` system ColumnDefinition id.
   */
  defaultColumnDefinitionId?: string;

  /**
   * Narrow AI sub-call for pivoted-segment axis-name recommendations.
   * Default: returns `null` (no recommendation), which leaves the pivot
   * segment's `axisName` unresolved and triggers `SEGMENT_MISSING_AXIS_NAME`
   * unless the user supplied one via hints.
   */
  axisNameRecommender?: AxisNameRecommenderFn;

  /**
   * Optional structured logger for observability. When supplied, `interpret()`
   * emits:
   *   - `interpret.stage.completed` per stage that reported `usage` from its
   *     DI return value (currently `classify-field-segments` and
   *     `recommend-segment-axis-names`), with `stage`, `latencyMs`, and token
   *     counts when the dep provided them.
   *   - `interpret.cost.summary` once at the end with aggregated totals.
   *
   * The parser module does not import Pino — `ParserLogger` is a structural
   * interface matching pino's `.info(obj, msg?)` shape so consumers can pass
   * a real pino instance directly.
   */
  logger?: ParserLogger;

  /**
   * Max number of LLM calls in flight at once during the per-region stages
   * (`classify-field-segments`, `recommend-segment-axis-names`). Caps the fan-out so
   * workbooks with many regions don't spray the provider with unlimited
   * concurrent requests. Default: `DEFAULT_INTERPRET_CONCURRENCY` (8).
   */
  concurrency?: number;
}

/**
 * Default value for `InterpretDeps.concurrency`. Picked empirically — enough
 * parallelism to hide per-call LLM latency for typical workbooks (≤ ~20
 * regions) while staying well clear of typical Anthropic rate limits.
 */
export const DEFAULT_INTERPRET_CONCURRENCY = 8;

export type {
  AxisNameRecommenderFn,
  ClassifierFn,
  ClassifierCandidate,
  ClassifierResult,
  AxisNameRecommenderResult,
  ColumnClassification,
  ColumnDefinitionCatalogEntry,
  LlmUsage,
  ParserLogger,
  RecordsAxisNameSuggestion,
} from "./types.js";
