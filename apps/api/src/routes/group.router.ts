/**
 * Custom RBAC group authoring (#622) — the `/api/groups` surface: CRUD +
 * group-centric membership. All authorization (entitlement + capability + the
 * bundle boundary + member validation) lives in {@link GroupService}.
 */

import { Router, Request, Response, NextFunction } from "express";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { GroupService } from "../services/group.service.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { auditContextFromRequest } from "../utils/audit-context.util.js";
import {
  GroupUpsertRequestSchema,
  GroupMembersSetRequestSchema,
  type GroupResponse,
  type GroupListResponse,
  type GroupMembersResponse,
} from "@portalai/core/contracts";

export const groupRouter = Router();

/**
 * @openapi
 * /api/groups:
 *   get:
 *     summary: List the org's groups (#622)
 *     tags: [RBAC Authoring]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The org's groups
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GroupListResponse'
 *       403:
 *         description: Not entitled to custom RBAC, or not an owner/admin
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *   post:
 *     summary: Create a group bundling policies (#622)
 *     tags: [RBAC Authoring]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GroupUpsertRequest'
 *     responses:
 *       200:
 *         description: Group created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GroupResponse'
 *       403:
 *         description: Not entitled / not owner-admin / bundle exceeds boundary
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       409:
 *         description: A group with that name already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
groupRouter.get(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const groups = await GroupService.list(req.application!.metadata);
      return HttpService.success<GroupListResponse>(res, { groups });
    } catch (error) {
      return next(error);
    }
  }
);

groupRouter.post(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = GroupUpsertRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.ORGANIZATION_INVALID_PAYLOAD,
            "Invalid group payload — expected { name, policyIds, description? }"
          )
        );
      }
      const group = await GroupService.create(
        req.application!.metadata,
        parsed.data,
        auditContextFromRequest(req)
      );
      return HttpService.success<GroupResponse>(res, { group });
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * @openapi
 * /api/groups/{id}:
 *   get:
 *     summary: Get one group (#622)
 *     tags: [RBAC Authoring]
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
 *         description: The group
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GroupResponse'
 *       404:
 *         description: Group not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *   put:
 *     summary: Update a group + re-set its policies (#622)
 *     tags: [RBAC Authoring]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GroupUpsertRequest'
 *     responses:
 *       200:
 *         description: Group updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GroupResponse'
 *       404:
 *         description: Group not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *   delete:
 *     summary: Delete a group (cascade-drops memberships + attachments) (#622)
 *     tags: [RBAC Authoring]
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
 *         description: Group deleted
 *       404:
 *         description: Group not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
groupRouter.get(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const group = await GroupService.get(
        req.application!.metadata,
        req.params.id
      );
      return HttpService.success<GroupResponse>(res, { group });
    } catch (error) {
      return next(error);
    }
  }
);

groupRouter.put(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = GroupUpsertRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.ORGANIZATION_INVALID_PAYLOAD,
            "Invalid group payload — expected { name, policyIds, description? }"
          )
        );
      }
      const group = await GroupService.update(
        req.application!.metadata,
        req.params.id,
        parsed.data,
        auditContextFromRequest(req)
      );
      return HttpService.success<GroupResponse>(res, { group });
    } catch (error) {
      return next(error);
    }
  }
);

groupRouter.delete(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await GroupService.remove(
        req.application!.metadata,
        req.params.id,
        auditContextFromRequest(req)
      );
      return HttpService.success(res, result);
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * @openapi
 * /api/groups/{id}/members:
 *   put:
 *     summary: Set a group's membership (group-centric, #622)
 *     tags: [RBAC Authoring]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GroupMembersSetRequest'
 *     responses:
 *       200:
 *         description: Membership set
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GroupResponse'
 *       400:
 *         description: A named user is not an org member
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Group not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
groupRouter.put(
  "/:id/members",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = GroupMembersSetRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.ORGANIZATION_INVALID_PAYLOAD,
            "Invalid membership payload — expected { userIds }"
          )
        );
      }
      const group = await GroupService.setMembers(
        req.application!.metadata,
        req.params.id,
        parsed.data.userIds,
        auditContextFromRequest(req)
      );
      return HttpService.success<GroupResponse>(res, { group });
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * @openapi
 * /api/groups/{id}/members:
 *   get:
 *     summary: List a group's member ids (#637)
 *     description: >
 *       The group's active member user ids. Gated by the normal members-read
 *       permission — org membership only (not the customRbac authoring gate) —
 *       and org-scoped to the group.
 *     tags: [RBAC Authoring]
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
 *         description: The group's member user ids
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GroupMembersResponse'
 *       404:
 *         description: Group not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
groupRouter.get(
  "/:id/members",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userIds = await GroupService.listMembers(
        req.application!.metadata,
        req.params.id
      );
      return HttpService.success<GroupMembersResponse>(res, { userIds });
    } catch (error) {
      return next(error);
    }
  }
);
