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
import {
  createUser,
  createOrganization,
  createOrganizationUser,
  generateId,
  teardownOrg,
  seedRbacForOrg,
} from "../utils/application.util.js";

// #641: an object an agent session creates records the session's portal as
// provenance (`source_portal_id`), while `createdBy` stays the prompting user.
// A REST-created object records none.

const CALLER_AUTH0 = "auth0|provenance-caller";

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
const { RoleService } = await import("../../../services/role.service.js");
const { PolicyService } = await import("../../../services/policy.service.js");
const { GroupService } = await import("../../../services/group.service.js");
const { agentAudit } = await import("../../../tools/rbac/rbac-tool.util.js");
const {
  users,
  organizations,
  organizationUsers,
  tiers,
  roles,
  permissionPolicies,
  groups,
} = schema;

const auth = (r: request.Test) => r.set("authorization", "Bearer x");
const readStation = {
  effect: "allow" as const,
  verb: "read" as const,
  resourceType: "station" as const,
  resourceId: null,
  condition: null,
};

describe("object provenance (#641)", () => {
  let connection: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;

  beforeAll(() => {
    connection = postgres(process.env.DATABASE_URL as string, { max: 1 });
    db = drizzle(connection, { schema });
  });
  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 150)); // let fail-open audits land
    await teardownOrg(db);
    await db.delete(tiers).where(eq(tiers.createdBy, "PROVENANCE_TEST"));
  });
  afterAll(async () => {
    await connection.end();
  });

  /** An owner in an org entitled to custom RBAC. */
  async function seedOwner() {
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
    const slug = `provenance-tier-${generateId()}`;
    await db.insert(tiers).values({
      id: generateId(),
      created: Date.now(),
      createdBy: "PROVENANCE_TEST",
      slug,
      displayName: "Provenance Test Tier",
      customRbac: true,
    } as never);
    await db
      .update(organizations)
      .set({ tier: slug })
      .where(eq(organizations.id, org.id));
    const ctx = {
      userId: caller.id,
      organizationId: org.id,
      roles: ["owner" as const],
    };
    return { ctx, callerId: caller.id };
  }

  const stored = async (
    table: typeof roles | typeof permissionPolicies | typeof groups,
    id: string
  ) => {
    const [row] = await db
      .select({
        createdBy: table.createdBy,
        sourcePortalId: table.sourcePortalId,
      })
      .from(table)
      .where(eq(table.id, id));
    return row;
  };

  describe("RBAC objects the agent creates", () => {
    it("a role records its portal, owned by the caller", async () => {
      const { ctx, callerId } = await seedOwner();
      const role = await RoleService.create(
        ctx,
        { name: "Agent role", policyIds: [] },
        agentAudit("portal-1")
      );
      expect(await stored(roles, role.id)).toEqual({
        createdBy: callerId,
        sourcePortalId: "portal-1",
      });
    });

    it("a policy records its portal, owned by the caller", async () => {
      const { ctx, callerId } = await seedOwner();
      const policy = await PolicyService.create(
        ctx,
        { name: "Agent policy", statements: [readStation] },
        agentAudit("portal-1")
      );
      expect(await stored(permissionPolicies, policy.id)).toEqual({
        createdBy: callerId,
        sourcePortalId: "portal-1",
      });
    });

    it("a group records its portal, owned by the caller", async () => {
      const { ctx, callerId } = await seedOwner();
      const group = await GroupService.create(
        ctx,
        { name: "Agent group", policyIds: [] },
        agentAudit("portal-1")
      );
      expect(await stored(groups, group.id)).toEqual({
        createdBy: callerId,
        sourcePortalId: "portal-1",
      });
    });

    it("an update keeps the role's provenance", async () => {
      const { ctx } = await seedOwner();
      const role = await RoleService.create(
        ctx,
        { name: "Agent role", policyIds: [] },
        agentAudit("portal-1")
      );
      await RoleService.update(
        ctx,
        role.id,
        { name: "Renamed role", policyIds: [] },
        { sourceIp: null, userAgent: "test" }
      );
      expect((await stored(roles, role.id))?.sourcePortalId).toBe("portal-1");
    });
  });

  describe("RBAC objects created through REST", () => {
    const viaRest = async (
      url: string,
      body: Record<string, unknown>,
      key: "role" | "policy" | "group"
    ) => {
      const { callerId } = await seedOwner();
      const res = await auth(request(app).post(url)).send(body);
      expect(res.status).toBe(200);
      return { callerId, id: (res.body.payload[key] as { id: string }).id };
    };

    it("POST /api/roles records no portal", async () => {
      const { callerId, id } = await viaRest(
        "/api/roles",
        { name: "UI role", policyIds: [] },
        "role"
      );
      expect(await stored(roles, id)).toEqual({
        createdBy: callerId,
        sourcePortalId: null,
      });
    });

    it("POST /api/policies records no portal", async () => {
      const { callerId, id } = await viaRest(
        "/api/policies",
        { name: "UI policy", statements: [readStation] },
        "policy"
      );
      expect(await stored(permissionPolicies, id)).toEqual({
        createdBy: callerId,
        sourcePortalId: null,
      });
    });

    it("POST /api/groups records no portal", async () => {
      const { callerId, id } = await viaRest(
        "/api/groups",
        { name: "UI group", policyIds: [] },
        "group"
      );
      expect(await stored(groups, id)).toEqual({
        createdBy: callerId,
        sourcePortalId: null,
      });
    });
  });
});
