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
import type { DbClient } from "../../../db/repositories/base.repository.js";
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
const { wideTableReconcilerService } =
  await import("../../../services/wide-table-reconciler.service.js");
const { wideTableStatementCache } =
  await import("../../../services/wide-table-statement.cache.js");
const {
  users,
  organizations,
  organizationUsers,
  tiers,
  roles,
  permissionPolicies,
  groups,
  connectorDefinitions,
  connectorInstances,
  connectorEntities,
  columnDefinitions,
  fieldMappings,
  entityRecords,
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

  // ── Payloads (slice 4) ────────────────────────────────────────────

  const rowAudit = (createdBy: string) => ({
    created: Date.now(),
    createdBy,
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  });

  /**
   * An entity the agent made (portal-1) beside one made by hand, each with a
   * text column mapped and its wide table reconciled.
   */
  async function seedEntities(callerId: string, orgId: string) {
    const defId = generateId();
    await db.insert(connectorDefinitions).values({
      id: defId,
      slug: `slug-${defId}`,
      display: "Test Connector",
      category: "crm",
      authType: "oauth2",
      configSchema: null,
      capabilityFlags: { sync: true, read: true, write: true },
      isActive: true,
      version: "1.0.0",
      iconUrl: null,
      ...rowAudit("SYSTEM_TEST"),
    } as never);
    const instId = generateId();
    await db.insert(connectorInstances).values({
      id: instId,
      connectorDefinitionId: defId,
      organizationId: orgId,
      name: "Test Instance",
      status: "active",
      config: null,
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: { read: true, write: true },
      ...rowAudit("SYSTEM_TEST"),
    } as never);
    const colId = generateId();
    await db.insert(columnDefinitions).values({
      id: colId,
      organizationId: orgId,
      key: `label_${generateId().replace(/-/g, "").slice(0, 8)}`,
      label: "Label",
      type: "string",
      description: null,
      validationPattern: null,
      validationMessage: null,
      canonicalFormat: null,
      ...rowAudit(callerId),
    } as never);
    const make = async (sourcePortalId: string | null) => {
      const entityId = generateId();
      await db.insert(connectorEntities).values({
        id: entityId,
        organizationId: orgId,
        connectorInstanceId: instId,
        key: `ent_${generateId().replace(/-/g, "").slice(0, 8)}`,
        label: "Entity",
        sourcePortalId,
        ...rowAudit(callerId),
      } as never);
      const mappingId = generateId();
      await db.insert(fieldMappings).values({
        id: mappingId,
        organizationId: orgId,
        connectorEntityId: entityId,
        columnDefinitionId: colId,
        sourceField: "label",
        isPrimaryKey: false,
        normalizedKey: "label",
        required: false,
        defaultValue: null,
        format: null,
        enumValues: null,
        sourcePortalId,
        ...rowAudit(callerId),
      } as never);
      await wideTableReconcilerService.reconcileEntity(
        entityId,
        db as unknown as DbClient
      );
      return { entityId, mappingId };
    };
    wideTableStatementCache.clear();
    return { agent: await make("portal-1"), manual: await make(null) };
  }

  describe("payloads carry the marker", () => {
    it("an entity's GET and list report its sourcePortalId", async () => {
      const { ctx } = await seedOwner();
      const { agent, manual } = await seedEntities(
        ctx.userId,
        ctx.organizationId
      );
      const got = await auth(
        request(app).get(`/api/connector-entities/${agent.entityId}`)
      );
      expect(got.status).toBe(200);
      expect(got.body.payload.connectorEntity.sourcePortalId).toBe("portal-1");

      const list = await auth(
        request(app).get("/api/connector-entities?limit=100")
      );
      const byId = new Map(
        (
          list.body.payload.connectorEntities as Array<{
            id: string;
            sourcePortalId: string | null;
          }>
        ).map((e) => [e.id, e.sourcePortalId])
      );
      expect(byId.get(agent.entityId)).toBe("portal-1");
      expect(byId.get(manual.entityId)).toBeNull();
    });

    it("a field mapping's GET reports its sourcePortalId", async () => {
      const { ctx } = await seedOwner();
      const { agent, manual } = await seedEntities(
        ctx.userId,
        ctx.organizationId
      );
      const a = await auth(
        request(app).get(`/api/field-mappings/${agent.mappingId}`)
      );
      const m = await auth(
        request(app).get(`/api/field-mappings/${manual.mappingId}`)
      );
      expect(a.status).toBe(200);
      expect(a.body.payload.fieldMapping.sourcePortalId).toBe("portal-1");
      expect(m.body.payload.fieldMapping.sourcePortalId).toBeNull();
    });

    it("a record created through REST reports no portal; one marked in the DB reports it", async () => {
      const { ctx } = await seedOwner();
      const { manual } = await seedEntities(ctx.userId, ctx.organizationId);
      const url = `/api/connector-entities/${manual.entityId}/records`;
      const created = await auth(request(app).post(url)).send({
        normalizedData: { label: "Acme" },
      });
      expect(created.status).toBe(201);
      const id = created.body.payload.record.id as string;

      const before = await auth(request(app).get(`${url}/${id}`));
      expect(before.body.payload.record.sourcePortalId).toBeNull();

      await db
        .update(entityRecords)
        .set({ sourcePortalId: "portal-1" })
        .where(eq(entityRecords.id, id));
      const after = await auth(request(app).get(`${url}/${id}`));
      expect(after.body.payload.record.sourcePortalId).toBe("portal-1");
      const list = await auth(request(app).get(url));
      expect(list.body.payload.records[0].sourcePortalId).toBe("portal-1");
    });

    it.each([
      ["/api/roles", "roles"],
      ["/api/policies", "policies"],
      ["/api/groups", "groups"],
    ] as Array<[string, "roles" | "policies" | "groups"]>)(
      "%s lists report the agent row's portal and null for a REST row",
      async (url, key) => {
        const { ctx } = await seedOwner();
        const agentRow =
          key === "roles"
            ? await RoleService.create(
                ctx,
                { name: "Agent", policyIds: [] },
                agentAudit("portal-1")
              )
            : key === "policies"
              ? await PolicyService.create(
                  ctx,
                  { name: "Agent", statements: [readStation] },
                  agentAudit("portal-1")
                )
              : await GroupService.create(
                  ctx,
                  { name: "Agent", policyIds: [] },
                  agentAudit("portal-1")
                );
        const body =
          key === "policies"
            ? { name: "UI", statements: [readStation] }
            : { name: "UI", policyIds: [] };
        const rest = await auth(request(app).post(url)).send(body);
        const restId = (Object.values(rest.body.payload)[0] as { id: string })
          .id;

        const list = await auth(request(app).get(url));
        expect(list.status).toBe(200);
        const byId = new Map(
          (
            list.body.payload[key] as Array<{
              id: string;
              sourcePortalId: string | null;
            }>
          ).map((r) => [r.id, r.sourcePortalId])
        );
        expect(byId.get(agentRow.id)).toBe("portal-1");
        expect(byId.get(restId)).toBeNull();
      }
    );
  });
});
