import { z } from "zod";
import { PolicyPrincipalTypeSchema } from "../models/permission.model.js";

/**
 * Wire contracts for RBAC object grants + sharing (#621). A "share" is authored
 * as one or two `permission_grants` rows (`read` → `{read}`, `read-write` →
 * `{read, write}`); the API groups those verb-rows back into one
 * {@link GrantView} per (principal, resource). Grants are only ever over
 * shareable objects (`station` | `pin`).
 */

/** The two share levels the dialog offers. `read-write` never conveys delete. */
export const GrantAccessSchema = z.enum(["read", "read-write"]);
export type GrantAccess = z.infer<typeof GrantAccessSchema>;

/** The shareable object types (#621) — mirrors `SHAREABLE_RESOURCE_TYPES`. */
export const ShareResourceTypeSchema = z.enum([
  "station",
  "pin",
  "curated_view",
]);
export type ShareResourceType = z.infer<typeof ShareResourceTypeSchema>;

/** Who a share targets: a specific org member, or "the team" (→ role:member). */
export const ShareGranteeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user"), userId: z.string() }),
  z.object({ type: z.literal("team") }),
]);
export type ShareGrantee = z.infer<typeof ShareGranteeSchema>;

/** `GET /api/grants` — who `resourceId` is shared with (#745: one schema, so
 *  a missing id and a bad type fail the same way). */
export const GrantListRequestQuerySchema = z.object({
  resourceType: ShareResourceTypeSchema,
  resourceId: z.string().min(1),
});
export type GrantListRequestQuery = z.infer<typeof GrantListRequestQuerySchema>;

/** `POST /api/grants` — share `resourceId` with `grantee` at `access`. */
// #745: an unknown key is a 400 naming it, not silently dropped.
export const ShareGrantRequestSchema = z
  .object({
    resourceType: ShareResourceTypeSchema,
    resourceId: z.string().min(1),
    grantee: ShareGranteeSchema,
    access: GrantAccessSchema,
  })
  .strict();
export type ShareGrantRequest = z.infer<typeof ShareGrantRequestSchema>;

/** One share as the UI sees it — verb-rows grouped per (principal, resource).
 *  `id` is a representative grant-row id; `DELETE /api/grants/:id` revokes the
 *  whole share (every verb row of that principal on the object). */
export const GrantViewSchema = z.object({
  id: z.string(),
  principalType: PolicyPrincipalTypeSchema,
  principalId: z.string(),
  /** Display label — the member's name/email, or "The team". */
  principalLabel: z.string(),
  access: GrantAccessSchema,
});
export type GrantView = z.infer<typeof GrantViewSchema>;

/** `POST /api/grants` response — the created/updated share. */
export const ShareGrantResponseSchema = z.object({ grant: GrantViewSchema });
export type ShareGrantResponse = z.infer<typeof ShareGrantResponseSchema>;

/** `GET /api/grants?resourceType&resourceId` response — who it's shared with. */
export const GrantListResponseSchema = z.object({
  grants: z.array(GrantViewSchema),
});
export type GrantListResponse = z.infer<typeof GrantListResponseSchema>;
