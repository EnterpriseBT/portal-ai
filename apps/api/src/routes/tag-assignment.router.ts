import { Router, Response, NextFunction } from "express";

import type { TagTargetType } from "@portalai/core/models";
import {
  EntityTagAssignmentCreateRequestBodySchema,
  type EntityTagAssignmentCreateResponsePayload,
  type EntityTagAssignmentListResponsePayload,
} from "@portalai/core/contracts";

import { ApiCode } from "../constants/api-codes.constants.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { TagAssignmentService } from "../services/tag-assignment.service.js";
import { createLogger } from "../utils/logger.util.js";
import { invalidPayload } from "../utils/zod-issue.util.js";

import type { Request } from "../types/request.js";

const logger = createLogger({ module: "tag-assignment" });

/**
 * Tag assignment routes for one taggable type (#1070), mounted under the
 * object's own router at `/:<idParam>/tags` (`mergeParams`, so the object id
 * is readable here). Every type answers the same way, through
 * {@link TagAssignmentService}:
 *
 * - `GET /` lists the tags the caller may read on the object;
 * - `POST /` `{ entityTagId }` assigns one (201), 409 when already there;
 * - `DELETE /:assignmentId` removes one.
 *
 * A missing or unreadable object is its own 404, a read-only one 403.
 */
export function createTagAssignmentRouter(
  type: TagTargetType,
  idParam: string
): Router {
  const router = Router({ mergeParams: true });
  const target = (req: Request) => ({ type, id: req.params[idParam]! });
  const fail = (code: ApiCode, fallback: string) => (error: unknown) =>
    error instanceof ApiError
      ? error
      : new ApiError(
          500,
          code,
          error instanceof Error ? error.message : fallback
        );

  router.get(
    "/",
    getApplicationMetadata,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tags = await TagAssignmentService.list(
          req.application!.metadata,
          target(req)
        );
        return HttpService.success<EntityTagAssignmentListResponsePayload>(
          res,
          { tags: tags as EntityTagAssignmentListResponsePayload["tags"] }
        );
      } catch (error) {
        logger.error({ error, type }, "Failed to list tag assignments");
        return next(
          fail(
            ApiCode.ENTITY_TAG_ASSIGNMENT_FETCH_FAILED,
            "Failed to list tag assignments"
          )(error)
        );
      }
    }
  );

  router.post(
    "/",
    getApplicationMetadata,
    async (req: Request, res: Response, next: NextFunction) => {
      const parsed = EntityTagAssignmentCreateRequestBodySchema.safeParse(
        req.body
      );
      if (!parsed.success) {
        return next(
          invalidPayload(
            ApiCode.ENTITY_TAG_ASSIGNMENT_INVALID_PAYLOAD,
            "Invalid tag assignment payload",
            parsed.error
          )
        );
      }
      try {
        const { assignment, created } = await TagAssignmentService.assign(
          req.application!.metadata,
          target(req),
          parsed.data.entityTagId
        );
        if (!created) {
          return next(
            new ApiError(
              409,
              ApiCode.ENTITY_TAG_ASSIGNMENT_ALREADY_EXISTS,
              "This tag is already assigned here"
            )
          );
        }
        return HttpService.success<EntityTagAssignmentCreateResponsePayload>(
          res,
          { entityTagAssignment: assignment },
          201
        );
      } catch (error) {
        logger.error({ error, type }, "Failed to assign tag");
        return next(
          fail(
            ApiCode.ENTITY_TAG_ASSIGNMENT_CREATE_FAILED,
            "Failed to assign tag"
          )(error)
        );
      }
    }
  );

  router.delete(
    "/:assignmentId",
    getApplicationMetadata,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { assignmentId } = req.params;
        await TagAssignmentService.unassign(
          req.application!.metadata,
          target(req),
          assignmentId!
        );
        return HttpService.success(res, { id: assignmentId });
      } catch (error) {
        logger.error({ error, type }, "Failed to remove tag assignment");
        return next(
          fail(
            ApiCode.ENTITY_TAG_ASSIGNMENT_DELETE_FAILED,
            "Failed to remove tag"
          )(error)
        );
      }
    }
  );

  return router;
}

/**
 * @openapi
 * /api/connector-entities/{connectorEntityId}/tags:
 *   get:
 *     tags:
 *       - Tag Assignments
 *     summary: List the tags on a connector entity
 *     description: Only tags the caller may read. The connector entity must be readable (404 otherwise).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: connectorEntityId
 *         required: true
 *         schema:
 *           type: string
 *         description: The connector entity's id
 *     responses:
 *       200:
 *         description: The connector entity's tags
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/EntityTagAssignmentListResponsePayload'
 *       404:
 *         description: The connector entity doesn't exist or the caller can't read it
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *   post:
 *     tags:
 *       - Tag Assignments
 *     summary: Put a tag on a connector entity
 *     description: Needs write on the connector entity; the tag must be readable in the org.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: connectorEntityId
 *         required: true
 *         schema:
 *           type: string
 *         description: The connector entity's id
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/EntityTagAssignmentCreateRequestBody'
 *     responses:
 *       201:
 *         description: Tag assigned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/EntityTagAssignmentCreateResponsePayload'
 *       400:
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       403:
 *         description: The caller can read the connector entity but not change it
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: The connector entity or the tag doesn't exist or isn't readable
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       409:
 *         description: The connector entity already carries this tag
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 * /api/connector-entities/{connectorEntityId}/tags/{assignmentId}:
 *   delete:
 *     tags:
 *       - Tag Assignments
 *     summary: Take a tag off a connector entity
 *     description: Needs write on the connector entity; the assignment must be on it.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: connectorEntityId
 *         required: true
 *         schema:
 *           type: string
 *         description: The connector entity's id
 *       - in: path
 *         name: assignmentId
 *         required: true
 *         schema:
 *           type: string
 *         description: The tag assignment's id
 *     responses:
 *       200:
 *         description: Tag removed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/TagAssignmentDeleteResponsePayload'
 *       403:
 *         description: The caller can read the connector entity but not change it
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: The connector entity or the assignment doesn't exist
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
