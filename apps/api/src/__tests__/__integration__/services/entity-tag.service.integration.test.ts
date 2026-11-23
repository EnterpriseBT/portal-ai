/**
 * #1071: EntityTagService holds the tag catalog logic the routes and the
 * `tag_management` agent tools share. The routes' own suite
 * (`entity-tag.router.integration.test.ts`) pins what they always answered;
 * this file pins the service directly, including the readable-only
 * `removedFrom` a delete reports.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";

import { TAG_TARGET_TYPES, type TagTargetType } from "@portalai/core/models";

import * as schema from "../../../db/schema/index.js";
import { EntityTagAssignmentsRepository } from "../../../db/repositories/entity-tag-assignments.repository.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { EntityTagService } from "../../../services/entity-tag.service.js";
import type { PermissionContext } from "../../../services/permission.service.js";
import { ApiError } from "../../../services/http.service.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  allowForUser,
  generateId,
  seedTenancyFixture,
  teardownOrg,
  type TenancyFixture,
} from "../utils/application.util.js";
import { seedTag, seedTagTargets } from "../utils/tag-targets.util.js";

type Db = ReturnType<typeof drizzle>;

/** Run `fn` and return the `ApiError` it throws (fails if it doesn't). */
async function apiError(fn: () => Promise<unknown>): Promise<ApiError> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error("expected an ApiError");
}

const ALL = (n: number) =>
  Object.fromEntries(TAG_TARGET_TYPES.map((t) => [t, n])) as Record<
    TagTargetType,
    number
  >;

const PAGE = {
  limit: 50,
  offset: 0,
  sortBy: "name" as const,
  sortOrder: "asc" as const,
};

