/**
 * REST API connector — config + credentials schemas.
 *
 * These schemas describe the shape of:
 *   - `connector_instances.config` for `rest-api` definitions
 *     (`RestApiInstanceConfigSchema` — non-secret instance config)
 *   - `api_endpoint_configs` rows
 *     (`ApiEndpointConfigSchema` — per-entity endpoint config)
 *
 * Phase 1 only ships the `none` auth arm. Phase 2 widens the
 * `ApiAuthConfigSchema` discriminated union to apiKey / bearer / basic
 * and adds a parallel `ApiCredentialsSchema` for the encrypted blob.
 */
import { z } from "zod";

// ── Auth ─────────────────────────────────────────────────────────────
//
// `ApiAuthConfigSchema` is a discriminated union to scaffold phase 2's
// non-secret auth metadata (mode + per-mode public params). In phase 1
// only the `none` arm exists; the discriminator is in place so the
// follow-up phases extend rather than refactor.

export const ApiAuthNoneSchema = z.object({ mode: z.literal("none") });
export type ApiAuthNone = z.infer<typeof ApiAuthNoneSchema>;

export const ApiAuthConfigSchema = z.discriminatedUnion("mode", [
  ApiAuthNoneSchema,
]);
export type ApiAuthConfig = z.infer<typeof ApiAuthConfigSchema>;

// ── Instance config ──────────────────────────────────────────────────

export const RestApiInstanceConfigSchema = z.object({
  baseUrl: z.string().url(),
  auth: ApiAuthConfigSchema,
});
export type RestApiInstanceConfig = z.infer<typeof RestApiInstanceConfigSchema>;

// ── Endpoint config ──────────────────────────────────────────────────
//
// Pagination is NOT a field here in phase 1 — the api_endpoint_configs
// CHECK constraint enforces 'none' at the DB level, so phase 1 exposes
// no choice at the model layer either. Phase 3 adds a discriminated
// `pagination` union to this schema.

export const ApiEndpointConfigSchema = z.object({
  path: z.string().min(1),
  method: z.enum(["GET", "POST"]),
  recordsPath: z.string().default(""),
  idField: z.string().nullable().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  queryParams: z.record(z.string(), z.string()).optional(),
});
export type ApiEndpointConfig = z.infer<typeof ApiEndpointConfigSchema>;
