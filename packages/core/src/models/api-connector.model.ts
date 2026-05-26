/**
 * REST API connector — config + credentials schemas.
 *
 * These schemas describe the shape of:
 *   - `connector_instances.config` for `rest-api` definitions
 *     (`RestApiInstanceConfigSchema` — non-secret instance config)
 *   - `api_endpoint_configs` rows
 *     (`ApiEndpointConfigSchema` — per-entity endpoint config)
 *   - `connector_instances.credentials` (encrypted at rest, JSON on
 *     decrypt) for `rest-api` definitions
 *     (`ApiCredentialsSchema` — per-mode secret payload).
 *
 * Auth splits across `config.auth` (non-secret discriminator + public
 * params) and `credentials` (encrypted secret value). The mode tag is
 * duplicated in both blobs; the adapter rejects mismatches at runtime.
 */
import { z } from "zod";

// ── Auth (config-side, non-secret) ───────────────────────────────────

export const ApiAuthNoneSchema = z.object({ mode: z.literal("none") });
export type ApiAuthNone = z.infer<typeof ApiAuthNoneSchema>;

export const ApiAuthApiKeySchema = z.object({
  mode: z.literal("apiKey"),
  keyName: z.string().min(1),
  placement: z.enum(["header", "query"]),
});
export type ApiAuthApiKey = z.infer<typeof ApiAuthApiKeySchema>;

export const ApiAuthBearerSchema = z.object({ mode: z.literal("bearer") });
export type ApiAuthBearer = z.infer<typeof ApiAuthBearerSchema>;

export const ApiAuthBasicSchema = z.object({ mode: z.literal("basic") });
export type ApiAuthBasic = z.infer<typeof ApiAuthBasicSchema>;

export const ApiAuthConfigSchema = z.discriminatedUnion("mode", [
  ApiAuthNoneSchema,
  ApiAuthApiKeySchema,
  ApiAuthBearerSchema,
  ApiAuthBasicSchema,
]);
export type ApiAuthConfig = z.infer<typeof ApiAuthConfigSchema>;

// ── Credentials (secret-side, encrypted at rest) ─────────────────────

export const ApiCredentialsNoneSchema = z.object({ mode: z.literal("none") });
export type ApiCredentialsNone = z.infer<typeof ApiCredentialsNoneSchema>;

export const ApiCredentialsApiKeySchema = z.object({
  mode: z.literal("apiKey"),
  value: z.string().min(1),
});
export type ApiCredentialsApiKey = z.infer<typeof ApiCredentialsApiKeySchema>;

export const ApiCredentialsBearerSchema = z.object({
  mode: z.literal("bearer"),
  token: z.string().min(1),
});
export type ApiCredentialsBearer = z.infer<typeof ApiCredentialsBearerSchema>;

export const ApiCredentialsBasicSchema = z.object({
  mode: z.literal("basic"),
  username: z.string().min(1),
  password: z.string().min(1),
});
export type ApiCredentialsBasic = z.infer<typeof ApiCredentialsBasicSchema>;

export const ApiCredentialsSchema = z.discriminatedUnion("mode", [
  ApiCredentialsNoneSchema,
  ApiCredentialsApiKeySchema,
  ApiCredentialsBearerSchema,
  ApiCredentialsBasicSchema,
]);
export type ApiCredentials = z.infer<typeof ApiCredentialsSchema>;

// ── Instance config ──────────────────────────────────────────────────

export const RestApiInstanceConfigSchema = z.object({
  baseUrl: z.url(),
  auth: ApiAuthConfigSchema,
});
export type RestApiInstanceConfig = z.infer<typeof RestApiInstanceConfigSchema>;

// ── Pagination strategies (config side) ──────────────────────────────
//
// Discriminated union over `strategy`. The DB stores the discriminator
// in the `pagination` text column (CHECK-constrained to the same four
// values) and the rest of the union arm in the `pagination_config`
// jsonb column; the route flattens / unflattens between the structured
// model shape and the table shape.

export const PaginationNoneSchema = z.object({ strategy: z.literal("none") });
export type PaginationNone = z.infer<typeof PaginationNoneSchema>;

export const PaginationPageOffsetSchema = z.object({
  strategy: z.literal("pageOffset"),
  style: z.enum(["page", "offset"]),
  param: z.string().min(1),
  pageSize: z.number().int().positive().default(50),
  pageSizeParam: z.string().optional(),
  startPage: z.number().int().nonnegative().default(1),
  stopOnShortPage: z.boolean().default(true),
});
export type PaginationPageOffset = z.infer<typeof PaginationPageOffsetSchema>;

export const PaginationCursorSchema = z.object({
  strategy: z.literal("cursor"),
  cursorParam: z.string().min(1),
  cursorPlacement: z.enum(["query", "header", "body"]).default("query"),
  cursorResponsePath: z.string().min(1),
});
export type PaginationCursor = z.infer<typeof PaginationCursorSchema>;

export const PaginationLinkHeaderSchema = z.object({
  strategy: z.literal("linkHeader"),
});
export type PaginationLinkHeader = z.infer<typeof PaginationLinkHeaderSchema>;

export const PaginationConfigSchema = z.discriminatedUnion("strategy", [
  PaginationNoneSchema,
  PaginationPageOffsetSchema,
  PaginationCursorSchema,
  PaginationLinkHeaderSchema,
]);
export type PaginationConfig = z.infer<typeof PaginationConfigSchema>;

// ── Endpoint config ──────────────────────────────────────────────────
//
// `ApiEndpointConfigBaseSchema` is the raw shape (no cross-field
// refinements); `ApiEndpointConfigSchema` layers the `bodyTemplate vs
// method` refine on top. PATCH-style partial validation derives from
// the base — Zod's `.partial()` cannot be applied after a refine.

export const ApiEndpointConfigBaseSchema = z.object({
  path: z.string().min(1),
  method: z.enum(["GET", "POST"]),
  recordsPath: z.string().default(""),
  // JSONata expression applied to the raw HTTP response before
  // inference / sync; mutually exclusive with recordsPath (see refine
  // below). 4 KB cap is way above realistic user-typed transforms but
  // bounds abuse.
  transform: z.string().max(4096).optional(),
  idField: z.string().nullable().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  queryParams: z.record(z.string(), z.string()).optional(),
  bodyTemplate: z.string().optional(),
  pagination: PaginationConfigSchema,
});

export const ApiEndpointConfigSchema = ApiEndpointConfigBaseSchema.refine(
  (cfg) => !(cfg.method === "GET" && cfg.bodyTemplate !== undefined),
  {
    message: "bodyTemplate is only valid when method is POST",
    path: ["bodyTemplate"],
  }
).refine(
  (cfg) => {
    const recordsPathSet = !!cfg.recordsPath && cfg.recordsPath.length > 0;
    const transformSet = !!cfg.transform && cfg.transform.length > 0;
    return !(recordsPathSet && transformSet);
  },
  {
    message:
      "transform and recordsPath cannot both be set; choose one to extract records",
    path: ["transform"],
  }
);
export type ApiEndpointConfig = z.infer<typeof ApiEndpointConfigSchema>;
