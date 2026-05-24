/**
 * REST API connector contracts — wire shapes for the phase-4 probe
 * pipeline. The Zod schemas exist so the route layer can validate
 * both sides of the wire (response shape stable across versions, and
 * the frontend SDK can parse the result without reaching into the
 * adapter's internal types).
 */
import { z } from "zod";

import { ColumnDataTypeEnum } from "../models/column-definition.model.js";

/**
 * Per-column LLM suggestion. Optional — the heuristic layer always
 * runs, the AI-assist layer is best-effort and silently degrades.
 */
export const ApiColumnSuggestionSchema = z.object({
  /** Matched `column_definitions.id` or null when nothing in the catalog fits. */
  columnDefinitionId: z.string().nullable(),
  /** Snake-case identifier the user is most likely to expect for this column. */
  suggestedNormalizedKey: z.string(),
  /** May refine the heuristic type (e.g. `string` → `date`). */
  suggestedSemanticType: ColumnDataTypeEnum,
  /** Clamped to [0, 1] before serialization. */
  confidence: z.number(),
  /** Short LLM-emitted explanation rendered in the Adopt-suggestion tooltip. */
  rationale: z.string(),
});
export type ApiColumnSuggestion = z.infer<typeof ApiColumnSuggestionSchema>;

/**
 * One discovered column with the probe's sample values plus the
 * (optional) LLM suggestion. The `sourceField` is identical to `key`
 * but emitted explicitly so future renames between API field name
 * and user-facing key don't break the wire contract.
 */
export const DiscoveredColumnWithSuggestionSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: ColumnDataTypeEnum,
  required: z.boolean(),
  sourceField: z.string(),
  samples: z.array(z.unknown()),
  suggestion: ApiColumnSuggestionSchema.optional(),
});
export type DiscoveredColumnWithSuggestion = z.infer<
  typeof DiscoveredColumnWithSuggestionSchema
>;

/**
 * Top-level result of the discoverColumns route. Both layers (heuristic
 * + AI-assist) collapsed into a single response; `degradation` carries
 * the advisory that the LLM layer didn't run (disabled) or failed
 * (errored). 200-OK regardless — degradation is not an HTTP error.
 */
export const DiscoverColumnsResultSchema = z.object({
  columns: z.array(DiscoveredColumnWithSuggestionSchema),
  /** `"live"` = fresh probe; `"cache"` = served from the in-process cache. */
  source: z.enum(["live", "cache"]),
  /** Epoch-ms at which the cache entry was written. Present when source === "cache". */
  cachedAt: z.number().optional(),
  /** Count of records the heuristic scanned (≤ MAX_RECORDS_SCANNED). */
  recordsScanned: z.number(),
  /**
   * - `"llm-failed"` — classifier wired but threw; degraded silently.
   * - `"llm-disabled"` — classifier not wired in this process.
   * - `null` — both layers ran successfully (or no candidates).
   */
  degradation: z.enum(["llm-failed", "llm-disabled"]).nullable(),
});
export type DiscoverColumnsResult = z.infer<typeof DiscoverColumnsResultSchema>;

/** Request body for the discoverColumns route. */
export const DiscoverColumnsRequestBodySchema = z.object({
  forceRefresh: z.boolean().optional(),
});
export type DiscoverColumnsRequestBody = z.infer<
  typeof DiscoverColumnsRequestBodySchema
>;
