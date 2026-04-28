import { Router, Request, Response, NextFunction } from "express";
import {
  eq,
  and,
  or,
  ilike,
  inArray,
  sql,
  type SQL,
  type Column,
} from "drizzle-orm";

import { EntityGroupModelFactory } from "@portalai/core/models";
import {
  EntityGroupListRequestQuerySchema,
  type EntityGroupListResponsePayload,
  type EntityGroupGetResponsePayload,
  EntityGroupCreateRequestBodySchema,
  type EntityGroupCreateResponsePayload,
  EntityGroupUpdateRequestBodySchema,
  type EntityGroupUpdateResponsePayload,
  type EntityGroupDeleteResponsePayload,
  type EntityGroupImpactResponsePayload,
} from "@portalai/core/contracts";
import {
  EntityGroupResolveRequestQuerySchema,
  type EntityGroupResolveResponsePayload,
} from "@portalai/core/contracts";
import { createLogger } from "../utils/logger.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "../services/db.service.js";
import { entityGroups } from "../db/schema/index.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { entityGroupMemberRouter } from "./entity-group-member.router.js";

const logger = createLogger({ module: "entity-group" });

export const entityGroupRouter = Router();

// Mount nested member router
entityGroupRouter.use("/:entityGroupId/members", entityGroupMemberRouter);

/** Map of sortable field names to their Drizzle columns. */
const SORTABLE_COLUMNS: Record<string, Column> = {
  name: entityGroups.name,
  created: entityGroups.created,
};

