/**
 * #1070: the tag assignment routes, one table row per taggable type. Every
 * type answers the same way: the object must be in the caller's org and
 * readable (404 otherwise), a change needs write on it (403), and the tag
 * must be readable in the org (404).
 *
 * Fixture: an org owner, a plain member and another org's owner. The member
 * owns one object of each type and is granted tag read, since a member holds
 * no tag permission by default.
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
import { and, eq, isNull } from "drizzle-orm";

import type { TagTargetType } from "@portalai/core/models";

import * as schema from "../../../db/schema/index.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  allowForUser,
  denyForUser,
  generateId,
  seedTenancyFixture,
  teardownOrg,
  type TenancyFixture,
} from "../utils/application.util.js";
import { seedTag, seedTagTargets } from "../utils/tag-targets.util.js";

const OWNER_SUB = "auth0|tag-assign-owner";
const MEMBER_SUB = "auth0|tag-assign-member";
const OTHER_SUB = "auth0|tag-assign-other";

let currentSub = OWNER_SUB;

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

type Db = ReturnType<typeof drizzle>;

const TYPES: { type: TagTargetType; path: string; notFound: ApiCode }[] = [
  {
    type: "entity",
    path: "connector-entities",
    notFound: ApiCode.CONNECTOR_ENTITY_NOT_FOUND,
  },
  { type: "station", path: "stations", notFound: ApiCode.STATION_NOT_FOUND },
  {
    type: "pin",
    path: "portal-results",
    notFound: ApiCode.PORTAL_RESULT_NOT_FOUND,
  },
  {
    type: "connector_instance",
    path: "connector-instances",
    notFound: ApiCode.CONNECTOR_INSTANCE_NOT_FOUND,
  },
  {
    type: "curated_view",
    path: "curated-views",
    notFound: ApiCode.CURATED_VIEW_NOT_FOUND,
  },
];

describe.each(TYPES)(
  "tag assignment routes on $type (#1070)",
  ({ type, path, notFound }) => {
    let connection!: ReturnType<typeof postgres>;
    let db!: Db;
    let fx!: TenancyFixture;
    let mine!: Record<TagTargetType, string>;
    let mineToo!: Record<TagTargetType, string>;
    let owners!: Record<TagTargetType, string>;
    let tagId!: string;

    const url = (id: string) => `/api/${path}/${id}/tags`;
    const liveAssignments = (targetId: string) =>
      db
        .select()
        .from(schema.entityTagAssignments)
        .where(isNull(schema.entityTagAssignments.deleted))
        .then((rows) =>
          rows.filter((r) =>
            [
              r.connectorEntityId,
              r.stationId,
              r.portalResultId,
              r.connectorInstanceId,
              r.curatedViewId,
            ].includes(targetId)
          )
        );

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
      mine = await seedTagTargets(db, fx.orgId, fx.memberId);
      mineToo = await seedTagTargets(db, fx.orgId, fx.memberId);
      owners = await seedTagTargets(db, fx.orgId, fx.ownerId);
      tagId = await seedTag(db, fx.orgId, fx.ownerId);
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

    it("assigns a tag (201) and lists it", async () => {
      const res = await request(app)
        .post(url(mine[type]))
        .send({ entityTagId: tagId });
      expect(res.status).toBe(201);
      expect(res.body.payload.entityTagAssignment.entityTagId).toBe(tagId);

      const list = await request(app).get(url(mine[type]));
      expect(list.status).toBe(200);
      expect(list.body.payload.tags).toEqual([
        expect.objectContaining({
          id: tagId,
          assignmentId: res.body.payload.entityTagAssignment.id,
        }),
      ]);
    });

    it("answers 409 for a tag already on the object", async () => {
      await request(app).post(url(mine[type])).send({ entityTagId: tagId });
      const again = await request(app)
        .post(url(mine[type]))
        .send({ entityTagId: tagId });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe(
        ApiCode.ENTITY_TAG_ASSIGNMENT_ALREADY_EXISTS
      );
    });

    it("answers one 201 and one 409 to two concurrent assigns, never a 500", async () => {
      const results = await Promise.all([
        request(app).post(url(mine[type])).send({ entityTagId: tagId }),
        request(app).post(url(mine[type])).send({ entityTagId: tagId }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await liveAssignments(mine[type])).toHaveLength(1);
    });

    it("refuses a caller who can read the object but not write it (403)", async () => {
      const assigned = await request(app)
        .post(url(mine[type]))
        .send({ entityTagId: tagId });
      await denyForUser(db, {
        organizationId: fx.orgId,
        userId: fx.memberId,
        verb: "write",
        resourceType: type,
      });

      const list = await request(app).get(url(mine[type]));
      expect(list.status).toBe(200);
      const post = await request(app)
        .post(url(mine[type]))
        .send({ entityTagId: tagId });
      expect(post.status).toBe(403);
      const del = await request(app).delete(
        `${url(mine[type])}/${assigned.body.payload.entityTagAssignment.id}`
      );
      expect(del.status).toBe(403);
      expect(await liveAssignments(mine[type])).toHaveLength(1);
    });

    it("answers 404 for an object the caller can't read", async () => {
      for (const res of [
        await request(app).get(url(owners[type])),
        await request(app).post(url(owners[type])).send({ entityTagId: tagId }),
      ]) {
        expect(res.status).toBe(404);
        expect(res.body.code).toBe(notFound);
      }
    });

    it("answers 404 for another org's object", async () => {
      currentSub = OWNER_SUB;
      const theirs = await seedTagTargets(db, fx.otherOrgId, fx.otherOwnerId);
      const res = await request(app)
        .post(url(theirs[type]))
        .send({ entityTagId: tagId });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(notFound);
    });

    it("answers 404 for another org's tag", async () => {
      const theirTag = await seedTag(db, fx.otherOrgId, fx.otherOwnerId);
      const res = await request(app)
        .post(url(mine[type]))
        .send({ entityTagId: theirTag });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.ENTITY_TAG_NOT_FOUND);
    });

    it("answers 404 for a tag the caller can't read", async () => {
      await denyForUser(db, {
        organizationId: fx.orgId,
        userId: fx.memberId,
        verb: "read",
        resourceType: "tag",
      });
      const res = await request(app)
        .post(url(mine[type]))
        .send({ entityTagId: tagId });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.ENTITY_TAG_NOT_FOUND);
    });

    it("lists only tags the caller can read", async () => {
      currentSub = OWNER_SUB;
      await request(app).post(url(mine[type])).send({ entityTagId: tagId });
      currentSub = MEMBER_SUB;
      await denyForUser(db, {
        organizationId: fx.orgId,
        userId: fx.memberId,
        verb: "read",
        resourceType: "tag",
      });
      const list = await request(app).get(url(mine[type]));
      expect(list.status).toBe(200);
      expect(list.body.payload.tags).toEqual([]);
    });

    it("removes a tag (200) and can assign it again", async () => {
      const assigned = await request(app)
        .post(url(mine[type]))
        .send({ entityTagId: tagId });
      const id = assigned.body.payload.entityTagAssignment.id;
      const del = await request(app).delete(`${url(mine[type])}/${id}`);
      expect(del.status).toBe(200);
      expect(del.body.payload.id).toBe(id);
      expect(await liveAssignments(mine[type])).toHaveLength(0);

      const again = await request(app)
        .post(url(mine[type]))
        .send({ entityTagId: tagId });
      expect(again.status).toBe(201);
    });

    it("answers 404 removing an assignment that sits on another object", async () => {
      const assigned = await request(app)
        .post(url(mineToo[type]))
        .send({ entityTagId: tagId });
      const id = assigned.body.payload.entityTagAssignment.id;
      const res = await request(app).delete(`${url(mine[type])}/${id}`);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.ENTITY_TAG_ASSIGNMENT_NOT_FOUND);
      expect(await liveAssignments(mineToo[type])).toHaveLength(1);
    });

    it("refuses an unknown body key (400)", async () => {
      const res = await request(app)
        .post(url(mine[type]))
        .send({ entityTagId: tagId, extra: 1 });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.ENTITY_TAG_ASSIGNMENT_INVALID_PAYLOAD);
      const rows = await db
        .select()
        .from(schema.entityTagAssignments)
        .where(
          and(
            eq(schema.entityTagAssignments.organizationId, fx.orgId),
            isNull(schema.entityTagAssignments.deleted)
          )
        );
      expect(rows).toHaveLength(0);
    });
  }
);

/**
 * #1070: tagging is metadata, not entity data, so a running job doesn't
 * block it, the same rule entity tagging already followed.
 */
describe("tag assignment under a running job (#1070)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: Db;
  let fx!: TenancyFixture;

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
    currentSub = OWNER_SUB;
  });

  afterEach(async () => {
    await teardownOrg(db);
    await connection.end();
  });

  it("tags a connector and its entity while a sync runs on it", async () => {
    const targets = await seedTagTargets(db, fx.orgId, fx.ownerId);
    const tagId = await seedTag(db, fx.orgId, fx.ownerId);
    await db.insert(schema.jobs).values({
      id: generateId(),
      created: Date.now(),
      createdBy: fx.ownerId,
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId: fx.orgId,
      type: "connector_sync",
      status: "active",
      progress: 10,
      metadata: { connectorInstanceId: targets.connector_instance },
      attempts: 1,
      maxAttempts: 3,
      lockScopes: [`instance:${targets.connector_instance}`],
    } as never);

    const onInstance = await request(app)
      .post(`/api/connector-instances/${targets.connector_instance}/tags`)
      .send({ entityTagId: tagId });
    expect(onInstance.status).toBe(201);
    const onEntity = await request(app)
      .post(`/api/connector-entities/${targets.entity}/tags`)
      .send({ entityTagId: tagId });
    expect(onEntity.status).toBe(201);
  });
});
