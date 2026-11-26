/**
 * #1076: the command palette's search returns exactly what each type's own
 * list route returns to the same caller, for every searchable type and every
 * default role. A search never reveals an object its list wouldn't, and never
 * hides one it would. If this fails, search must reuse the list's filter; the
 * test doesn't bend.
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

import type { SearchResultType } from "@portalai/core/contracts";

import * as schema from "../../../db/schema/index.js";
import {
  allowForUser,
  createOrganizationUser,
  createUser,
  generateId,
  seedTenancyFixture,
  teardownOrg,
  type TenancyFixture,
} from "../utils/application.util.js";
import { seedTagTargets } from "../utils/tag-targets.util.js";

const OWNER_SUB = "auth0|search-agree-owner";
const ADMIN_SUB = "auth0|search-agree-admin";
const MEMBER_SUB = "auth0|search-agree-member";
const OTHER_SUB = "auth0|search-agree-other";
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

/** Each type's list route, the payload key, and the row's display name. */
const LISTS: Record<
  SearchResultType,
  { path: string; key: string; name: "name" | "label" }
> = {
  station: { path: "stations", key: "stations", name: "name" },
  pin: { path: "portal-results", key: "portalResults", name: "name" },
  curated_view: { path: "curated-views", key: "curatedViews", name: "label" },
  connector_instance: {
    path: "connector-instances",
    key: "connectorInstances",
    name: "name",
  },
  entity: {
    path: "connector-entities",
    key: "connectorEntities",
    name: "label",
  },
  portal: { path: "portals", key: "portals", name: "name" },
};

const TERM = "Agree";

describe("search agrees with each list route (#1076)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let fx!: TenancyFixture;

  async function portal(orgId: string, createdBy: string, name: string) {
    const base = () => ({
      id: generateId(),
      created: Date.now(),
      createdBy,
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    });
    const station = { ...base(), organizationId: orgId, name: "Holder" };
    await db.insert(schema.stations).values(station as never);
    await db.insert(schema.portals).values({
      ...base(),
      organizationId: orgId,
      stationId: station.id,
      name,
      lastOpened: null,
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
    const admin = createUser(ADMIN_SUB);
    await db.insert(schema.users).values(admin as never);
    await db
      .insert(schema.organizationUsers)
      .values(
        createOrganizationUser(fx.orgId, admin.id, { role: "admin" }) as never
      );

    // Objects of every type from each creator, two from the owner; fewer
    // than the per-type cap, so the cap never decides membership. The member
    // also reads stations through a grant.
    await seedTagTargets(db, fx.orgId, fx.ownerId, `${TERM} owner 1`);
    await seedTagTargets(db, fx.orgId, fx.ownerId, `${TERM} owner 2`);
    await seedTagTargets(db, fx.orgId, fx.memberId, `${TERM} member`);
    await seedTagTargets(db, fx.orgId, admin.id, `${TERM} admin`);
    await seedTagTargets(db, fx.otherOrgId, fx.otherOwnerId, `${TERM} far`);
    await portal(fx.orgId, fx.ownerId, `${TERM} owner chat`);
    await portal(fx.orgId, fx.memberId, `${TERM} member chat`);
    await portal(fx.orgId, admin.id, `${TERM} admin chat`);
    await allowForUser(db, {
      organizationId: fx.orgId,
      userId: fx.memberId,
      verb: "read",
      resourceType: "station",
    });
  });

  afterEach(async () => {
    await teardownOrg(db);
    await connection.end();
  });

  it.each([
    ["owner", OWNER_SUB],
    ["admin", ADMIN_SUB],
    ["member", MEMBER_SUB],
  ])(
    "for the %s, search and every list return the same objects",
    async (_role, sub) => {
      currentSub = sub;
      const res = await request(app).get(`/api/search?q=${TERM}`);
      expect(res.status).toBe(200);
      const results = res.body.payload.results as {
        type: SearchResultType;
        id: string;
      }[];

      for (const [type, list] of Object.entries(LISTS) as [
        SearchResultType,
        (typeof LISTS)[SearchResultType],
      ][]) {
        const listed = await request(app).get(`/api/${list.path}?limit=100`);
        expect(listed.status).toBe(200);
        const fromList = (
          listed.body.payload[list.key] as Record<string, string>[]
        )
          .filter((row) => row[list.name]?.includes(TERM))
          .map((row) => row.id)
          .sort();
        const fromSearch = results
          .filter((r) => r.type === type)
          .map((r) => r.id)
          .sort();
        expect({ type, ids: fromSearch }).toEqual({ type, ids: fromList });
      }
    }
  );
});
