/**
 * The tag catalog (#1071): list, create, update and delete, shared by the
 * `/api/entity-tags` routes and the `tag_management` agent tools so both
 * apply one set of rules.
 *
 * - Reads see only tags the caller may read (#630).
 * - Creating needs class `resource.write` on tag (#685).
 * - Editing or deleting needs write or delete on the tag itself; a tag the
 *   caller can't read is a 404, like its GET (#713).
 * - Names are unique per org (409 ENTITY_TAG_DUPLICATE_NAME).
 * - Deleting a tag takes it off every object in the same transaction.
 *
 * Tags are metadata: no job locks them (the route map records `locks: none`).
 */

import { and, eq, or, type Column, type SQL } from "drizzle-orm";

import { EntityTagModelFactory, type EntityTag } from "@portalai/core/models";
import type {
  EntityTagCreateRequestBody,
  EntityTagListRequestQuery,
  EntityTagListResponsePayload,
  EntityTagUpdateRequestBody,
  TagUsage,
} from "@portalai/core/contracts";

import { ApiCode } from "../constants/api-codes.constants.js";
import { entityTags } from "../db/schema/index.js";
import { ilikeContains } from "../utils/filter-sql.util.js";
import { createLogger } from "../utils/logger.util.js";
import { unwrapPgError } from "../utils/pg-error.util.js";
import { DbService } from "./db.service.js";
import { ApiError } from "./http.service.js";
import { ObjectAccessService } from "./object-access.service.js";
import { ObjectCapabilitiesService } from "./object-capabilities.service.js";
import {
  PermissionService,
  type PermissionContext,
} from "./permission.service.js";
import { TagAssignmentService } from "./tag-assignment.service.js";

const logger = createLogger({ module: "entity-tag" });

// #756: keyed by the schema's `sortBy` enum, so every value the schema
// accepts has a column and nothing else reaches the lookup.
const SORTABLE_COLUMNS: Record<EntityTagListRequestQuery["sortBy"], Column> = {
  name: entityTags.name,
  created: entityTags.created,
};

export interface EntityTagListOptions {
  search?: string;
  limit: number;
  offset: number;
  sortBy: EntityTagListRequestQuery["sortBy"];
  sortOrder: "asc" | "desc";
  /** #1070: each tag's per-type counts over objects the caller can read. */
  includeUsage?: boolean;
}

const notFound = () =>
  new ApiError(404, ApiCode.ENTITY_TAG_NOT_FOUND, "Entity tag not found");

const duplicateName = () =>
  new ApiError(
    409,
    ApiCode.ENTITY_TAG_DUPLICATE_NAME,
    "An entity tag with this name already exists in this organization"
  );

/** Wrap a repository failure as `code`, passing an `ApiError` through. A
 *  write that lost a race to the same name hits the unique index (#1071) and
 *  answers the same 409 as the check before it. */
const failedAs =
  (code: ApiCode, fallback: string) =>
  (error: unknown): never => {
    if (error instanceof ApiError) throw error;
    const pg = unwrapPgError(error);
    if (
      pg.code === "23505" &&
      pg.message?.includes("entity_tags_org_name_unique")
    ) {
      throw duplicateName();
    }
    throw new ApiError(
      500,
      code,
      error instanceof Error ? error.message : fallback
    );
  };

export class EntityTagService {
  /** The tags the caller may read, each with the caller's capabilities. */
  static async list(
    ctx: PermissionContext,
    opts: EntityTagListOptions
  ): Promise<{
    entityTags: EntityTagListResponsePayload["entityTags"];
    total: number;
  }> {
    const { organizationId } = ctx;
    const filters: SQL[] = [eq(entityTags.organizationId, organizationId)];

    if (opts.search) {
      filters.push(
        or(
          ilikeContains(entityTags.name, opts.search),
          ilikeContains(entityTags.description, opts.search)
        )!
      );
    }

    // #630: filter to the tags the caller may `read`.
    const set = await PermissionService.loadSet(ctx);
    const visibility = set.visibilityPredicate("tag", {
      createdByCol: entityTags.createdBy,
      idCol: entityTags.id,
    });
    if (visibility) filters.push(visibility);

    const where = and(...filters);
    const listOpts = {
      limit: opts.limit,
      offset: opts.offset,
      orderBy: {
        column: SORTABLE_COLUMNS[opts.sortBy],
        direction: opts.sortOrder,
      },
    };

    const [data, total] = await Promise.all([
      DbService.repository.entityTags.findMany(where, listOpts),
      DbService.repository.entityTags.count(where),
    ]).catch(
      failedAs(ApiCode.ENTITY_TAG_FETCH_FAILED, "Failed to list entity tags")
    );

    const usage = opts.includeUsage
      ? await TagAssignmentService.usageByTag(
          set,
          organizationId,
          data.map((tag) => tag.id)
        )
      : null;

    return {
      // #688: each row with the caller's capabilities.
      entityTags: ObjectCapabilitiesService.attach(
        set,
        "tag",
        usage ? data.map((tag) => ({ ...tag, usage: usage.get(tag.id) })) : data
      ) as unknown as EntityTagListResponsePayload["entityTags"],
      total,
    };
  }

