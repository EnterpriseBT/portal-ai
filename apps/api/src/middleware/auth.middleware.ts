import { auth } from "express-oauth2-jwt-bearer";
import type { Request, Response, NextFunction, RequestHandler } from "express";

import { SsoConfig } from "../config/sso.config.js";
import { ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";

/**
 * Multi-issuer JWT validation middleware (#577).
 *
 * Builds one `express-oauth2-jwt-bearer` validator per configured issuer
 * (`SsoConfig.issuers()`, which defaults to today's single Auth0 tenant when
 * `SSO_ISSUERS` is unset — so SaaS behavior is unchanged). Each request is
 * dispatched to the validator whose issuer matches the token's `iss` claim.
 *
 * The `iss` is read UNVERIFIED, purely to route; the selected validator then
 * performs the real signature / audience / expiry verification and fetches the
 * JWKS (cached internally). A well-formed token whose issuer is not configured
 * is rejected 401 `SSO_UNKNOWN_ISSUER`; a missing/malformed token is 401
 * `AUTH_UNAUTHORIZED`, the same code the single-issuer middleware produced.
 */
function buildValidators(): Map<string, RequestHandler> {
  const map = new Map<string, RequestHandler>();
  for (const cfg of SsoConfig.issuers()) {
    map.set(
      cfg.issuer,
      auth({
        issuer: cfg.issuer,
        issuerBaseURL: cfg.issuer.replace(/\/$/, ""),
        audience: cfg.audience,
        tokenSigningAlg: cfg.alg,
      })
    );
  }
  return map;
}

// Built once at module load. A malformed `SSO_ISSUERS` throws here, so the app
// fails fast at boot rather than silently accepting no issuer.
const validators = buildValidators();

/** Read the `iss` claim from a JWT without verifying it (routing only). */
function unverifiedIssuer(token: string): string | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8")
    ) as { iss?: unknown };
    return typeof payload.iss === "string" ? payload.iss : null;
  } catch {
    return null;
  }
}

export const jwtCheck: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const authz = req.headers.authorization;
  if (!authz || !authz.startsWith("Bearer ")) {
    return next(
      new ApiError(401, ApiCode.AUTH_UNAUTHORIZED, "Missing bearer token")
    );
  }

  const iss = unverifiedIssuer(authz.substring(7));
  const validator = iss ? validators.get(iss) : undefined;
  if (!validator) {
    return next(
      new ApiError(
        401,
        iss ? ApiCode.SSO_UNKNOWN_ISSUER : ApiCode.AUTH_UNAUTHORIZED,
        iss ? "Token issuer is not configured" : "Malformed token"
      )
    );
  }

  return validator(req, res, next);
};
