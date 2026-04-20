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
   * Narrow AI sub-call for pivoted-region axis-name recommendations. Default:
   * returns `null` (no recommendation), which leaves `recordsAxisName`
   * unfilled and triggers `PIVOTED_REGION_MISSING_AXIS_NAME` unless the user
   * supplied one via hints.
   */
  axisNameRecommender?: AxisNameRecommenderFn;

  /**
   * Optional structured logger for observability. When supplied, `interpret()`
   * emits:
   *   - `interpret.stage.completed` per stage that reported `usage` from its
   *     DI return value (currently `classify-columns` and
   *     `recommend-records-axis-name`), with `stage`, `latencyMs`, and token
   *     counts when the dep provided them.
   *   - `interpret.cost.summary` once at the end with aggregated totals.
   *
   * The parser module does not import Pino — `ParserLogger` is a structural
   * interface matching pino's `.info(obj, msg?)` shape so consumers can pass
   * a real pino instance directly.
   */
  logger?: ParserLogger;
}

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
