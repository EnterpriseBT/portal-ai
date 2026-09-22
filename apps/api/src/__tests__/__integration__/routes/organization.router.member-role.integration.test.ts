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
import type { OrgRole } from "@portalai/core/models";
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

const CALLER_AUTH0 = "auth0|role-assign-caller";

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
const { users, organizations, organizationUsers, auditLog, userRole, roles } =
  schema;

describe("PUT /api/organization/members/:userId/roles (#620 set-the-set)", () => {
  let connection: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;

  beforeAll(() => {
    connection = postgres(process.env.DATABASE_URL as string, { max: 1 });
    db = drizzle(connection, { schema });
  });
  afterEach(async () => {
    // setMemberRoles emits audit rows fire-and-forget (post-commit); let them
    // land before teardown deletes the org, or the late insert violates the
    // audit_log → organizations FK.
    await new Promise((r) => setTimeout(r, 200));
    await teardownOrg(db);
  });
  afterAll(async () => {
    await connection.end();
  });

  async function seedCaller(callerRole: OrgRole): Promise<string> {
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
    return org.id;
  }

  async function seedTarget(orgId: string, role: OrgRole = "member") {
    const u = createUser(`auth0|target-${generateId()}`);
    await db.insert(users).values(u as never);
    await db
      .insert(organizationUsers)
      .values(
        createOrganizationUser(orgId, u.id, { role, lastLogin: 0 }) as never
      );
    return u.id;
  }

  // #622: assignment is by slug; for system roles slug === name, so the
  // existing owner/admin/member bodies are already valid slugs.
  const putRoles = (userId: string, rolesBody: string[]) =>
    request(app)
      .put(`/api/organization/members/${userId}/roles`)
      .set("Authorization", "Bearer test-token")
      .send({ roleSlugs: rolesBody });

  async function roleNames(userId: string, orgId: string): Promise<string[]> {
    const rows = await db
      .select({ name: roles.name })
      .from(userRole)
      .innerJoin(roles, eq(userRole.roleId, roles.id))
      .where(
        and(
          eq(userRole.userId, userId),
          eq(userRole.organizationId, orgId),
          isNull(userRole.deleted)
        )
      );
    return rows.map((r) => r.name as string);
  }

  it("owner sets a member to [admin, member] (multi-role add)", async () => {
    const orgId = await seedCaller("owner");
    const target = await seedTarget(orgId, "member");

    const res = await putRoles(target, ["admin", "member"]);

    expect(res.status).toBe(200);
    expect(res.body.payload.member.roles.sort()).toEqual(["admin", "member"]);
    expect((await roleNames(target, orgId)).sort()).toEqual([
      "admin",
      "member",
    ]);
    // Enum mirror = highest of the set.
    const [row] = await db
      .select()
      .from(organizationUsers)
      .where(
        and(
          eq(organizationUsers.organizationId, orgId),
          eq(organizationUsers.userId, target)
        )
      );
    expect(row.role).toBe("admin");

    // Audits member.role.add (post-commit, fail-open — give it a tick).
    await new Promise((r) => setTimeout(r, 75));
    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.organizationId, orgId),
          eq(auditLog.action, "member.role.add")
        )
      );
    expect(audits.some((a) => a.targetId === target)).toBe(true);
  });

  it("removes roles no longer in the desired set", async () => {
    const orgId = await seedCaller("owner");
    const target = await seedTarget(orgId, "member");
    await putRoles(target, ["admin", "member"]);

    const res = await putRoles(target, ["member"]);

    expect(res.status).toBe(200);
    expect(await roleNames(target, orgId)).toEqual(["member"]);
  });

  it("rejects an empty roles array at the schema edge (400)", async () => {
    const orgId = await seedCaller("owner");
    const target = await seedTarget(orgId, "member");

    const res = await putRoles(target, []);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.ORGANIZATION_INVALID_PAYLOAD);
  });

  it("blocks removing the owner role from the org's last owner (409)", async () => {
    const orgId = await seedCaller("owner");
    // The caller is the sole owner — demoting themselves strips the last owner.
    const caller = await db
      .select({ userId: organizationUsers.userId })
      .from(organizationUsers)
      .where(
        and(
          eq(organizationUsers.organizationId, orgId),
          eq(organizationUsers.role, "owner")
        )
      );

    const res = await putRoles(caller[0].userId, ["member"]);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ApiCode.LAST_OWNER_ROLE_REMOVAL);
  });

  it("an owner may add a co-owner, then the last-owner guard relaxes", async () => {
    const orgId = await seedCaller("owner");
    const target = await seedTarget(orgId, "member");

    // Promote target to owner (co-owner) — now two owners exist.
    const promote = await putRoles(target, ["owner"]);
    expect(promote.status).toBe(200);
    expect(await roleNames(target, orgId)).toEqual(["owner"]);
  });

  it("an admin cannot add or remove the admin role (403)", async () => {
    const orgId = await seedCaller("admin");
    const target = await seedTarget(orgId, "member");

    const res = await putRoles(target, ["admin"]);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ApiCode.INSUFFICIENT_ROLE);
  });

  it("a member caller cannot set roles (403)", async () => {
    const orgId = await seedCaller("member");
    const target = await seedTarget(orgId, "member");

    const res = await putRoles(target, ["member"]);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ApiCode.INSUFFICIENT_ROLE);
  });

  it("returns 404 for a member not in this organization", async () => {
    await seedCaller("owner");

    const res = await putRoles("nonexistent-user-id", ["admin"]);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ApiCode.ORGANIZATION_USER_NOT_FOUND);
  });
});
