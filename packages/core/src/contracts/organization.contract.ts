import { z } from "zod";
import { OrganizationSchema } from "../models/organization.model.js";
import { OrgRoleSchema } from "../models/organization-user.model.js";
import { CapabilityMapSchema } from "../models/permission.model.js";

/**
 * Response payload for the caller's current organization (#576/#620).
 * - `roles` — the caller's roles in the org (display), from the `user_role` join.
 * - `capabilities` — the server-computed gating map; the FE gates on these.
 */
export const OrganizationGetResponseSchema = z.object({
  organization: OrganizationSchema,
  roles: z.array(OrgRoleSchema),
  /** The caller's custom group names in this org (#622) — displayed on the
   *  profile; empty unless the org authors groups. Defaulted so pre-#622
   *  callers/fixtures still parse. */
  groups: z.array(z.string()).default([]),
  capabilities: CapabilityMapSchema,
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
 * Set-the-set request for `PUT /organization/members/:userId/roles` (#620,
 * extended #622) — the desired **complete** role set for a member, addressed by
 * **slug** (system + custom; the endpoint diffs against the member's current
 * roles and adds/removes to match). `.min(1)` is the ≥1-role guard at the schema
 * edge; the service additionally requires ≥1 *system* role.
 */
export const MemberRolesSetRequestSchema = z.object({
  roleSlugs: z.array(z.string().min(1)).min(1),
});

export type MemberRolesSetRequest = z.infer<typeof MemberRolesSetRequestSchema>;

/** Response for a successful set-roles — the member's resulting role set (its
 *  system role names + the complete slug set, #622). */
export const MemberRolesSetResponseSchema = z.object({
  member: z.object({
    userId: z.string(),
    roles: z.array(OrgRoleSchema),
    roleSlugs: z.array(z.string()),
  }),
});

export type MemberRolesSetResponse = z.infer<
  typeof MemberRolesSetResponseSchema
>;
