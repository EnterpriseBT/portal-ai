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

// pageOffset splits on `style`: page-style endpoints (`?page=1&per_page=…`)
// are forgiving and can lean on schema defaults; offset-style endpoints
// (`?resultOffset=0&resultRecordCount=…`) need every field set explicitly
// because the iterator's per-page step is `pageSize` (not 1), and there
// is no universally-safe default across the row-offset APIs we support.
// Both variants share `strategy: "pageOffset"` so the outer
// `PaginationConfigSchema` is a plain `z.union` rather than a
// `z.discriminatedUnion` (the latter requires unique literal
// discriminators per option).

const PaginationPageOffsetPageStyleSchema = z.object({
  strategy: z.literal("pageOffset"),
  style: z.literal("page"),
  param: z.string().min(1),
  /** Defaults to 1 — the only universally-safe value across page-style
   *  APIs that lean on the schema. Users typically override (e.g. 50,
   *  100). */
  pageSize: z.number().int().positive().default(1),
  pageSizeParam: z.string().optional(),
  startPage: z.number().int().nonnegative().default(1),
  stopOnShortPage: z.boolean().default(true),
});

const PaginationPageOffsetOffsetStyleSchema = z.object({
  strategy: z.literal("pageOffset"),
  style: z.literal("offset"),
  param: z.string().min(1),
  /** Required — the iterator increments by `pageSize` per page, so an
   *  unset value would silently produce an unusable URL sequence. */
  pageSize: z.number().int().positive(),
  /** Required — every offset-style API we've seen takes BOTH the row
   *  offset and the row count per page; making this optional would let
   *  the form skip a field the upstream needs. */
  pageSizeParam: z.string().min(1),
  /** Required — typically 0 for row-offset APIs, but never universally
   *  the same value (some are 1-indexed). Force the user to declare. */
  startPage: z.number().int().nonnegative(),
  stopOnShortPage: z.boolean().default(true),
});

export const PaginationPageOffsetSchema = z.union([
  PaginationPageOffsetOffsetStyleSchema,
  PaginationPageOffsetPageStyleSchema,
]);
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

// `linkBody` mirrors `linkHeader` but reads the next URL from a dotted
// path in the response body instead of the HTTP `Link` header. The
// extracted value must be a complete URL (the iterator follows it
// verbatim via `overrideUrl`, same as the link-header path). Common
// shape: NASA NEO returns `{ links: { next: "<full url>" } }`.
export const PaginationLinkBodySchema = z.object({
  strategy: z.literal("linkBody"),
  nextUrlPath: z.string().min(1),
});
export type PaginationLinkBody = z.infer<typeof PaginationLinkBodySchema>;

// `z.union` rather than `z.discriminatedUnion` because
// `PaginationPageOffsetSchema` is itself a union over `style` (with
// both branches sharing `strategy: "pageOffset"` — Zod's discriminated
// union would reject the strategy-literal collision).
export const PaginationConfigSchema = z.union([
  PaginationNoneSchema,
  PaginationPageOffsetSchema,
  PaginationCursorSchema,
  PaginationLinkHeaderSchema,
  PaginationLinkBodySchema,
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
