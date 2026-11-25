import type { Request } from "../types/request.js";
/**
 * The command palette's search (#1076), `GET /api/search`. Read-scoped per
 * type through `SearchService`; no gate beyond each type's read.
 */

import { Router, Response, NextFunction } from "express";

import {
  SearchRequestQuerySchema,
  type SearchResponsePayload,
} from "@portalai/core/contracts";

import { HttpService } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { SearchService } from "../services/search.service.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { invalidPayload } from "../utils/zod-issue.util.js";
import { setDbCancelPolicy } from "../utils/request-context.util.js";

export const searchRouter = Router();

/**
 * @openapi
 * /api/search:
 *   get:
 *     summary: Search the objects the caller can read (#1076)
 *     description: >
 *       The command palette's search. Pass at most one of `q` (by name, across
 *       stations, pinned results, views, connectors, entities and portals),
 *       `tag` (objects carrying a readable tag whose name starts with the
 *       text) or `refs` (the readable subset of `type:id` pairs, in order).
 *       With none, answers the caller's favorites. Every result is readable by
 *       the caller in their active org; at most 5 per type (10 favorites).
 *     tags: [Search]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: false
 *         schema: { type: string, maxLength: 120 }
 *       - in: query
 *         name: tag
 *         required: false
 *         schema: { type: string, maxLength: 120 }
 *       - in: query
 *         name: refs
 *         required: false
 *         description: Up to 20 comma-separated `type:id` pairs
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The matching objects, grouped by type in a fixed order
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SearchResponse'
 *       400:
 *         description: SEARCH_INVALID_QUERY. More than one mode, an unknown key, over-long text or a malformed ref
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
searchRouter.get(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    const parsed = SearchRequestQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return next(
        invalidPayload(
          ApiCode.SEARCH_INVALID_QUERY,
          "Invalid search query",
          parsed.error
        )
      );
    }
    try {
      // Read-only, and a superseded search is safe to stop mid-statement.
      setDbCancelPolicy("always");
      const payload = await SearchService.search(
        req.application!.metadata,
        parsed.data
      );
      return HttpService.success<SearchResponsePayload>(res, payload);
    } catch (error) {
      return next(error);
    }
  }
);
