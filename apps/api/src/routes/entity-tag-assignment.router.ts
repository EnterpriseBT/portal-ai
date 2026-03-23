import { Router, Request, Response, NextFunction } from "express";

import { EntityTagAssignmentModelFactory } from "@portalai/core/models";
import {
  EntityTagAssignmentCreateRequestBodySchema,
  type EntityTagAssignmentCreateResponsePayload,
  type EntityTagAssignmentListResponsePayload,
} from "@portalai/core/contracts";
import { createLogger } from "../utils/logger.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "../services/db.service.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";

const logger = createLogger({ module: "entity-tag-assignment" });

/**
 * This router is mounted under /connector-entities/:connectorEntityId/tags.
 * Express mergeParams is required so `:connectorEntityId` is accessible here.
 */
export const entityTagAssignmentRouter = Router({ mergeParams: true });

/**
 * @openapi
 * /api/connector-entities/{connectorEntityId}/tags:
 *   get:
 *     tags:
 *       - Entity Tag Assignments
 *     summary: List tags assigned to a connector entity
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: connectorEntityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Connector entity ID
 *     responses:
 *       200:
 *         description: List of tags assigned to the connector entity
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
 *                     tags:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/EntityTag'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
entityTagAssignmentRouter.get(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { connectorEntityId } = req.params;
      logger.info({ connectorEntityId }, "GET /connector-entities/:connectorEntityId/tags called");

      const enrichedAssignments = await DbService.repository.entityTagAssignments
        .findByConnectorEntityId(connectorEntityId)
        .catch((error) => {
          if (error instanceof ApiError) throw error;
          throw new ApiError(500, ApiCode.ENTITY_TAG_ASSIGNMENT_FETCH_FAILED, error instanceof Error ? error.message : "Failed to list entity tag assignments");
        });

      const tags = enrichedAssignments.map((a) => a.tag);

      return HttpService.success<EntityTagAssignmentListResponsePayload>(res, {
        tags: tags as unknown as EntityTagAssignmentListResponsePayload["tags"],
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to list entity tag assignments"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.ENTITY_TAG_ASSIGNMENT_FETCH_FAILED, error instanceof Error ? error.message : "Failed to list entity tag assignments"));
    }
  }
);

/**
 * @openapi
 * /api/connector-entities/{connectorEntityId}/tags:
 *   post:
 *     tags:
 *       - Entity Tag Assignments
 *     summary: Assign a tag to a connector entity
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: connectorEntityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Connector entity ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - entityTagId
 *             properties:
 *               entityTagId:
 *                 type: string
 *     responses:
 *       201:
 *         description: Tag assigned successfully
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
 *                     entityTagAssignment:
 *                       $ref: '#/components/schemas/EntityTagAssignment'
 *       400:
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Connector entity or entity tag not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       409:
 *         description: Tag already assigned to this entity
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
entityTagAssignmentRouter.post(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { connectorEntityId } = req.params;
      const parsed = EntityTagAssignmentCreateRequestBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(new ApiError(400, ApiCode.ENTITY_TAG_ASSIGNMENT_CREATE_FAILED, "Invalid entity tag assignment payload"));
      }

      const { organizationId, userId } = req.application!.metadata;

      // Verify connector entity exists and belongs to org
      const connectorEntity = await DbService.repository.connectorEntities.findById(connectorEntityId);
      if (!connectorEntity || connectorEntity.organizationId !== organizationId) {
        return next(new ApiError(404, ApiCode.CONNECTOR_ENTITY_NOT_FOUND, "Connector entity not found"));
      }

      // Verify tag exists and belongs to same org
      const entityTag = await DbService.repository.entityTags.findById(parsed.data.entityTagId);
      if (!entityTag || entityTag.organizationId !== organizationId) {
        return next(new ApiError(404, ApiCode.ENTITY_TAG_NOT_FOUND, "Entity tag not found"));
      }

      // Check for duplicate assignment
      const existing = await DbService.repository.entityTagAssignments.findExisting(
        connectorEntityId,
        parsed.data.entityTagId
      );
      if (existing) {
        return next(new ApiError(409, ApiCode.ENTITY_TAG_ASSIGNMENT_ALREADY_EXISTS, "This tag is already assigned to this entity"));
      }

      const factory = new EntityTagAssignmentModelFactory();
      const model = factory.create(userId);
      model.update({
        organizationId,
        connectorEntityId,
        entityTagId: parsed.data.entityTagId,
      });

      const entityTagAssignment = await DbService.repository.entityTagAssignments.create(
        model.parse()
      ).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.ENTITY_TAG_ASSIGNMENT_CREATE_FAILED, error instanceof Error ? error.message : "Failed to create entity tag assignment");
      });

      logger.info({ id: entityTagAssignment.id, connectorEntityId, entityTagId: parsed.data.entityTagId }, "Entity tag assignment created");

      return HttpService.success<EntityTagAssignmentCreateResponsePayload>(
        res,
        { entityTagAssignment: entityTagAssignment as unknown as EntityTagAssignmentCreateResponsePayload["entityTagAssignment"] },
        201
      );
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to create entity tag assignment"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.ENTITY_TAG_ASSIGNMENT_CREATE_FAILED, error instanceof Error ? error.message : "Failed to create entity tag assignment"));
    }
  }
);

/**
 * @openapi
 * /api/connector-entities/{connectorEntityId}/tags/{assignmentId}:
 *   delete:
 *     tags:
 *       - Entity Tag Assignments
 *     summary: Remove a tag assignment from a connector entity
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: connectorEntityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Connector entity ID
 *       - in: path
 *         name: assignmentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity tag assignment ID
 *     responses:
 *       200:
 *         description: Tag assignment removed
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
 *         description: Entity tag assignment not found
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
entityTagAssignmentRouter.delete(
  "/:assignmentId",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { assignmentId } = req.params;

      const existing = await DbService.repository.entityTagAssignments.findById(assignmentId);
      if (!existing) {
        return next(new ApiError(404, ApiCode.ENTITY_TAG_ASSIGNMENT_NOT_FOUND, "Entity tag assignment not found"));
      }

      const { userId } = req.application!.metadata;

      await DbService.repository.entityTagAssignments.softDelete(assignmentId, userId).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.ENTITY_TAG_ASSIGNMENT_DELETE_FAILED, error instanceof Error ? error.message : "Failed to delete entity tag assignment");
      });

      logger.info({ assignmentId }, "Entity tag assignment soft-deleted");

      return HttpService.success(res, { id: assignmentId });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to delete entity tag assignment"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.ENTITY_TAG_ASSIGNMENT_DELETE_FAILED, error instanceof Error ? error.message : "Failed to delete entity tag assignment"));
    }
  }
);
