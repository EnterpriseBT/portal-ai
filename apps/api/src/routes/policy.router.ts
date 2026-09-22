/**
 * Custom RBAC policy authoring (#622) — the `/api/policies` surface. Thin
 * intake/validate/shape; all authorization (entitlement + capability + the
 * statement boundary) and system-immutability live in {@link PolicyService}.
 */

import { Router, Request, Response, NextFunction } from "express";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { PolicyService } from "../services/policy.service.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { auditContextFromRequest } from "../utils/audit-context.util.js";
import {
  PolicyUpsertRequestSchema,
  type PolicyResponse,
  type PolicyListResponse,
} from "@portalai/core/contracts";

export const policyRouter = Router();

/**
 * @openapi
 * /api/policies:
 *   get:
 *     summary: List the org's custom + system policies (#622)
 *     tags: [RBAC Authoring]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The org's policies
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PolicyListResponse'
 *       403:
 *         description: Not entitled to custom RBAC, or not an owner/admin
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *   post:
 *     summary: Create a custom policy (#622)
 *     description: >
 *       Authors a `kind:custom` policy + its statements. Requires the
 *       `customRbac` entitlement and the owner/admin capability; every `allow`
 *       is boundary-checked (`RBAC_POLICY_EXCEEDS_BOUNDARY`).
 *     tags: [RBAC Authoring]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PolicyUpsertRequest'
 *     responses:
 *       200:
 *         description: Policy created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PolicyResponse'
 *       400:
 *         description: Invalid payload
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       403:
 *         description: Not entitled / not owner-admin / statement exceeds boundary
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       409:
 *         description: A policy with that name already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
policyRouter.get(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const policies = await PolicyService.list(req.application!.metadata);
      return HttpService.success<PolicyListResponse>(res, { policies });
    } catch (error) {
      return next(error);
    }
  }
);

policyRouter.post(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = PolicyUpsertRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.ORGANIZATION_INVALID_PAYLOAD,
            "Invalid policy payload — expected { name, statements[≥1], description? }"
          )
        );
      }
      const policy = await PolicyService.create(
        req.application!.metadata,
        parsed.data,
        auditContextFromRequest(req)
      );
      return HttpService.success<PolicyResponse>(res, { policy });
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * @openapi
 * /api/policies/{id}:
 *   get:
 *     summary: Get one policy with its statements (#622)
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
 *         description: The policy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PolicyResponse'
 *       404:
 *         description: Policy not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *   put:
 *     summary: Update a custom policy + replace its statements (#622)
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
 *             $ref: '#/components/schemas/PolicyUpsertRequest'
 *     responses:
 *       200:
 *         description: Policy updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PolicyResponse'
 *       403:
 *         description: System policy is immutable / not entitled / exceeds boundary
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Policy not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *   delete:
 *     summary: Delete a custom policy (cascade-detaches it) (#622)
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
 *         description: Policy deleted
 *       403:
 *         description: System policy is immutable
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Policy not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
policyRouter.get(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const policy = await PolicyService.get(
        req.application!.metadata,
        req.params.id
      );
      return HttpService.success<PolicyResponse>(res, { policy });
    } catch (error) {
      return next(error);
    }
  }
);

policyRouter.put(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = PolicyUpsertRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.ORGANIZATION_INVALID_PAYLOAD,
            "Invalid policy payload — expected { name, statements[≥1], description? }"
          )
        );
      }
      const policy = await PolicyService.update(
        req.application!.metadata,
        req.params.id,
        parsed.data,
        auditContextFromRequest(req)
      );
      return HttpService.success<PolicyResponse>(res, { policy });
    } catch (error) {
      return next(error);
    }
  }
);

policyRouter.delete(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await PolicyService.remove(
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
