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

import { inArray } from "drizzle-orm";

import {
  EntityTagAssignmentModelFactory,
  TAG_TARGET_TYPES,
  type EntityTagAssignment,
  type TagTarget,
  type TagTargetType,
} from "@portalai/core/models";
import type { AssignedEntityTag, TagUsage } from "@portalai/core/contracts";

import { ApiCode } from "../constants/api-codes.constants.js";
import { TARGET_TABLES } from "../db/repositories/entity-tag-assignments.repository.js";
import { entityTags } from "../db/schema/index.js";
import type { EntityTagSelect } from "../db/schema/zod.js";
import type { DbClient } from "../db/repositories/base.repository.js";
import { createLogger } from "../utils/logger.util.js";
import { CuratedViewDeleteService } from "./curated-view-delete.service.js";
import { DbService } from "./db.service.js";
import { ApiError } from "./http.service.js";
import { ObjectAccessService } from "./object-access.service.js";
import { ObjectTargetService } from "./object-target.service.js";
import type { PermissionSet } from "./permission-set.js";
import {
  PermissionService,
  type PermissionContext,
} from "./permission.service.js";

const logger = createLogger({ module: "tag-assignment" });

const tagNotFound = () =>
  new ApiError(404, ApiCode.ENTITY_TAG_NOT_FOUND, "Tag not found");

