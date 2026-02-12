/**
 * Auth0 user profile information from the userinfo endpoint
 * @see https://auth0.com/docs/api/authentication#get-user-info
 */
export interface Auth0UserProfile {
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  middle_name?: string;
  nickname?: string;
  preferred_username?: string;
  profile?: string;
  picture?: string;
  website?: string;
  email?: string;
  email_verified?: boolean;
  gender?: string;
  birthdate?: string;
  zoneinfo?: string;
  locale?: string;
  phone_number?: string;
  phone_number_verified?: boolean;
  address?: {
    formatted?: string;
    street_address?: string;
    locality?: string;
    region?: string;
    postal_code?: string;
    country?: string;
  };
  updated_at?: string;
  [key: string]: unknown;
}

/**
 * User profile information used throughout the application
 */
export interface UserProfile {
  id: string;
  email?: string;
  name?: string;
  picture?: string;
}
