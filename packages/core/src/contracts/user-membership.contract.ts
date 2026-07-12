import { z } from "zod";
import { OrganizationSchema } from "../models/organization.model.js";

/**
 * One organization the authenticated user belongs to, flagged if it is
 * their current (active) organization. `isCurrent` is computed — it marks
 * whichever membership `getCurrentOrganization` would resolve (the highest
 * `last_login`, NULLS LAST) — so it can never disagree with the org the app
 * actually serves. (#201)
 */
export const UserMembershipSchema = z.object({
  organization: OrganizationSchema,
  isCurrent: z.boolean(),
});
export type UserMembership = z.infer<typeof UserMembershipSchema>;

/** Response payload for `GET /api/organization/memberships`. */
export const UserMembershipsGetResponseSchema = z.object({
  memberships: z.array(UserMembershipSchema),
});
export type UserMembershipsGetResponse = z.infer<
  typeof UserMembershipsGetResponseSchema
>;

/** Request body for `POST /api/organization/switch`. */
export const OrganizationSwitchRequestSchema = z.object({
  organizationId: z.string().min(1),
});
export type OrganizationSwitchRequest = z.infer<
  typeof OrganizationSwitchRequestSchema
>;
