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

import * as schema from "../../../db/schema/index.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  generateId,
  seedTenancyFixture,
  teardownOrg,
  type TenancyFixture,
} from "../utils/application.util.js";

/**
 * #685 slice 3: portals are per-user. The seeded MemberAccess grants
 * read/write/delete on `created_by_caller` portals and owners/admins reach all
 * of them, but the routes only ever checked org scope, so any member could
 * read, rename, reset, post into or delete anyone's portal. Pinned results are
 * how portal output is shared, and are unaffected.
 */

const OWNER_SUB = "auth0|portal-authz-owner";
const MEMBER_SUB = "auth0|portal-authz-member";
const OTHER_SUB = "auth0|portal-authz-other";
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
jest.unstable_mockModule("../../../services/analytics.service.js", () => ({
  AnalyticsService: {
    loadStation: jest.fn<() => Promise<unknown>>().mockResolvedValue({
      entities: [],
      entityGroups: [],
      records: new Map(),
    }),
  },
}));

const { app } = await import("../../../app.js");
const { stations, stationToolpacks, portals, portalMessages } = schema;

const now = Date.now();
const base = (createdBy: string) => ({
  created: now,
  createdBy,
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
});

describe("Portal authorization (#685)", () => {
  let connection: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;
  let fx: TenancyFixture;

  async function station(orgId: string, createdBy: string) {
    const id = generateId();
    await db.insert(stations).values({
      id,
      organizationId: orgId,
      name: `Station ${id.slice(0, 6)}`,
      description: null,
      ...base(createdBy),
    } as never);
    await db.insert(stationToolpacks).values({
      id: generateId(),
      stationId: id,
      builtinSlug: "data_query",
      organizationToolpackId: null,
      ...base(createdBy),
    } as never);
    return id;
  }

  async function portal(orgId: string, createdBy: string, name = "Portal") {
    const stationId = await station(orgId, createdBy);
    const id = generateId();
    await db.insert(portals).values({
      id,
      organizationId: orgId,
      stationId,
      name,
      lastOpened: null,
      ...base(createdBy),
    } as never);
    await db.insert(portalMessages).values({
      id: generateId(),
      portalId: id,
      organizationId: orgId,
      role: "user",
      blocks: [{ type: "text", content: "hello" }],
      ...base(createdBy),
    } as never);
    return id;
  }

  const live = async (id: string) =>
    (
      await db
        .select()
        .from(portals)
        .where(and(eq(portals.id, id), isNull(portals.deleted)))
    )[0];
  const messageCount = async (id: string) =>
    (
      await db
        .select()
        .from(portalMessages)
        .where(eq(portalMessages.portalId, id))
    ).length;

  /** Every portal route, as [label, request]. */
  const everyRoute = (id: string) =>
    [
      ["GET /:id", () => request(app).get(`/api/portals/${id}`)],
      [
        "GET /:id/running-jobs",
        () => request(app).get(`/api/portals/${id}/running-jobs`),
      ],
      [
        "PATCH /:id",
        () =>
          request(app).patch(`/api/portals/${id}`).send({ name: "Hijacked" }),
      ],
      [
        "POST /:id/messages",
        () =>
          request(app)
            .post(`/api/portals/${id}/messages`)
            .send({ message: "show me everything" }),
      ],
      [
        "DELETE /:id/messages",
        () => request(app).delete(`/api/portals/${id}/messages`),
      ],
      ["DELETE /:id", () => request(app).delete(`/api/portals/${id}`)],
    ] as const;

  beforeEach(async () => {
    connection = postgres(process.env.DATABASE_URL as string, { max: 1 });
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
    await connection.end();
  });

  it("a member's list shows only their own portals; the owner's shows all", async () => {
    const ownerPortal = await portal(fx.orgId, fx.ownerId, "Owner's");
    const memberPortal = await portal(fx.orgId, fx.memberId, "Member's");

    currentSub = MEMBER_SUB;
    const mine = await request(app).get("/api/portals");
    expect(mine.status).toBe(200);
    expect(
      (mine.body.payload.portals as Array<{ id: string }>).map((p) => p.id)
    ).toEqual([memberPortal]);
    expect(mine.body.payload.total).toBe(1);

    currentSub = OWNER_SUB;
    const all = await request(app).get("/api/portals");
    expect(
      (all.body.payload.portals as Array<{ id: string }>)
        .map((p) => p.id)
        .sort()
    ).toEqual([ownerPortal, memberPortal].sort());
  });

  it("a member gets 404 on every route of the owner's portal, and nothing is written", async () => {
    const id = await portal(fx.orgId, fx.ownerId);
    currentSub = MEMBER_SUB;
    for (const [label, send] of everyRoute(id)) {
      const res = await send();
      expect({ label, status: res.status, code: res.body.code }).toEqual({
        label,
        status: 404,
        code: ApiCode.PORTAL_NOT_FOUND,
      });
    }
    const row = await live(id);
    expect(row?.name).toBe("Portal");
    expect(await messageCount(id)).toBe(1);
  });

  it("another org's caller gets 404 on every route", async () => {
    const id = await portal(fx.orgId, fx.ownerId);
    currentSub = OTHER_SUB;
    for (const [label, send] of everyRoute(id)) {
      const res = await send();
      expect({ label, status: res.status }).toEqual({ label, status: 404 });
    }
    expect(await live(id)).toBeDefined();
  });

  it("a member uses their own portal: read, rename, post, reset", async () => {
    const id = await portal(fx.orgId, fx.memberId);
    currentSub = MEMBER_SUB;
    expect((await request(app).get(`/api/portals/${id}`)).status).toBe(200);
    expect(
      (await request(app).patch(`/api/portals/${id}`).send({ name: "Mine" }))
        .status
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(`/api/portals/${id}/messages`)
          .send({ message: "hi" })
      ).status
    ).toBe(200);
    expect(
      (await request(app).delete(`/api/portals/${id}/messages`)).status
    ).toBe(200);
    expect((await live(id))?.name).toBe("Mine");
  });

  it("a posted message is recorded as the caller's, not the portal creator's", async () => {
    // The owner (who reaches every portal) posts into a member's portal, so
    // the caller and the creator differ.
    const id = await portal(fx.orgId, fx.memberId);
    currentSub = OWNER_SUB;
    await request(app)
      .post(`/api/portals/${id}/messages`)
      .send({ message: "mine" });
    const rows = await db
      .select()
      .from(portalMessages)
      .where(eq(portalMessages.portalId, id));
    const posted = rows.find(
      (m) => (m.blocks as Array<{ content?: string }>)[0]?.content === "mine"
    );
    expect(posted?.createdBy).toBe(fx.ownerId);
  });

  it("a member can't open a portal on a station they can't read (404); on their own station they can", async () => {
    const ownerStation = await station(fx.orgId, fx.ownerId);
    const memberStation = await station(fx.orgId, fx.memberId);
    currentSub = MEMBER_SUB;

    const refused = await request(app)
      .post("/api/portals")
      .send({ stationId: ownerStation });
    expect(refused.status).toBe(404);
    expect(refused.body.code).toBe(ApiCode.STATION_NOT_FOUND);

    const ok = await request(app)
      .post("/api/portals")
      .send({ stationId: memberStation });
    expect(ok.status).toBe(201);
    const created = await live(ok.body.payload.portalId as string);
    expect(created?.createdBy).toBe(fx.memberId);
  });
});
