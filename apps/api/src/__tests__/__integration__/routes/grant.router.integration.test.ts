import {
  jest,
  describe,
  it,
  expect,
  beforeAll,
  afterEach,
  afterAll,
} from "@jest/globals";
import request from "supertest";
import { Request, Response, NextFunction } from "express";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq } from "drizzle-orm";
import { PermissionGrantModelFactory } from "@portalai/core/models";
import * as schema from "../../../db/schema/index.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  createUser,
  createOrganization,
  createOrganizationUser,
  generateId,
  teardownOrg,
  seedRbacForOrg,
} from "../utils/application.util.js";

const CALLER_AUTH0 = "auth0|grant-caller";

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

describe("POST/GET/DELETE /api/grants (#621)", () => {
  let connection: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;

  beforeAll(() => {
    connection = postgres(process.env.DATABASE_URL as string, { max: 1 });
    db = drizzle(connection, { schema });
  });
  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 150)); // let fail-open audits land
    await teardownOrg(db);
  });
  afterAll(async () => {
    await connection.end();
  });

  /** Seed an org owned by the caller (role `callerRole`); returns the org id. */
  async function seedOrg(callerRole: "owner" | "admin" | "member") {
    const caller = createUser(CALLER_AUTH0);
    await db.insert(users).values(caller as never);
    let ownerId = caller.id;
    if (callerRole !== "owner") {
      const owner = createUser(`auth0|owner-${generateId()}`);
      await db.insert(users).values(owner as never);
      ownerId = owner.id;
    }
    const org = createOrganization(ownerId);
    await db.insert(organizations).values(org as never);
    await seedRbacForOrg(db as never, org.id);
    await db.insert(organizationUsers).values(
      createOrganizationUser(org.id, caller.id, {
        role: callerRole,
        lastLogin: Date.now(),
      }) as never
    );
    if (callerRole !== "owner") {
      await db.insert(organizationUsers).values(
        createOrganizationUser(org.id, ownerId, {
          role: "owner",
          lastLogin: 0,
        }) as never
      );
    }
    return { orgId: org.id, callerId: caller.id, ownerId };
  }

  async function addMember(orgId: string, email?: string) {
    const u = createUser(`auth0|m-${generateId()}`);
    if (email) (u as { email?: string }).email = email;
    await db.insert(users).values(u as never);
    await db.insert(organizationUsers).values(
      createOrganizationUser(orgId, u.id, {
        role: "member",
        lastLogin: 0,
      }) as never
    );
    return u.id;
  }

  async function addStation(orgId: string, createdBy: string) {
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
  }

  const liveGrants = (orgId: string, resourceId: string) =>
    db
      .select()
      .from(permissionGrants)
      .where(
        and(
          eq(permissionGrants.organizationId, orgId),
          eq(permissionGrants.resourceId, resourceId)
        )
      );

  const share = (body: Record<string, unknown>) =>
    request(app)
      .post("/api/grants")
      .set("Authorization", "Bearer t")
      .send(body);

  it("owner shares a station read with a member → one grant row", async () => {
    const { orgId, callerId } = await seedOrg("owner");
    const station = await addStation(orgId, callerId);
    const member = await addMember(orgId);

    const res = await share({
      resourceType: "station",
      resourceId: station,
      grantee: { type: "user", userId: member },
      access: "read",
    });

    expect(res.status).toBe(200);
    expect(res.body.payload.grant.access).toBe("read");
    const rows = await liveGrants(orgId, station);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      principalType: "user",
      principalId: member,
      verb: "read",
      effect: "allow",
    });
  });

  it("read-write shares two rows; re-sharing read replaces them", async () => {
    const { orgId, callerId } = await seedOrg("owner");
    const station = await addStation(orgId, callerId);
    const member = await addMember(orgId);

    await share({
      resourceType: "station",
      resourceId: station,
      grantee: { type: "user", userId: member },
      access: "read-write",
    });
    expect(
      (await liveGrants(orgId, station)).map((r) => r.verb).sort()
    ).toEqual(["read", "write"]);

    const res = await share({
      resourceType: "station",
      resourceId: station,
      grantee: { type: "user", userId: member },
      access: "read",
    });
    expect(res.status).toBe(200);
    expect((await liveGrants(orgId, station)).map((r) => r.verb)).toEqual([
      "read",
    ]);
  });

  it("shares to the team as a role:member principal", async () => {
    const { orgId, callerId } = await seedOrg("owner");
    const station = await addStation(orgId, callerId);
    const res = await share({
      resourceType: "station",
      resourceId: station,
      grantee: { type: "team" },
      access: "read",
    });
    expect(res.status).toBe(200);
    const [row] = await liveGrants(orgId, station);
    expect(row.principalType).toBe("role");
    expect(row.principalId).toBe(`sysrole:${orgId}:member`);
  });

  it("rejects a grantee who is not an org member (400)", async () => {
    const { orgId, callerId } = await seedOrg("owner");
    const station = await addStation(orgId, callerId);
    const res = await share({
      resourceType: "station",
      resourceId: station,
      grantee: { type: "user", userId: "not-a-member" },
      access: "read",
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.RBAC_GRANTEE_NOT_MEMBER);
  });

  it("a member can't share a station they don't own (403 share-authority)", async () => {
    const { orgId, ownerId } = await seedOrg("member");
    const station = await addStation(orgId, ownerId); // owner's station
    const member = await addMember(orgId);
    const res = await share({
      resourceType: "station",
      resourceId: station,
      grantee: { type: "user", userId: member },
      access: "read",
    });
    expect(res.status).toBe(403);
  });

  it("rejects a grant beyond the granter's boundary (403)", async () => {
    const { orgId, callerId, ownerId } = await seedOrg("member");
    const station = await addStation(orgId, ownerId); // not the caller's
    const member = await addMember(orgId);
    // Give the caller share + read (but NOT write) on that station directly.
    for (const verb of ["share", "read"] as const) {
      await db.insert(permissionGrants).values(
        new PermissionGrantModelFactory()
          .create("system")
          .update({
            organizationId: orgId,
            principalType: "user",
            principalId: callerId,
            effect: "allow",
            verb,
            resourceType: "station",
            resourceId: station,
            condition: null,
          })
          .parse() as never
      );
    }
    // read-write exceeds boundary (no write); read is within it.
    const bad = await share({
      resourceType: "station",
      resourceId: station,
      grantee: { type: "user", userId: member },
      access: "read-write",
    });
    expect(bad.status).toBe(403);
    expect(bad.body.code).toBe(ApiCode.RBAC_GRANT_EXCEEDS_BOUNDARY);

    const ok = await share({
      resourceType: "station",
      resourceId: station,
      grantee: { type: "user", userId: member },
      access: "read",
    });
    expect(ok.status).toBe(200);
  });

  it("GET lists shares grouped per principal; DELETE revokes them", async () => {
    const { orgId, callerId } = await seedOrg("owner");
    const station = await addStation(orgId, callerId);
    const m1 = await addMember(orgId, "m1@x.io");
    const m2 = await addMember(orgId, "m2@x.io");
    await share({
      resourceType: "station",
      resourceId: station,
      grantee: { type: "user", userId: m1 },
      access: "read-write",
    });
    await share({
      resourceType: "station",
      resourceId: station,
      grantee: { type: "user", userId: m2 },
      access: "read",
    });

    const list = await request(app)
      .get(`/api/grants?resourceType=station&resourceId=${station}`)
      .set("Authorization", "Bearer t");
    expect(list.status).toBe(200);
    expect(list.body.payload.grants).toHaveLength(2);
    const m1View = list.body.payload.grants.find(
      (g: { principalId: string }) => g.principalId === m1
    );
    expect(m1View.access).toBe("read-write");

    const del = await request(app)
      .delete(`/api/grants/${m1View.id}`)
      .set("Authorization", "Bearer t");
    expect(del.status).toBe(200);
    // m1's two rows gone; m2's one remains.
    const remaining = await liveGrants(orgId, station);
    expect(remaining.every((r) => r.principalId === m2)).toBe(true);
  });
});
