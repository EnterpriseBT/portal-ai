import { z } from "zod";
import { OrganizationSchema } from "../models/organization.model.js";

/**
 * Response payload for fetching a single organization.
 */
export const OrganizationGetResponseSchema = z.object({
  organization: OrganizationSchema,
});

export type OrganizationGetResponse = z.infer<
  typeof OrganizationGetResponseSchema
>;
