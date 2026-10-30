import { z } from "zod";

/**
 * Reads a boolean OIDC claim that may arrive as a string (#916). Auth0 returns
 * an enterprise connection's mapped claims as strings, so `email_verified` can
 * be `"true"` or `"false"`. Returns undefined for anything else, so a caller
 * never mistakes an unknown value for `true`.
 */
export function parseBooleanClaim(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return undefined;
}

/** A boolean claim, also accepting the strings `"true"` and `"false"`. */
const booleanClaim = z
  .preprocess((value) => parseBooleanClaim(value) ?? value, z.boolean())
  .optional();

/**
 * Auth0 user profile schema from the userinfo endpoint.
 * @see https://auth0.com/docs/api/authentication#get-user-info
 *
 * Uses `.catchall(z.unknown())` to allow arbitrary claims that Auth0
 * may include beyond the standard OIDC fields.
 */
export const Auth0UserProfileSchema = z
  .object({
    sub: z.string().min(1),
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
    email_verified: booleanClaim,
    gender: z.string().optional(),
    birthdate: z.string().optional(),
    zoneinfo: z.string().optional(),
    locale: z.string().optional(),
    phone_number: z.string().optional(),
    phone_number_verified: booleanClaim,
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
 * User profile API response payload.
 */
export const Auth0UserProfileGetResponseSchema = z.object({
  profile: Auth0UserProfileSchema,
  lastLogin: z.number().nullable(),
  /** The caller's DB user id (#176) — the client compares it against
   *  `organization.ownerUserId` for owner-only affordances (billing).
   *  Null until the user row is first synced. */
  userId: z.string().nullable(),
});

export type Auth0UserProfileGetResponse = z.infer<
  typeof Auth0UserProfileGetResponseSchema
>;
