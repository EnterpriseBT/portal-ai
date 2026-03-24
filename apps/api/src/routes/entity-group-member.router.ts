import { Router, Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";

import { EntityGroupMemberModelFactory } from "@portalai/core/models";
import {
  EntityGroupMemberCreateRequestBodySchema,
  type EntityGroupMemberCreateResponsePayload,
  EntityGroupMemberUpdateRequestBodySchema,
  type EntityGroupMemberUpdateResponsePayload,
  EntityGroupMemberOverlapRequestQuerySchema,
  type EntityGroupMemberOverlapResponsePayload,
} from "@portalai/core/contracts";
import { createLogger } from "../utils/logger.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "../services/db.service.js";
import { entityRecords } from "../db/schema/index.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";

const logger = createLogger({ module: "entity-group-member" });

/**
 * This router is mounted under /entity-groups/:entityGroupId/members.
 * Express mergeParams is required so `:entityGroupId` is accessible here.
 */
export const entityGroupMemberRouter = Router({ mergeParams: true });

/**
 * @openapi
 * /api/entity-groups/{entityGroupId}/members:
 *   get:
 *     tags:
 *       - Entity Group Members
 *     summary: List members of an entity group
 *     description: Returns members with connector entity labels and link field details.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entityGroupId
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity group ID
 *     responses:
 *       200:
 *         description: List of group members
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
 *                     members:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/EntityGroupMemberWithDetails'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
entityGroupMemberRouter.get(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { entityGroupId } = req.params;
      logger.info({ entityGroupId }, "GET /entity-groups/:entityGroupId/members called");

      const enrichedMembers = await DbService.repository.entityGroupMembers
        .findByEntityGroupId(entityGroupId)
        .catch((error) => {
          if (error instanceof ApiError) throw error;
          throw new ApiError(500, ApiCode.ENTITY_GROUP_MEMBER_FETCH_FAILED, error instanceof Error ? error.message : "Failed to list entity group members");
        });

      const members = enrichedMembers.map((m) => ({
        ...m,
        connectorEntityLabel: m.connectorEntity.label,
        linkFieldMappingSourceField: m.fieldMapping.sourceField,
        connectorEntity: undefined,
        fieldMapping: undefined,
      }));

      return HttpService.success(res, { members });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to list entity group members"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.ENTITY_GROUP_MEMBER_FETCH_FAILED, error instanceof Error ? error.message : "Failed to list entity group members"));
    }
  }
);

/**
 * @openapi
 * /api/entity-groups/{entityGroupId}/members:
 *   post:
 *     tags:
 *       - Entity Group Members
 *     summary: Add a member to an entity group
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entityGroupId
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
 *             required:
 *               - connectorEntityId
 *               - linkFieldMappingId
 *             properties:
 *               connectorEntityId:
 *                 type: string
 *               linkFieldMappingId:
 *                 type: string
 *               isPrimary:
 *                 type: boolean
 *                 default: false
 *     responses:
 *       201:
 *         description: Member added
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
 *                     entityGroupMember:
 *                       $ref: '#/components/schemas/EntityGroupMember'
 *       400:
 *         description: Invalid request body or link field does not belong to entity
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Entity group, connector entity, or field mapping not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       409:
 *         description: Entity already a member of this group
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
entityGroupMemberRouter.post(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { entityGroupId } = req.params;
      const parsed = EntityGroupMemberCreateRequestBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(new ApiError(400, ApiCode.ENTITY_GROUP_MEMBER_CREATE_FAILED, "Invalid entity group member payload"));
      }

      const { organizationId, userId } = req.application!.metadata;

      // Verify entity group exists
      const group = await DbService.repository.entityGroups.findById(entityGroupId);
      if (!group) {
        return next(new ApiError(404, ApiCode.ENTITY_GROUP_NOT_FOUND, "Entity group not found"));
      }

      // Verify connector entity exists and belongs to same org
      const connectorEntity = await DbService.repository.connectorEntities.findById(parsed.data.connectorEntityId);
      if (!connectorEntity || connectorEntity.organizationId !== organizationId) {
        return next(new ApiError(400, ApiCode.ENTITY_GROUP_MEMBER_CREATE_FAILED, "Connector entity not found or does not belong to this organization"));
      }

      // Verify link field mapping exists and belongs to the connector entity
      const fieldMapping = await DbService.repository.fieldMappings.findById(parsed.data.linkFieldMappingId);
      if (!fieldMapping || fieldMapping.connectorEntityId !== parsed.data.connectorEntityId) {
        return next(new ApiError(400, ApiCode.ENTITY_GROUP_MEMBER_LINK_FIELD_INVALID, "Link field mapping not found or does not belong to the specified connector entity"));
      }

      // Check for duplicate membership
      const existing = await DbService.repository.entityGroupMembers.findExisting(
        entityGroupId,
        parsed.data.connectorEntityId
      );
      if (existing) {
        return next(new ApiError(409, ApiCode.ENTITY_GROUP_MEMBER_ALREADY_EXISTS, "This entity is already a member of this group"));
      }

      // Check for a soft-deleted member with the same combo — restore it instead of inserting
      const softDeleted = await DbService.repository.entityGroupMembers.findSoftDeleted(
        entityGroupId,
        parsed.data.connectorEntityId
      );

      let entityGroupMember;

      if (softDeleted) {
        // Restore the soft-deleted row with updated fields
        const restoreData = {
          linkFieldMappingId: parsed.data.linkFieldMappingId,
          isPrimary: parsed.data.isPrimary ?? false,
          updated: Date.now(),
          updatedBy: userId,
        };

        if (parsed.data.isPrimary) {
          entityGroupMember = await DbService.transaction(async (tx) => {
            await DbService.repository.entityGroupMembers.clearPrimary(entityGroupId, tx);
            return DbService.repository.entityGroupMembers.restore(softDeleted.id, restoreData as never, tx);
          });
        } else {
          entityGroupMember = await DbService.repository.entityGroupMembers.restore(softDeleted.id, restoreData as never);
        }
      } else {
        const factory = new EntityGroupMemberModelFactory();
        const model = factory.create(userId);
        model.update({
          organizationId,
          entityGroupId,
          connectorEntityId: parsed.data.connectorEntityId,
          linkFieldMappingId: parsed.data.linkFieldMappingId,
          isPrimary: parsed.data.isPrimary,
        });

        if (parsed.data.isPrimary) {
          entityGroupMember = await DbService.transaction(async (tx) => {
            await DbService.repository.entityGroupMembers.clearPrimary(entityGroupId, tx);
            return DbService.repository.entityGroupMembers.create(model.parse(), tx);
          });
        } else {
          entityGroupMember = await DbService.repository.entityGroupMembers.create(model.parse());
        }
      }

      if (!entityGroupMember) {
        return next(new ApiError(500, ApiCode.ENTITY_GROUP_MEMBER_CREATE_FAILED, "Failed to create entity group member"));
      }

      logger.info({ id: entityGroupMember.id, entityGroupId }, "Entity group member created");

      return HttpService.success<EntityGroupMemberCreateResponsePayload>(
        res,
        { entityGroupMember: entityGroupMember as unknown as EntityGroupMemberCreateResponsePayload["entityGroupMember"] },
        201
      );
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to create entity group member"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.ENTITY_GROUP_MEMBER_CREATE_FAILED, error instanceof Error ? error.message : "Failed to create entity group member"));
    }
  }
);

/**
 * @openapi
 * /api/entity-groups/{entityGroupId}/members/{memberId}:
 *   patch:
 *     tags:
 *       - Entity Group Members
 *     summary: Update an entity group member
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entityGroupId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: memberId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               linkFieldMappingId:
 *                 type: string
 *               isPrimary:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Member updated
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
 *                     entityGroupMember:
 *                       $ref: '#/components/schemas/EntityGroupMember'
 *       400:
 *         description: Invalid request body or link field does not belong to entity
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Member not found
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
entityGroupMemberRouter.patch(
  "/:memberId",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { entityGroupId, memberId } = req.params;
      const parsed = EntityGroupMemberUpdateRequestBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(new ApiError(400, ApiCode.ENTITY_GROUP_MEMBER_UPDATE_FAILED, "Invalid entity group member payload"));
      }

      const existing = await DbService.repository.entityGroupMembers.findById(memberId);
      if (!existing) {
        return next(new ApiError(404, ApiCode.ENTITY_GROUP_MEMBER_NOT_FOUND, "Entity group member not found"));
      }

      // If linkFieldMappingId is changing, verify the new field mapping belongs to the member's connector entity
      if (parsed.data.linkFieldMappingId && parsed.data.linkFieldMappingId !== existing.linkFieldMappingId) {
        const fieldMapping = await DbService.repository.fieldMappings.findById(parsed.data.linkFieldMappingId);
        if (!fieldMapping || fieldMapping.connectorEntityId !== existing.connectorEntityId) {
          return next(new ApiError(400, ApiCode.ENTITY_GROUP_MEMBER_LINK_FIELD_INVALID, "Link field mapping not found or does not belong to the member's connector entity"));
        }
      }

      const { userId } = req.application!.metadata;
      const updateData = {
        ...parsed.data,
        updated: Date.now(),
        updatedBy: userId,
      };

      let entityGroupMember;
      if (parsed.data.isPrimary === true) {
        entityGroupMember = await DbService.transaction(async (tx) => {
          await DbService.repository.entityGroupMembers.clearPrimary(entityGroupId, tx);
          return DbService.repository.entityGroupMembers.update(memberId, updateData as never, tx);
        });
      } else {
        entityGroupMember = await DbService.repository.entityGroupMembers.update(memberId, updateData as never);
      }

      logger.info({ memberId, entityGroupId }, "Entity group member updated");

      return HttpService.success<EntityGroupMemberUpdateResponsePayload>(res, {
        entityGroupMember: entityGroupMember as unknown as EntityGroupMemberUpdateResponsePayload["entityGroupMember"],
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to update entity group member"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.ENTITY_GROUP_MEMBER_UPDATE_FAILED, error instanceof Error ? error.message : "Failed to update entity group member"));
    }
  }
);

/**
 * @openapi
 * /api/entity-groups/{entityGroupId}/members/{memberId}:
 *   delete:
 *     tags:
 *       - Entity Group Members
 *     summary: Remove a member from an entity group
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entityGroupId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: memberId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Member removed
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
 *         description: Member not found
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
entityGroupMemberRouter.delete(
  "/:memberId",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { memberId } = req.params;

      const existing = await DbService.repository.entityGroupMembers.findById(memberId);
      if (!existing) {
        return next(new ApiError(404, ApiCode.ENTITY_GROUP_MEMBER_NOT_FOUND, "Entity group member not found"));
      }

      const { userId } = req.application!.metadata;

      await DbService.repository.entityGroupMembers.softDelete(memberId, userId).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.ENTITY_GROUP_MEMBER_DELETE_FAILED, error instanceof Error ? error.message : "Failed to delete entity group member");
      });

      logger.info({ memberId }, "Entity group member soft-deleted");

      return HttpService.success(res, { id: memberId });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to delete entity group member"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.ENTITY_GROUP_MEMBER_DELETE_FAILED, error instanceof Error ? error.message : "Failed to delete entity group member"));
    }
  }
);

/**
 * @openapi
 * /api/entity-groups/{entityGroupId}/members/overlap:
 *   get:
 *     tags:
 *       - Entity Group Members
 *     summary: Preview overlap between existing members and a candidate member
 *     description: Calculates the percentage of matching link field values between existing group members and a target entity before adding it.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entityGroupId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: targetConnectorEntityId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: targetLinkFieldMappingId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Overlap statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/EntityGroupOverlapResponse'
 *       400:
 *         description: Missing query parameters
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
entityGroupMemberRouter.get(
  "/overlap",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { entityGroupId } = req.params;
      const queryParsed = EntityGroupMemberOverlapRequestQuerySchema.safeParse(req.query);
      if (!queryParsed.success) {
        return next(new ApiError(400, ApiCode.ENTITY_GROUP_MEMBER_FETCH_FAILED, "targetConnectorEntityId and targetLinkFieldMappingId query parameters are required"));
      }

      const { targetConnectorEntityId, targetLinkFieldMappingId } = queryParsed.data;

      // Look up target field mapping to get the source field
      const targetMapping = await DbService.repository.fieldMappings.findById(targetLinkFieldMappingId);
      if (!targetMapping) {
        return next(new ApiError(400, ApiCode.ENTITY_GROUP_MEMBER_LINK_FIELD_INVALID, "Target link field mapping not found"));
      }

      // Get target entity's distinct link field values
      const targetValues = await DbService.repository.entityRecords.findMany(
        eq(entityRecords.connectorEntityId, targetConnectorEntityId)
      );
      const targetFieldKey = targetMapping.sourceField;
      const targetSet = new Set(
        targetValues
          .map((r) => {
            const val = (r.normalizedData as Record<string, unknown>)[targetFieldKey];
            return val != null ? String(val) : null;
          })
          .filter((v): v is string => v !== null)
      );

      // Get existing members of the group
      const enrichedMembers = await DbService.repository.entityGroupMembers.findByEntityGroupId(entityGroupId);

      let sourceRecordCount = 0;
      const sourceValueSet = new Set<string>();

      for (const member of enrichedMembers) {
        const sourceFieldKey = member.fieldMapping.sourceField;
        const records = await DbService.repository.entityRecords.findMany(
          eq(entityRecords.connectorEntityId, member.connectorEntityId)
        );
        for (const r of records) {
          const val = (r.normalizedData as Record<string, unknown>)[sourceFieldKey];
          if (val != null) {
            sourceValueSet.add(String(val));
          }
        }
        sourceRecordCount += records.length;
      }

      // Compute intersection
      let matchingRecordCount = 0;
      for (const val of sourceValueSet) {
        if (targetSet.has(val)) matchingRecordCount++;
      }

      const totalUnique = sourceValueSet.size + targetSet.size;
      const overlapPercentage = totalUnique === 0
        ? 0
        : Math.round((matchingRecordCount / Math.max(sourceValueSet.size, targetSet.size)) * 10000) / 100;

      return HttpService.success<EntityGroupMemberOverlapResponsePayload>(res, {
        overlapPercentage: Math.min(overlapPercentage, 100),
        sourceRecordCount,
        targetRecordCount: targetValues.length,
        matchingRecordCount,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to compute overlap"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.ENTITY_GROUP_MEMBER_FETCH_FAILED, error instanceof Error ? error.message : "Failed to compute overlap"));
    }
  }
);
