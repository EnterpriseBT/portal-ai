/**
 * The instance-object picker source (#622) — `GET /api/rbac/objects`. Returns
 * visibility-scoped `{ id, label }` candidates of a `resourceType` for the
 * policy editor, so an author picks by name (never a typed id). Gated like the
 * rest of the authoring surface (entitlement + owner/admin capability).
 */

import { Router, Request, Response, NextFunction } from "express";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { RbacObjectSearchService } from "../services/rbac-object-search.service.js";
import { EntitlementService } from "../services/entitlement.service.js";
import { PermissionService } from "../services/permission.service.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import type { RbacObjectSearchResponse } from "@portalai/core/contracts";

export const rbacObjectSearchRouter = Router();

/**
 * @openapi
 * /api/rbac/objects:
 *   get:
 *     summary: Search pickable instance objects for the policy editor (#622)
 *     description: >
 *       `{ id, label }` candidates of `resourceType` the caller can see
 *       (visibility-scoped) matching `search`. Powers the statement editor's
 *       instance multiselect — no hand-entered ids. Gated on the customRbac
 *       entitlement + owner/admin capability.
 *     tags: [RBAC Authoring]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: resourceType
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: search
 *         required: false
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: The candidate objects
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RbacObjectSearchResponse'
 *       403:
 *         description: Not entitled to custom RBAC, or not an owner/admin
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
rbacObjectSearchRouter.get(
  "/objects",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.application!.metadata;
      if (!(await EntitlementService.customRbacEntitled(ctx.organizationId))) {
        return next(
          new ApiError(
            403,
            ApiCode.RBAC_CUSTOM_NOT_ENTITLED,
            "Your plan does not include custom RBAC authoring"
          )
        );
      }
      await PermissionService.check(ctx, "member.role.assign");

      const resourceType = String(req.query.resourceType ?? "");
      const search = String(req.query.search ?? "");
      const limit = Math.min(Number(req.query.limit) || 20, 50);
      const objects = await RbacObjectSearchService.search(
        ctx,
        resourceType,
        search,
        limit
      );
      return HttpService.success<RbacObjectSearchResponse>(res, { objects });
    } catch (error) {
      return next(error);
    }
  }
);
