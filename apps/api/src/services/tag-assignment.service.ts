/**
 * Tag assignments on any taggable object (#1070): connector entities,
 * stations, pins, connector instances and curated views.
 *
 * One check sequence serves every type, for the routes and (#1071) the
 * agent's tag tools alike:
 *
 * 1. the object is loaded org-scoped and must be readable, else a 404 with
 *    the object's own not-found code (unreadable == absent);
 * 2. a change needs `resource.write` on the object, else 403;
 * 3. an assigned tag must be in the org and readable, else 404.
 *
 * Tags are metadata: no job reads or writes them, so nothing here takes a
 * job lock (the route map records `locks: none`).
 */

import {
  EntityTagAssignmentModelFactory,
  TAG_TARGET_PERMISSION_TYPE,
  type EntityTagAssignment,
  type TagTarget,
  type TagTargetType,
} from "@portalai/core/models";
import type { AssignedEntityTag } from "@portalai/core/contracts";

import { ApiCode } from "../constants/api-codes.constants.js";
import type { EntityTagSelect } from "../db/schema/zod.js";
import { createLogger } from "../utils/logger.util.js";
import { DbService } from "./db.service.js";
import { ApiError } from "./http.service.js";
import { ObjectAccessService, type OwnedRow } from "./object-access.service.js";
import type { PermissionSet } from "./permission-set.js";
import {
  PermissionService,
  type PermissionContext,
} from "./permission.service.js";

const logger = createLogger({ module: "tag-assignment" });

interface TargetDescriptor {
  load: (id: string) => Promise<OwnedRow | null | undefined>;
  notFound: () => ApiError;
}

const TARGETS: Record<TagTargetType, TargetDescriptor> = {
  entity: {
    load: (id) => DbService.repository.connectorEntities.findById(id),
    notFound: () =>
      new ApiError(
        404,
        ApiCode.CONNECTOR_ENTITY_NOT_FOUND,
        "Connector entity not found"
      ),
  },
  station: {
    load: (id) => DbService.repository.stations.findById(id),
    notFound: () =>
      new ApiError(404, ApiCode.STATION_NOT_FOUND, "Station not found"),
  },
  pin: {
    load: (id) => DbService.repository.portalResults.findById(id),
    notFound: () =>
      new ApiError(
        404,
        ApiCode.PORTAL_RESULT_NOT_FOUND,
        "Portal result not found"
      ),
  },
  connector_instance: {
    load: (id) => DbService.repository.connectorInstances.findById(id),
    notFound: () =>
      new ApiError(
        404,
        ApiCode.CONNECTOR_INSTANCE_NOT_FOUND,
        "Connector instance not found"
      ),
  },
  curated_view: {
    load: (id) => DbService.repository.curatedViews.findById(id),
    notFound: () =>
      new ApiError(404, ApiCode.CURATED_VIEW_NOT_FOUND, "View not found"),
  },
};

export class TagAssignmentService {
  /**
   * Load the target for a read or a change, returning the caller's
   * permission set. Throws the target's 404, or 403 for a change without
   * write.
   */
  static async loadTarget(
    ctx: PermissionContext,
    target: TagTarget,
    verb: "read" | "write"
  ): Promise<PermissionSet> {
    const set = await PermissionService.loadSet(ctx);
    const descriptor = TARGETS[target.type];
    const row = await descriptor.load(target.id);
    const type = TAG_TARGET_PERMISSION_TYPE[target.type];
    if (verb === "write") {
      ObjectAccessService.loadForVerb(
        set,
        ctx.organizationId,
        type,
        row,
        "write",
        descriptor.notFound
      );
    } else if (
      !ObjectAccessService.readableInOrg(set, ctx.organizationId, type, row)
    ) {
      throw descriptor.notFound();
    }
    return set;
  }

  /** The tags on an object that the caller may read. */
  static async list(
    ctx: PermissionContext,
    target: TagTarget
  ): Promise<AssignedEntityTag[]> {
    const set = await TagAssignmentService.loadTarget(ctx, target, "read");
    const tags =
      await DbService.repository.entityTagAssignments.findByTarget(target);
    return TagAssignmentService.readableTags(set, tags);
  }

  /**
   * Put a tag on an object. `created: false` means the object already
   * carried it; the route answers 409, a tool reports a no-op.
   */
  static async assign(
    ctx: PermissionContext,
    target: TagTarget,
    entityTagId: string
  ): Promise<{ assignment: EntityTagAssignment; created: boolean }> {
    const set = await TagAssignmentService.loadTarget(ctx, target, "write");
    const tag = await DbService.repository.entityTags.findById(entityTagId);
    if (
      !ObjectAccessService.readableInOrg(set, ctx.organizationId, "tag", tag)
    ) {
      throw new ApiError(404, ApiCode.ENTITY_TAG_NOT_FOUND, "Tag not found");
    }

    // The factory stamps the id and audit columns; the repository sets the
    // target column and the tag.
    const base = new EntityTagAssignmentModelFactory()
      .create(ctx.userId)
      .toJSON();
    const { row, created } = await DbService.repository.entityTagAssignments
      .insertIfAbsent(target, entityTagId, {
        id: base.id!,
        created: base.created!,
        createdBy: ctx.userId,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
        organizationId: ctx.organizationId,
      })
      .catch((error: unknown) => {
        throw new ApiError(
          500,
          ApiCode.ENTITY_TAG_ASSIGNMENT_CREATE_FAILED,
          error instanceof Error ? error.message : "Failed to assign tag"
        );
      });
    logger.info(
      { target, entityTagId, assignmentId: row.id, created },
      "Tag assignment"
    );
    return { assignment: row as EntityTagAssignment, created };
  }

  /** Take a tag off an object. The assignment must be on this object. */
  static async unassign(
    ctx: PermissionContext,
    target: TagTarget,
    assignmentId: string
  ): Promise<void> {
    await TagAssignmentService.loadTarget(ctx, target, "write");
    const existing =
      await DbService.repository.entityTagAssignments.findAssignment(
        target,
        assignmentId
      );
    if (!existing || existing.organizationId !== ctx.organizationId) {
      throw new ApiError(
        404,
        ApiCode.ENTITY_TAG_ASSIGNMENT_NOT_FOUND,
        "Tag assignment not found"
      );
    }
    await DbService.repository.entityTagAssignments
      .softDelete(assignmentId, ctx.userId)
      .catch((error: unknown) => {
        throw new ApiError(
          500,
          ApiCode.ENTITY_TAG_ASSIGNMENT_DELETE_FAILED,
          error instanceof Error ? error.message : "Failed to remove tag"
        );
      });
    logger.info({ target, assignmentId }, "Tag assignment removed");
  }

  /** Only the tags the caller may read (#630 tag visibility). */
  static readableTags<T extends EntityTagSelect>(
    set: PermissionSet,
    tags: T[]
  ): T[] {
    return tags.filter((tag) =>
      set.can("resource.read", {
        type: "tag",
        id: tag.id,
        createdBy: tag.createdBy,
      })
    );
  }
}
