import { parseBooleanClaim } from "@portalai/core/contracts";

/**
 * Reads a profile's `email_verified` strictly (#916). Auth0 passes an
 * enterprise connection's mapped claims through as strings, so a verified
 * email can arrive as `"true"`, and an unverified one as `"false"`, which a
 * truthiness check would accept. Only `true` or the string `"true"` count.
 */
export function isEmailVerified(value: unknown): boolean {
  return parseBooleanClaim(value) === true;
}
