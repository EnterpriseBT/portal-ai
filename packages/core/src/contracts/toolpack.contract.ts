/**
 * Toolpack contracts — the wire shapes for `GET /api/toolpacks` and
 * `GET /api/toolpacks/:id`.
 *
 * Phase 1 emits only `kind: "builtin"` records. The discriminated
 * union is already in place so phase 2 can add the `kind: "custom"`
 * arm without reshaping consumers.
 */

import { z } from "zod";

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

/**
 * The merged toolpack record returned by the API.
 *
 * Phase 1: only the `builtin` arm is emitted. Phase 2 extends the
 * discriminated union with a `custom` arm.
 */
export const ToolpackSchema = z.discriminatedUnion("kind", [
  BuiltinToolpackRecordSchema,
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
