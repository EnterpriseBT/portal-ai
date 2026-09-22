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
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema/index.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import { SystemUtilities } from "../../../utils/system.util.js";
import {
  createUser,
  createOrganization,
  createOrganizationUser,
  generateId,
  teardownOrg,
  seedRbacForOrg,
} from "../utils/application.util.js";

const CALLER_AUTH0 = "auth0|objsearch-caller";

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
const { RbacObjectSearchService } =
  await import("../../../services/rbac-object-search.service.js");
const { users, organizations, organizationUsers, tiers, stations } = schema;

const auth = (r: request.Test) => r.set("authorization", "Bearer x");

describe("GET /api/rbac/objects (#622 slice 5)", () => {
  let connection: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;

  beforeAll(() => {
    connection = postgres(process.env.DATABASE_URL as string, { max: 1 });
    db = drizzle(connection, { schema });
  });
  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 150));
    await teardownOrg(db);
    await db.delete(tiers).where(eq(tiers.createdBy, "RBAC_TEST"));
  });
  afterAll(async () => {
    await connection.end();
  });

  async function seedOrg(callerRole: "owner" | "member") {
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

  async function entitleOrg(orgId: string, customRbac = true) {
    const slug = `rbac-tier-${generateId()}`;
    await db.insert(tiers).values({
      id: generateId(),
      created: Date.now(),
      createdBy: "RBAC_TEST",
      slug,
      displayName: "RBAC Test Tier",
      customRbac,
    } as never);
    await db
      .update(organizations)
      .set({ tier: slug })
      .where(eq(organizations.id, orgId));
  }

  async function addStation(orgId: string, name: string, createdBy: string) {
    const id = generateId();
    await db.insert(stations).values({
      id,
      organizationId: orgId,
      name,
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

  it("owner sees all org stations; search filters by name", async () => {
    const { orgId, callerId, ownerId } = await seedOrg("owner");
    await entitleOrg(orgId);
    await addStation(orgId, "Alpha Station", ownerId);
    await addStation(orgId, "Beta Station", callerId);

    const all = await auth(
      request(app).get("/api/rbac/objects?resourceType=station")
    );
    expect(all.status).toBe(200);
    expect(all.body.payload.objects).toHaveLength(2);

    const filtered = await auth(
      request(app).get("/api/rbac/objects?resourceType=station&search=Alpha")
    );
    expect(filtered.body.payload.objects).toEqual([
      expect.objectContaining({ label: "Alpha Station" }),
    ]);
  });

  it("the search is visibility-scoped — a member-context sees only own + system (service level)", async () => {
    // The route is owner/admin-only, so the visibility predicate is exercised
    // at the service level with a member context: it must scope to own + system.
    const { orgId, callerId, ownerId } = await seedOrg("member");
    await entitleOrg(orgId);
    await addStation(orgId, "Owner Station", ownerId); // must NOT appear
    await addStation(orgId, "Member Station", callerId);
    await addStation(orgId, "System Station", SystemUtilities.id.system);

    const objects = await RbacObjectSearchService.search(
      { userId: callerId, organizationId: orgId, roles: ["member"] },
      "station",
      ""
    );
    const labels = objects.map((o) => o.label).sort();
    expect(labels).toEqual(["Member Station", "System Station"]);
  });

  it("data-plane + pseudo + unknown resource types return no candidates", async () => {
    const { orgId } = await seedOrg("owner");
    await entitleOrg(orgId);
    for (const rt of ["entity_record", "field_mapping", "billing", "planet"]) {
      const res = await auth(
        request(app).get(`/api/rbac/objects?resourceType=${rt}`)
      );
      expect(res.status).toBe(200);
      expect(res.body.payload.objects).toEqual([]);
    }
  });

  it("refuses an org without the customRbac entitlement", async () => {
    const { orgId } = await seedOrg("owner");
    await entitleOrg(orgId, false);
    const res = await auth(
      request(app).get("/api/rbac/objects?resourceType=station")
    );
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ApiCode.RBAC_CUSTOM_NOT_ENTITLED);
  });

  it("refuses a member (no owner/admin capability)", async () => {
    const { orgId } = await seedOrg("member");
    await entitleOrg(orgId);
    const res = await auth(
      request(app).get("/api/rbac/objects?resourceType=station")
    );
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ApiCode.INSUFFICIENT_ROLE);
  });
});
