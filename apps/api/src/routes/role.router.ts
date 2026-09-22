/**
 * Custom RBAC role authoring (#622) — the `/api/roles` surface. Thin
 * intake/validate/shape; all authorization (entitlement + capability + the
 * bundle boundary) and system-immutability live in {@link RoleService}.
 */

import { Router, Request, Response, NextFunction } from "express";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { RoleService } from "../services/role.service.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { auditContextFromRequest } from "../utils/audit-context.util.js";
import {
  RoleUpsertRequestSchema,
  type RoleResponse,
  type RoleListResponse,
} from "@portalai/core/contracts";

export const roleRouter = Router();

/**
 * @openapi
 * /api/roles:
 *   get:
 *     summary: List the org's custom + system roles (#622)
 *     tags: [RBAC Authoring]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The org's roles
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RoleListResponse'
 *       403:
 *         description: Not entitled to custom RBAC, or not an owner/admin
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *   post:
 *     summary: Create a custom role bundling policies (#622)
 *     description: >
 *       Authors a `kind:custom` role + attaches the given policies. Requires the
 *       `customRbac` entitlement and the owner/admin capability; the union of
 *       the bundled policies' statements is boundary-checked
 *       (`RBAC_POLICY_EXCEEDS_BOUNDARY`).
 *     tags: [RBAC Authoring]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RoleUpsertRequest'
 *     responses:
 *       200:
 *         description: Role created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RoleResponse'
 *       400:
 *         description: Invalid payload
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       403:
 *         description: Not entitled / not owner-admin / bundle exceeds boundary
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       409:
 *         description: A role with that name already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
roleRouter.get(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const roles = await RoleService.list(req.application!.metadata);
      return HttpService.success<RoleListResponse>(res, { roles });
    } catch (error) {
      return next(error);
    }
  }
);

roleRouter.post(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = RoleUpsertRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.ORGANIZATION_INVALID_PAYLOAD,
            "Invalid role payload — expected { name, policyIds }"
          )
        );
      }
      const role = await RoleService.create(
        req.application!.metadata,
        parsed.data,
        auditContextFromRequest(req)
      );
      return HttpService.success<RoleResponse>(res, { role });
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * @openapi
 * /api/roles/{id}:
 *   get:
 *     summary: Get one role with its policy ids (#622)
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
 *         description: The role
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RoleResponse'
 *       404:
 *         description: Role not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *   put:
 *     summary: Update a custom role + re-set its policies (#622)
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
 *             $ref: '#/components/schemas/RoleUpsertRequest'
 *     responses:
 *       200:
 *         description: Role updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RoleResponse'
 *       403:
 *         description: System role is immutable / not entitled / exceeds boundary
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Role not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *   delete:
 *     summary: Delete a custom role (cascade-drops its assignments) (#622)
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
 *         description: Role deleted
 *       403:
 *         description: System role is immutable
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Role not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
roleRouter.get(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const role = await RoleService.get(
        req.application!.metadata,
        req.params.id
      );
      return HttpService.success<RoleResponse>(res, { role });
    } catch (error) {
      return next(error);
    }
  }
);

roleRouter.put(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = RoleUpsertRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.ORGANIZATION_INVALID_PAYLOAD,
            "Invalid role payload — expected { name, policyIds }"
          )
        );
      }
      const role = await RoleService.update(
        req.application!.metadata,
        req.params.id,
        parsed.data,
        auditContextFromRequest(req)
      );
      return HttpService.success<RoleResponse>(res, { role });
    } catch (error) {
      return next(error);
    }
  }
);

roleRouter.delete(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await RoleService.remove(
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
