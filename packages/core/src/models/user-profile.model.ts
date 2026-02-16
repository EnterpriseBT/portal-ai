import { z } from "zod";
import { BaseModelSchema } from "./base.model.js";

/**
 * User profile database model.
 * Extends BaseModel with user-specific fields sourced from Auth0.
 */
export const UserProfileModelSchema = BaseModelSchema.extend({
  email: z.string().optional(),
  name: z.string().optional(),
  picture: z.string().optional(),
});

export type UserProfileModel = z.infer<typeof UserProfileModelSchema>;
