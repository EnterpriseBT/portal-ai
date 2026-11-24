/**
 * #1072: the four favoritable lists and their detail reads. Every row
 * carries the caller's own `isFavorite`, `favorite=true` narrows a list to
 * the caller's favorites (composing with search, tags and paging, never
 * reordering), and a favorite the caller can no longer read is hidden but
 * kept.
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
import { StationQueryService } from "../../../services/station-query.service.js";
import {
  allowForUser,
  denyForUser,
  generateId,
  seedTenancyFixture,
  teardownOrg,
  type TenancyFixture,
} from "../utils/application.util.js";
import { seedTag, seedTagTargets } from "../utils/tag-targets.util.js";

const OWNER_SUB = "auth0|fav-list-owner";
const MEMBER_SUB = "auth0|fav-list-member";
const OTHER_SUB = "auth0|fav-list-other";

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
type Row = { id: string; isFavorite?: boolean };

const TYPES: {
  type: FavoriteTargetType;
  path: string;
  listKey: string;
  getKey: string;
  invalidQuery: ApiCode;
  tagColumn:
    | "stationId"
    | "portalResultId"
    | "curatedViewId"
    | "connectorInstanceId";
}[] = [
  {
    type: "station",
    path: "stations",
    listKey: "stations",
    getKey: "station",
    invalidQuery: ApiCode.STATION_INVALID_QUERY,
    tagColumn: "stationId",
  },
  {
    type: "pin",
    path: "portal-results",
    listKey: "portalResults",
    getKey: "portalResult",
    invalidQuery: ApiCode.PORTAL_RESULT_INVALID_QUERY,
    tagColumn: "portalResultId",
  },
  {
    type: "curated_view",
    path: "curated-views",
    listKey: "curatedViews",
    getKey: "curatedView",
    invalidQuery: ApiCode.CURATED_VIEW_INVALID_QUERY,
    tagColumn: "curatedViewId",
  },
  {
    type: "connector_instance",
    path: "connector-instances",
    listKey: "connectorInstances",
    getKey: "connectorInstance",
    invalidQuery: ApiCode.CONNECTOR_INSTANCE_INVALID_QUERY,
    tagColumn: "connectorInstanceId",
  },
];

describe.each(TYPES)(
  "favorites on the $type list and detail (#1072)",
  ({ type, path, listKey, getKey, invalidQuery, tagColumn }) => {
    let connection!: ReturnType<typeof postgres>;
    let db!: Db;
    let fx!: TenancyFixture;
    let alpha!: string;
    let beta!: string;
    let gamma!: string;

    const list = async (query = "") => {
      const res = await request(app).get(
        `/api/${path}?limit=100&sortOrder=asc${query}`
      );
      expect(res.status).toBe(200);
      const rows = (res.body.payload[listKey] as Row[]).filter((r) =>
        [alpha, beta, gamma].includes(r.id)
      );
      return { rows, total: res.body.payload.total as number };
    };
    const star = (id: string) =>
      request(app).put(`/api/favorites/${type}/${id}`).expect(200);

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
      alpha = (await seedTagTargets(db, fx.orgId, fx.ownerId, "Alpha"))[type];
      beta = (await seedTagTargets(db, fx.orgId, fx.ownerId, "Beta"))[type];
      gamma = (await seedTagTargets(db, fx.orgId, fx.ownerId, "Gamma"))[type];
      currentSub = OWNER_SUB;
    });

    afterEach(async () => {
      await teardownOrg(db);
      await connection.end();
    });

    it("marks only the caller's own favorites", async () => {
      await star(beta);
      // Another member's star never shows, even to an owner.
      await allowForUser(db, {
        organizationId: fx.orgId,
        userId: fx.memberId,
        verb: "read",
        resourceType: type,
      });
      currentSub = MEMBER_SUB;
      await star(gamma);
      currentSub = OWNER_SUB;

      const { rows } = await list();
      const flags = Object.fromEntries(rows.map((r) => [r.id, r.isFavorite]));
      expect(flags).toEqual({ [alpha]: false, [beta]: true, [gamma]: false });
    });

    it("narrows to the caller's favorites with favorite=true", async () => {
      await star(alpha);
      await star(gamma);
      const { rows, total } = await list("&favorite=true");
      expect(rows.map((r) => r.id).sort()).toEqual([alpha, gamma].sort());
      expect(rows.every((r) => r.isFavorite)).toBe(true);
      expect(total).toBe(2);
    });

    it("composes with search and tags", async () => {
      await star(alpha);
      await star(beta);
      const searched = await list("&favorite=true&search=Beta");
      expect(searched.rows.map((r) => r.id)).toEqual([beta]);

      const tagId = await seedTag(db, fx.orgId, fx.ownerId, "Q4");
      await db.insert(schema.entityTagAssignments).values({
        id: generateId(),
        created: Date.now(),
        createdBy: fx.ownerId,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
        organizationId: fx.orgId,
        connectorEntityId: null,
        stationId: null,
        portalResultId: null,
        curatedViewId: null,
        connectorInstanceId: null,
        [tagColumn]: alpha,
        entityTagId: tagId,
      });
      const tagged = await list(`&favorite=true&tagIds=${tagId}`);
      expect(tagged.rows.map((r) => r.id)).toEqual([alpha]);
    });

    it("pages favorites with a correct total", async () => {
      await star(alpha);
      await star(beta);
      await star(gamma);
      const res = await request(app).get(
        `/api/${path}?favorite=true&limit=2&offset=0&sortOrder=asc`
      );
      expect(res.body.payload[listKey]).toHaveLength(2);
      expect(res.body.payload.total).toBe(3);
    });

    it("never reorders the list", async () => {
      const before = (await list()).rows.map((r) => r.id);
      await star(gamma);
      const after = (await list()).rows.map((r) => r.id);
      expect(after).toEqual(before);
    });

    it("refuses favorite=false (400)", async () => {
      const res = await request(app).get(`/api/${path}?favorite=false`);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(invalidQuery);
    });

    it("hides a favorite the caller can no longer read, and keeps it", async () => {
      await allowForUser(db, {
        organizationId: fx.orgId,
        userId: fx.memberId,
        verb: "read",
        resourceType: type,
      });
      currentSub = MEMBER_SUB;
      await star(alpha);
      expect((await list("&favorite=true")).rows.map((r) => r.id)).toEqual([
        alpha,
      ]);

      await denyForUser(db, {
        organizationId: fx.orgId,
        userId: fx.memberId,
        verb: "read",
        resourceType: type,
      });
      expect((await list("&favorite=true")).rows).toEqual([]);
      expect(
        await db
          .select()
          .from(schema.favorites)
          .where(eq(schema.favorites.userId, fx.memberId))
      ).toHaveLength(1);

      // Access restored: it comes back starred.
      await db
        .delete(schema.permissionStatements)
        .where(
          and(
            eq(schema.permissionStatements.organizationId, fx.orgId),
            eq(schema.permissionStatements.effect, "deny")
          )
        );
      const restored = await list("&favorite=true");
      expect(restored.rows).toEqual([
        expect.objectContaining({ id: alpha, isFavorite: true }),
      ]);
    });

    it("carries isFavorite on the detail read", async () => {
      await star(alpha);
      const starred = await request(app).get(`/api/${path}/${alpha}`);
      expect(starred.status).toBe(200);
      expect(starred.body.payload[getKey].isFavorite).toBe(true);
      const plain = await request(app).get(`/api/${path}/${beta}`);
      expect(plain.body.payload[getKey].isFavorite).toBe(false);
    });
  }
);

describe("the agent's station listing (#1072)", () => {
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

  it("carries no isFavorite, so station_list's output is unchanged", async () => {
    const { station } = await seedTagTargets(db, fx.orgId, fx.ownerId);
    await request(app).put(`/api/favorites/station/${station}`).expect(200);
    const { stations } = await StationQueryService.listForCaller(
      { userId: fx.ownerId, organizationId: fx.orgId, roles: ["owner"] },
      { limit: 50, offset: 0, sortBy: "created", sortOrder: "asc" }
    );
    const row = stations.find((s) => s.id === station);
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("isFavorite");
  });
});
