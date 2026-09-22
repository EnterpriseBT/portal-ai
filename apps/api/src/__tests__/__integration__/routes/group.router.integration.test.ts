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
  type OrgRole,
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

const CALLER_AUTH0 = "auth0|group-caller";

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
const { PermissionService } =
  await import("../../../services/permission.service.js");
const {
  users,
  organizations,
  organizationUsers,
  tiers,
  groups,
  userGroup,
  permissionPolicies,
  permissionStatements,
  policyAttachments,
} = schema;

const auth = (r: request.Test) => r.set("authorization", "Bearer x");

describe("/api/groups (#622 slice 5)", () => {
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

  async function seedOrg() {
    const caller = createUser(CALLER_AUTH0);
    await db.insert(users).values(caller as never);
    const org = createOrganization(caller.id);
    await db.insert(organizations).values(org as never);
    await seedRbacForOrg(db as never, org.id);
    await db.insert(organizationUsers).values(
      createOrganizationUser(org.id, caller.id, {
        role: "owner",
        lastLogin: Date.now(),
      }) as never
    );
    return { orgId: org.id, ownerId: caller.id };
  }

  async function addMember(orgId: string) {
    const u = createUser(`auth0|m-${generateId()}`);
    await db.insert(users).values(u as never);
    await db.insert(organizationUsers).values(
      createOrganizationUser(orgId, u.id, {
        role: "member",
        lastLogin: 0,
      }) as never
    );
    return u.id;
  }

  async function entitleOrg(orgId: string) {
    const slug = `rbac-tier-${generateId()}`;
    await db.insert(tiers).values({
      id: generateId(),
      created: Date.now(),
      createdBy: "RBAC_TEST",
      slug,
      displayName: "RBAC Test Tier",
      customRbac: true,
    } as never);
    await db
      .update(organizations)
      .set({ tier: slug })
      .where(eq(organizations.id, orgId));
  }

  /** A custom policy granting `read audit` (a capability a member lacks). */
  async function auditReadPolicy(orgId: string) {
    const policy = new PolicyModelFactory()
      .create("RBAC_TEST")
      .update({
        organizationId: orgId,
        name: "AuditRead",
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
        resourceType: "audit",
        resourceId: null,
        condition: null,
      })
      .parse();
    await db.insert(permissionStatements).values(stmt as never);
    return policy.id;
  }

  it("owner creates a group bundling a policy; a member added to it inherits the policy", async () => {
    const { orgId } = await seedOrg();
    await entitleOrg(orgId);
    const policyId = await auditReadPolicy(orgId);
    const memberId = await addMember(orgId);

    const created = await auth(request(app).post("/api/groups")).send({
      name: "Auditors",
      policyIds: [policyId],
    });
    expect(created.status).toBe(200);
    expect(created.body.payload.group.policyIds).toEqual([policyId]);
    expect(created.body.payload.group.memberCount).toBe(0);
    const groupId = created.body.payload.group.id;

    // Member is not yet in the group → cannot read audit.
    const memberCtx = {
      userId: memberId,
      organizationId: orgId,
      roles: ["member"] as OrgRole[],
    };
    expect(
      (await PermissionService.loadSet(memberCtx)).can("org.audit.read")
    ).toBe(false);

    // Add the member (group-centric) → inherits the group's policy.
    const setM = await auth(
      request(app).put(`/api/groups/${groupId}/members`)
    ).send({ userIds: [memberId] });
    expect(setM.status).toBe(200);
    expect(setM.body.payload.group.memberCount).toBe(1);
    expect(
      (await PermissionService.loadSet(memberCtx)).can("org.audit.read")
    ).toBe(true);
  });

  it("member-centric setGroups adds the user to the group", async () => {
    const { orgId } = await seedOrg();
    await entitleOrg(orgId);
    const memberId = await addMember(orgId);
    const created = await auth(request(app).post("/api/groups")).send({
      name: "West",
      policyIds: [],
    });
    const groupId = created.body.payload.group.id;

    const res = await auth(
      request(app).put(`/api/organization/members/${memberId}/groups`)
    ).send({ groupIds: [groupId] });
    expect(res.status).toBe(200);

    const live = await db
      .select()
      .from(userGroup)
      .where(and(eq(userGroup.groupId, groupId), isNull(userGroup.deleted)));
    expect(live.map((r) => r.userId)).toEqual([memberId]);
  });

  it("setMembers rejects a user who is not an org member", async () => {
    const { orgId } = await seedOrg();
    await entitleOrg(orgId);
    const created = await auth(request(app).post("/api/groups")).send({
      name: "G",
      policyIds: [],
    });
    const groupId = created.body.payload.group.id;
    const stranger = createUser(`auth0|stranger-${generateId()}`);
    await db.insert(users).values(stranger as never);

    const res = await auth(
      request(app).put(`/api/groups/${groupId}/members`)
    ).send({ userIds: [stranger.id] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.RBAC_GRANTEE_NOT_MEMBER);
  });

  it("owner can bundle a system policy into a group (boundary passes for * *)", async () => {
    // The group boundary path is identical to RoleService's (union of the
    // bundled policies' statements); admin-bundles-FullAccess rejection is
    // proven there. Here: an owner holding `* *` bundles a system policy fine.
    const { orgId } = await seedOrg();
    await entitleOrg(orgId);
    const [adminAccess] = await db
      .select()
      .from(permissionPolicies)
      .where(
        and(
          eq(permissionPolicies.organizationId, orgId),
          eq(permissionPolicies.name, "AdminAccess")
        )
      )
      .limit(1);
    const res = await auth(request(app).post("/api/groups")).send({
      name: "AdminGroup",
      policyIds: [adminAccess.id],
    });
    expect(res.status).toBe(200);
    expect(res.body.payload.group.policyIds).toEqual([adminAccess.id]);
  });

  it("delete cascade-soft-deletes memberships + attachments", async () => {
    const { orgId } = await seedOrg();
    await entitleOrg(orgId);
    const policyId = await auditReadPolicy(orgId);
    const memberId = await addMember(orgId);
    const created = await auth(request(app).post("/api/groups")).send({
      name: "Temp",
      policyIds: [policyId],
    });
    const groupId = created.body.payload.group.id;
    await auth(request(app).put(`/api/groups/${groupId}/members`)).send({
      userIds: [memberId],
    });

    const del = await auth(request(app).delete(`/api/groups/${groupId}`));
    expect(del.status).toBe(200);

    const liveMembers = await db
      .select()
      .from(userGroup)
      .where(and(eq(userGroup.groupId, groupId), isNull(userGroup.deleted)));
    expect(liveMembers).toHaveLength(0);
    const liveAttachments = await db
      .select()
      .from(policyAttachments)
      .where(
        and(
          eq(policyAttachments.principalId, groupId),
          isNull(policyAttachments.deleted)
        )
      );
    expect(liveAttachments).toHaveLength(0);
    const [group] = await db
      .select()
      .from(groups)
      .where(eq(groups.id, groupId));
    expect(group.deleted).not.toBeNull();
  });
});
