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
});
export type ToolpackRegisterResponsePayload = z.infer<
  typeof ToolpackRegisterResponsePayloadSchema
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
