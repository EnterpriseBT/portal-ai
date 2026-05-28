/**
 * `ColumnDefinitionClassifier` dep contract for the REST API connector.
 *
 * Mirrors the spreadsheet pipeline's `ClassifierFn` shape
 * (`@portalai/core/contracts` → `LlmBridge`) but is column-shaped
 * instead of cell-shaped: input is a list of inferred-column
 * candidates carrying their heuristic type + samples, output is a
 * per-column classification with optional catalog binding +
 * suggested normalized key + semantic-type refinement.
 *
 * The dep is optional on `RestApiAdapter`. When unwired, the probe
 * pipeline emits heuristic-only output with `degradation:
 * "llm-disabled"`; when wired but the call throws, the pipeline
 * silently degrades with `degradation: "llm-failed"`. Mirrors the
 * spreadsheet stages' "fall back silently" discipline.
 */
import type { ColumnDataType } from "@portalai/core/models";

/**
 * One inferred column candidate the heuristic layer emits per record
 * key. The classifier matches each candidate against the org's
 * `column_definitions` catalog and may refine the heuristic type
 * (e.g. `string` → `date`) based on sample values.
 */
export interface ApiClassifierCandidate {
  /** JSON key from the record body. */
  sourceField: string;
  /** Heuristic-layer type — the classifier may refine but not contradict the broad class. */
  inferredType: ColumnDataType;
  /** Up to MAX_SAMPLES_PER_COLUMN values from the heuristic's sample list. */
  samples: unknown[];
}

/**
 * Catalog entry the classifier sees per `column_definition` row for
 * the requesting org. Matches the spreadsheet pipeline's
 * `ColumnDefinitionCatalogEntry` shape so future cross-pollination is
 * trivial.
 */
export interface ColumnDefinitionCatalogEntry {
  id: string;
  label: string;
  normalizedKey?: string | null;
  description?: string | null;
  type?: ColumnDataType | null;
}

/**
 * Per-column classification the classifier returns. Echoed
 * `sourceField` lets the adapter merge classifications back into the
 * heuristic columns even when the model returns them in a different
 * order (or drops some).
 */
export interface ApiColumnClassification {
  sourceField: string;
  /** Matched `column_definitions.id` or `null` when nothing in the catalog fits. */
  columnDefinitionId: string | null;
  /** Snake-case identifier the user is most likely to expect for this column. */
  suggestedNormalizedKey: string;
  /** May refine heuristicType (e.g. `string` → `date`). */
  suggestedSemanticType: ColumnDataType;
  /** Clamp to [0, 1] at the adapter — the model occasionally returns out-of-band values. */
  confidence: number;
  /** Short LLM-emitted explanation (rendered in the Adopt-suggestion chip tooltip). */
  rationale: string;
}

/**
 * The dep itself. Pure async — no per-call state retained inside the
 * classifier. The adapter passes the full candidate + catalog set;
 * the classifier may batch internally (e.g. `pLimit(8)`) to respect
 * the upstream LLM's per-request limits.
 */
export interface ColumnDefinitionClassifier {
  classify(
    candidates: ApiClassifierCandidate[],
    catalog: ColumnDefinitionCatalogEntry[]
  ): Promise<ApiColumnClassification[]>;
}

/**
 * Failure shape thrown by the default (Haiku-backed) implementation.
 * The adapter catches `ClassifierError` regardless of `reason` and
 * degrades to heuristic-only output; the `reason` discriminator is
 * for telemetry, not branching logic in the adapter.
 */
export class ClassifierError extends Error {
  override readonly name = "ClassifierError" as const;
  readonly reason: ClassifierErrorReason;

  constructor(
    reason: ClassifierErrorReason,
    message: string,
    options?: ErrorOptions
  ) {
    super(`[classifier:${reason}] ${message}`, options);
    this.reason = reason;
  }
}

export type ClassifierErrorReason =
  | "malformed-response"
  | "timeout"
  | "network-error";
