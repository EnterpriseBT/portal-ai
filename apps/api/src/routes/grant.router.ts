/**
 * RBAC object grants + sharing (#621) — the `/api/grants` surface. Share a
 * station/pin with a member or the team (`POST`), list who it's shared with
 * (`GET`), revoke (`DELETE`). All authorization (share-authority, permissions
 * boundary, grantee-membership) lives in {@link GrantService}; this router
 * intakes + validates + shapes the response.
 */

import { Router, Request, Response, NextFunction } from "express";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { GrantService } from "../services/grant.service.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { auditContextFromRequest } from "../utils/audit-context.util.js";
import {
  ShareGrantRequestSchema,
  ShareResourceTypeSchema,
  type ShareGrantResponse,
  type GrantListResponse,
} from "@portalai/core/contracts";

export const grantRouter = Router();

/**
 * @openapi
 * /api/grants:
 *   post:
 *     summary: Share a station or pin with a member or the team (#621)
 *     description: >
 *       Grants `read` or `read-write` on one station/pin to a user or the team
 *       (role:member). Requires `resource.share` on the object (owner/admin/its
 *       creator); rejects a grant beyond the granter's own allow-set
 *       (`RBAC_GRANT_EXCEEDS_BOUNDARY`) or a non-member grantee
 *       (`RBAC_GRANTEE_NOT_MEMBER`). Re-sharing replaces the prior access.
 *     tags: [Grants]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ShareGrantRequest'
 *     responses:
 *       200:
 *         description: Share created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShareGrantResponse'
 *       400:
 *         description: Invalid payload, or the grantee is not an org member
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       403:
 *         description: Caller can't share this object, or the grant exceeds their boundary
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Object not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
grantRouter.post(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.application!.metadata;
      const parsed = ShareGrantRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.ORGANIZATION_INVALID_PAYLOAD,
            "Invalid share payload — expected { resourceType, resourceId, grantee, access }"
          )
        );
      }
      const grant = await GrantService.share(
        ctx,
        parsed.data,
        auditContextFromRequest(req)
      );
      return HttpService.success<ShareGrantResponse>(res, { grant });
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * @openapi
 * /api/grants:
 *   get:
 *     summary: List who a station or pin is shared with (#621)
 *     description: >
 *       Every share on the object, grouped per principal (verb-rows collapsed
 *       into `read` / `read-write`). Requires `resource.share` on the object.
 *     tags: [Grants]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: resourceType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [station, pin]
 *       - in: query
 *         name: resourceId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: The object's shares
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GrantListResponse'
 *       403:
 *         description: Caller can't manage this object's shares
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Object not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
grantRouter.get(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.application!.metadata;
      const rt = ShareResourceTypeSchema.safeParse(req.query.resourceType);
      const resourceId = req.query.resourceId;
      if (!rt.success || typeof resourceId !== "string" || !resourceId) {
        return next(
          new ApiError(
            400,
            ApiCode.ORGANIZATION_INVALID_PAYLOAD,
            "resourceType (station|pin) and resourceId query params are required"
          )
        );
      }
      const grants = await GrantService.list(ctx, rt.data, resourceId);
      return HttpService.success<GrantListResponse>(res, { grants });
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * @openapi
 * /api/grants/{id}:
 *   delete:
 *     summary: Revoke a share (#621)
 *     description: >
 *       Revokes the share the grant row belongs to — every verb row of that
 *       principal on the object. Requires `resource.share` on the object.
 *     tags: [Grants]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Share revoked
 *       403:
 *         description: Caller can't manage this object's shares
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Grant not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
grantRouter.delete(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.application!.metadata;
      const result = await GrantService.revoke(
        ctx,
        req.params.id,
        auditContextFromRequest(req)
      );
      return HttpService.success(res, result);
    } catch (error) {
      return next(error);
    }
  }
);
