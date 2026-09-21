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

const CALLER_AUTH0 = "auth0|pin-enforce-caller";

jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, _res: Response, next: NextFunction) => {
    if (req.headers.authorization)
      req.auth = { payload: { sub: CALLER_AUTH0 } } as never;
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
const {
  users,
  organizations,
  organizationUsers,
  stations,
  portalResults,
  permissionGrants,
} = schema;
const SYSTEM = SystemUtilities.id.system;

describe("pin object enforcement — member perspective (#621 slice 3b)", () => {
  let connection: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;
  let orgId: string;
  let callerId: string;
  let stationId: string;
  let ownPin: string;
  let otherPin: string;

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

  const addPin = async (createdBy: string) => {
    const id = generateId();
    await db.insert(portalResults).values({
      id,
      organizationId: orgId,
      stationId,
      portalId: null,
      messageId: null,
      blockIndex: null,
      name: `pin-${id.slice(0, 6)}`,
      type: "text",
      content: { value: "x" },
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
    verbs: ("read" | "write")[]
  ) => {
    for (const verb of verbs) {
      await db.insert(permissionGrants).values(
        new PermissionGrantModelFactory()
          .create(SYSTEM)
          .update({
            organizationId: orgId,
            principalType: "user",
            principalId: callerId,
            effect: "allow",
            verb,
            resourceType: "pin",
            resourceId,
            condition: null,
          })
          .parse() as never
      );
    }
  };

  beforeEach(async () => {
    const caller = createUser(CALLER_AUTH0);
    await db.insert(users).values(caller as never);
    callerId = caller.id;
    const owner = createUser(`auth0|owner-${generateId()}`);
    await db.insert(users).values(owner as never);
    const other = createUser(`auth0|other-${generateId()}`);
    await db.insert(users).values(other as never);
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
    stationId = generateId();
    await db.insert(stations).values({
      id: stationId,
      organizationId: orgId,
      name: "st",
      description: null,
      created: Date.now(),
      createdBy: SYSTEM,
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    ownPin = await addPin(callerId);
    otherPin = await addPin(other.id);
  });

  const auth = <T extends request.Test>(t: T) =>
    t.set("Authorization", "Bearer t");

  it("list hides another member's pin; shows it once shared", async () => {
    let res = await auth(request(app).get("/api/portal-results?limit=50"));
    let ids = res.body.payload.portalResults.map((p: { id: string }) => p.id);
    expect(ids).toContain(ownPin);
    expect(ids).not.toContain(otherPin);

    await grantCaller(otherPin, ["read"]);
    res = await auth(request(app).get("/api/portal-results?limit=50"));
    ids = res.body.payload.portalResults.map((p: { id: string }) => p.id);
    expect(ids).toContain(otherPin);
  });

  it("GET own → 200 canShare true; another's → 404; shared → 200 canShare false", async () => {
    const own = await auth(request(app).get(`/api/portal-results/${ownPin}`));
    expect(own.status).toBe(200);
    expect(own.body.payload.canShare).toBe(true);
    // #621: the creator also fully controls their own pin.
    expect(own.body.payload.canWrite).toBe(true);
    expect(own.body.payload.canDelete).toBe(true);

    expect(
      (await auth(request(app).get(`/api/portal-results/${otherPin}`))).status
    ).toBe(404);

    await grantCaller(otherPin, ["read"]);
    const shared = await auth(
      request(app).get(`/api/portal-results/${otherPin}`)
    );
    expect(shared.status).toBe(200);
    expect(shared.body.payload.canShare).toBe(false);
    // #621: a read grantee gets neither write nor delete on the shared pin.
    expect(shared.body.payload.canWrite).toBe(false);
    expect(shared.body.payload.canDelete).toBe(false);
  });

  it("PATCH: read grantee 403, read-write grantee 200; DELETE shared 403", async () => {
    await grantCaller(otherPin, ["read"]);
    const ro = await auth(
      request(app).patch(`/api/portal-results/${otherPin}`)
    ).send({ name: "no" });
    expect(ro.status).toBe(403);

    await grantCaller(otherPin, ["write"]);
    const rw = await auth(
      request(app).patch(`/api/portal-results/${otherPin}`)
    ).send({ name: "yes" });
    expect(rw.status).toBe(200);

    // read-write grantee still can't delete a shared pin.
    const del = await auth(
      request(app).delete(`/api/portal-results/${otherPin}`)
    );
    expect(del.status).toBe(403);
  });

  it("a member can delete their own pin", async () => {
    const res = await auth(
      request(app).delete(`/api/portal-results/${ownPin}`)
    );
    expect(res.status).toBe(200);
  });
});
