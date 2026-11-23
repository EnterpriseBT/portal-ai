/**
 * #1070: every taggable list filters by tag (`tagIds`, any-match) and
 * attaches tags (`include=tags`), both limited to tags the caller can read.
 * The filter composes with search and paging and never returns an object
 * the caller can't read.
 *
 * Fixture: a member owns three objects of each type, "alpha" (tag one),
 * "beta" (tag two) and "gamma" (untagged). The org owner owns a fourth
 * carrying tag one, which the member can't read. The member is granted tag
 * read, since a member holds no tag permission by default.
 */

import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import request from "supertest";
import { Request, Response, NextFunction } from "express";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { TagTargetType } from "@portalai/core/models";

import * as schema from "../../../db/schema/index.js";
import { EntityTagAssignmentsRepository } from "../../../db/repositories/entity-tag-assignments.repository.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import {
  allowForUser,
  denyForUser,
  generateId,
  seedTenancyFixture,
  teardownOrg,
  type TenancyFixture,
} from "../utils/application.util.js";
import { seedTag, seedTagTargets } from "../utils/tag-targets.util.js";

const OWNER_SUB = "auth0|tag-list-owner";
const MEMBER_SUB = "auth0|tag-list-member";
const OTHER_SUB = "auth0|tag-list-other";

let currentSub = MEMBER_SUB;

jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { payload: { sub: currentSub } } as never;
    next();
  },
}));

jest.unstable_mockModule("../../../services/auth0.service.js", () => ({
  Auth0Service: {
    hasAccessToken: jest.fn(),
    getAccessToken: jest.fn(),
    getAuth0UserProfile: jest.fn(),
  },
}));

const { app } = await import("../../../app.js");

const LISTS: { type: TagTargetType; path: string; key: string }[] = [
  { type: "entity", path: "connector-entities", key: "connectorEntities" },
  { type: "station", path: "stations", key: "stations" },
  { type: "pin", path: "portal-results", key: "portalResults" },
  {
    type: "connector_instance",
    path: "connector-instances",
    key: "connectorInstances",
  },
  { type: "curated_view", path: "curated-views", key: "curatedViews" },
];

describe.each(LISTS)(
  "tag list filter on $path (#1070)",
  ({ type, path, key }) => {
    let connection!: ReturnType<typeof postgres>;
    let db!: ReturnType<typeof drizzle>;
    let fx!: TenancyFixture;
    let alpha!: string;
    let beta!: string;
    let tagOne!: string;
    let tagTwo!: string;
    const repo = new EntityTagAssignmentsRepository();

    const tag = (targetId: string, tagId: string, orgId: string) =>
      repo.insertIfAbsent(
        { type, id: targetId },
        tagId,
        {
          id: generateId(),
          organizationId: orgId,
          created: Date.now(),
          createdBy: "SYSTEM_TEST",
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        },
        db as DbClient
      );

    const list = async (query: string) => {
      const res = await request(app).get(`/api/${path}?${query}`);
      expect(res.status).toBe(200);
      return res.body.payload as Record<string, unknown> & { total: number };
    };
    const ids = (payload: Record<string, unknown>) =>
      (payload[key] as { id: string }[]).map((row) => row.id).sort();

    beforeEach(async () => {
      if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
      connection = postgres(process.env.DATABASE_URL, { max: 1 });
      db = drizzle(connection, { schema });
      await teardownOrg(db);
      fx = await seedTenancyFixture(db, {
        owner: OWNER_SUB,
        member: MEMBER_SUB,
        otherOwner: OTHER_SUB,
      });
      alpha = (await seedTagTargets(db, fx.orgId, fx.memberId, "alpha"))[type];
      beta = (await seedTagTargets(db, fx.orgId, fx.memberId, "beta"))[type];
      await seedTagTargets(db, fx.orgId, fx.memberId, "gamma");
      const ownersAlpha = (
        await seedTagTargets(db, fx.orgId, fx.ownerId, "alpha")
      )[type];
      tagOne = await seedTag(db, fx.orgId, fx.ownerId, "One");
      tagTwo = await seedTag(db, fx.orgId, fx.ownerId, "Two");
      await tag(alpha, tagOne, fx.orgId);
      await tag(beta, tagTwo, fx.orgId);
      await tag(ownersAlpha, tagOne, fx.orgId);
      await allowForUser(db, {
        organizationId: fx.orgId,
        userId: fx.memberId,
        verb: "read",
        resourceType: "tag",
      });
      currentSub = MEMBER_SUB;
    });

    afterEach(async () => {
      await teardownOrg(db);
      await connection.end();
    });

    it("returns only readable objects carrying any of the tags", async () => {
      const one = await list(`tagIds=${tagOne}`);
      expect(ids(one)).toEqual([alpha]);
      expect(one.total).toBe(1);

      const both = await list(`tagIds=${tagOne},${tagTwo}`);
      expect(ids(both)).toEqual([alpha, beta].sort());
      expect(both.total).toBe(2);
    });

    it("composes with search and paging", async () => {
      const searched = await list(`tagIds=${tagOne},${tagTwo}&search=beta`);
      expect(ids(searched)).toEqual([beta]);
      expect(searched.total).toBe(1);

      const paged = await list(`tagIds=${tagOne},${tagTwo}&limit=1&offset=0`);
      expect(ids(paged)).toHaveLength(1);
      expect(paged.total).toBe(2);
    });

    it("matches nothing for another org's tag", async () => {
      const theirTag = await seedTag(db, fx.otherOrgId, fx.otherOwnerId);
      // Planted below the API (which refuses a foreign tag), so the filter
      // alone has to keep it from matching.
      await tag(alpha, theirTag, fx.orgId);
      const res = await list(`tagIds=${theirTag}`);
      expect(ids(res)).toEqual([]);
      expect(res.total).toBe(0);
    });

    it("attaches only readable tags with include=tags, and hides unreadable ones", async () => {
      const withTags = await list(`tagIds=${tagOne}&include=tags`);
      const rows = withTags[key] as { id: string; tags: { id: string }[] }[];
      expect(rows[0]!.tags.map((t) => t.id)).toEqual([tagOne]);

      await denyForUser(db, {
        organizationId: fx.orgId,
        userId: fx.memberId,
        verb: "read",
        resourceType: "tag",
      });
      const hidden = await list(`tagIds=${tagOne}`);
      expect(hidden.total).toBe(0);
      const all = await list(`include=tags&search=alpha`);
      const allRows = all[key] as { id: string; tags: unknown[] }[];
      expect(allRows.map((r) => r.id)).toEqual([alpha]);
      expect(allRows[0]!.tags).toEqual([]);
    });
  }
);
