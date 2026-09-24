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

// The auth mock reads the caller's auth0 sub straight off the Bearer token, so a
// single test can act as different org members by changing the header.
jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, _res: Response, next: NextFunction) => {
    const h = req.headers.authorization;
    if (h?.startsWith("Bearer ")) {
      req.auth = { payload: { sub: h.slice("Bearer ".length) } } as never;
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
const {
  users,
  organizations,
  organizationUsers,
  entityGroups,
  connectorInstances,
  jobs,
} = schema;

/**
 * #630 slice 2 — the server enforcement boundary. Two object semantics:
 *  - `connector_instance` ∈ DATA_RESOURCE_TYPES → member reads own + system
 *    (created_by_caller / created_by_system), never another member's.
 *  - `entity_group` is admin-managed (no member grant) → member sees nothing,
 *    owner sees all.
 * Plus the toolpacks class gate (member 403) and jobs unconditional read.
 * This is the real access boundary; nav-hiding is only convenience over it.
 */
describe("nav/object RBAC enforcement (#630 slice 2)", () => {
  let connection: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;

  const ownerAuth0 = "auth0|nav-owner";
  const memberAAuth0 = "auth0|nav-member-a";
  const memberBAuth0 = "auth0|nav-member-b";
  const bearer = (r: request.Test, sub: string) =>
    r.set("authorization", `Bearer ${sub}`);

  let orgId: string;
  let ownerId: string;
  let memberAId: string;
  let memberBId: string;

  let ciOwnA: string; // connector instance created by member A
  let ciOwnB: string; // connector instance created by member B
  let ciSystem: string; // system-created connector instance
  let groupOwnA: string; // entity group created by member A (admin-managed type)

  beforeAll(async () => {
    connection = postgres(process.env.DATABASE_URL as string, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);

    const owner = createUser(ownerAuth0);
    const memberA = createUser(memberAAuth0);
    const memberB = createUser(memberBAuth0);
    await db.insert(users).values([owner, memberA, memberB] as never);
    ownerId = owner.id;
    memberAId = memberA.id;
    memberBId = memberB.id;

    const org = createOrganization(ownerId);
    orgId = org.id;
    await db.insert(organizations).values(org as never);
    await seedRbacForOrg(db as never, orgId);

    const now = Date.now();
    await db.insert(organizationUsers).values([
      createOrganizationUser(orgId, ownerId, { role: "owner", lastLogin: now }),
      createOrganizationUser(orgId, memberAId, {
        role: "member",
        lastLogin: now,
      }),
      createOrganizationUser(orgId, memberBId, {
        role: "member",
        lastLogin: now,
      }),
    ] as never);

    const audit = {
      created: Date.now(),
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    };

    // connector instances (created_by_caller semantics)
    const ci = (name: string, createdBy: string) => {
      const id = generateId();
      return {
        id,
        connectorDefinitionId: "def-test",
        organizationId: orgId,
        name,
        status: "pending" as const,
        config: null,
        credentials: null,
        lastSyncAt: null,
        lastErrorMessage: null,
        enabledCapabilityFlags: null,
        createdBy,
        ...audit,
      };
    };
    const a = ci("CI Member A", memberAId);
    const b = ci("CI Member B", memberBId);
    const s = ci("CI System", SystemUtilities.id.system);
    ciOwnA = a.id;
    ciOwnB = b.id;
    ciSystem = s.id;
    await db.insert(connectorInstances).values([a, b, s] as never);

    // entity groups (admin-managed type — no member grant)
    const eg = (name: string, createdBy: string) => ({
      id: generateId(),
      organizationId: orgId,
      name,
      description: null,
      createdBy,
      ...audit,
    });
    const ga = eg("EG Member A", memberAId);
    groupOwnA = ga.id;
    await db
      .insert(entityGroups)
      .values([
        ga,
        eg("EG Member B", memberBId),
        eg("EG System", SystemUtilities.id.system),
      ] as never);

    // a job created by the owner — a member must still see it (unconditional read)
    await db.insert(jobs).values({
      id: generateId(),
      organizationId: orgId,
      type: "connector_sync",
      status: "pending",
      progress: 0,
      metadata: {},
      createdBy: ownerId,
      ...audit,
    } as never);
  });

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });

  afterAll(async () => {
    await teardownOrg(db);
    await connection.end();
  });

  // ── connector_instance: created_by_caller filtering ─────────────────
  it("a member's connector list shows own + system, not another member's", async () => {
    const res = await bearer(
      request(app).get("/api/connector-instances?limit=50"),
      memberAAuth0
    );
    expect(res.status).toBe(200);
    const names = res.body.payload.connectorInstances
      .map((c: { name: string }) => c.name)
      .sort();
    expect(names).toEqual(["CI Member A", "CI System"]);
    expect(names).not.toContain("CI Member B");
  });

  it("the owner's connector list shows every instance", async () => {
    const res = await bearer(
      request(app).get("/api/connector-instances?limit=50"),
      ownerAuth0
    );
    expect(res.status).toBe(200);
    expect(res.body.payload.connectorInstances).toHaveLength(3);
  });

  it("a member may open their own + the system connector, not another member's", async () => {
    expect(
      (
        await bearer(
          request(app).get(`/api/connector-instances/${ciOwnA}`),
          memberAAuth0
        )
      ).status
    ).toBe(200);
    expect(
      (
        await bearer(
          request(app).get(`/api/connector-instances/${ciSystem}`),
          memberAAuth0
        )
      ).status
    ).toBe(200);
    expect(
      (
        await bearer(
          request(app).get(`/api/connector-instances/${ciOwnB}`),
          memberAAuth0
        )
      ).status
    ).toBe(404);
  });

  it("the owner may open any connector", async () => {
    const res = await bearer(
      request(app).get(`/api/connector-instances/${ciOwnB}`),
      ownerAuth0
    );
    expect(res.status).toBe(200);
  });

  // ── entity_group: admin-managed (no member grant) ───────────────────
  it("a member sees no entity groups and cannot open one (admin-managed type)", async () => {
    const list = await bearer(
      request(app).get("/api/entity-groups?limit=50"),
      memberAAuth0
    );
    expect(list.status).toBe(200);
    expect(list.body.payload.entityGroups).toHaveLength(0);

    const detail = await bearer(
      request(app).get(`/api/entity-groups/${groupOwnA}`),
      memberAAuth0
    );
    expect(detail.status).toBe(404); // 404 even though the member "created" it
  });

  it("the owner sees and can open every entity group", async () => {
    const list = await bearer(
      request(app).get("/api/entity-groups?limit=50"),
      ownerAuth0
    );
    expect(list.body.payload.entityGroups).toHaveLength(3);
    const detail = await bearer(
      request(app).get(`/api/entity-groups/${groupOwnA}`),
      ownerAuth0
    );
    expect(detail.status).toBe(200);
  });

  // ── Toolpacks class gate ───────────────────────────────────────────
  it("a member is denied the toolpacks list (class-level read gate)", async () => {
    const res = await bearer(request(app).get("/api/toolpacks"), memberAAuth0);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ApiCode.INSUFFICIENT_ROLE);
  });

  it("the owner may read the toolpacks list", async () => {
    const res = await bearer(request(app).get("/api/toolpacks"), ownerAuth0);
    expect(res.status).toBe(200);
  });

  // ── Jobs read-all ──────────────────────────────────────────────────
  it("a member sees jobs they did not create (unconditional read job)", async () => {
    const res = await bearer(
      request(app).get("/api/jobs?limit=50"),
      memberAAuth0
    );
    expect(res.status).toBe(200);
    expect(res.body.payload.jobs.length).toBeGreaterThanOrEqual(1);
  });

  // ── Sibling routes carry the same boundary as the main route (#630 fixes) ──
  it("connector /:id/impact + /running-jobs are 404 for a member on another's instance", async () => {
    expect(
      (
        await bearer(
          request(app).get(`/api/connector-instances/${ciOwnB}/impact`),
          memberAAuth0
        )
      ).status
    ).toBe(404);
    expect(
      (
        await bearer(
          request(app).get(`/api/connector-instances/${ciOwnB}/running-jobs`),
          memberAAuth0
        )
      ).status
    ).toBe(404);
    // …but the owner sees the impact of any instance.
    expect(
      (
        await bearer(
          request(app).get(`/api/connector-instances/${ciOwnB}/impact`),
          ownerAuth0
        )
      ).status
    ).toBe(200);
  });

  it("connector /:id/sync is refused (403) for a member on another member's instance", async () => {
    const res = await bearer(
      request(app).post(`/api/connector-instances/${ciOwnB}/sync`),
      memberAAuth0
    );
    expect(res.status).toBe(403);
  });

  it("entity-group /:id/impact is 404 for a member (admin-managed type)", async () => {
    const res = await bearer(
      request(app).get(`/api/entity-groups/${groupOwnA}/impact`),
      memberAAuth0
    );
    expect(res.status).toBe(404);
  });

  it("jobs /:id/cancel is org-scoped — a foreign-org job is 404", async () => {
    // A second org with its own job; memberA (in the first org) must not cancel it.
    const otherOwner = createUser(`auth0|nav-other-${generateId()}`);
    await db.insert(users).values(otherOwner as never);
    const otherOrg = createOrganization(otherOwner.id);
    await db.insert(organizations).values(otherOrg as never);
    await seedRbacForOrg(db as never, otherOrg.id);
    const foreignJobId = generateId();
    await db.insert(jobs).values({
      id: foreignJobId,
      organizationId: otherOrg.id,
      type: "connector_sync",
      status: "pending",
      progress: 0,
      metadata: {},
      created: Date.now(),
      createdBy: otherOwner.id,
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    const res = await bearer(
      request(app).post(`/api/jobs/${foreignJobId}/cancel`),
      memberAAuth0
    );
    expect(res.status).toBe(404);
  });
});