  static async create(
    ctx: PermissionContext,
    body: EntityTagCreateRequestBody,
    opts: { sourcePortalId?: string | null } = {}
  ): Promise<EntityTag> {
    const { organizationId, userId } = ctx;

    // #685: creating one is owner/admin only (class write on tag).
    // MemberAccess holds nothing on this type, so members can't create
    // what they couldn't then edit or delete.
    await PermissionService.check(ctx, "resource.write", { type: "tag" });

    const duplicate = await DbService.repository.entityTags.findByName(
      organizationId,
      body.name
    );
    if (duplicate) throw duplicateName();

    const model = new EntityTagModelFactory().create(userId);
    model.update({
      organizationId,
      name: body.name,
      color: body.color ?? null,
      description: body.description ?? null,
      // #641: an agent session's tag records the session; provenance only.
      sourcePortalId: opts.sourcePortalId ?? null,
    });

    const entityTag = await DbService.repository.entityTags
      .create(model.parse())
      .catch(
        failedAs(
          ApiCode.ENTITY_TAG_CREATE_FAILED,
          "Failed to create entity tag"
        )
      );

    logger.info({ id: entityTag.id, organizationId }, "Entity tag created");
    return entityTag as EntityTag;
  }

  static async update(
    ctx: PermissionContext,
    id: string,
    body: EntityTagUpdateRequestBody
  ): Promise<EntityTag> {
    // #630: a member may edit only their own tag; owner/admin any.
    // #713: one the caller can't read answers 404, like its GET.
    const existing = ObjectAccessService.loadForVerb(
      await PermissionService.loadSet(ctx),
      ctx.organizationId,
      "tag",
      await DbService.repository.entityTags.findById(id),
      "write",
      notFound
    );

    if (body.name && body.name !== existing.name) {
      const duplicate = await DbService.repository.entityTags.findByName(
        existing.organizationId,
        body.name
      );
      if (duplicate) throw duplicateName();
    }

    const entityTag = await DbService.repository.entityTags
      .update(id, {
        ...body,
        updated: Date.now(),
        updatedBy: ctx.userId,
      } as never)
      .catch(
        failedAs(
          ApiCode.ENTITY_TAG_UPDATE_FAILED,
          "Failed to update entity tag"
        )
      );

    logger.info({ id }, "Entity tag updated");
    return entityTag as EntityTag;
  }

  /**
   * Delete a tag and take it off every object, in one transaction that holds
   * the tag's row lock, so no assign lands on it meanwhile (#1071).
   *
   * With `countRemoved` (the agent's `tag_delete`), `removedFrom` counts per
   * type the objects it came off, read inside that transaction so it matches
   * what was removed, over only the objects the caller can read: a count over
   * the rest would reveal they exist. The route doesn't ask, so a delete from
   * the Tags page pays for no counting.
   */
  static async delete(
    ctx: PermissionContext,
    id: string,
    opts: { countRemoved?: boolean } = {}
  ): Promise<{ id: string; removedFrom?: TagUsage }> {
    // #630: a member may delete only their own tag; owner/admin any.
    // #713: one the caller can't read answers 404, like its GET.
    const set = await PermissionService.loadSet(ctx);
    ObjectAccessService.loadForVerb(
      set,
      ctx.organizationId,
      "tag",
      await DbService.repository.entityTags.findById(id),
      "delete",
      notFound
    );

    const removedFrom = await DbService.transaction(async (tx) => {
      // Assigns share-lock the tag, so this waits for any in flight; one
      // that comes after finds the tag gone. A concurrent delete won.
      const [live] = await DbService.repository.entityTags.lockLive(
        [id],
        "update",
        tx
      );
      if (!live) throw notFound();

      const usage = opts.countRemoved
        ? (
            await TagAssignmentService.usageByTag(
              set,
              ctx.organizationId,
              [id],
              tx
            )
          ).get(id)
        : undefined;

      const assignments =
        await DbService.repository.entityTagAssignments.findByEntityTagId(
          id,
          tx
        );
      const assignmentIds = assignments.map((a) => a.id);
      if (assignmentIds.length > 0) {
        await DbService.repository.entityTagAssignments.softDeleteMany(
          assignmentIds,
          ctx.userId,
          tx
        );
      }
      await DbService.repository.entityTags.softDelete(id, ctx.userId, tx);
      return usage;
    }).catch(
      failedAs(ApiCode.ENTITY_TAG_DELETE_FAILED, "Failed to delete entity tag")
    );

    logger.info({ id }, "Entity tag soft-deleted");
    return removedFrom ? { id, removedFrom } : { id };
  }
}
