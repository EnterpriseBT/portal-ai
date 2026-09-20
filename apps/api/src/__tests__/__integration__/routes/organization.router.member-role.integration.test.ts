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
const { users, organizations, organizationUsers, auditLog } = schema;

describe("PATCH /api/organization/members/:userId/role (#576)", () => {
  let connection: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;

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

  /** Seed the caller (CALLER_AUTH0) with `callerRole` in a fresh org. */
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

    // Caller's membership is their current org (highest lastLogin).
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

  async function seedTarget(
    orgId: string,
    role: OrgRole = "member"
  ): Promise<string> {
    const u = createUser(`auth0|target-${generateId()}`);
    await db.insert(users).values(u as never);
    await db
      .insert(organizationUsers)
      .values(
        createOrganizationUser(orgId, u.id, { role, lastLogin: 0 }) as never
      );
    return u.id;
  }

  const patchRole = (userId: string, role: string) =>
    request(app)
      .patch(`/api/organization/members/${userId}/role`)
      .set("Authorization", "Bearer test-token")
      .send({ role });

  it("owner promotes a member to admin (200) and emits member.role.change", async () => {
    const orgId = await seedCaller("owner");
    const target = await seedTarget(orgId, "member");

    const res = await patchRole(target, "admin");

    expect(res.status).toBe(200);
    expect(res.body.payload.member.role).toBe("admin");

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

    // Audit is post-commit, fail-open — give it a tick (mirrors audit-emission test).
    await new Promise((r) => setTimeout(r, 75));
    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.organizationId, orgId),
          eq(auditLog.action, "member.role.change")
        )
      );
    expect(audits).toHaveLength(1);
    expect(audits[0].targetId).toBe(target);
    expect(audits[0].metadata).toMatchObject({ from: "member", to: "admin" });
  });

  it("admin cannot promote a member to admin (403 INSUFFICIENT_ROLE)", async () => {
    const orgId = await seedCaller("admin");
    const target = await seedTarget(orgId, "member");

    const res = await patchRole(target, "admin");

    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ApiCode.INSUFFICIENT_ROLE);
  });

  it("admin may keep a member as member (200)", async () => {
    const orgId = await seedCaller("admin");
    const target = await seedTarget(orgId, "member");

    const res = await patchRole(target, "member");

    expect(res.status).toBe(200);
    expect(res.body.payload.member.role).toBe("member");
  });

  it("a member caller cannot assign roles (403 INSUFFICIENT_ROLE)", async () => {
    const orgId = await seedCaller("member");
    const target = await seedTarget(orgId, "member");

    const res = await patchRole(target, "member");

    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ApiCode.INSUFFICIENT_ROLE);
  });

  it("the owner role is immutable via this endpoint (403)", async () => {
    const orgId = await seedCaller("owner");
    const target = await seedTarget(orgId, "member");

    const res = await patchRole(target, "owner");

    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ApiCode.INSUFFICIENT_ROLE);
  });

  it("returns 404 for a member not in this organization", async () => {
    await seedCaller("owner");

    const res = await patchRole("nonexistent-user-id", "admin");

    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ApiCode.ORGANIZATION_USER_NOT_FOUND);
  });

  it("rejects an invalid role with 400", async () => {
    const orgId = await seedCaller("owner");
    const target = await seedTarget(orgId, "member");

    const res = await patchRole(target, "superuser");

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.ORGANIZATION_INVALID_PAYLOAD);
  });
});
