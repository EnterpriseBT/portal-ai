import { auth } from "express-oauth2-jwt-bearer";
import { environment } from "../environment.js";
import { deployMode, type DeployMode } from "../config/deploy-mode.js";

type AuthEnv = Pick<
  typeof environment,
  "AUTH0_AUDIENCE" | "AUTH0_DOMAIN" | "OIDC_ISSUER" | "OIDC_AUDIENCE"
>;

/**
 * JWT verification config for the active deploy mode (#579):
 * - `saas` → the central Auth0 (issuer built from `AUTH0_DOMAIN`) — unchanged.
 * - `residency` → the customer's own OIDC issuer/audience (`OIDC_*`) verbatim.
 *
 * `mode`/`env` are injectable for tests; both default to the live values.
 */
export function resolveAuthConfig(
  mode: DeployMode = deployMode,
  env: AuthEnv = environment
): { audience: string | undefined; issuerBaseURL: string } {
  if (mode === "residency") {
    return { audience: env.OIDC_AUDIENCE, issuerBaseURL: env.OIDC_ISSUER };
  }
  return {
    audience: env.AUTH0_AUDIENCE,
    issuerBaseURL: `https://${env.AUTH0_DOMAIN}`,
  };
}

/**
 * JWT validation middleware using `express-oauth2-jwt-bearer`.
 *
 * Extracts the Bearer token from the Authorization header, fetches the JWKS
 * from the mode-selected issuer (cached internally), and validates the JWT
 * signature, expiration, audience, and issuer. Populates req.auth with the
 * decoded token payload. Returns 401 on failure.
 */
export const jwtCheck = auth({
  ...resolveAuthConfig(),
  tokenSigningAlg: "RS256",
});
