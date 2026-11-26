/**
 * #1076: `GET /api/search`, the command palette's read-scoped search. Every
 * mode returns only what the caller can read in their active org.
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
import { eq } from "drizzle-orm";

import type { TagTargetType } from "@portalai/core/models";

import * as schema from "../../../db/schema/index.js";
import {
  allowForUser,
  generateId,
  seedTenancyFixture,
  teardownOrg,
  type TenancyFixture,
} from "../utils/application.util.js";
import { seedTag, seedTagTargets } from "../utils/tag-targets.util.js";

const OWNER_SUB = "auth0|search-owner";
const MEMBER_SUB = "auth0|search-member";
const OTHER_SUB = "auth0|search-other";
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
type Result = {
  type: string;
  id: string;
  name: string;
  tags: { id: string }[];
};

const TAG_COLUMN: Record<
  TagTargetType,
  | "connectorEntityId"
  | "stationId"
  | "portalResultId"
  | "curatedViewId"
  | "connectorInstanceId"
> = {
  entity: "connectorEntityId",
  station: "stationId",
  pin: "portalResultId",
  curated_view: "curatedViewId",
  connector_instance: "connectorInstanceId",
};

describe("GET /api/search (#1076)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: Db;
  let fx!: TenancyFixture;

  const search = async (
    qs: string
  ): Promise<{
    results: Result[];
    matchedTags?: { id: string; name: string }[];
  }> => {
    const res = await request(app).get(`/api/search${qs}`);
    expect(res.status).toBe(200);
    return res.body.payload;
  };
  const ids = (results: Result[]) => results.map((r) => r.id);

  const base = (createdBy: string) => ({
    id: generateId(),
    created: Date.now(),
    createdBy,
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  });

  async function portal(orgId: string, createdBy: string, name: string) {
    const station = {
      ...base(createdBy),
      organizationId: orgId,
      name: `Holder ${generateId().slice(0, 6)}`,
    };
    await db.insert(schema.stations).values(station as never);
    const row = {
      ...base(createdBy),
      organizationId: orgId,
      stationId: station.id,
      name,
      lastOpened: null,
    };
    await db.insert(schema.portals).values(row as never);
    return row.id;
  }

  async function assign(
    orgId: string,
    tagId: string,
    type: TagTargetType,
    targetId: string
  ) {
    await db.insert(schema.entityTagAssignments).values({
      ...base(fx.ownerId),
      organizationId: orgId,
      entityTagId: tagId,
      connectorEntityId: null,
      stationId: null,
      portalResultId: null,
      curatedViewId: null,
      connectorInstanceId: null,
      [TAG_COLUMN[type]]: targetId,
    } as never);
  }

  /** A member reads no tag by default; this grants read on their own. */
  async function memberReadsOwnTags() {
    await db.insert(schema.permissionGrants).values({
      ...base("SYSTEM_TEST"),
      organizationId: fx.orgId,
      principalType: "user",
      principalId: fx.memberId,
      effect: "allow",
      verb: "read",
      resourceType: "tag",
      resourceId: null,
      condition: "created_by_caller",
      conditionParam: null,
    } as never);
  }

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

  describe("q", () => {
    it("finds every type by name, in type order", async () => {
      const t = await seedTagTargets(db, fx.orgId, fx.ownerId, "Zephyr");
      const p = await portal(fx.orgId, fx.ownerId, "Zephyr chat");
      const { results } = await search("?q=zephyr");
      expect(results.map((r) => [r.type, r.id])).toEqual([
        ["station", t.station],
        ["pin", t.pin],
        ["curated_view", t.curated_view],
        ["connector_instance", t.connector_instance],
        ["entity", t.entity],
        ["portal", p],
      ]);
      expect(results.every((r) => r.name.startsWith("Zephyr"))).toBe(true);
    });

    it("finds an entity by its key", async () => {
      const t = await seedTagTargets(db, fx.orgId, fx.ownerId, "Keyed");
      const [entity] = await db
        .select()
        .from(schema.connectorEntities)
        .where(eq(schema.connectorEntities.id, t.entity));
      const { results } = await search(`?q=${entity.key}`);
      expect(
        results.filter((r) => r.type === "entity").map((r) => r.id)
      ).toEqual([t.entity]);
    });

    it("puts prefix matches before substring matches", async () => {
      const inner = await seedTagTargets(db, fx.orgId, fx.ownerId, "Big Atlas");
      const prefix = await seedTagTargets(db, fx.orgId, fx.ownerId, "Atlas");
      const { results } = await search("?q=atlas");
      expect(
        results.filter((r) => r.type === "station").map((r) => r.id)
      ).toEqual([prefix.station, inner.station]);
    });

    it("returns at most 5 per type", async () => {
      for (let i = 0; i < 7; i++) {
        await seedTagTargets(db, fx.orgId, fx.ownerId, `Many ${i}`);
      }
      const { results } = await search("?q=many");
      expect(results.filter((r) => r.type === "station")).toHaveLength(5);
    });

    it("matches % and _ literally", async () => {
      await seedTagTargets(db, fx.orgId, fx.ownerId, "Plain");
      const odd = await seedTagTargets(db, fx.orgId, fx.ownerId, "Q1_100%");
      expect(ids((await search("?q=%25")).results)).toEqual(
        expect.arrayContaining([odd.station])
      );
      expect(
        (await search("?q=%25")).results.filter((r) => r.type === "station")
      ).toHaveLength(1);
      expect(
        (await search("?q=_")).results.filter((r) => r.type === "station")
      ).toHaveLength(1);
    });
  });

  describe("read safety", () => {
    it("never shows a member another member's unshared objects", async () => {
      await seedTagTargets(db, fx.orgId, fx.ownerId, "Secret");
      await portal(fx.orgId, fx.ownerId, "Secret chat");
      currentSub = MEMBER_SUB;
      expect((await search("?q=secret")).results).toEqual([]);
    });

    it("never shows an owner another user's portal (#1127)", async () => {
      await portal(fx.orgId, fx.memberId, "Member chat");
      const own = await portal(fx.orgId, fx.ownerId, "Owner chat");
      const { results } = await search("?q=chat");
      expect(
        results.filter((r) => r.type === "portal").map((r) => r.id)
      ).toEqual([own]);
    });

    it("never returns another org's objects", async () => {
      await seedTagTargets(db, fx.otherOrgId, fx.otherOwnerId, "Foreign");
      await portal(fx.otherOrgId, fx.otherOwnerId, "Foreign chat");
      expect((await search("?q=foreign")).results).toEqual([]);
    });

    it("never returns a deleted object", async () => {
      const t = await seedTagTargets(db, fx.orgId, fx.ownerId, "Gone");
      await db
        .update(schema.stations)
        .set({ deleted: Date.now(), deletedBy: fx.ownerId } as never)
        .where(eq(schema.stations.id, t.station));
      const { results } = await search("?q=gone");
      expect(ids(results)).not.toContain(t.station);
    });

    it("shows a member what a grant lets them read", async () => {
      const t = await seedTagTargets(db, fx.orgId, fx.ownerId, "Granted");
      await allowForUser(db, {
        organizationId: fx.orgId,
        userId: fx.memberId,
        verb: "read",
        resourceType: "station",
      });
      currentSub = MEMBER_SUB;
      expect(ids((await search("?q=granted")).results)).toEqual([t.station]);
    });
  });

  describe("tag", () => {
    it("returns objects of every taggable type carrying a matching tag", async () => {
      const t = await seedTagTargets(db, fx.orgId, fx.ownerId, "Tagged");
      await seedTagTargets(db, fx.orgId, fx.ownerId, "Untagged");
      const finance = await seedTag(db, fx.orgId, fx.ownerId, "Finance");
      for (const type of Object.keys(TAG_COLUMN) as TagTargetType[]) {
        await assign(fx.orgId, finance, type, t[type]);
      }
      const { results, matchedTags } = await search("?tag=fin");
      expect(matchedTags).toEqual([{ id: finance, name: "Finance" }]);
      expect(ids(results).sort()).toEqual(Object.values(t).sort());
      expect(results.every((r) => r.tags.some((x) => x.id === finance))).toBe(
        true
      );
      expect(results.some((r) => r.type === "portal")).toBe(false);
    });

    it("matches nothing through a tag the caller can't read", async () => {
      const t = await seedTagTargets(db, fx.orgId, fx.memberId, "Mine");
      const hidden = await seedTag(db, fx.orgId, fx.ownerId, "Hidden");
      await assign(fx.orgId, hidden, "station", t.station);
      currentSub = MEMBER_SUB;
      expect(await search("?tag=hidden")).toEqual({
        results: [],
        matchedTags: [],
      });
    });

    it("doesn't return an unreadable object carrying a readable tag", async () => {
      const ownerObjects = await seedTagTargets(
        db,
        fx.orgId,
        fx.ownerId,
        "Owners"
      );
      const memberObjects = await seedTagTargets(
        db,
        fx.orgId,
        fx.memberId,
        "Members"
      );
      const tag = await seedTag(db, fx.orgId, fx.memberId, "Shared");
      await assign(fx.orgId, tag, "station", ownerObjects.station);
      await assign(fx.orgId, tag, "station", memberObjects.station);
      await memberReadsOwnTags();
      currentSub = MEMBER_SUB;
      expect(ids((await search("?tag=shared")).results)).toEqual([
        memberObjects.station,
      ]);
    });
  });

  describe("favorites (no mode)", () => {
    it("returns only the caller's favorites, never entities or portals", async () => {
      const starred = await seedTagTargets(db, fx.orgId, fx.ownerId, "Starred");
      await seedTagTargets(db, fx.orgId, fx.ownerId, "Plain");
      for (const [type, path] of [
        ["station", starred.station],
        ["pin", starred.pin],
        ["curated_view", starred.curated_view],
        ["connector_instance", starred.connector_instance],
      ]) {
        await request(app).put(`/api/favorites/${type}/${path}`).expect(200);
      }
      const { results } = await search("");
      expect(results.map((r) => r.type)).toEqual([
        "station",
        "pin",
        "curated_view",
        "connector_instance",
      ]);
      expect(results.every((r) => r.name === "Starred")).toBe(true);
    });

    it("hides a favorite the caller can no longer read", async () => {
      const t = await seedTagTargets(db, fx.orgId, fx.ownerId, "Was shared");
      await allowForUser(db, {
        organizationId: fx.orgId,
        userId: fx.memberId,
        verb: "read",
        resourceType: "station",
      });
      currentSub = MEMBER_SUB;
      await request(app).put(`/api/favorites/station/${t.station}`).expect(200);
      expect(ids((await search("")).results)).toEqual([t.station]);
      await db
        .delete(schema.policyAttachments)
        .where(eq(schema.policyAttachments.principalId, fx.memberId));
      expect((await search("")).results).toEqual([]);
    });
  });

  describe("refs", () => {
    it("returns the readable subset in the request's order", async () => {
      const own = await seedTagTargets(db, fx.orgId, fx.memberId, "Own");
      const p = await portal(fx.orgId, fx.memberId, "Own chat");
      const owners = await seedTagTargets(db, fx.orgId, fx.ownerId, "Owners");
      const foreign = await seedTagTargets(
        db,
        fx.otherOrgId,
        fx.otherOwnerId,
        "Far"
      );
      const deleted = await seedTagTargets(
        db,
        fx.orgId,
        fx.memberId,
        "Deleted"
      );
      await db
        .update(schema.curatedViews)
        .set({ deleted: Date.now(), deletedBy: fx.memberId } as never)
        .where(eq(schema.curatedViews.id, deleted.curated_view));
      currentSub = MEMBER_SUB;
      const refs = [
        `portal:${p}`,
        `station:${owners.station}`,
        `curated_view:${deleted.curated_view}`,
        `entity:${own.entity}`,
        `station:${foreign.station}`,
        `station:${own.station}`,
        `pin:missing-id`,
      ].join(",");
      const { results } = await search(`?refs=${encodeURIComponent(refs)}`);
      expect(results.map((r) => `${r.type}:${r.id}`)).toEqual([
        `portal:${p}`,
        `entity:${own.entity}`,
        `station:${own.station}`,
      ]);
    });
  });

  it("attaches only readable tags", async () => {
    const t = await seedTagTargets(db, fx.orgId, fx.memberId, "Visible");
    const mine = await seedTag(db, fx.orgId, fx.memberId, "Mine");
    const hidden = await seedTag(db, fx.orgId, fx.ownerId, "Hidden");
    await assign(fx.orgId, mine, "station", t.station);
    await assign(fx.orgId, hidden, "station", t.station);
    await memberReadsOwnTags();
    currentSub = MEMBER_SUB;
    const { results } = await search("?q=visible");
    const station = results.find((r) => r.type === "station")!;
    expect(station.tags.map((x) => x.id)).toEqual([mine]);
  });
});
