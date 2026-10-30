import type { Request } from "../types/request.js";
/**
 * Public SSO discovery router (#916) — the anonymous lookup behind "Sign in
 * with SSO". Mounted at `/api/public` ahead of `protectedRouter`, so
 * `jwtCheck` never sees it: the caller is signing in and has no token yet.
 *
 * Safe for the same two reasons as the public site router:
 *
 * 1. **It serves no tenant data.** The answer is `{ connection }`, an Auth0
 *    connection name from deploy config (`SSO_ENTERPRISE_CONNECTIONS`), or
 *    null. Revealing whether a domain has SSO is accepted, as for any SSO
 *    discovery. The email travels in the body, never a URL, and isn't logged.
 * 2. **It is rate-limited per IP**, in its own window, so it can't spend the
 *    site-config budget or the reverse.
 */

import { Router, Response, NextFunction } from "express";

import {
  SsoDiscoveryRequestBodySchema,
  type SsoDiscoveryResponse,
} from "@portalai/core/contracts";

import { SsoConfig } from "../config/sso.config.js";
import { HttpService } from "../services/http.service.js";
import { publicRateLimit } from "../middleware/public-rate-limit.middleware.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { environment } from "../environment.js";
import { invalidPayload } from "../utils/zod-issue.util.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "public-sso-router" });

export const publicSsoRouter = Router();

/**
 * @openapi
 * /api/public/sso-discovery:
 *   post:
 *     tags:
 *       - Public Auth
 *     summary: Find the SSO connection for a work email (anonymous)
 *     description: >
 *       Maps a work email's domain to the Auth0 enterprise connection it signs
 *       in through, so the sign-in page can send the user there. Answers
 *       `connection: null` when no connection lists the domain.
 *
 *
 *       **No authentication.** The caller is signing in. Rate-limited per IP
 *       instead, and it answers only a connection name, never user or
 *       organization data.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SsoDiscoveryRequestBody'
 *     responses:
 *       200:
 *         description: The connection for the email's domain, or null
 *         headers:
 *           Cache-Control:
 *             schema:
 *               type: string
 *             description: "`no-store`"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 payload:
 *                   $ref: '#/components/schemas/SsoDiscoveryResponse'
 *       400:
 *         description: Malformed body (SSO_DISCOVERY_INVALID_PAYLOAD)
 *       429:
 *         description: Per-IP rate limit exceeded (SSO_DISCOVERY_RATE_LIMITED)
 */
publicSsoRouter.post(
  "/sso-discovery",
  publicRateLimit(
    environment.PUBLIC_SSO_RATE_LIMIT_PER_MIN,
    ApiCode.SSO_DISCOVERY_RATE_LIMITED,
    "sso"
  ),
  (req: Request, res: Response, next: NextFunction) => {
    const parsed = SsoDiscoveryRequestBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return next(
        invalidPayload(
          ApiCode.SSO_DISCOVERY_INVALID_PAYLOAD,
          "SSO discovery",
          parsed.error
        )
      );
    }

    const connection = SsoConfig.connectionForEmail(parsed.data.email);
    logger.info({ matched: connection !== null }, "SSO discovery lookup");

    res.set("Cache-Control", "no-store");
    return HttpService.success<SsoDiscoveryResponse>(res, { connection });
  }
);