/**
 * @openapi
 * /api/entity-groups:
 *   get:
 *     tags:
 *       - Entity Groups
 *     summary: List entity groups
 *     description: Returns a paginated, searchable, and sortable list of entity groups scoped to the authenticated user's organization.
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
 *         description: Case-insensitive search on group name
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [name, created]
 *           default: created
 *         description: Field to sort by
 *       - in: query
 *         name: include
 *         schema:
 *           type: string
 *         description: Comma-separated list of related data to include — memberCount
 *     responses:
 *       200:
 *         description: Paginated list of entity groups
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
 *                     entityGroups:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/EntityGroup'
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
entityGroupRouter.get(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        limit,
        offset,
        sortBy,
        sortOrder,
        search,
        include,
        connectorEntityId,
      } = EntityGroupListRequestQuerySchema.parse(req.query);

      const organizationId = req.application!.metadata.organizationId;
      const filters: SQL[] = [eq(entityGroups.organizationId, organizationId)];

      if (search) {
        filters.push(
          or(
            ilike(entityGroups.name, `%${search}%`),
            ilike(entityGroups.description, `%${search}%`)
          )!
        );
      }

      if (connectorEntityId) {
        const memberRows =
          await DbService.repository.entityGroupMembers.findByConnectorEntityId(
            connectorEntityId
          );
        const groupIds = [...new Set(memberRows.map((m) => m.entityGroupId))];
        // inArray requires a non-empty array; use sql`false` to match nothing when empty
        filters.push(
          groupIds.length > 0 ? inArray(entityGroups.id, groupIds) : sql`false`
        );
      }

      const where = and(...filters);
      const column = SORTABLE_COLUMNS[sortBy] ?? SORTABLE_COLUMNS.created;
      const include_ = include
        ?.split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const listOpts = {
        limit,
        offset,
        orderBy: { column, direction: sortOrder },
        include: include_,
      };

      const [data, total] = await Promise.all([
        DbService.repository.entityGroups.findMany(where, listOpts),
        DbService.repository.entityGroups.count(where),
      ]).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(
          500,
          ApiCode.ENTITY_GROUP_FETCH_FAILED,
          error instanceof Error
            ? error.message
            : "Failed to list entity groups"
        );
      });

      return HttpService.success<EntityGroupListResponsePayload>(res, {
        entityGroups:
          data as unknown as EntityGroupListResponsePayload["entityGroups"],
        total,
        limit,
        offset,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to list entity groups"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ENTITY_GROUP_FETCH_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to list entity groups"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/entity-groups/{id}:
 *   get:
 *     tags:
 *       - Entity Groups
 *     summary: Get an entity group by ID
 *     description: Returns the entity group with its members enriched with connector entity labels and field mapping source fields.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity group ID
 *     responses:
 *       200:
 *         description: Entity group found
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
 *                     entityGroup:
 *                       $ref: '#/components/schemas/EntityGroupWithMembers'
 *       404:
 *         description: Entity group not found
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
entityGroupRouter.get(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      logger.info({ id }, "GET /api/entity-groups/:id called");

      const entityGroup = await DbService.repository.entityGroups
        .findById(id)
        .catch((error) => {
          if (error instanceof ApiError) throw error;
          throw new ApiError(
            500,
            ApiCode.ENTITY_GROUP_FETCH_FAILED,
            error instanceof Error
              ? error.message
              : "Failed to fetch entity group"
          );
        });

      if (!entityGroup) {
        return next(
          new ApiError(
            404,
            ApiCode.ENTITY_GROUP_NOT_FOUND,
            "Entity group not found"
          )
        );
      }

      const enrichedMembers =
        await DbService.repository.entityGroupMembers.findByEntityGroupId(id, {
          include: ["connectorEntity", "fieldMapping", "columnDefinition"],
        });

      const members = enrichedMembers.map((m) => ({
        ...m,
        connectorEntityLabel: m.connectorEntity!.label,
        linkFieldMappingSourceField: m.columnDefinition!.key,
        connectorEntity: undefined,
        fieldMapping: undefined,
      }));

      return HttpService.success<EntityGroupGetResponsePayload>(res, {
        entityGroup: {
          ...entityGroup,
          members,
        } as unknown as EntityGroupGetResponsePayload["entityGroup"],
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to fetch entity group"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ENTITY_GROUP_FETCH_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to fetch entity group"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/entity-groups:
 *   post:
 *     tags:
 *       - Entity Groups
 *     summary: Create an entity group
 *     description: Creates a new entity group scoped to the authenticated user's organization. Group names must be unique within the organization.
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
 *               description:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       201:
 *         description: Entity group created
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
 *                     entityGroup:
 *                       $ref: '#/components/schemas/EntityGroup'
 *       400:
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       409:
 *         description: Group name already exists in this organization
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
entityGroupRouter.post(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = EntityGroupCreateRequestBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.ENTITY_GROUP_INVALID_PAYLOAD,
            "Invalid entity group payload"
          )
        );
      }

      const { organizationId, userId } = req.application!.metadata;

      const duplicate = await DbService.repository.entityGroups.findByName(
        organizationId,
        parsed.data.name
      );
      if (duplicate) {
        return next(
          new ApiError(
            409,
            ApiCode.ENTITY_GROUP_DUPLICATE_NAME,
            "An entity group with this name already exists in this organization"
          )
        );
      }

      const factory = new EntityGroupModelFactory();
      const model = factory.create(userId);
      model.update({
        organizationId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
      });

      const entityGroup = await DbService.repository.entityGroups
        .create(model.parse())
        .catch((error) => {
          if (error instanceof ApiError) throw error;
          throw new ApiError(
            500,
            ApiCode.ENTITY_GROUP_CREATE_FAILED,
            error instanceof Error
              ? error.message
              : "Failed to create entity group"
          );
        });

      logger.info(
        { id: entityGroup.id, organizationId },
        "Entity group created"
      );

      return HttpService.success<EntityGroupCreateResponsePayload>(
        res,
        {
          entityGroup:
            entityGroup as unknown as EntityGroupCreateResponsePayload["entityGroup"],
        },
        201
      );
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to create entity group"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ENTITY_GROUP_CREATE_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to create entity group"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/entity-groups/{id}:
 *   patch:
 *     tags:
 *       - Entity Groups
 *     summary: Update an entity group
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity group ID
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
 *               description:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Entity group updated
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
 *                     entityGroup:
 *                       $ref: '#/components/schemas/EntityGroup'
 *       400:
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Entity group not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       409:
 *         description: Group name already exists in this organization
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
entityGroupRouter.patch(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const parsed = EntityGroupUpdateRequestBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.ENTITY_GROUP_INVALID_PAYLOAD,
            "Invalid entity group payload"
          )
        );
      }

      const existing = await DbService.repository.entityGroups.findById(id);
      if (!existing) {
        return next(
          new ApiError(
            404,
            ApiCode.ENTITY_GROUP_NOT_FOUND,
            "Entity group not found"
          )
        );
      }

      if (parsed.data.name && parsed.data.name !== existing.name) {
        const duplicate = await DbService.repository.entityGroups.findByName(
          existing.organizationId,
          parsed.data.name
        );
        if (duplicate) {
          return next(
            new ApiError(
              409,
              ApiCode.ENTITY_GROUP_DUPLICATE_NAME,
              "An entity group with this name already exists in this organization"
            )
          );
        }
      }

      const { userId } = req.application!.metadata;

      const entityGroup = await DbService.repository.entityGroups
        .update(id, {
          ...parsed.data,
          updated: Date.now(),
          updatedBy: userId,
        } as never)
        .catch((error) => {
          if (error instanceof ApiError) throw error;
          throw new ApiError(
            500,
            ApiCode.ENTITY_GROUP_UPDATE_FAILED,
            error instanceof Error
              ? error.message
              : "Failed to update entity group"
          );
        });

      logger.info({ id }, "Entity group updated");

      return HttpService.success<EntityGroupUpdateResponsePayload>(res, {
        entityGroup:
          entityGroup as unknown as EntityGroupUpdateResponsePayload["entityGroup"],
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to update entity group"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ENTITY_GROUP_UPDATE_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to update entity group"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/entity-groups/{id}/impact:
 *   get:
 *     tags:
 *       - Entity Groups
 *     summary: Get deletion impact for an entity group
 *     description: Returns count of members that would be affected if this entity group were deleted.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity group ID
 *     responses:
 *       200:
 *         description: Impact assessment
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
 *                     entityGroupMembers:
 *                       type: integer
 *       404:
 *         description: Entity group not found
 *       500:
 *         description: Internal server error
 */
