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

// ── Endpoint config ──────────────────────────────────────────────────
//
// Pagination is NOT a field here in phase 1/2 — the api_endpoint_configs
// CHECK constraint enforces 'none' at the DB level, so the model layer
// exposes no choice either. Phase 3 adds a discriminated `pagination`
// union to this schema.

export const ApiEndpointConfigSchema = z.object({
  path: z.string().min(1),
  method: z.enum(["GET", "POST"]),
  recordsPath: z.string().default(""),
  idField: z.string().nullable().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  queryParams: z.record(z.string(), z.string()).optional(),
});
export type ApiEndpointConfig = z.infer<typeof ApiEndpointConfigSchema>;
