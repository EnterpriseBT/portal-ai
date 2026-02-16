import { z } from "zod";

/**
 * Auth0 user profile schema from the userinfo endpoint.
 * @see https://auth0.com/docs/api/authentication#get-user-info
 *
 * Uses `.catchall(z.unknown())` to allow arbitrary claims that Auth0
 * may include beyond the standard OIDC fields.
 */
export const Auth0UserProfileSchema = z
  .object({
    sub: z.string(),
    name: z.string().optional(),
    given_name: z.string().optional(),
    family_name: z.string().optional(),
    middle_name: z.string().optional(),
    nickname: z.string().optional(),
    preferred_username: z.string().optional(),
    profile: z.string().optional(),
    picture: z.string().optional(),
    website: z.string().optional(),
    email: z.string().optional(),
    email_verified: z.boolean().optional(),
    gender: z.string().optional(),
    birthdate: z.string().optional(),
    zoneinfo: z.string().optional(),
    locale: z.string().optional(),
    phone_number: z.string().optional(),
    phone_number_verified: z.boolean().optional(),
    address: z
      .object({
        formatted: z.string().optional(),
        street_address: z.string().optional(),
        locality: z.string().optional(),
        region: z.string().optional(),
        postal_code: z.string().optional(),
        country: z.string().optional(),
      })
      .optional(),
    updated_at: z.string().optional(),
  })
  .catchall(z.unknown());

export type Auth0UserProfile = z.infer<typeof Auth0UserProfileSchema>;

/**
 * User profile information used throughout the application.
 * A simplified subset of the Auth0 profile for API responses.
 */
export const UserProfileSchema = z.object({
  id: z.string(),
  email: z.string().optional(),
  name: z.string().optional(),
  picture: z.string().optional(),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;
