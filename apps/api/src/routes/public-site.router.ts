/**
 * Public site router (#311) — the API's only deliberately-anonymous DATA
 * surface, mounted at `/api/public` ahead of `protectedRouter` so the
 * router-level `jwtCheck` never sees these requests.
 *
 * Two invariants make that safe, and both are pinned by tests:
 *
 * 1. **It serves no tenant data.** The payload is a presentation snapshot
 *    of *public* tier rows plus operator-authored contact routes — no org,
 *    user, or usage facts exist in the contract to leak
 *    (`site-config.contract.ts` is strict; the integration suite asserts
 *    an org-private tier is absent).
 * 2. **It is rate-limited per IP.** `publicRateLimit` bounds abuse; the
 *    service's TTL cache bounds what reaches Postgres/Stripe/SSM behind it.
 *
 * The consumer is the marketing site's BUILD, not a browser: `apps/site`
 * fetches this once per build and bakes the values into static HTML.
 */

import { Router, Request, Response, NextFunction } from "express";

import {
  PublicSiteConfigResponseSchema,
  type PublicSiteConfigResponse,
} from "@portalai/core/contracts";

import { SiteConfigService } from "../services/site-config.service.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { publicRateLimit } from "../middleware/public-rate-limit.middleware.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { environment } from "../environment.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "public-site-router" });

export const publicSiteRouter = Router();

publicSiteRouter.use(
  publicRateLimit(environment.PUBLIC_SITE_RATE_LIMIT_PER_MIN)
);

/**
 * @openapi
 * /api/public/site-config:
 *   get:
 *     tags:
 *       - Public Site
 *     summary: Public marketing-site configuration snapshot (anonymous)
 *     description: >
 *       Returns the atomic snapshot the public marketing site bakes into its
 *       static HTML at build time: the ordered public pricing tiers (with
 *       Stripe-resolved amounts) and the operator-owned contact routes.
 *
 *
 *       **No authentication.** This endpoint is anonymous by design and is
 *       rate-limited per IP instead. It exposes no organization, user, or
 *       usage data — only tiers flagged public, never org-scoped ones.
 *
 *
 *       A tier with no Stripe price is served as `price: null` (the bespoke
 *       "contact us" card). A tier whose `stripePriceId` cannot be resolved
 *       fails closed with a 503 rather than being published as amountless.
 *     responses:
 *       200:
 *         description: The site-config snapshot
 *         headers:
 *           Cache-Control:
 *             schema:
 *               type: string
 *             description: "`public, max-age=60, s-maxage=300`"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 payload:
 *                   $ref: '#/components/schemas/PublicSiteConfigResponse'
 *       429:
 *         description: Per-IP rate limit exceeded (SITE_CONFIG_RATE_LIMITED)
 *       500:
 *         description: Snapshot assembly failed
 *       503:
 *         description: >
 *           A public tier's Stripe price could not be resolved
 *           (SITE_CONFIG_PRICE_UNRESOLVED) — fail-closed, see description
 */
publicSiteRouter.get(
  "/site-config",
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info("GET /api/public/site-config called");

      const snapshot = await SiteConfigService.getSiteConfig();

      // Validate on the way out: the site bakes this into published HTML,
      // so a shape regression must fail here, not silently ship.
      const parsed = PublicSiteConfigResponseSchema.safeParse(snapshot);
      if (!parsed.success) {
        logger.error(
          { issues: parsed.error.issues },
          "Site-config snapshot failed its own contract"
        );
        return next(
          new ApiError(
            500,
            ApiCode.SITE_CONFIG_FETCH_FAILED,
            "Site configuration could not be assembled"
          )
        );
      }

      // Honest note: no CDN fronts the API today, so `s-maxage` is
      // correct-but-inert. It costs nothing and is right the day one does.
      res.set("Cache-Control", "public, max-age=60, s-maxage=300");
      return HttpService.success<PublicSiteConfigResponse>(res, parsed.data);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to serve public site config"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.SITE_CONFIG_FETCH_FAILED,
              "Site configuration could not be assembled"
            )
      );
    }
  }
);
