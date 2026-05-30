/**
 * REST API connector contracts — wire shapes for the phase-4 probe
 * pipeline. The Zod schemas exist so the route layer can validate
 * both sides of the wire (response shape stable across versions, and
 * the frontend SDK can parse the result without reaching into the
 * adapter's internal types).
 */
import { z } from "zod";

import {
  ApiAuthConfigSchema,
  ApiCredentialsSchema,
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
   * - `"transform-failed"` — JSONata transform errored; columns empty,
   *   `transformError` populated with the parse/runtime details.
   * - `null` — all layers ran successfully (or no candidates).
   */
  degradation: z
    .enum(["llm-failed", "llm-disabled", "transform-failed"])
    .nullable(),
  /**
   * Populated when `degradation === "transform-failed"`. Carries the
   * classified failure (parse vs runtime) and message so the UI can
   * surface it inline in the transform editor preview.
   */
  transformError: z
    .object({
      kind: z.enum(["parse", "runtime"]),
      message: z.string(),
    })
    .nullable()
    .optional(),
});
export type DiscoverColumnsResult = z.infer<typeof DiscoverColumnsResultSchema>;

/** Request body for the discoverColumns route. */
export const DiscoverColumnsRequestBodySchema = z.object({
  forceRefresh: z.boolean().optional(),
});
export type DiscoverColumnsRequestBody = z.infer<
  typeof DiscoverColumnsRequestBodySchema
>;

/**
 * Request body for the pre-commit probe-draft route.
 *
 * `POST /api/connector-instances/probe-endpoint-draft` — pure-compute,
 * no row writes, no audit log. Carries the full workflow-draft state
 * so the server can synthesize a ProbeContext without a persisted
 * ConnectorInstance / ApiEndpoint. Credentials live for the request
 * duration only.
 */
export const ProbeEndpointDraftRequestBodySchema = z.object({
  baseUrl: z.string().url(),
  auth: ApiAuthConfigSchema,
  credentials: ApiCredentialsSchema.nullable(),
  endpoint: ApiEndpointConfigSchema,
  forceRefresh: z.boolean().optional(),
});
export type ProbeEndpointDraftRequestBody = z.infer<
  typeof ProbeEndpointDraftRequestBodySchema
>;

/**
 * Request body for the preview-endpoint-page route — same shape as
 * the probe-draft body. Distinct from probe-draft so the route can
 * skip inference + classification and just return the raw page.
 */
export const PreviewEndpointPageRequestBodySchema =
  ProbeEndpointDraftRequestBodySchema.omit({ forceRefresh: true });
export type PreviewEndpointPageRequestBody = z.infer<
  typeof PreviewEndpointPageRequestBodySchema
>;

/**
 * Response for the preview-endpoint-page route. Returns the raw HTTP
 * response of page 1 so the form's preview pane can render formatted
 * JSON, extract a records-path subtree, or evaluate a JSONata
 * transform client-side. Body is capped at PREVIEW_BODY_BYTE_LIMIT
 * server-side (truncated indicator surfaces in the response).
 */
export const PreviewEndpointPageResponseSchema = z.object({
  body: z.unknown(),
  status: z.number(),
  headers: z.record(z.string(), z.string()),
  truncated: z.boolean(),
});
export type PreviewEndpointPageResponse = z.infer<
  typeof PreviewEndpointPageResponseSchema
>;

/**
 * Request body for the JSONata transform suggestion route.
 *
 * `POST /api/connector-instances/suggest-transform` — single-shot AI
 * assist. The user runs Preview first to capture `sampleResponse` (any
 * JSON-decodable value, including `null`), optionally describes what
 * records they want via `promptHint`, and the server returns a JSONata
 * expression. The route does not make an upstream HTTP call, so it
 * deliberately omits draft endpoint config / credentials — only the
 * sample and the hint cross the wire.
 *
 * `sampleResponse` is required: `null` is accepted (some APIs return
 * 200 with a null body), but the key must be present so the route
 * doesn't accidentally invoke the model with an undefined sample.
 */
export const SuggestTransformRequestBodySchema = z.object({
  promptHint: z.string().max(2000).optional(),
  sampleResponse: z.unknown().refine((v) => v !== undefined, {
    message: "sampleResponse is required",
  }),
});
export type SuggestTransformRequestBody = z.infer<
  typeof SuggestTransformRequestBodySchema
>;

/**
 * Response for the suggest-transform route.
 *
 * `expression` is always populated (the AI returns *some* expression,
 * even if it fails server-side validation against the sample after a
 * retry). `warning` is `null` on success and populated when both
 * attempts produced an expression that failed the strict
 * array-of-objects validation in `applyTransform`. The UI populates
 * the transform textarea unconditionally and surfaces the warning
 * inline.
 */
export const SuggestTransformResponseSchema = z.object({
  expression: z.string(),
  warning: z
    .object({
      kind: z.literal("validation-failed"),
      message: z.string(),
    })
    .nullable(),
});
export type SuggestTransformResponse = z.infer<
  typeof SuggestTransformResponseSchema
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

/**
 * Per-column draft the workflow's ProbeReviewStep collects. When
 * `columns` is present on the create body, the route materializes
 * each draft as a column_definition (find-or-create by
 * `normalizedKey`) + a field_mapping in one transaction, then
 * reconciles the wide table. `columnDefinitionId` is set when the
 * user adopted an AI-assist suggestion; otherwise the route looks
 * up by key or creates fresh.
 */
export const CreateApiEndpointColumnDraftSchema = z.object({
  sourceField: z.string().min(1),
  normalizedKey: z.string().regex(/^[a-z][a-z0-9_]*$/),
  type: ColumnDataTypeEnum,
  required: z.boolean().default(false),
  columnDefinitionId: z.string().nullable().optional(),
});
export type CreateApiEndpointColumnDraft = z.infer<
  typeof CreateApiEndpointColumnDraftSchema
>;

/** Request body for the create route. */
export const CreateApiEndpointRequestBodySchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  config: ApiEndpointConfigSchema,
  /**
   * Optional bulk column-mapping setup. Each entry materializes as a
   * column_definition (find-or-create by `normalizedKey`) +
   * field_mapping + wide-table reconcile in the same route handler.
   * Omit (or send `[]`) to skip — the user can configure mappings
   * later from the connector detail page.
   */
  columns: z.array(CreateApiEndpointColumnDraftSchema).optional(),
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
