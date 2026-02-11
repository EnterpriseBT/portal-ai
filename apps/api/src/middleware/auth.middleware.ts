import { auth } from "express-oauth2-jwt-bearer";
import { environment } from "../environment.js";

/**
 * JWT validation middleware using Auth0's express-oauth2-jwt-bearer.
 *
 * Extracts the Bearer token from the Authorization header, fetches the JWKS
 * from Auth0 (cached internally), and validates the JWT signature, expiration,
 * audience, and issuer. Populates req.auth with the decoded token payload.
 * Returns 401 on failure.
 */
export const jwtCheck = auth({
  audience: environment.AUTH0_AUDIENCE,
  issuerBaseURL: `https://${environment.AUTH0_DOMAIN}`,
  tokenSigningAlg: "RS256",
});
