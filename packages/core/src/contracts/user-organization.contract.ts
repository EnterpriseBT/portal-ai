import { z } from "zod";
import { OrganizationUserSchema } from "../models/organization-user.model.js";

/**
 * Response payload for fetching a single user-organization link.
 */
export const UserOrganizationGetResponseSchema = z.object({
  organizationUser: OrganizationUserSchema,
});

export type UserOrganizationGetResponse = z.infer<
  typeof UserOrganizationGetResponseSchema
>;
