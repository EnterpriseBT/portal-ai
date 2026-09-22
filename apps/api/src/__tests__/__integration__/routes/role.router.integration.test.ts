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
import {
  PolicyModelFactory,
  PermissionStatementModelFactory,
  UserRoleModelFactory,
} from "@portalai/core/models";
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

const CALLER_AUTH0 = "auth0|role-caller";

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
  tiers,
  roles,
  permissionPolicies,
  permissionStatements,
  policyAttachments,
  userRole,
  auditLog,
} = schema;

const auth = (r: request.Test) => r.set("authorization", "Bearer x");

describe("/api/roles (#622 slice 4)", () => {
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

  /** Insert a custom policy with one `allow read station` statement. */
  async function makeCustomPolicy(orgId: string, name = "P") {
    const policy = new PolicyModelFactory()
      .create("RBAC_TEST")
      .update({
        organizationId: orgId,
        name,
        kind: "custom",
        description: null,
      })
      .parse();
    await db.insert(permissionPolicies).values(policy as never);
    const stmt = new PermissionStatementModelFactory()
      .create("RBAC_TEST")
      .update({
        organizationId: orgId,
        policyId: policy.id,
        effect: "allow",
        verb: "read",
        resourceType: "station",
        resourceId: null,
        condition: null,
      })
      .parse();
    await db.insert(permissionStatements).values(stmt as never);
    return policy.id;
  }

  async function systemPolicyId(orgId: string, name: string) {
    const [row] = await db
      .select()
      .from(permissionPolicies)
      .where(
        and(
          eq(permissionPolicies.organizationId, orgId),
          eq(permissionPolicies.name, name)
        )
      )
      .limit(1);
    return row.id;
  }

  it("owner creates a role bundling a custom policy → attachments + audit", async () => {
    const { orgId } = await seedOrg("owner");
    await entitleOrg(orgId);
    const policyId = await makeCustomPolicy(orgId);

    const res = await auth(request(app).post("/api/roles")).send({
      name: "Analyst",
      policyIds: [policyId],
    });
    expect(res.status).toBe(200);
    expect(res.body.payload.role.kind).toBe("custom");
    expect(res.body.payload.role.policyIds).toEqual([policyId]);

    const roleId = res.body.payload.role.id;
    const attachments = await db
      .select()
      .from(policyAttachments)
      .where(
        and(
          eq(policyAttachments.principalId, roleId),
          isNull(policyAttachments.deleted)
        )
      );
    expect(attachments).toHaveLength(1);

    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.organizationId, orgId),
          eq(auditLog.action, "role.create")
        )
      );
    expect(audits).toHaveLength(1);
  });

  it("an admin bundling the system FullAccess policy is rejected by the boundary", async () => {
    const { orgId } = await seedOrg("admin");
    await entitleOrg(orgId);
    const fullAccessId = await systemPolicyId(orgId, "FullAccess");

    const res = await auth(request(app).post("/api/roles")).send({
      name: "SuperRole",
      policyIds: [fullAccessId],
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ApiCode.RBAC_POLICY_EXCEEDS_BOUNDARY);
  });

  it("update re-sets the role's attached policies", async () => {
    const { orgId } = await seedOrg("owner");
    await entitleOrg(orgId);
    const p1 = await makeCustomPolicy(orgId, "P1");
    const p2 = await makeCustomPolicy(orgId, "P2");

    const created = await auth(request(app).post("/api/roles")).send({
      name: "R",
      policyIds: [p1],
    });
    const roleId = created.body.payload.role.id;

    const put = await auth(request(app).put(`/api/roles/${roleId}`)).send({
      name: "R",
      policyIds: [p2],
    });
    expect(put.status).toBe(200);
    expect(put.body.payload.role.policyIds).toEqual([p2]);

    const live = await db
      .select()
      .from(policyAttachments)
      .where(
        and(
          eq(policyAttachments.principalId, roleId),
          isNull(policyAttachments.deleted)
        )
      );
    expect(live.map((a) => a.policyId)).toEqual([p2]);
  });

  it("a system role cannot be edited or deleted", async () => {
    const { orgId } = await seedOrg("owner");
    await entitleOrg(orgId);
    const [memberRole] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.organizationId, orgId), eq(roles.name, "member")))
      .limit(1);

    const put = await auth(
      request(app).put(`/api/roles/${memberRole.id}`)
    ).send({ name: "member", policyIds: [] });
    expect(put.status).toBe(403);
    expect(put.body.code).toBe(ApiCode.RBAC_SYSTEM_IMMUTABLE);

    const del = await auth(request(app).delete(`/api/roles/${memberRole.id}`));
    expect(del.status).toBe(403);
    expect(del.body.code).toBe(ApiCode.RBAC_SYSTEM_IMMUTABLE);
  });

  it("delete cascade-soft-deletes the role's assignments + attachments", async () => {
    const { orgId } = await seedOrg("owner");
    await entitleOrg(orgId);
    const policyId = await makeCustomPolicy(orgId);
    const created = await auth(request(app).post("/api/roles")).send({
      name: "Temp",
      policyIds: [policyId],
    });
    const roleId = created.body.payload.role.id;

    // Assign the role to a user.
    const u = createUser(`auth0|assignee-${generateId()}`);
    await db.insert(users).values(u as never);
    const assignment = new UserRoleModelFactory()
      .create("RBAC_TEST")
      .update({ userId: u.id, organizationId: orgId, roleId })
      .parse();
    await db.insert(userRole).values(assignment as never);

    const del = await auth(request(app).delete(`/api/roles/${roleId}`));
    expect(del.status).toBe(200);

    const liveAssignments = await db
      .select()
      .from(userRole)
      .where(and(eq(userRole.roleId, roleId), isNull(userRole.deleted)));
    expect(liveAssignments).toHaveLength(0);
    const liveAttachments = await db
      .select()
      .from(policyAttachments)
      .where(
        and(
          eq(policyAttachments.principalId, roleId),
          isNull(policyAttachments.deleted)
        )
      );
    expect(liveAttachments).toHaveLength(0);
    const [role] = await db.select().from(roles).where(eq(roles.id, roleId));
    expect(role.deleted).not.toBeNull();
  });
});
