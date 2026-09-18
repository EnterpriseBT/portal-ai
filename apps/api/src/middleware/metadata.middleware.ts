import type { Request, Response, NextFunction } from "express";

import { ApplicationService } from "../services/application.service.js";
import { Auth0Service } from "../services/auth0.service.js";
import { SsoConfig } from "../config/sso.config.js";
import { DbService } from "../services/db.service.js";
import { ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "metadata-middleware" });

/**
 * Derive a login-session marker from the validated token payload, preferring
 * `auth_time` (true login time), then `sid` (session id), then `iat` (#577,
 * OQ6). Prefixed so the three kinds never collide. Null when none is present —
 * the caller then skips per-login re-emission for that IdP.
 */
function loginSessionMarker(
  payload: Record<string, unknown> | undefined
): string | null {
  if (!payload) return null;
  if (typeof payload.auth_time === "number") return `at:${payload.auth_time}`;
  if (typeof payload.sid === "string") return `sid:${payload.sid}`;
  if (typeof payload.iat === "number") return `iat:${payload.iat}`;
  return null;
}

/**
 * Middleware that resolves the authenticated Auth0 user and their current
 * organization, then attaches both IDs to `req.application.metadata`.
 *
 * Must run after `jwtCheck` so that `req.auth` is populated.
 */
export const getApplicationMetadata = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const auth0Id = req.auth?.payload.sub;
    if (!auth0Id) {
      return next(
        new ApiError(
          401,
          ApiCode.METADATA_MISSING_AUTH,
          "Missing authentication subject"
        )
      );
    }

    const user = await DbService.repository.users.findByAuth0Id(auth0Id);
    const orgResult = user
      ? await ApplicationService.getCurrentOrganization(user.id)
      : null;

    // Self-heal (#583): a logged-in user with no row, or no membership, means
    // the Auth0 post-login webhook never provisioned them (misconfigured,
    // unreachable, or a user predating it). Provision on the request path so
    // the invariant "an authenticated user always resolves to a membership +
    // role" holds regardless of the webhook. Idempotent + advisory-locked, so
    // concurrent requests during a first login converge on one org. The Auth0
    // profile is fetched lazily — only when a user row must be created — via
    // the request's own access token. A fetch failure falls to the catch below
    // → 500 METADATA_FETCH_FAILED (fail-closed): never a nameless partial user.
    if (!user || !orgResult) {
      const ensured = await ApplicationService.ensureProvisioned(
        auth0Id,
        async () => {
          const profile = await Auth0Service.getAuth0UserProfile(
            Auth0Service.getAccessToken(req.headers.authorization),
            typeof req.auth?.payload.iss === "string"
              ? req.auth.payload.iss
              : undefined
          );
          return {
            email: profile.email ?? null,
            name: profile.name ?? null,
            picture: profile.picture ?? null,
            emailVerified: profile.email_verified ?? false,
          };
        },
        { sourceIp: req.ip ?? null, userAgent: req.get("user-agent") ?? null },
        SsoConfig.provisioningFallback(
          req.auth?.payload as Record<string, unknown> | undefined
        )
      );

      req.application = {
        metadata: {
          userId: ensured.user.id,
          organizationId: ensured.organization.id,
          role: ensured.organizationUser.role,
        },
      };

      return next();
    }

    // Re-homed per-login side-effects (#577): refresh the profile + emit the
    // auth.login audit row for a returning user when the token represents a new
    // login session (the webhook used to do this). Fire-and-forget + deduped by
    // the session marker; never blocks or fails the request.
    void ApplicationService.recordLoginIfNewSession(
      user,
      orgResult.organization.id,
      orgResult.organizationUser,
      loginSessionMarker(req.auth?.payload),
      async () => {
        const profile = await Auth0Service.getAuth0UserProfile(
          Auth0Service.getAccessToken(req.headers.authorization),
          typeof req.auth?.payload.iss === "string"
            ? req.auth.payload.iss
            : undefined
        );
        return {
          email: profile.email ?? null,
          name: profile.name ?? null,
          picture: profile.picture ?? null,
          emailVerified: profile.email_verified ?? false,
        };
      },
      { sourceIp: req.ip ?? null, userAgent: req.get("user-agent") ?? null }
    );

    req.application = {
      metadata: {
        userId: user.id,
        organizationId: orgResult.organization.id,
        role: orgResult.organizationUser.role,
      },
    };

    next();
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : "Unknown error" },
      "Failed to resolve application metadata"
    );
    return next(
      new ApiError(
        500,
        ApiCode.METADATA_FETCH_FAILED,
        "Failed to resolve application metadata"
      )
    );
  }
};
