/**
 * #1072: PUT / DELETE /api/favorites/:type/:id. A favorite is the caller's
 * own data, so both verbs need only read on the object, and an object the
 * caller can't read answers its own 404 to both. Both are idempotent.
 *
 * Fixture: an org owner, a plain member and another org's owner. By default
 * the member can't read the owner's objects; a read grant makes them
 * read-only to the member.
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
import { and, eq } from "drizzle-orm";

import type { FavoriteTargetType } from "@portalai/core/models";

import * as schema from "../../../db/schema/index.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  allowForUser,
  generateId,
  seedTenancyFixture,
  teardownOrg,
  type TenancyFixture,
} from "../utils/application.util.js";
import { seedTagTargets } from "../utils/tag-targets.util.js";

const OWNER_SUB = "auth0|fav-route-owner";
const MEMBER_SUB = "auth0|fav-route-member";
const OTHER_SUB = "auth0|fav-route-other";

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

const TYPES: {
  type: FavoriteTargetType;
  table:
    | typeof schema.stations
    | typeof schema.portalResults
    | typeof schema.curatedViews
    | typeof schema.connectorInstances;
  notFound: ApiCode;
}[] = [
  {
    type: "station",
    table: schema.stations,
    notFound: ApiCode.STATION_NOT_FOUND,
  },
  {
    type: "pin",
    table: schema.portalResults,
    notFound: ApiCode.PORTAL_RESULT_NOT_FOUND,
  },
  {
    type: "curated_view",
    table: schema.curatedViews,
    notFound: ApiCode.CURATED_VIEW_NOT_FOUND,
  },
  {
    type: "connector_instance",
    table: schema.connectorInstances,
    notFound: ApiCode.CONNECTOR_INSTANCE_NOT_FOUND,
  },
];

describe.each(TYPES)(
  "favorite routes on $type (#1072)",
  ({ type, table, notFound }) => {
    let connection!: ReturnType<typeof postgres>;
    let db!: Db;
    let fx!: TenancyFixture;
    let owners!: Record<string, string>;

    const url = (id: string, t: string = type) => `/api/favorites/${t}/${id}`;
    const favoritesOf = (userId: string) =>
      db
        .select()
        .from(schema.favorites)
        .where(eq(schema.favorites.userId, userId));

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
      owners = await seedTagTargets(db, fx.orgId, fx.ownerId);
      currentSub = MEMBER_SUB;
    });

    afterEach(async () => {
      await teardownOrg(db);
      await connection.end();
    });

    const grantRead = () =>
      allowForUser(db, {
        organizationId: fx.orgId,
        userId: fx.memberId,
        verb: "read",
        resourceType: type,
      });

    it("lets a read-only member star and unstar it", async () => {
      await grantRead();
      const put = await request(app).put(url(owners[type]!));
      expect(put.status).toBe(200);
      expect(put.body.payload).toEqual({ isFavorite: true });
      const rows = await favoritesOf(fx.memberId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.organizationId).toBe(fx.orgId);

      const del = await request(app).delete(url(owners[type]!));
      expect(del.status).toBe(200);
      expect(del.body.payload).toEqual({ isFavorite: false });
      expect(await favoritesOf(fx.memberId)).toHaveLength(0);
    });

    it("is idempotent both ways", async () => {
      await grantRead();
      await request(app).put(url(owners[type]!));
      const again = await request(app).put(url(owners[type]!));
      expect(again.status).toBe(200);
      expect(await favoritesOf(fx.memberId)).toHaveLength(1);

      await request(app).delete(url(owners[type]!));
      const none = await request(app).delete(url(owners[type]!));
      expect(none.status).toBe(200);
      expect(none.body.payload).toEqual({ isFavorite: false });
    });

    it("makes one row from concurrent stars", async () => {
      await grantRead();
      const results = await Promise.all(
        Array.from({ length: 4 }, () => request(app).put(url(owners[type]!)))
      );
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
      expect(await favoritesOf(fx.memberId)).toHaveLength(1);
    });

    it("answers the object's 404 to both verbs when the caller can't read it", async () => {
      for (const res of [
        await request(app).put(url(owners[type]!)),
        await request(app).delete(url(owners[type]!)),
      ]) {
        expect(res.status).toBe(404);
        expect(res.body.code).toBe(notFound);
      }
      expect(await favoritesOf(fx.memberId)).toHaveLength(0);
    });

    it("answers 404 for another org's object, even to its org's peer role", async () => {
      currentSub = OWNER_SUB;
      const theirs = await seedTagTargets(db, fx.otherOrgId, fx.otherOwnerId);
      for (const res of [
        await request(app).put(url(theirs[type]!)),
        await request(app).delete(url(theirs[type]!)),
      ]) {
        expect(res.status).toBe(404);
        expect(res.body.code).toBe(notFound);
      }
    });

    it("answers 404 for a deleted or missing object", async () => {
      currentSub = OWNER_SUB;
      await db
        .update(table)
        .set({ deleted: Date.now(), deletedBy: fx.ownerId })
        .where(eq(table.id, owners[type]!));
      for (const res of [
        await request(app).put(url(owners[type]!)),
        await request(app).put(url(generateId())),
        await request(app).delete(url(generateId())),
      ]) {
        expect(res.status).toBe(404);
        expect(res.body.code).toBe(notFound);
      }
      expect(await favoritesOf(fx.ownerId)).toHaveLength(0);
    });
  }
);

describe("favorite routes: input and races (#1072)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: Db;
  let fx!: TenancyFixture;
  let owners!: Record<string, string>;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 2 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);
    fx = await seedTenancyFixture(db, {
      owner: OWNER_SUB,
      member: MEMBER_SUB,
      otherOwner: OTHER_SUB,
    });
    owners = await seedTagTargets(db, fx.orgId, fx.ownerId);
    currentSub = OWNER_SUB;
  });

  afterEach(async () => {
    await teardownOrg(db);
    await connection.end();
  });

  it("refuses an unknown type (400)", async () => {
    const res = await request(app).put(`/api/favorites/entity/${generateId()}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.FAVORITE_INVALID_PAYLOAD);
  });

  it("refuses a request body (400)", async () => {
    const res = await request(app)
      .put(`/api/favorites/station/${owners.station}`)
      .send({ userId: fx.memberId });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.FAVORITE_INVALID_PAYLOAD);
    expect(await db.select().from(schema.favorites)).toHaveLength(0);
  });

  it("never leaves a star for a member removed while starring", async () => {
    // Code review: hold the membership row the way a removal does, star
    // meanwhile, then tombstone the membership and sweep the member's
    // favorites in that transaction. The star waits for the removal and then
    // finds the caller no longer a member.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const removal = db.transaction(async (tx) => {
      await tx
        .select({ id: schema.organizationUsers.id })
        .from(schema.organizationUsers)
        .where(
          and(
            eq(schema.organizationUsers.organizationId, fx.orgId),
            eq(schema.organizationUsers.userId, fx.ownerId)
          )
        )
        .for("update");
      locked();
      await held;
      await tx
        .update(schema.organizationUsers)
        .set({ deleted: Date.now(), deletedBy: fx.ownerId })
        .where(
          and(
            eq(schema.organizationUsers.organizationId, fx.orgId),
            eq(schema.organizationUsers.userId, fx.ownerId)
          )
        );
      await tx
        .delete(schema.favorites)
        .where(eq(schema.favorites.userId, fx.ownerId));
    });
    await isLocked;
    const starred = request(app)
      .put(`/api/favorites/station/${owners.station}`)
      .then((r) => r);
    await new Promise((r) => setTimeout(r, 300));
    release();
    await removal;
    const res = await starred;
    expect(res.status).toBe(404);
    expect(await db.select().from(schema.favorites)).toHaveLength(0);
  });

  it("never leaves a star on an object deleted while starring it", async () => {
    // Hold the station's row the way its delete does, star it meanwhile,
    // then soft-delete and sweep in that transaction: the star waits for the
    // delete and then finds the station gone.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const deletion = db.transaction(async (tx) => {
      await tx
        .select({ id: schema.stations.id })
        .from(schema.stations)
        .where(eq(schema.stations.id, owners.station!))
        .for("update");
      locked();
      await held;
      await tx
        .update(schema.stations)
        .set({ deleted: Date.now(), deletedBy: fx.ownerId })
        .where(eq(schema.stations.id, owners.station!));
      await tx
        .delete(schema.favorites)
        .where(eq(schema.favorites.stationId, owners.station!));
    });
    await isLocked;
    const star = request(app).put(`/api/favorites/station/${owners.station}`);
    const starred = star.then((r) => r);
    // Give the star time to reach the lock before the delete commits.
    await new Promise((r) => setTimeout(r, 300));
    release();
    await deletion;
    const res = await starred;
    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ApiCode.STATION_NOT_FOUND);
    expect(await db.select().from(schema.favorites)).toHaveLength(0);
  });
});
