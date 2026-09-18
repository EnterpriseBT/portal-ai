import { z } from "zod";
import { OrganizationSchema } from "../models/organization.model.js";
import {
  OrgRoleSchema,
  OrganizationUserSchema,
} from "../models/organization-user.model.js";

/**
 * Response payload for the caller's current organization — the org plus the
 * caller's `role` in it (#576), the single source the web app derives role-aware
 * gating from (never recomputed from `ownerUserId`).
 */
export const OrganizationGetResponseSchema = z.object({
  organization: OrganizationSchema,
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