entityGroupRouter.get(
  "/:id/impact",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      const existing = await DbService.repository.entityGroups.findById(id);
      if (!existing) {
        return next(
          new ApiError(
            404,
            ApiCode.ENTITY_GROUP_NOT_FOUND,
            "Entity group not found"
          )
        );
      }

      const members =
        await DbService.repository.entityGroupMembers.findByEntityGroupId(id);

      return HttpService.success<EntityGroupImpactResponsePayload>(res, {
        entityGroupMembers: members.length,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to fetch entity group impact"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ENTITY_GROUP_FETCH_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to fetch entity group impact"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/entity-groups/{id}:
 *   delete:
 *     tags:
 *       - Entity Groups
 *     summary: Delete an entity group
 *     description: Soft-deletes an entity group and cascades to all its members.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity group ID
 *     responses:
 *       200:
 *         description: Entity group deleted
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
 *                     cascaded:
 *                       type: object
 *                       properties:
 *                         entityGroupMembers:
 *                           type: integer
 *       404:
 *         description: Entity group not found
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
entityGroupRouter.delete(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      const existing = await DbService.repository.entityGroups.findById(id);
      if (!existing) {
        return next(
          new ApiError(
            404,
            ApiCode.ENTITY_GROUP_NOT_FOUND,
            "Entity group not found"
          )
        );
      }

      const { userId } = req.application!.metadata;

      const cascaded = await DbService.transaction(async (tx) => {
        const members =
          await DbService.repository.entityGroupMembers.findByEntityGroupId(
            id,
            {},
            tx
          );
        const memberIds = members.map((m) => m.id);
        if (memberIds.length > 0) {
          await DbService.repository.entityGroupMembers.softDeleteMany(
            memberIds,
            userId,
            tx
          );
        }
        await DbService.repository.entityGroups.softDelete(id, userId, tx);
        return { entityGroupMembers: memberIds.length };
      }).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(
          500,
          ApiCode.ENTITY_GROUP_DELETE_FAILED,
          error instanceof Error
            ? error.message
            : "Failed to delete entity group"
        );
      });

      logger.info({ id, cascaded }, "Entity group soft-deleted");

      return HttpService.success<EntityGroupDeleteResponsePayload>(res, {
        id,
        cascaded,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to delete entity group"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ENTITY_GROUP_DELETE_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to delete entity group"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/entity-groups/{id}/resolve:
 *   get:
 *     tags:
 *       - Entity Groups
 *     summary: Resolve identity across group members
 *     description: On-demand identity resolution. For each member in the group, looks up the link field mapping's source field, then queries entity records where that field matches the provided linkValue.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity group ID
 *       - in: query
 *         name: linkValue
 *         required: true
 *         schema:
 *           type: string
 *         description: The identity value to resolve across group members
 *     responses:
 *       200:
 *         description: Identity resolution results
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
 *                     results:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/EntityGroupResolveResult'
 *       400:
 *         description: Missing or empty linkValue
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Entity group not found
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
entityGroupRouter.get(
  "/:id/resolve",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const queryParsed = EntityGroupResolveRequestQuerySchema.safeParse(
        req.query
      );
      if (!queryParsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.ENTITY_GROUP_INVALID_PAYLOAD,
            "linkValue query parameter is required"
          )
        );
      }

      const { linkValue } = queryParsed.data;

      const entityGroup = await DbService.repository.entityGroups.findById(id);
      if (!entityGroup) {
        return next(
          new ApiError(
            404,
            ApiCode.ENTITY_GROUP_NOT_FOUND,
            "Entity group not found"
          )
        );
      }

      const enrichedMembers =
        await DbService.repository.entityGroupMembers.findByEntityGroupId(id, {
          include: ["connectorEntity", "fieldMapping", "columnDefinition"],
        });

      const results: EntityGroupResolveResponsePayload["results"] = [];

      for (const member of enrichedMembers) {
        const columnKey = member.columnDefinition!.key;

        // Query entity_records where normalizedData->>columnKey = linkValue
        const { entityRecords } = await import("../db/schema/index.js");
        const records = await DbService.repository.entityRecords.findMany(
          and(
            eq(entityRecords.connectorEntityId, member.connectorEntityId),
            sql`${entityRecords.normalizedData}->>${columnKey} = ${linkValue}`
          )
        );

        results.push({
          connectorEntityId: member.connectorEntityId,
          connectorEntityLabel: member.connectorEntity!.label,
          isPrimary: member.isPrimary,
          records:
            records as unknown as EntityGroupResolveResponsePayload["results"][number]["records"],
        });
      }

      return HttpService.success<EntityGroupResolveResponsePayload>(res, {
        results,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to resolve entity group"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ENTITY_GROUP_FETCH_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to resolve entity group"
            )
      );
    }
  }
);
