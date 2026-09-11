import { auth } from "express-oauth2-jwt-bearer";
import type { RequestHandler } from "express";
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
 *
 * The underlying `auth()` is built **lazily** on first request, not at module
 * load (#579): `auth()` asserts a non-empty `issuerBaseURL` at construction,
 * so an eager build would crash the *import* — before the deploy-mode boot
 * guard can report a clean `DEPLOY_MODE_CONFIG_INVALID` — for a residency
 * install missing its OIDC config. Deferring construction lets the guard run
 * first; a config that passes the guard always yields a valid issuer here.
 */
let authMiddleware: RequestHandler | undefined;
export const jwtCheck: RequestHandler = (req, res, next) => {
  authMiddleware ??= auth({
    ...resolveAuthConfig(),
    tokenSigningAlg: "RS256",
  });
  return authMiddleware(req, res, next);
};
