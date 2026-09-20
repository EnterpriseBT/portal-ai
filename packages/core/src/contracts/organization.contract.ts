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

/**
 * Set-the-set request for `PUT /organization/members/:userId/roles` (#620) —
 * the desired **complete** role set for a member (the endpoint diffs it against
 * their current roles and adds/removes to match). `.min(1)` is the ≥1-role
 * guard at the schema edge (a member always holds at least one role).
 */
export const MemberRolesSetRequestSchema = z.object({
  roles: z.array(OrgRoleSchema).min(1),
});

export type MemberRolesSetRequest = z.infer<typeof MemberRolesSetRequestSchema>;

/** Response for a successful set-roles — the member's resulting role set. */
export const MemberRolesSetResponseSchema = z.object({
  member: z.object({
    userId: z.string(),
    roles: z.array(OrgRoleSchema),
  }),
});

export type MemberRolesSetResponse = z.infer<
  typeof MemberRolesSetResponseSchema
>;
