import { Router, Request, Response, NextFunction } from "express";
import { eq, and, ilike, type SQL, type Column } from "drizzle-orm";

import { EntityTagModelFactory } from "@portalai/core/models";
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
import { DbService } from "../services/db.service.js";
import { entityTags } from "../db/schema/index.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";

const logger = createLogger({ module: "entity-tag" });

export const entityTagRouter = Router();

/** Map of sortable field names to their Drizzle columns. */
const SORTABLE_COLUMNS: Record<string, Column> = {
  name: entityTags.name,
  created: entityTags.created,
};

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
 *         description: Case-insensitive search on tag name
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [name, created]
 *           default: created
 *         description: Field to sort by
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
 *                   type: object
 *                   properties:
 *                     entityTags:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/EntityTag'
 *                     total:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     offset:
 *                       type: integer
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
    try {
      const { limit, offset, sortBy, sortOrder, search } =
        EntityTagListRequestQuerySchema.parse(req.query);

      const organizationId = req.application!.metadata.organizationId;
      const filters: SQL[] = [eq(entityTags.organizationId, organizationId)];

      if (search) {
        filters.push(ilike(entityTags.name, `%${search}%`));
      }

      const where = and(...filters);
      const column = SORTABLE_COLUMNS[sortBy] ?? SORTABLE_COLUMNS.created;
      const listOpts = { limit, offset, orderBy: { column, direction: sortOrder } };

      const [data, total] = await Promise.all([
        DbService.repository.entityTags.findMany(where, listOpts),
        DbService.repository.entityTags.count(where),
      ]).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.ENTITY_TAG_FETCH_FAILED, error instanceof Error ? error.message : "Failed to list entity tags");
      });

      return HttpService.success<EntityTagListResponsePayload>(res, {
        entityTags: data as unknown as EntityTagListResponsePayload["entityTags"],
        total,
        limit,
        offset,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to list entity tags"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.ENTITY_TAG_FETCH_FAILED, error instanceof Error ? error.message : "Failed to list entity tags"));
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
 *                   type: object
 *                   properties:
 *                     entityTag:
 *                       $ref: '#/components/schemas/EntityTag'
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

      const entityTag = await DbService.repository.entityTags.findById(id).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.ENTITY_TAG_FETCH_FAILED, error instanceof Error ? error.message : "Failed to fetch entity tag");
      });

      if (!entityTag) {
        return next(new ApiError(404, ApiCode.ENTITY_TAG_NOT_FOUND, "Entity tag not found"));
      }

      return HttpService.success<EntityTagGetResponsePayload>(res, {
        entityTag: entityTag as unknown as EntityTagGetResponsePayload["entityTag"],
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to fetch entity tag"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.ENTITY_TAG_FETCH_FAILED, error instanceof Error ? error.message : "Failed to fetch entity tag"));
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
 *                 type: string
 *                 nullable: true
 *               description:
 *                 type: string
 *                 nullable: true
 *     responses:
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
        return next(new ApiError(400, ApiCode.ENTITY_TAG_INVALID_PAYLOAD, "Invalid entity tag payload"));
      }

      const { organizationId, userId } = req.application!.metadata;

      const duplicate = await DbService.repository.entityTags.findByName(organizationId, parsed.data.name);
      if (duplicate) {
        return next(new ApiError(409, ApiCode.ENTITY_TAG_DUPLICATE_NAME, "An entity tag with this name already exists in this organization"));
      }

      const factory = new EntityTagModelFactory();
      const model = factory.create(userId);
      model.update({
        organizationId,
        name: parsed.data.name,
        color: parsed.data.color ?? null,
        description: parsed.data.description ?? null,
      });

      const entityTag = await DbService.repository.entityTags.create(
        model.parse()
      ).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.ENTITY_TAG_CREATE_FAILED, error instanceof Error ? error.message : "Failed to create entity tag");
      });

      logger.info({ id: entityTag.id, organizationId }, "Entity tag created");

      return HttpService.success<EntityTagCreateResponsePayload>(
        res,
        { entityTag: entityTag as unknown as EntityTagCreateResponsePayload["entityTag"] },
        201
      );
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to create entity tag"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.ENTITY_TAG_CREATE_FAILED, error instanceof Error ? error.message : "Failed to create entity tag"));
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
 *                 type: string
 *                 nullable: true
 *               description:
 *                 type: string
 *                 nullable: true
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
        return next(new ApiError(400, ApiCode.ENTITY_TAG_INVALID_PAYLOAD, "Invalid entity tag payload"));
      }

      const existing = await DbService.repository.entityTags.findById(id);
      if (!existing) {
        return next(new ApiError(404, ApiCode.ENTITY_TAG_NOT_FOUND, "Entity tag not found"));
      }

      if (parsed.data.name && parsed.data.name !== existing.name) {
        const duplicate = await DbService.repository.entityTags.findByName(existing.organizationId, parsed.data.name);
        if (duplicate) {
          return next(new ApiError(409, ApiCode.ENTITY_TAG_DUPLICATE_NAME, "An entity tag with this name already exists in this organization"));
        }
      }

      const { userId } = req.application!.metadata;

      const entityTag = await DbService.repository.entityTags.update(id, {
        ...parsed.data,
        updated: Date.now(),
        updatedBy: userId,
      } as never).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.ENTITY_TAG_UPDATE_FAILED, error instanceof Error ? error.message : "Failed to update entity tag");
      });

      logger.info({ id }, "Entity tag updated");

      return HttpService.success<EntityTagUpdateResponsePayload>(res, {
        entityTag: entityTag as unknown as EntityTagUpdateResponsePayload["entityTag"],
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to update entity tag"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.ENTITY_TAG_UPDATE_FAILED, error instanceof Error ? error.message : "Failed to update entity tag"));
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

      const existing = await DbService.repository.entityTags.findById(id);
      if (!existing) {
        return next(new ApiError(404, ApiCode.ENTITY_TAG_NOT_FOUND, "Entity tag not found"));
      }

      const { userId } = req.application!.metadata;

      await DbService.transaction(async (tx) => {
        const assignments = await DbService.repository.entityTagAssignments.findByEntityTagId(id, tx);
        const assignmentIds = assignments.map((a) => a.id);
        if (assignmentIds.length > 0) {
          await DbService.repository.entityTagAssignments.softDeleteMany(assignmentIds, userId, tx);
        }
        await DbService.repository.entityTags.softDelete(id, userId, tx);
      }).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.ENTITY_TAG_DELETE_FAILED, error instanceof Error ? error.message : "Failed to delete entity tag");
      });

      logger.info({ id }, "Entity tag soft-deleted");

      return HttpService.success(res, { id });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to delete entity tag"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.ENTITY_TAG_DELETE_FAILED, error instanceof Error ? error.message : "Failed to delete entity tag"));
    }
  }
);