describe("EntityTagService (#1071)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: Db;
  let fx!: TenancyFixture;
  let owner!: PermissionContext;
  let member!: PermissionContext;
  let foreign!: PermissionContext;
  const repo = new EntityTagAssignmentsRepository();

  const tagAll = async (
    tagId: string,
    targets: Record<TagTargetType, string>
  ) => {
    for (const type of TAG_TARGET_TYPES) {
      await repo.insertIfAbsent(
        { type, id: targets[type] },
        tagId,
        {
          id: generateId(),
          organizationId: fx.orgId,
          created: Date.now(),
          createdBy: "SYSTEM_TEST",
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        },
        db as DbClient
      );
    }
  };

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);
    fx = await seedTenancyFixture(db, {
      owner: "auth0|ets-owner",
      member: "auth0|ets-member",
      otherOwner: "auth0|ets-other",
    });
    owner = { userId: fx.ownerId, organizationId: fx.orgId, roles: ["owner"] };
    member = {
      userId: fx.memberId,
      organizationId: fx.orgId,
      roles: ["member"],
    };
    foreign = {
      userId: fx.otherOwnerId,
      organizationId: fx.otherOrgId,
      roles: ["owner"],
    };
  });

  afterEach(async () => {
    await teardownOrg(db);
    await connection.end();
  });

  describe("list", () => {
    it("returns only tags in the caller's org, with capabilities", async () => {
      await seedTag(db, fx.orgId, fx.ownerId, "Finance");
      await seedTag(db, fx.otherOrgId, fx.otherOwnerId, "Elsewhere");

      const { entityTags, total } = await EntityTagService.list(owner, PAGE);

      expect(total).toBe(1);
      expect(entityTags.map((t) => t.name)).toEqual(["Finance"]);
      expect(entityTags[0].capabilities).toMatchObject({
        read: true,
        write: true,
        delete: true,
      });
    });

    it("returns nothing to a member without tag read", async () => {
      await seedTag(db, fx.orgId, fx.ownerId, "Finance");
      const { entityTags, total } = await EntityTagService.list(member, PAGE);
      expect(total).toBe(0);
      expect(entityTags).toEqual([]);
    });

    it("matches search on name or description", async () => {
      await seedTag(db, fx.orgId, fx.ownerId, "Finance");
      await seedTag(db, fx.orgId, fx.ownerId, "Sales");
      const { entityTags } = await EntityTagService.list(owner, {
        ...PAGE,
        search: "fin",
      });
      expect(entityTags.map((t) => t.name)).toEqual(["Finance"]);
    });

    it("adds readable usage when asked", async () => {
      const tag = await seedTag(db, fx.orgId, fx.ownerId, "Finance");
      await tagAll(tag, await seedTagTargets(db, fx.orgId, fx.ownerId));
      const { entityTags } = await EntityTagService.list(owner, {
        ...PAGE,
        includeUsage: true,
      });
      expect(entityTags[0].usage).toEqual(ALL(1));
    });
  });

  describe("create", () => {
    it("creates a tag for a caller with class write", async () => {
      const tag = await EntityTagService.create(owner, {
        name: "Finance",
        color: "#2563EB",
      });
      expect(tag).toMatchObject({
        name: "Finance",
        color: "#2563EB",
        description: null,
        organizationId: fx.orgId,
        createdBy: fx.ownerId,
      });
    });

    it("records no session for a tag created outside one", async () => {
      const tag = await EntityTagService.create(owner, { name: "Finance" });
      expect(tag.sourcePortalId).toBeNull();
    });

    it("records the portal session that created a tag (#641)", async () => {
      const tag = await EntityTagService.create(
        owner,
        { name: "Finance" },
        { sourcePortalId: "portal-1" }
      );
      expect(tag.sourcePortalId).toBe("portal-1");
      const [row] = await db
        .select()
        .from(schema.entityTags)
        .where(eq(schema.entityTags.id, tag.id));
      expect(row.sourcePortalId).toBe("portal-1");
      // Provenance only: the prompting user still owns it.
      expect(row.createdBy).toBe(fx.ownerId);
    });

    it("refuses a member without class write (403)", async () => {
      const err = await apiError(() =>
        EntityTagService.create(member, { name: "Finance" })
      );
      expect(err.status).toBe(403);
    });

    it("refuses a duplicate name (409)", async () => {
      await seedTag(db, fx.orgId, fx.ownerId, "Finance");
      const err = await apiError(() =>
        EntityTagService.create(owner, { name: "Finance" })
      );
      expect(err.status).toBe(409);
      expect(err.code).toBe(ApiCode.ENTITY_TAG_DUPLICATE_NAME);
    });
  });

  describe("update", () => {
    it("updates a tag the caller may write", async () => {
      const id = await seedTag(db, fx.orgId, fx.ownerId, "Finance");
      const tag = await EntityTagService.update(owner, id, {
        description: "Money things",
      });
      expect(tag).toMatchObject({
        id,
        name: "Finance",
        description: "Money things",
        updatedBy: fx.ownerId,
      });
    });

    it("answers 404 for a tag the caller can't read", async () => {
      const id = await seedTag(db, fx.orgId, fx.ownerId, "Finance");
      const err = await apiError(() =>
        EntityTagService.update(member, id, { name: "Renamed" })
      );
      expect(err.status).toBe(404);
      expect(err.code).toBe(ApiCode.ENTITY_TAG_NOT_FOUND);
    });

    it("answers 404 for another org's tag", async () => {
      const id = await seedTag(db, fx.orgId, fx.ownerId, "Finance");
      const err = await apiError(() =>
        EntityTagService.update(foreign, id, { name: "Renamed" })
      );
      expect(err.status).toBe(404);
    });

    it("answers 403 for a tag the caller reads but can't write", async () => {
      const id = await seedTag(db, fx.orgId, fx.ownerId, "Finance");
      await allowForUser(db, {
        organizationId: fx.orgId,
        userId: fx.memberId,
        verb: "read",
        resourceType: "tag",
      });
      const err = await apiError(() =>
        EntityTagService.update(member, id, { name: "Renamed" })
      );
      expect(err.status).toBe(403);
    });

    it("refuses a rename onto an existing name (409)", async () => {
      const id = await seedTag(db, fx.orgId, fx.ownerId, "Finance");
      await seedTag(db, fx.orgId, fx.ownerId, "Sales");
      const err = await apiError(() =>
        EntityTagService.update(owner, id, { name: "Sales" })
      );
      expect(err.status).toBe(409);
      expect(err.code).toBe(ApiCode.ENTITY_TAG_DUPLICATE_NAME);
    });
  });

  describe("delete", () => {
    it("removes the tag from every object and reports only readable ones", async () => {
      const id = await seedTag(db, fx.orgId, fx.ownerId, "Finance");
      // The member reads their own objects but not the owner's.
      await tagAll(id, await seedTagTargets(db, fx.orgId, fx.memberId, "m"));
      await tagAll(id, await seedTagTargets(db, fx.orgId, fx.ownerId, "o"));
      for (const verb of ["read", "delete"] as const) {
        await allowForUser(db, {
          organizationId: fx.orgId,
          userId: fx.memberId,
          verb,
          resourceType: "tag",
        });
      }

      const result = await EntityTagService.delete(member, id, {
        countRemoved: true,
      });

      expect(result).toEqual({ id, removedFrom: ALL(1) });
      const live = await db
        .select()
        .from(schema.entityTagAssignments)
        .where(eq(schema.entityTagAssignments.entityTagId, id));
      expect(live.every((a) => a.deleted !== null)).toBe(true);
      expect(live).toHaveLength(TAG_TARGET_TYPES.length * 2);
      const [tag] = await db
        .select()
        .from(schema.entityTags)
        .where(eq(schema.entityTags.id, id));
      expect(tag.deleted).not.toBeNull();
    });

    it("counts nothing unless asked, as the route doesn't", async () => {
      const id = await seedTag(db, fx.orgId, fx.ownerId, "Finance");
      await tagAll(id, await seedTagTargets(db, fx.orgId, fx.ownerId, "o"));
      expect(await EntityTagService.delete(owner, id)).toEqual({ id });
    });

    it("answers 404 for a tag another delete already removed", async () => {
      const id = await seedTag(db, fx.orgId, fx.ownerId, "Finance");
      await EntityTagService.delete(owner, id);
      const err = await apiError(() => EntityTagService.delete(owner, id));
      expect(err.status).toBe(404);
    });

    it("answers 404 for a tag the caller can't read", async () => {
      const id = await seedTag(db, fx.orgId, fx.ownerId, "Finance");
      const err = await apiError(() => EntityTagService.delete(member, id));
      expect(err.status).toBe(404);
      expect(err.code).toBe(ApiCode.ENTITY_TAG_NOT_FOUND);
    });

    it("answers 403 for a tag the caller reads but can't delete", async () => {
      const id = await seedTag(db, fx.orgId, fx.ownerId, "Finance");
      await allowForUser(db, {
        organizationId: fx.orgId,
        userId: fx.memberId,
        verb: "read",
        resourceType: "tag",
      });
      const err = await apiError(() => EntityTagService.delete(member, id));
      expect(err.status).toBe(403);
    });
  });
});
