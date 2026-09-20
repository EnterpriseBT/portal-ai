import { z } from "zod";
import { OrganizationSchema } from "../models/organization.model.js";
import {
  OrgRoleSchema,
  OrganizationUserSchema,
} from "../models/organization-user.model.js";
import { CapabilityMapSchema } from "../models/permission.model.js";

/**
 * Response payload for the caller's current organization (#576/#620).
 * - `roles` — the caller's roles in the org (display), from the `user_role` join.
 * - `capabilities` — the server-computed gating map; the FE gates on these.
 * - `role` — **deprecated/transitional**: the caller's highest role, kept while
 *   the FE migrates to `capabilities`; removed once nothing reads it (#620 s4).
 */
export const OrganizationGetResponseSchema = z.object({
  organization: OrganizationSchema,
  roles: z.array(OrgRoleSchema),
  capabilities: CapabilityMapSchema,
  role: OrgRoleSchema,
});

export type OrganizationGetResponse = z.infer<
  typeof OrganizationGetResponseSchema
>;

/**
 * Request body for DELETE /api/organization/:id — the server-verified
 * type-to-confirm gate (#197). The route rejects unless `confirmationName`
 * matches the organization's name (trim-exact, case-sensitive).
 */
export const OrganizationDeleteRequestSchema = z.object({
  confirmationName: z.string().min(1),
});

export type OrganizationDeleteRequest = z.infer<
  typeof OrganizationDeleteRequestSchema
>;

/**
 * Response payload for a successful organization deletion — the id of the
 * deleted (tombstoned) organization.
 */
export const OrganizationDeleteResponseSchema = z.object({
  id: z.string(),
});

export type OrganizationDeleteResponse = z.infer<
  typeof OrganizationDeleteResponseSchema
>;

/**
 * Request body for PATCH /api/organization/members/:userId/role (#576) — assign
 * a membership role. Owner + admin may call it; only the owner may mint/remove
 * `admin` or `owner` (enforced in the route, OQ2).
 */
export const MemberRoleUpdateRequestSchema = z.object({
  role: OrgRoleSchema,
});

export type MemberRoleUpdateRequest = z.infer<
  typeof MemberRoleUpdateRequestSchema
>;

/** Response payload for a successful role assignment — the updated membership. */
export const MemberRoleUpdateResponseSchema = z.object({
  member: OrganizationUserSchema,
});

export type MemberRoleUpdateResponse = z.infer<
  typeof MemberRoleUpdateResponseSchema
>;