/** Wrap an unexpected failure as `code`, passing an `ApiError` through. */
const failedAs =
  (code: ApiCode, fallback: string) =>
  (error: unknown): never => {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      500,
      code,
      error instanceof Error ? error.message : fallback
    );
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
    await TagAssignmentService.checkTarget(set, ctx, target, verb);
    return set;
  }

  /**
   * The one target check every path runs, against a permission set already
   * loaded: the object must be in the caller's org and readable (else its
   * own 404), and writable for a change (else 403).
   */
  private static async checkTarget(
    set: PermissionSet,
    ctx: PermissionContext,
    target: TagTarget,
    verb: "read" | "write"
  ): Promise<void> {
    if (verb === "read") {
      await ObjectTargetService.loadReadable(set, ctx, target);
      return;
    }
    const descriptor = ObjectTargetService.descriptor(target.type);
    const row = await descriptor.load(target.id);
    // Each target type is the permission type of its own name.
    ObjectAccessService.loadForVerb(
      set,
      ctx.organizationId,
      target.type,
      row,
      "write",
      descriptor.notFound
    );
  }

  /** Every tag among `ids` must be in the caller's org and readable. */
  private static async checkTags(
    set: PermissionSet,
    ctx: PermissionContext,
    ids: string[]
  ): Promise<void> {
    const tags = await DbService.repository.entityTags.findMany(
      inArray(entityTags.id, ids)
    );
    const readable = new Set(
      tags
        .filter((tag) =>
          ObjectAccessService.readableInOrg(set, ctx.organizationId, "tag", tag)
        )
        .map((tag) => tag.id)
    );
    if (ids.some((id) => !readable.has(id))) throw tagNotFound();
  }

  /**
   * Inside a write's transaction: share-lock the tags (a tag delete waits
   * for the write, and a write after a delete finds the tag gone) and the
   * objects (an object delete waits, or ran first and the object is gone),
   * each in a fixed order so concurrent writers never deadlock.
   */
  private static async lockForWrite(
    tagIds: string[],
    targets: TagTarget[],
    tx: DbClient
  ): Promise<void> {
    const live = await DbService.repository.entityTags.lockLive(
      tagIds,
      "share",
      tx
    );
    if (live.length !== new Set(tagIds).size) throw tagNotFound();
    const ordered = [...targets].sort((a, b) =>
      `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`)
    );
    for (const target of ordered) {
      const ok = await DbService.repository.entityTagAssignments.lockLiveTarget(
        target,
        tx
      );
      if (!ok) throw ObjectTargetService.descriptor(target.type).notFound();
    }
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
      throw tagNotFound();
    }

    // The factory stamps the id and audit columns; the repository sets the
    // target column and the tag.
    const base = new EntityTagAssignmentModelFactory()
      .create(ctx.userId)
      .toJSON();
    // The object's row stays share-locked until the insert commits, so a
    // delete racing this assign either runs first (and the object is gone
    // here: 404) or waits and then sweeps this assignment with the rest.
    const { row, created } = await DbService.transaction(async (tx) => {
      await TagAssignmentService.lockForWrite([entityTagId], [target], tx);
      return DbService.repository.entityTagAssignments
        .insertIfAbsent(
          target,
          entityTagId,
          {
            id: base.id!,
            created: base.created!,
            createdBy: ctx.userId,
            updated: null,
            updatedBy: null,
            deleted: null,
            deletedBy: null,
            organizationId: ctx.organizationId,
          },
          tx
        )
        .catch((error: unknown) => {
          throw new ApiError(
            500,
            ApiCode.ENTITY_TAG_ASSIGNMENT_CREATE_FAILED,
            error instanceof Error ? error.message : "Failed to assign tag"
          );
        });
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

  /**
   * #1071: the objects of one taggable type the caller can read, by name, so
   * the agent's tag tools have ids to act on (the agent's `tag_target_list`).
   * The same read rule every tag path applies to a target: in the caller's
   * org and readable to them. Writability isn't filtered: tagging re-checks
   * write per object and refuses a read-only one.
   */
  static async listTargets(
    ctx: PermissionContext,
    type: TagTargetType,
    opts: { search?: string; limit: number; offset: number }
  ): Promise<{
    targets: { type: TagTargetType; id: string; name: string }[];
    total: number;
  }> {
    const set = await PermissionService.loadSet(ctx);
    const table = TARGET_TABLES[type];
    const { rows, total } =
      await DbService.repository.entityTagAssignments.findTargets(
        type,
        ctx.organizationId,
        set.visibilityPredicate(type, {
          createdByCol: table.createdBy,
          idCol: table.id,
        }),
        opts
      );
    return { targets: rows.map((r) => ({ type, ...r })), total };
  }

  /**
   * #1071: put every tag on every object, all or nothing (the agent's
   * `tag_assign`). The caller's permissions load once; every object and tag
   * is checked (the same checks as one assign) before anything is written,
   * and every pair is written in one transaction, so a failure anywhere
   * leaves nothing applied. Results come back in input order; a pair the
   * object already carried reports `created: false`.
   */
  static async assignMany(
    ctx: PermissionContext,
    targets: TagTarget[],
    tagIds: string[]
  ): Promise<{ target: TagTarget; entityTagId: string; created: boolean }[]> {
    const set = await PermissionService.loadSet(ctx);
    for (const target of targets) {
      await TagAssignmentService.checkTarget(set, ctx, target, "write");
    }
    await TagAssignmentService.checkTags(set, ctx, tagIds);

    const results = await DbService.transaction(async (tx) => {
      await TagAssignmentService.lockForWrite(tagIds, targets, tx);
      const out: {
        target: TagTarget;
        entityTagId: string;
        created: boolean;
      }[] = [];
      for (const target of targets) {
        for (const entityTagId of tagIds) {
          const base = new EntityTagAssignmentModelFactory()
            .create(ctx.userId)
            .toJSON();
          const { created } =
            await DbService.repository.entityTagAssignments.insertIfAbsent(
              target,
              entityTagId,
              {
                id: base.id!,
                created: base.created!,
                createdBy: ctx.userId,
                updated: null,
                updatedBy: null,
                deleted: null,
                deletedBy: null,
                organizationId: ctx.organizationId,
              },
              tx
            );
          out.push({ target, entityTagId, created });
        }
      }
      return out;
    }).catch(
      failedAs(
        ApiCode.ENTITY_TAG_ASSIGNMENT_CREATE_FAILED,
        "Failed to assign tags"
      )
    );
    logger.info(
      {
        pairs: results.length,
        created: results.filter((r) => r.created).length,
      },
      "Tag assignments"
    );
    return results;
  }

  /**
   * #1071: take every tag off every object, all or nothing (the agent's
   * `tag_unassign`). Checked like {@link assignMany}; the object's current
   * tags are read inside the transaction, so a pair someone else removed
   * meanwhile reports `removed: false` rather than failing the call.
   */
  static async unassignMany(
    ctx: PermissionContext,
    targets: TagTarget[],
    tagIds: string[]
  ): Promise<{ target: TagTarget; entityTagId: string; removed: boolean }[]> {
    const set = await PermissionService.loadSet(ctx);
    for (const target of targets) {
      await TagAssignmentService.checkTarget(set, ctx, target, "write");
    }
    await TagAssignmentService.checkTags(set, ctx, tagIds);

    const results = await DbService.transaction(async (tx) => {
      await TagAssignmentService.lockForWrite(tagIds, targets, tx);
      const out: {
        target: TagTarget;
        entityTagId: string;
        removed: boolean;
      }[] = [];
      const toDelete: string[] = [];
      for (const target of targets) {
        const assigned = new Map(
          (
            await DbService.repository.entityTagAssignments.findByTarget(
              target,
              tx
            )
          ).map((row) => [row.id, row.assignmentId])
        );
        for (const entityTagId of tagIds) {
          const assignmentId = assigned.get(entityTagId);
          if (assignmentId) toDelete.push(assignmentId);
          out.push({ target, entityTagId, removed: !!assignmentId });
        }
      }
      if (toDelete.length > 0) {
        await DbService.repository.entityTagAssignments.softDeleteMany(
          toDelete,
          ctx.userId,
          tx
        );
      }
      return out;
    }).catch(
      failedAs(
        ApiCode.ENTITY_TAG_ASSIGNMENT_DELETE_FAILED,
        "Failed to remove tags"
      )
    );
    logger.info(
      {
        pairs: results.length,
        removed: results.filter((r) => r.removed).length,
      },
      "Tag assignments removed"
    );
    return results;
  }

  /**
   * A list's `tagIds` filter, narrowed to tags the caller may read in their
   * org. `undefined` means no filter; an empty array means the filter names
   * no tag the caller can see, so the list matches nothing (a hidden tag
   * never narrows a list, which would reveal where it sits).
   */
  static async readableTagIds(
    set: PermissionSet,
    organizationId: string,
    raw: string | undefined
  ): Promise<string[] | undefined> {
    if (raw === undefined) return undefined;
    const ids = [
      ...new Set(
        raw
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
      ),
    ];
    if (ids.length === 0) return undefined;
    const tags = await DbService.repository.entityTags.findMany(
      inArray(entityTags.id, ids)
    );
    return tags
      .filter((tag) =>
        ObjectAccessService.readableInOrg(set, organizationId, "tag", tag)
      )
      .map((tag) => tag.id);
  }

  /**
   * The readable tags on a page of objects of one type, keyed by object id,
   * in one query. Every id is present (an untagged object maps to `[]`).
   */
  static async tagsForTargets(
    set: PermissionSet,
    type: TagTargetType,
    ids: string[]
  ): Promise<Map<string, EntityTagSelect[]>> {
    const byTarget =
      await DbService.repository.entityTagAssignments.findByTargetIds(
        type,
        ids
      );
    return new Map(
      ids.map((id) => [
        id,
        TagAssignmentService.readableTags(set, byTarget.get(id) ?? []),
      ])
    );
  }

  /**
   * Per-type usage for a page of tags: how many objects of each type carry
   * each tag, counting only objects the caller can read (a count over the
   * rest would reveal they exist). One grouped query per type.
   */
  static async usageByTag(
    set: PermissionSet,
    organizationId: string,
    tagIds: string[],
    client?: DbClient
  ): Promise<Map<string, TagUsage>> {
    const usage = new Map<string, TagUsage>(
      tagIds.map((id) => [
        id,
        Object.fromEntries(TAG_TARGET_TYPES.map((t) => [t, 0])) as TagUsage,
      ])
    );
    if (tagIds.length === 0) return usage;
    await Promise.all(
      TAG_TARGET_TYPES.map(async (type) => {
        const table = TARGET_TABLES[type];
        const counts =
          await DbService.repository.entityTagAssignments.countObjectsByTag(
            type,
            tagIds,
            organizationId,
            set.visibilityPredicate(type, {
              createdByCol: table.createdBy,
              idCol: table.id,
            }),
            client
          );
        for (const [tagId, n] of counts) {
          const row = usage.get(tagId);
          if (row) row[type] = n;
        }
      })
    );
    return usage;
  }

  /**
   * Every tag assignment a connector or entity delete removes (#1070): the
   * entities' own, the connector's own, and those on the views over the
   * entities, which the delete cascades to. For the delete-impact dialogs.
   */
  static async countRemovedByDelete(
    organizationId: string,
    scope: { entityIds: string[]; connectorInstanceIds?: string[] }
  ): Promise<number> {
    const repo = DbService.repository.entityTagAssignments;
    const viewIds = await CuratedViewDeleteService.findIdsByConnectorEntityIds(
      organizationId,
      scope.entityIds
    );
    const counts = await Promise.all([
      repo.countByTargetIds("entity", scope.entityIds),
      repo.countByTargetIds(
        "connector_instance",
        scope.connectorInstanceIds ?? []
      ),
      repo.countByTargetIds("curated_view", viewIds),
    ]);
    return counts.reduce((a, b) => a + b, 0);
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
