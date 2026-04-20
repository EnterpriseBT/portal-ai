import { Router, Request, Response, NextFunction } from "express";

import { OrganizationToolModelFactory } from "@portalai/core/models";
import {
  OrganizationToolListRequestQuerySchema,
  CreateOrganizationToolBodySchema,
  UpdateOrganizationToolBodySchema,
  type OrganizationToolListResponsePayload,
  type OrganizationToolCreateResponsePayload,
  type OrganizationToolUpdateResponsePayload,
} from "@portalai/core/contracts";
import { createLogger } from "../utils/logger.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "../services/db.service.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";

const logger = createLogger({ module: "organization-tools" });

export const organizationToolsRouter = Router();

// ── GET /api/organization-tools ───────────────────────────────────────────

/**
 * @openapi
 * /api/organization-tools:
 *   get:
 *     tags:
 *       - Organization Tools
 *     summary: List organization tools
 *     description: Returns all custom webhook tools defined for the authenticated user's organization.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/limitParam'
 *       - $ref: '#/components/parameters/offsetParam'
 *     responses:
 *       200:
 *         description: Organization tools retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/OrganizationToolListResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
organizationToolsRouter.get(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { limit, offset } = OrganizationToolListRequestQuerySchema.parse(
        req.query
      );
      const { organizationId } = req.application!.metadata;

      const [data, total] = await Promise.all([
        DbService.repository.organizationTools.findByOrganizationId(
          organizationId,
          { limit, offset }
        ),
        DbService.repository.organizationTools.count(undefined as never),
      ]);

      return HttpService.success<OrganizationToolListResponsePayload>(res, {
        organizationTools:
          data as unknown as OrganizationToolListResponsePayload["organizationTools"],
        total,
        limit,
        offset,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to list organization tools"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ORG_TOOL_NOT_FOUND,
              "Failed to list organization tools"
            )
      );
    }
  }
);

// ── POST /api/organization-tools ──────────────────────────────────────────

/**
 * @openapi
 * /api/organization-tools:
 *   post:
 *     tags:
 *       - Organization Tools
 *     summary: Create an organization tool
 *     description: Defines a new custom webhook tool for the organization. Tool names must be unique within the org.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, parameterSchema, implementation]
 *             properties:
 *               name:
 *                 type: string
 *                 example: get_customer_ltv
 *               description:
 *                 type: string
 *                 nullable: true
 *               parameterSchema:
 *                 type: object
 *                 additionalProperties: true
 *                 description: JSON Schema object describing the tool's input parameters
 *               implementation:
 *                 type: object
 *                 required: [type, url]
 *                 properties:
 *                   type:
 *                     type: string
 *                     enum: [webhook]
 *                   url:
 *                     type: string
 *                     example: https://example.com/tool
 *                   headers:
 *                     type: object
 *                     additionalProperties:
 *                       type: string
 *     responses:
 *       201:
 *         description: Organization tool created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   type: object
 *                   properties:
 *                     organizationTool:
 *                       $ref: '#/components/schemas/OrganizationTool'
 *       400:
 *         description: Invalid payload
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       409:
 *         description: A tool with this name already exists in the organization
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
organizationToolsRouter.post(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = CreateOrganizationToolBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.ORG_TOOL_NOT_FOUND,
            "Invalid organization tool payload"
          )
        );
      }

      const { organizationId, userId } = req.application!.metadata;
      const { name, description, parameterSchema, implementation } =
        parsed.data;

      // Validate unique name within org
      const existing = await DbService.repository.organizationTools.findByName(
        organizationId,
        name
      );
      if (existing) {
        return next(
          new ApiError(
            409,
            ApiCode.ORG_TOOL_NAME_CONFLICT,
            "A tool with this name already exists in this organization"
          )
        );
      }

      const factory = new OrganizationToolModelFactory();
      const model = factory.create(userId);
      model.update({
        organizationId,
        name,
        description: description ?? null,
        parameterSchema,
        implementation,
      });

      const organizationTool =
        await DbService.repository.organizationTools.create(model.parse());

      logger.info(
        { id: organizationTool.id, organizationId },
        "Organization tool created"
      );

      return HttpService.success<OrganizationToolCreateResponsePayload>(
        res,
        {
          organizationTool:
            organizationTool as unknown as OrganizationToolCreateResponsePayload["organizationTool"],
        },
        201
      );
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to create organization tool"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ORG_TOOL_NOT_FOUND,
              "Failed to create organization tool"
            )
      );
    }
  }
);

// ── PATCH /api/organization-tools/:toolId ─────────────────────────────────

/**
 * @openapi
 * /api/organization-tools/{toolId}:
 *   patch:
 *     tags:
 *       - Organization Tools
 *     summary: Update an organization tool
 *     description: Updates tool fields. If renaming, the new name must be unique within the organization.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: toolId
 *         required: true
 *         schema:
 *           type: string
 *         description: Organization tool ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *                 nullable: true
 *               parameterSchema:
 *                 type: object
 *                 additionalProperties: true
 *               implementation:
 *                 type: object
 *                 properties:
 *                   type:
 *                     type: string
 *                     enum: [webhook]
 *                   url:
 *                     type: string
 *                   headers:
 *                     type: object
 *                     additionalProperties:
 *                       type: string
 *     responses:
 *       200:
 *         description: Organization tool updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   type: object
 *                   properties:
 *                     organizationTool:
 *                       $ref: '#/components/schemas/OrganizationTool'
 *       400:
 *         description: Invalid payload
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Organization tool not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       409:
 *         description: A tool with this name already exists in the organization
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
organizationToolsRouter.patch(
  "/:toolId",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { toolId } = req.params;
      const { organizationId, userId } = req.application!.metadata;

      const parsed = UpdateOrganizationToolBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.ORG_TOOL_NOT_FOUND,
            "Invalid organization tool payload"
          )
        );
      }

      const existing =
        await DbService.repository.organizationTools.findById(toolId);
      if (!existing || existing.organizationId !== organizationId) {
        return next(
          new ApiError(
            404,
            ApiCode.ORG_TOOL_NOT_FOUND,
            "Organization tool not found"
          )
        );
      }

      // If renaming, check for name conflict
      if (parsed.data.name && parsed.data.name !== existing.name) {
        const duplicate =
          await DbService.repository.organizationTools.findByName(
            organizationId,
            parsed.data.name
          );
        if (duplicate) {
          return next(
            new ApiError(
              409,
              ApiCode.ORG_TOOL_NAME_CONFLICT,
              "A tool with this name already exists in this organization"
            )
          );
        }
      }

      const updates: Record<string, unknown> = {
        updated: Date.now(),
        updatedBy: userId,
      };
      if (parsed.data.name !== undefined) updates.name = parsed.data.name;
      if (parsed.data.description !== undefined)
        updates.description = parsed.data.description;
      if (parsed.data.parameterSchema !== undefined)
        updates.parameterSchema = parsed.data.parameterSchema;
      if (parsed.data.implementation !== undefined)
        updates.implementation = parsed.data.implementation;

      const organizationTool =
        await DbService.repository.organizationTools.update(
          toolId,
          updates as never
        );

      logger.info({ toolId }, "Organization tool updated");

      return HttpService.success<OrganizationToolUpdateResponsePayload>(res, {
        organizationTool:
          organizationTool as unknown as OrganizationToolUpdateResponsePayload["organizationTool"],
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to update organization tool"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ORG_TOOL_NOT_FOUND,
              "Failed to update organization tool"
            )
      );
    }
  }
);

// ── DELETE /api/organization-tools/:toolId ────────────────────────────────

/**
 * @openapi
 * /api/organization-tools/{toolId}:
 *   delete:
 *     tags:
 *       - Organization Tools
 *     summary: Delete an organization tool
 *     description: Soft-deletes a custom organization tool.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: toolId
 *         required: true
 *         schema:
 *           type: string
 *         description: Organization tool ID
 *     responses:
 *       200:
 *         description: Organization tool deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *       404:
 *         description: Organization tool not found
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
organizationToolsRouter.delete(
  "/:toolId",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { toolId } = req.params;
      const { organizationId, userId } = req.application!.metadata;

      const existing =
        await DbService.repository.organizationTools.findById(toolId);
      if (!existing || existing.organizationId !== organizationId) {
        return next(
          new ApiError(
            404,
            ApiCode.ORG_TOOL_NOT_FOUND,
            "Organization tool not found"
          )
        );
      }

      await DbService.repository.organizationTools.softDelete(toolId, userId);
      logger.info({ toolId }, "Organization tool soft-deleted");

      return HttpService.success(res, { id: toolId });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to delete organization tool"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ORG_TOOL_NOT_FOUND,
              "Failed to delete organization tool"
            )
      );
    }
  }
);
