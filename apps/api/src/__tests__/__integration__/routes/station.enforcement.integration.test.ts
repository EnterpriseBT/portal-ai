import {
  jest,
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
} from "@jest/globals";
import request from "supertest";
import { Request, Response, NextFunction } from "express";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { PermissionGrantModelFactory } from "@portalai/core/models";
import * as schema from "../../../db/schema/index.js";
import { SystemUtilities } from "../../../utils/system.util.js";
import {
  createUser,
  createOrganization,
  createOrganizationUser,
  generateId,
  teardownOrg,
  seedRbacForOrg,
} from "../utils/application.util.js";

const CALLER_AUTH0 = "auth0|station-enforce-caller";

jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, _res: Response, next: NextFunction) => {
    if (req.headers.authorization) {
      req.auth = { payload: { sub: CALLER_AUTH0 } } as never;
    }
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
const { users, organizations, organizationUsers, stations, permissionGrants } =
  schema;
const SYSTEM = SystemUtilities.id.system;

describe("station object enforcement — member perspective (#621 slice 3a)", () => {
  let connection: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;
  let orgId: string;
  let callerId: string;
  let otherId: string;
  let ownStation: string;
  let systemStation: string;
  let otherStation: string;

  beforeAll(() => {
    connection = postgres(process.env.DATABASE_URL as string, { max: 1 });
    db = drizzle(connection, { schema });
  });
  afterEach(async () => {
    await teardownOrg(db);
  });
  afterAll(async () => {
    await connection.end();
  });

  const addStation = async (createdBy: string) => {
    const id = generateId();
    await db.insert(stations).values({
      id,
      organizationId: orgId,
      name: `st-${id.slice(0, 6)}`,
      description: null,
      created: Date.now(),
      createdBy,
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    return id;
  };

  const grantCaller = async (
    resourceId: string,
    verbs: ("read" | "write")[],
    effect: "allow" | "deny" = "allow"
  ) => {
    for (const verb of verbs) {
      await db.insert(permissionGrants).values(
        new PermissionGrantModelFactory()
          .create(SYSTEM)
          .update({
            organizationId: orgId,
            principalType: "user",
            principalId: callerId,
            effect,
            verb,
            resourceType: "station",
            resourceId,
            condition: null,
          })
          .parse() as never
      );
    }
  };

  beforeEach(async () => {
    // caller = member; a separate owner; a second "other" member.
    const caller = createUser(CALLER_AUTH0);
    await db.insert(users).values(caller as never);
    callerId = caller.id;
    const owner = createUser(`auth0|owner-${generateId()}`);
    await db.insert(users).values(owner as never);
    const other = createUser(`auth0|other-${generateId()}`);
    await db.insert(users).values(other as never);
    otherId = other.id;
    const org = createOrganization(owner.id);
    await db.insert(organizations).values(org as never);
    orgId = org.id;
    await seedRbacForOrg(db as never, orgId);
    await db.insert(organizationUsers).values([
      createOrganizationUser(orgId, caller.id, {
        role: "member",
        lastLogin: Date.now(),
      }),
      createOrganizationUser(orgId, owner.id, { role: "owner", lastLogin: 0 }),
      createOrganizationUser(orgId, other.id, { role: "member", lastLogin: 0 }),
    ] as never);
    ownStation = await addStation(callerId);
    systemStation = await addStation(SYSTEM);
    otherStation = await addStation(otherId);
  });

  const auth = <T extends request.Test>(t: T) =>
    t.set("Authorization", "Bearer t");

  it("list shows own + system + shared, hides another member's", async () => {
    await grantCaller(otherStation, ["read"]); // share other's → visible
    const res = await auth(request(app).get("/api/stations?limit=50"));
    expect(res.status).toBe(200);
    const ids = res.body.payload.stations.map((s: { id: string }) => s.id);
    expect(ids).toContain(ownStation);
    expect(ids).toContain(systemStation);
    expect(ids).toContain(otherStation); // shared
  });

  it("list hides an unshared station of another member", async () => {
    const res = await auth(request(app).get("/api/stations?limit=50"));
    const ids = res.body.payload.stations.map((s: { id: string }) => s.id);
    expect(ids).not.toContain(otherStation);
  });

  it("GET own → 200 canShare true; another's → 404; shared → 200 canShare false", async () => {
    const own = await auth(request(app).get(`/api/stations/${ownStation}`));
    expect(own.status).toBe(200);
    expect(own.body.payload.canShare).toBe(true); // creator can share own
    // #621: the creator also fully controls their own object.
    expect(own.body.payload.canWrite).toBe(true);
    expect(own.body.payload.canDelete).toBe(true);

    const hidden = await auth(
      request(app).get(`/api/stations/${otherStation}`)
    );
    expect(hidden.status).toBe(404);

    await grantCaller(otherStation, ["read"]);
    const shared = await auth(
      request(app).get(`/api/stations/${otherStation}`)
    );
    expect(shared.status).toBe(200);
    expect(shared.body.payload.canShare).toBe(false); // grantee can't re-share
    // #621: a read grantee gets neither write nor delete on the shared object.
    expect(shared.body.payload.canWrite).toBe(false);
    expect(shared.body.payload.canDelete).toBe(false);
  });

  it("PATCH own → 200; a read grantee → 403; a read-write grantee → 200", async () => {
    const own = await auth(
      request(app).patch(`/api/stations/${ownStation}`)
    ).send({ name: "renamed" });
    expect(own.status).toBe(200);

    await grantCaller(otherStation, ["read"]);
    const ro = await auth(
      request(app).patch(`/api/stations/${otherStation}`)
    ).send({ name: "nope" });
    expect(ro.status).toBe(403);

    await grantCaller(otherStation, ["write"]);
    const rw = await auth(
      request(app).patch(`/api/stations/${otherStation}`)
    ).send({ name: "yes" });
    expect(rw.status).toBe(200);
  });

  it("DELETE own → 200; a read-write grantee cannot delete a shared station (403)", async () => {
    const own = await auth(request(app).delete(`/api/stations/${ownStation}`));
    expect(own.status).toBe(200);

    await grantCaller(otherStation, ["read", "write"]);
    const shared = await auth(
      request(app).delete(`/api/stations/${otherStation}`)
    );
    expect(shared.status).toBe(403); // delete never conveyed by a share
  });

  it("an explicit deny grant overrides a member's own write", async () => {
    await grantCaller(ownStation, ["write"], "deny");
    const res = await auth(
      request(app).patch(`/api/stations/${ownStation}`)
    ).send({ name: "frozen" });
    expect(res.status).toBe(403);
  });
});
