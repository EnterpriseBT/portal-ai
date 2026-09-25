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
import { and, eq, isNull } from "drizzle-orm";
import { PolicyAttachmentModelFactory } from "@portalai/core/models";
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

const CALLER_AUTH0 = "auth0|policy-caller";

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
const {
  users,
  organizations,
  organizationUsers,
  stations,
  tiers,
  permissionPolicies,
  permissionStatements,
  policyAttachments,
  roles,
  auditLog,
} = schema;

const auth = (r: request.Test) => r.set("authorization", "Bearer x");
const readStation = {
  effect: "allow" as const,
  verb: "read" as const,
  resourceType: "station" as const,
  resourceId: null,
  condition: null,
};

describe("/api/policies (#622 slice 3)", () => {
  let connection: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;

  beforeAll(() => {
    connection = postgres(process.env.DATABASE_URL as string, { max: 1 });
    db = drizzle(connection, { schema });
  });
  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 150)); // let fail-open audits land
    await teardownOrg(db);
    await db.delete(tiers).where(eq(tiers.createdBy, "RBAC_TEST"));
  });
  afterAll(async () => {
    await connection.end();
  });

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
    return { orgId: org.id, callerId: caller.id };
  }

  /** Point the org at a fresh tier with the given customRbac entitlement. */
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

  const body = (over: Record<string, unknown> = {}) => ({
    name: "Analysts",
    statements: [readStation],
    ...over,
  });

  it("owner creates a bounded custom policy → rows + policy.create audit", async () => {
    const { orgId } = await seedOrg("owner");
    await entitleOrg(orgId);

    const res = await auth(request(app).post("/api/policies")).send(body());
    expect(res.status).toBe(200);
    expect(res.body.payload.policy.kind).toBe("custom");
    expect(res.body.payload.policy.statements).toHaveLength(1);

    const policyId = res.body.payload.policy.id;
    const [pol] = await db
      .select()
      .from(permissionPolicies)
      .where(eq(permissionPolicies.id, policyId));
    expect(pol.kind).toBe("custom");
    const stmts = await db
      .select()
      .from(permissionStatements)
      .where(eq(permissionStatements.policyId, policyId));
    expect(stmts).toHaveLength(1);

    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.organizationId, orgId),
          eq(auditLog.action, "policy.create")
        )
      );
    expect(audits).toHaveLength(1);
  });

  it("an admin authoring allow * * is rejected by the boundary", async () => {
    const { orgId } = await seedOrg("admin");
    await entitleOrg(orgId);
    const res = await auth(request(app).post("/api/policies")).send(
      body({
        name: "SuperAdmin",
        statements: [
          {
            effect: "allow",
            verb: "*",
            resourceType: "*",
            resourceId: null,
            condition: null,
          },
        ],
      })
    );
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ApiCode.RBAC_POLICY_EXCEEDS_BOUNDARY);
  });

  // Statement shape validity (#630) — the RESOURCE_CAPABILITIES matrix, enforced
  // in PolicyService so BOTH this HTTP path and the rbac_management toolpack (thin
  // wrappers over the same PolicyService.create/update) reject inert statements.
  it("rejects an inert statement shape (read page) with 400 RBAC_STATEMENT_INVALID", async () => {
    const { orgId } = await seedOrg("owner");
    await entitleOrg(orgId);
    const res = await auth(request(app).post("/api/policies")).send(
      body({
        name: "BadShape",
        statements: [
          {
            effect: "allow",
            verb: "read",
            resourceType: "page",
            resourceId: "connectors",
            condition: null,
          },
        ],
      })
    );
    // Validity runs before the boundary — an owner would clear the boundary via
    // `* *`, so a 400 (not 403) proves the shape check fired first.
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.RBAC_STATEMENT_INVALID);
  });

  it("rejects an inert shape on update too (manage station)", async () => {
    const { orgId } = await seedOrg("owner");
    await entitleOrg(orgId);
    const created = await auth(request(app).post("/api/policies")).send(body());
    const res = await auth(
      request(app).put(`/api/policies/${created.body.payload.policy.id}`)
    ).send(
      body({
        statements: [
          {
            effect: "allow",
            verb: "manage",
            resourceType: "station",
            resourceId: null,
            condition: null,
          },
        ],
      })
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.RBAC_STATEMENT_INVALID);
  });

  it("accepts a valid `view page` grant (the nav-via-policy use case)", async () => {
    const { orgId } = await seedOrg("owner");
    await entitleOrg(orgId);
    const res = await auth(request(app).post("/api/policies")).send(
      body({
        name: "NavGrant",
        statements: [
          {
            effect: "allow",
            verb: "view",
            resourceType: "page",
            resourceId: "connectors",
            condition: null,
          },
        ],
      })
    );
    expect(res.status).toBe(200);
    expect(res.body.payload.policy.statements).toHaveLength(1);
  });

  it("an org without the customRbac entitlement is refused", async () => {
    const { orgId } = await seedOrg("owner");
    await entitleOrg(orgId, false);
    const res = await auth(request(app).post("/api/policies")).send(body());
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ApiCode.RBAC_CUSTOM_NOT_ENTITLED);
  });

  it("a member (no owner/admin capability) is refused", async () => {
    const { orgId } = await seedOrg("member");
    await entitleOrg(orgId);
    const res = await auth(request(app).post("/api/policies")).send(body());
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ApiCode.INSUFFICIENT_ROLE);
  });

  it("a duplicate policy name → 409", async () => {
    const { orgId } = await seedOrg("owner");
    await entitleOrg(orgId);
    await auth(request(app).post("/api/policies")).send(body({ name: "Dup" }));
    const res = await auth(request(app).post("/api/policies")).send(
      body({ name: "Dup" })
    );
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ApiCode.RBAC_NAME_CONFLICT);
  });

  it("a system policy cannot be edited or deleted", async () => {
    const { orgId } = await seedOrg("owner");
    await entitleOrg(orgId);
    const [sysPolicy] = await db
      .select()
      .from(permissionPolicies)
      .where(
        and(
          eq(permissionPolicies.organizationId, orgId),
          eq(permissionPolicies.kind, "system")
        )
      )
      .limit(1);

    const put = await auth(
      request(app).put(`/api/policies/${sysPolicy.id}`)
    ).send(body());
    expect(put.status).toBe(403);
    expect(put.body.code).toBe(ApiCode.RBAC_SYSTEM_IMMUTABLE);

    const del = await auth(
      request(app).delete(`/api/policies/${sysPolicy.id}`)
    );
    expect(del.status).toBe(403);
    expect(del.body.code).toBe(ApiCode.RBAC_SYSTEM_IMMUTABLE);
  });

  it("update replaces the statement set", async () => {
    const { orgId } = await seedOrg("owner");
    await entitleOrg(orgId);
    const created = await auth(request(app).post("/api/policies")).send(body());
    const id = created.body.payload.policy.id;

    const put = await auth(request(app).put(`/api/policies/${id}`)).send(
      body({
        statements: [
          {
            effect: "allow",
            verb: "write",
            resourceType: "station",
            resourceId: null,
            condition: "created_by_caller",
          },
        ],
      })
    );
    expect(put.status).toBe(200);

    const got = await auth(request(app).get(`/api/policies/${id}`));
    expect(got.body.payload.policy.statements).toEqual([
      {
        effect: "allow",
        verb: "write",
        resourceType: "station",
        resourceId: null,
        condition: "created_by_caller",
      },
    ]);
  });

  it("delete cascade-soft-deletes the policy's attachments", async () => {
    const { orgId } = await seedOrg("owner");
    await entitleOrg(orgId);
    const created = await auth(request(app).post("/api/policies")).send(body());
    const id = created.body.payload.policy.id;

    // Attach the policy to the member role, then delete the policy.
    const [memberRole] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.organizationId, orgId), eq(roles.name, "member")))
      .limit(1);
    const attachment = new PolicyAttachmentModelFactory()
      .create("SYSTEM_TEST")
      .update({
        organizationId: orgId,
        policyId: id,
        principalType: "role",
        principalId: memberRole.id,
      })
      .parse();
    await db.insert(policyAttachments).values(attachment as never);

    const del = await auth(request(app).delete(`/api/policies/${id}`));
    expect(del.status).toBe(200);

    const liveAttachments = await db
      .select()
      .from(policyAttachments)
      .where(
        and(
          eq(policyAttachments.policyId, id),
          isNull(policyAttachments.deleted)
        )
      );
    expect(liveAttachments).toHaveLength(0);
    const [pol] = await db
      .select()
      .from(permissionPolicies)
      .where(eq(permissionPolicies.id, id));
    expect(pol.deleted).not.toBeNull();
  });

  it("owner can author an instance statement on a station they created", async () => {
    const { orgId, callerId } = await seedOrg("owner");
    await entitleOrg(orgId);
    const stationId = await addStation(orgId, callerId);
    const res = await auth(request(app).post("/api/policies")).send(
      body({
        name: "OneStation",
        statements: [
          {
            effect: "allow",
            verb: "read",
            resourceType: "station",
            resourceId: stationId,
            condition: null,
          },
        ],
      })
    );
    expect(res.status).toBe(200);
    expect(res.body.payload.policy.statements[0].resourceId).toBe(stationId);
  });
});
