import { z } from "zod";
import { Auth0UserProfileSchema } from "./auth.contracts.js";

/**
 * User profile API response payload.
 */
export const UserProfileGetResponseSchema = z.object({
  profile: Auth0UserProfileSchema,
});

export type UserProfileGetResponse = z.infer<
  typeof UserProfileGetResponseSchema
>;
