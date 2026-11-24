/**
 * #1072: whatever ends an object or a membership takes its favorites with
 * it, in the same transaction. Deleting a station, pin, view or connector
 * (including views deleted by an entity or connector delete) removes every
 * user's favorite of it; removing a member removes their favorites in that
 * org only.
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

import type { FavoriteTargetType } from "@portalai/core/models";

import * as schema from "../../../db/schema/index.js";
import { favoritesRepo } from "../../../db/repositories/favorites.repository.js";
import {
  generateId,
  seedTenancyFixture,
  teardownOrg,
  type TenancyFixture,
} from "../utils/application.util.js";
import { seedTagTargets } from "../utils/tag-targets.util.js";

const OWNER_SUB = "auth0|fav-sweep-owner";
const MEMBER_SUB = "auth0|fav-sweep-member";
const OTHER_SUB = "auth0|fav-sweep-other";

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

type Targets = Awaited<ReturnType<typeof seedTagTargets>>;

describe("favorite sweeps (#1072)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let fx!: TenancyFixture;
  let t!: Targets;
  let other!: Targets;

  const star = (
    userId: string,
    type: FavoriteTargetType,
    id: string,
    orgId = fx.orgId
  ) =>
    favoritesRepo.insertIfAbsent(
      { id: generateId(), organizationId: orgId, userId, created: Date.now() },
      { type, id }
    );
  const all = () => db.select().from(schema.favorites);

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
    t = await seedTagTargets(db, fx.orgId, fx.ownerId, "Doomed");
    other = await seedTagTargets(db, fx.orgId, fx.ownerId, "Kept");
    currentSub = OWNER_SUB;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await teardownOrg(db);
    await connection.end();
  });

  it.each([
    ["station", "stations"],
    ["pin", "portal-results"],
    ["curated_view", "curated-views"],
    ["connector_instance", "connector-instances"],
  ] as [FavoriteTargetType, string][])(
    "deleting a %s removes every user's favorite of it",
    async (type, path) => {
      await star(fx.ownerId, type, t[type]);
      await star(fx.memberId, type, t[type]);
      await star(fx.ownerId, type, other[type]);

      const res = await request(app).delete(`/api/${path}/${t[type]}`);
      expect(res.status).toBeLessThan(300);

      const left = await all();
      expect(left).toHaveLength(1);
      expect(Object.values(left[0]!)).toContain(other[type]);
    }
  );

  it("deleting a connector removes its views' favorites too", async () => {
    await star(fx.ownerId, "curated_view", t.curated_view);
    await star(fx.memberId, "curated_view", t.curated_view);
    await star(fx.ownerId, "curated_view", other.curated_view);

    const res = await request(app).delete(
      `/api/connector-instances/${t.connector_instance}`
    );
    expect(res.status).toBeLessThan(300);

    expect((await all()).map((r) => r.curatedViewId)).toEqual([
      other.curated_view,
    ]);
  });

  it("deleting an entity removes its views' favorites", async () => {
    await star(fx.memberId, "curated_view", t.curated_view);
    await star(fx.memberId, "curated_view", other.curated_view);

    const res = await request(app).delete(
      `/api/connector-entities/${t.entity}`
    );
    expect(res.status).toBeLessThan(300);

    expect((await all()).map((r) => r.curatedViewId)).toEqual([
      other.curated_view,
    ]);
  });

  it("removing a member removes their favorites in that org only", async () => {
    const foreign = await seedTagTargets(db, fx.otherOrgId, fx.otherOwnerId);
    await star(fx.memberId, "station", t.station);
    await star(fx.memberId, "pin", other.pin);
    await star(fx.ownerId, "station", t.station);
    // The same person's star in another org stays.
    await star(fx.memberId, "station", foreign.station, fx.otherOrgId);

    const res = await request(app).delete(
      `/api/organization/members/${fx.memberId}`
    );
    expect(res.status).toBeLessThan(300);

    const left = await all();
    expect(
      left.filter(
        (r) => r.userId === fx.memberId && r.organizationId === fx.orgId
      )
    ).toEqual([]);
    expect(left).toHaveLength(2);
  });

  it("rolls the membership back when its favorites can't be removed", async () => {
    await star(fx.memberId, "station", t.station);
    jest
      .spyOn(favoritesRepo, "hardDeleteByUser")
      .mockRejectedValue(new Error("connection reset"));

    const res = await request(app).delete(
      `/api/organization/members/${fx.memberId}`
    );
    expect(res.status).toBe(500);

    const membership = await db
      .select()
      .from(schema.organizationUsers)
      .where(
        and(
          eq(schema.organizationUsers.organizationId, fx.orgId),
          eq(schema.organizationUsers.userId, fx.memberId),
          isNull(schema.organizationUsers.deleted)
        )
      );
    expect(membership).toHaveLength(1);
    expect(await all()).toHaveLength(1);
  });
});
