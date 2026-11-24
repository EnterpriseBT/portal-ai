import { Router, Response, NextFunction } from "express";
import { z } from "zod";

import {
  FavoriteParamsSchema,
  type FavoriteResponsePayload,
} from "@portalai/core/contracts";
import { createLogger } from "../utils/logger.util.js";
import { HttpService } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { invalidPayload } from "../utils/zod-issue.util.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { FavoriteService } from "../services/favorite.service.js";
import type { Request } from "../types/request.js";

const logger = createLogger({ module: "favorite" });

export const favoriteRouter = Router();

/** Neither verb takes a body; an absent one reaches the route as `{}`. */
const EmptyBodySchema = z.object({}).strict();

/** Parse the target from the path and refuse a body. */
function parseTarget(req: Request) {
  const params = FavoriteParamsSchema.safeParse(req.params);
  if (!params.success) {
    throw invalidPayload(
      ApiCode.FAVORITE_INVALID_PAYLOAD,
      "favorite target",
      params.error
    );
  }
  const body = EmptyBodySchema.safeParse(req.body ?? {});
  if (!body.success) {
    throw invalidPayload(
      ApiCode.FAVORITE_INVALID_PAYLOAD,
      "favorite request body",
      body.error
    );
  }
  return params.data;
}

/**
 * @openapi
 * /api/favorites/{type}/{id}:
 *   put:
 *     tags:
 *       - Favorites
 *     summary: Favorite an object
 *     description: >-
 *       Stars a station, pinned result, curated view or connector instance for
 *       the caller. Favorites are personal, and starring needs only read
 *       access to the object. Idempotent: starring an object already starred
 *       succeeds and changes nothing.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/favoriteTypeParam'
 *       - $ref: '#/components/parameters/favoriteIdParam'
 *     responses:
 *       200:
 *         description: The object is the caller's favorite
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/FavoriteResponsePayload'
 *       400:
 *         description: Unknown object type, or a request body was sent
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: The object doesn't exist or the caller can't read it
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
favoriteRouter.put(
  "/:type/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const target = parseTarget(req);
      const payload: FavoriteResponsePayload = await FavoriteService.set(
        req.application!.metadata,
        target
      );
      return HttpService.success<FavoriteResponsePayload>(res, payload);
    } catch (error) {
      logger.error({ error }, "Failed to favorite object");
      // FavoriteService and parseTarget throw only ApiErrors.
      return next(error);
    }
  }
);

/**
 * @openapi
 * /api/favorites/{type}/{id}:
 *   delete:
 *     tags:
 *       - Favorites
 *     summary: Unfavorite an object
 *     description: >-
 *       Removes the caller's star from a station, pinned result, curated view
 *       or connector instance. Needs only read access to the object.
 *       Idempotent: unstarring an object that isn't starred succeeds.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/favoriteTypeParam'
 *       - $ref: '#/components/parameters/favoriteIdParam'
 *     responses:
 *       200:
 *         description: The object isn't the caller's favorite
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/FavoriteResponsePayload'
 *       400:
 *         description: Unknown object type, or a request body was sent
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: The object doesn't exist or the caller can't read it
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
favoriteRouter.delete(
  "/:type/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const target = parseTarget(req);
      const payload: FavoriteResponsePayload = await FavoriteService.unset(
        req.application!.metadata,
        target
      );
      return HttpService.success<FavoriteResponsePayload>(res, payload);
    } catch (error) {
      logger.error({ error }, "Failed to unfavorite object");
      return next(error);
    }
  }
);
