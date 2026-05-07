/**
 * Toolpack contracts — the wire shapes for `/api/toolpacks` and
 * its sub-routes.
 *
 * Built-in records use the same `Toolpack` discriminated union
 * established in phase 1. Phase 2 adds the `kind: "custom"` arm and
 * the registration request bodies.
 */

import { z } from "zod";

import {
  ToolpackEndpointsSchema,
  TOOLPACK_SLUG_REGEX,
} from "../models/organization-toolpack.model.js";

// ── Tool & example shapes ────────────────────────────────────────────

export const ToolpackToolExampleSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
});
export type ToolpackToolExample = z.infer<typeof ToolpackToolExampleSchema>;

export const ToolpackToolSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  parameterSchema: z.record(z.string(), z.unknown()),
  examples: z.array(ToolpackToolExampleSchema).optional(),
});
export type ToolpackTool = z.infer<typeof ToolpackToolSchema>;

// ── Pack shapes ──────────────────────────────────────────────────────

export const BuiltinToolpackRecordSchema = z.object({
  id: z.string(),
  kind: z.literal("builtin"),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  iconSlug: z.string(),
  tools: z.array(ToolpackToolSchema),
});
export type BuiltinToolpackRecord = z.infer<typeof BuiltinToolpackRecordSchema>;

/** Auth-headers presence marker — actual values are never returned over the wire. */
export const AuthHeadersStatusSchema = z.object({
  has: z.boolean(),
});
export type AuthHeadersStatus = z.infer<typeof AuthHeadersStatusSchema>;

/**
 * Signing-secret presence marker. The plaintext is returned only on
 * the registration response and on rotation — every other read
 * returns `{ has: true }` (always true post-phase-6 because the
 * column is NOT NULL on the DB side).
 */
export const SigningSecretStatusSchema = z.object({
  has: z.boolean(),
});
export type SigningSecretStatus = z.infer<typeof SigningSecretStatusSchema>;

export const CustomToolpackRecordSchema = z.object({
  id: z.string(),
  kind: z.literal("custom"),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  iconSlug: z.string(),
  tools: z.array(ToolpackToolSchema),
  endpoints: ToolpackEndpointsSchema,
  authHeadersStatus: AuthHeadersStatusSchema,
  signingSecretStatus: SigningSecretStatusSchema,
  schemaFetchedAt: z.number(),
  metadataFetchedAt: z.number().nullable(),
});
export type CustomToolpackRecord = z.infer<typeof CustomToolpackRecordSchema>;

/**
 * The merged toolpack record returned by the API.
 */
export const ToolpackSchema = z.discriminatedUnion("kind", [
  BuiltinToolpackRecordSchema,
  CustomToolpackRecordSchema,
]);
export type Toolpack = z.infer<typeof ToolpackSchema>;

// ── List ─────────────────────────────────────────────────────────────

export const ToolpackListRequestQuerySchema = z.object({
  search: z.string().optional(),
  kind: z.enum(["builtin", "custom"]).optional(),
});
export type ToolpackListRequestQuery = z.infer<
  typeof ToolpackListRequestQuerySchema
>;

export const ToolpackListResponsePayloadSchema = z.object({
  toolpacks: z.array(ToolpackSchema),
  total: z.number().int().nonnegative(),
});
export type ToolpackListResponsePayload = z.infer<
  typeof ToolpackListResponsePayloadSchema
>;

// ── Get ──────────────────────────────────────────────────────────────

export const ToolpackGetResponsePayloadSchema = z.object({
  toolpack: ToolpackSchema,
});
export type ToolpackGetResponsePayload = z.infer<
  typeof ToolpackGetResponsePayloadSchema
>;

// ── Register / Update / Refresh / Delete ─────────────────────────────

export const RegisterToolpackBodySchema = z.object({
  name: z.string().regex(TOOLPACK_SLUG_REGEX),
  description: z.string().min(1).optional(),
  endpoints: ToolpackEndpointsSchema,
  authHeaders: z.record(z.string(), z.string()).optional(),
});
export type RegisterToolpackBody = z.infer<typeof RegisterToolpackBodySchema>;

export const UpdateToolpackBodySchema = z
  .object({
    name: z.string().regex(TOOLPACK_SLUG_REGEX).optional(),
    description: z.string().min(1).optional(),
    endpoints: ToolpackEndpointsSchema.optional(),
    authHeaders: z.record(z.string(), z.string()).optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: "At least one field must be provided",
  });
export type UpdateToolpackBody = z.infer<typeof UpdateToolpackBodySchema>;

export const ToolpackRegisterResponsePayloadSchema = z.object({
  toolpack: CustomToolpackRecordSchema,
  /**
   * The freshly-generated signing secret, surfaced exactly once on
   * registration. Subsequent GET / PATCH / refresh responses omit
   * this field entirely; admins who lose the secret rotate via
   * `POST /api/toolpacks/:id/rotate-signing-secret` to view it
   * again. Slice 5 in PR 2 of phase 6 wires this through the route.
   */
  signingSecret: z.string().optional(),
});
export type ToolpackRegisterResponsePayload = z.infer<
  typeof ToolpackRegisterResponsePayloadSchema
>;

/** Response for `POST /api/toolpacks/:id/rotate-signing-secret`. */
export const ToolpackRotateSigningSecretResponsePayloadSchema = z.object({
  id: z.string(),
  signingSecret: z.string(),
  rotatedAt: z.number(),
});
export type ToolpackRotateSigningSecretResponsePayload = z.infer<
  typeof ToolpackRotateSigningSecretResponsePayloadSchema
>;

export const ToolpackUpdateResponsePayloadSchema = z.object({
  toolpack: CustomToolpackRecordSchema,
});
export type ToolpackUpdateResponsePayload = z.infer<
  typeof ToolpackUpdateResponsePayloadSchema
>;

export const ToolpackRefreshResponsePayloadSchema = z.object({
  toolpack: CustomToolpackRecordSchema,
});
export type ToolpackRefreshResponsePayload = z.infer<
  typeof ToolpackRefreshResponsePayloadSchema
>;

export const ToolpackDeleteResponsePayloadSchema = z.object({
  id: z.string(),
  affectedStationIds: z.array(z.string()),
});
export type ToolpackDeleteResponsePayload = z.infer<
  typeof ToolpackDeleteResponsePayloadSchema
>;
