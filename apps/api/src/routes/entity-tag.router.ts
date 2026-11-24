import { Router, Response, NextFunction } from "express";

import {
  EntityTagListRequestQuerySchema,
  type EntityTagListResponsePayload,
  type EntityTagGetResponsePayload,
  EntityTagCreateRequestBodySchema,
  type EntityTagCreateResponsePayload,
  EntityTagUpdateRequestBodySchema,
  type EntityTagUpdateResponsePayload,
} from "@portalai/core/contracts";
import { createLogger } from "../utils/logger.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { invalidPayload } from "../utils/zod-issue.util.js";
import { DbService } from "../services/db.service.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { PermissionService } from "../services/permission.service.js";
import { ObjectCapabilitiesService } from "../services/object-capabilities.service.js";
import { EntityTagService } from "../services/entity-tag.service.js";
import type { Request } from "../types/request.js";

const logger = createLogger({ module: "entity-tag" });

export const entityTagRouter = Router();

/**
 * @openapi
 * /api/entity-tags:
 *   get:
 *     tags:
 *       - Entity Tags
 *     summary: List entity tags
 *     description: Returns a paginated, searchable, and sortable list of entity tags scoped to the authenticated user's organization.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/limitParam'
 *       - $ref: '#/components/parameters/offsetParam'
 *       - $ref: '#/components/parameters/sortOrderParam'
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Case-insensitive search on tag name or description
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [name, created]
 *           default: created
 *         description: Field to sort by
 *       - { in: query, name: include, required: false, schema: { type: string }, description: "`usage` adds each tag's per-type counts (entity, station, pin, connector_instance, curated_view), over the objects the caller can read (#1070)." }
 *     responses:
 *       200:
 *         description: Paginated list of entity tags
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/EntityTagListResponse'
 *       400:
 *         description: Malformed query, e.g. limit, offset or sortOrder (ENTITY_TAG_INVALID_QUERY)
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
entityTagRouter.get(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    // #756: a malformed query is a 400 naming the field, not a 500.
    const parsedQuery = EntityTagListRequestQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return next(
        invalidPayload(
          ApiCode.ENTITY_TAG_INVALID_QUERY,
          "Invalid entity tag list query",
          parsedQuery.error
        )
      );
    }
    try {
      const { limit, offset, sortBy, sortOrder, search, include } =
        parsedQuery.data;
      const { entityTags: rows, total } = await EntityTagService.list(
        req.application!.metadata,
        {
          search,
          limit,
          offset,
          sortBy,
          sortOrder,
          // #1070: with include=usage, each tag's per-type counts over the
          // objects the caller can read.
          includeUsage: (include ?? "")
            .split(",")
            .map((s) => s.trim())
            .includes("usage"),
        }
      );

      return HttpService.success<EntityTagListResponsePayload>(res, {
        entityTags: rows,
        total,
        limit,
        offset,
      });
    } catch (error) {
      logger.error({ error }, "Failed to list entity tags");
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ENTITY_TAG_FETCH_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to list entity tags"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/entity-tags/{id}:
 *   get:
 *     tags:
 *       - Entity Tags
 *     summary: Get an entity tag by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity tag ID
 *     responses:
 *       200:
 *         description: Entity tag found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/EntityTagGetResponsePayload'
 *       404:
 *         description: Entity tag not found
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
entityTagRouter.get(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      logger.info({ id }, "GET /api/entity-tags/:id called");

      const entityTag = await DbService.repository.entityTags
        .findById(id)
        .catch((error) => {
          if (error instanceof ApiError) throw error;
          throw new ApiError(
            500,
            ApiCode.ENTITY_TAG_FETCH_FAILED,
            error instanceof Error
              ? error.message
              : "Failed to fetch entity tag"
          );
        });

      const ctx = req.application!.metadata;
      if (!entityTag || entityTag.organizationId !== ctx.organizationId) {
        return next(
          new ApiError(
            404,
            ApiCode.ENTITY_TAG_NOT_FOUND,
            "Entity tag not found"
          )
        );
      }
      // #630: an unreadable tag is indistinguishable from absent (404).
      const set = await PermissionService.loadSet(ctx);
      if (
        !set.can("resource.read", {
          type: "tag",
          id,
          createdBy: entityTag.createdBy,
        })
      ) {
        return next(
          new ApiError(
            404,
            ApiCode.ENTITY_TAG_NOT_FOUND,
            "Entity tag not found"
          )
        );
      }

      return HttpService.success<EntityTagGetResponsePayload>(res, {
        entityTag: {
          ...entityTag,
          capabilities: ObjectCapabilitiesService.for(set, "tag", entityTag),
        } as unknown as EntityTagGetResponsePayload["entityTag"],
      });
    } catch (error) {
      logger.error({ error }, "Failed to fetch entity tag");
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ENTITY_TAG_FETCH_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to fetch entity tag"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/entity-tags:
 *   post:
 *     tags:
 *       - Entity Tags
 *     summary: Create an entity tag
 *     description: Creates a new entity tag scoped to the authenticated user's organization. Tag names must be unique within the organization.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 1
 *               color:
 *                 type: [string, "null"]
 *               description:
 *                 type: [string, "null"]
 *     responses:
 *       403:
 *         description: The caller lacks permission for this change (#685)
 *       201:
 *         description: Entity tag created
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
 *                     entityTag:
 *                       $ref: '#/components/schemas/EntityTag'
 *       400:
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       409:
 *         description: Tag name already exists in this organization
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
entityTagRouter.post(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = EntityTagCreateRequestBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          invalidPayload(
            ApiCode.ENTITY_TAG_INVALID_PAYLOAD,
            "Invalid entity tag payload",
            parsed.error
          )
        );
      }

      const entityTag = await EntityTagService.create(
        req.application!.metadata,
        parsed.data
      );

      return HttpService.success<EntityTagCreateResponsePayload>(
        res,
        {
          entityTag:
            entityTag as unknown as EntityTagCreateResponsePayload["entityTag"],
        },
        201
      );
    } catch (error) {
      logger.error({ error }, "Failed to create entity tag");
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ENTITY_TAG_CREATE_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to create entity tag"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/entity-tags/{id}:
 *   patch:
 *     tags:
 *       - Entity Tags
 *     summary: Update an entity tag
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity tag ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 1
 *               color:
 *                 type: [string, "null"]
 *               description:
 *                 type: [string, "null"]
 *     responses:
 *       200:
 *         description: Entity tag updated
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
 *                     entityTag:
 *                       $ref: '#/components/schemas/EntityTag'
 *       400:
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Entity tag not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       409:
 *         description: Tag name already exists in this organization
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
entityTagRouter.patch(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const parsed = EntityTagUpdateRequestBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          invalidPayload(
            ApiCode.ENTITY_TAG_INVALID_PAYLOAD,
            "Invalid entity tag payload",
            parsed.error
          )
        );
      }

      const entityTag = await EntityTagService.update(
        req.application!.metadata,
        id,
        parsed.data
      );

      return HttpService.success<EntityTagUpdateResponsePayload>(res, {
        entityTag:
          entityTag as unknown as EntityTagUpdateResponsePayload["entityTag"],
      });
    } catch (error) {
      logger.error({ error }, "Failed to update entity tag");
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ENTITY_TAG_UPDATE_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to update entity tag"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/entity-tags/{id}:
 *   delete:
 *     tags:
 *       - Entity Tags
 *     summary: Delete an entity tag
 *     description: Soft-deletes an entity tag and all its assignments.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity tag ID
 *     responses:
 *       200:
 *         description: Entity tag deleted
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
 *         description: Entity tag not found
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
entityTagRouter.delete(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      await EntityTagService.delete(req.application!.metadata, id);

      return HttpService.success(res, { id });
    } catch (error) {
      logger.error({ error }, "Failed to delete entity tag");
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ENTITY_TAG_DELETE_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to delete entity tag"
            )
      );
    }
  }
);
