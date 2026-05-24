/**
 * REST API connector contracts — wire shapes for the phase-4 probe
 * pipeline. The Zod schemas exist so the route layer can validate
 * both sides of the wire (response shape stable across versions, and
 * the frontend SDK can parse the result without reaching into the
 * adapter's internal types).
 */
import { z } from "zod";

import {
  ApiEndpointConfigBaseSchema,
  ApiEndpointConfigSchema,
} from "../models/api-connector.model.js";
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

// ── Endpoint CRUD wire shapes ───────────────────────────────────────

/**
 * The minimal `connector_entity` projection emitted alongside each
 * api-endpoint row on the wire. Mirrors `toWire`'s entity object in
 * `api-endpoints.router.ts`.
 */
export const ApiEndpointEntityWireSchema = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string(),
});
export type ApiEndpointEntityWire = z.infer<typeof ApiEndpointEntityWireSchema>;

/**
 * Wire shape for a single api-endpoint row: the connector_entity
 * projection + the structured endpoint config.
 */
export const ApiEndpointWireSchema = z.object({
  entity: ApiEndpointEntityWireSchema,
  config: ApiEndpointConfigSchema,
});
export type ApiEndpointWire = z.infer<typeof ApiEndpointWireSchema>;

/** Response payload for the list route. */
export const ApiEndpointListResponsePayloadSchema = z.object({
  endpoints: z.array(ApiEndpointWireSchema),
});
export type ApiEndpointListResponsePayload = z.infer<
  typeof ApiEndpointListResponsePayloadSchema
>;

/** Request body for the create route. */
export const CreateApiEndpointRequestBodySchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  config: ApiEndpointConfigSchema,
});
export type CreateApiEndpointRequestBody = z.infer<
  typeof CreateApiEndpointRequestBodySchema
>;

/** Request body for the patch route — every field optional. */
export const PatchApiEndpointRequestBodySchema = z.object({
  label: z.string().min(1).optional(),
  config: ApiEndpointConfigBaseSchema.partial().optional(),
});
export type PatchApiEndpointRequestBody = z.infer<
  typeof PatchApiEndpointRequestBodySchema
>;

/** Response payload for the delete route. */
export const DeleteApiEndpointResponsePayloadSchema = z.object({
  ok: z.literal(true),
});
export type DeleteApiEndpointResponsePayload = z.infer<
  typeof DeleteApiEndpointResponsePayloadSchema
>;

// ── testConnection contracts ────────────────────────────────────────

/**
 * Body forwarded to `ConnectorAdapter.testConnection` — adapter-
 * specific; the REST API adapter reads `endpointEntityId`. The
 * schema accepts unknown extra keys so other adapters can interpret
 * different shapes in the future.
 */
export const TestConnectionRequestBodySchema = z
  .object({
    endpointEntityId: z.string().optional(),
  })
  .catchall(z.unknown());
export type TestConnectionRequestBody = z.infer<
  typeof TestConnectionRequestBodySchema
>;

/**
 * Result of a `testConnection` invocation. `ok: false` is a
 * *successful* invocation of a check that itself reported failure —
 * not an HTTP-level error. Both shapes arrive as HTTP 200.
 */
export const TestConnectionResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    sample: z.array(z.unknown()),
  }),
  z.object({
    ok: z.literal(false),
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
]);
export type TestConnectionResult = z.infer<typeof TestConnectionResultSchema>;
