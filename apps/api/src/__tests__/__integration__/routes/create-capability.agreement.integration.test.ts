import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import request from "supertest";
import { Request, Response, NextFunction } from "express";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  GroupModelFactory,
  PermissionGrantModelFactory,
  PermissionStatementModelFactory,
  PolicyAttachmentModelFactory,
  PolicyModelFactory,
  RoleModelFactory,
  UserGroupModelFactory,
  UserRoleModelFactory,
  type PermissionResourceType,
  type PermissionVerb,
} from "@portalai/core/models";

import * as schema from "../../../db/schema/index.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  createOrganizationUser,
  createUser,
  generateId,
  seedTenancyFixture,
  teardownOrg,
  type TenancyFixture,
} from "../utils/application.util.js";

/**
 * #708: `resourcePermissions[type].create` agrees with that type's real create
 * route. For each caller and type, read `create` from
 * `GET /api/organization/current`, then send a minimal valid create:
 * `create === true` ⇔ the route creates (2xx), and `create === false` ⇔ it
 * refuses with 403 `INSUFFICIENT_ROLE`. A disagreement means a `CREATE_RULES`
 * row has drifted from its route.
 *
 * Callers:
 * - the owner;
 * - a seeded member (whose any-grant `write curated_view` is the Create View
 *   bug);
 * - a member whose group grants `write <type> created_by_caller` on the
 *   owner/admin-only types (an owned-only grant never satisfies a class create);
 * - a user with a bare custom role (no policies) and instance-only grants
 *   (`write <type>:<id>`), which never satisfy an owned create (no id).
 *
 * Parent rows are created by the caller under test, so a parent's read check
 * (a 404) can't hide the create check.
 */

const OWNER_SUB = "auth0|cap-create-owner";
const MEMBER_SUB = "auth0|cap-create-member";
const OTHER_SUB = "auth0|cap-create-other";
const OWNED_ONLY_SUB = "auth0|cap-create-owned-only";
const INSTANCE_SUB = "auth0|cap-create-instance";
let currentSub = OWNER_SUB;

jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { payload: { sub: currentSub } } as never;
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
// Portal creation loads the station's data; none is needed here.
jest.unstable_mockModule("../../../services/analytics.service.js", () => ({
  AnalyticsService: {
    loadStation: jest.fn<() => Promise<unknown>>().mockResolvedValue({
      entities: [],
      entityGroups: [],
      records: new Map(),
    }),
  },
}));

// Toolpack registration fetches the webhook's schema endpoint.
const mockFetch =
  jest.fn<
    (url: string, options?: Record<string, unknown>) => Promise<unknown>
  >();
(globalThis as { fetch: unknown }).fetch = mockFetch;
const SCHEMA_RESPONSE = JSON.stringify({
  tools: [
    {
      name: "lookup_company",
      description: "Look up a company by domain.",
      parameterSchema: {
        type: "object",
        properties: { domain: { type: "string" } },
      },
    },
  ],
});

const { app } = await import("../../../app.js");
const { wideTableReconcilerService } =
  await import("../../../services/wide-table-reconciler.service.js");

type Db = ReturnType<typeof drizzle>;
type CreatableType =
  | "station"
  | "pin"
  | "curated_view"
  | "portal"
  | "entity"
  | "entity_record"
  | "field_mapping"
  | "connector_instance"
  | "entity_group"
  | "tag"
  | "column_definition"
  | "toolpack";

const CLASS_TYPES: CreatableType[] = [
  "curated_view",
  "entity_group",
  "tag",
  "column_definition",
  "toolpack",
];
const OWNED_TYPES: CreatableType[] = [
  "station",
  "pin",
  "portal",
  "entity",
  "entity_record",
  "field_mapping",
  "connector_instance",
];

const now = Date.now();
const base = (createdBy: string) => ({
  created: now,
  createdBy,
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
});
const suffix = () => generateId().replace(/-/g, "").slice(0, 8);

describe("create capability agrees with the create routes (#708)", () => {
  let connection: ReturnType<typeof postgres>;
  let db: Db;
  let fx: TenancyFixture;
  let definitionId: string;
  let ownedOnlyId: string;
  let instanceUserId: string;
  /** Entities whose `er__<id>` wide tables need dropping afterwards. */
  const wideTables: string[] = [];

  const userIdFor: Record<string, () => string> = {
    [OWNER_SUB]: () => fx.ownerId,
    [MEMBER_SUB]: () => fx.memberId,
    [OWNED_ONLY_SUB]: () => ownedOnlyId,
    [INSTANCE_SUB]: () => instanceUserId,
  };

  // ── Parent rows (created by the caller under test) ──────────────────

  async function station(createdBy: string) {
    const id = generateId();
    await db.insert(schema.stations).values({
      id,
      organizationId: fx.orgId,
      name: `Station ${suffix()}`,
      description: null,
      ...base(createdBy),
    } as never);
    // A portal needs a station with at least one tool.
    await db.insert(schema.stationToolpacks).values({
      id: generateId(),
      stationId: id,
      builtinSlug: "data_query",
      organizationToolpackId: null,
      ...base(createdBy),
    } as never);
    return id;
  }

  async function portalWithMessage(createdBy: string) {
    const stationId = await station(createdBy);
    const id = generateId();
    await db.insert(schema.portals).values({
      id,
      organizationId: fx.orgId,
      stationId,
      name: "Portal",
      lastOpened: null,
      ...base(createdBy),
    } as never);
    await db.insert(schema.portalMessages).values({
      id: generateId(),
      organizationId: fx.orgId,
      portalId: id,
      role: "assistant",
      blocks: [{ type: "text", content: "Analysis complete." }],
      ...base(createdBy),
    } as never);
    return id;
  }

  async function instance(createdBy: string) {
    const id = generateId();
    await db.insert(schema.connectorInstances).values({
      id,
      connectorDefinitionId: definitionId,
      organizationId: fx.orgId,
      name: "Instance",
      status: "active",
      config: null,
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      // Record and field-mapping creates require the connector's write flag.
      enabledCapabilityFlags: { read: true, write: true },
      ...base(createdBy),
    } as never);
    return id;
  }

  /** An entity with its wide table and no field mappings (a curated view
   *  checks that each mapping is readable). */
  async function entity(createdBy: string) {
    const id = generateId();
    await db.insert(schema.connectorEntities).values({
      id,
      organizationId: fx.orgId,
      connectorInstanceId: await instance(createdBy),
      key: `entity_${suffix()}`,
      label: "Entity",
      ...base(createdBy),
    } as never);
    await wideTableReconcilerService.reconcileEntity(id, db as never);
    wideTables.push(id);
    return id;
  }

  async function columnDefinition(createdBy: string) {
    const id = generateId();
    await db.insert(schema.columnDefinitions).values({
      id,
      organizationId: fx.orgId,
      key: `col_${suffix()}`,
      label: "Col",
      type: "string",
      description: null,
      validationPattern: null,
      validationMessage: null,
      canonicalFormat: null,
      ...base(createdBy),
    } as never);
    return id;
  }

  // ── One minimal valid create per type ───────────────────────────────

  const attempt: Record<
    CreatableType,
    (createdBy: string) => Promise<request.Response>
  > = {
    station: () =>
      request(app)
        .post("/api/stations")
        .send({ name: `Station ${suffix()}` }),
    pin: async (createdBy) =>
      request(app)
        .post("/api/portal-results")
        .send({
          portalId: await portalWithMessage(createdBy),
          blockIndex: 0,
          name: "Pinned",
        }),
    curated_view: async (createdBy) =>
      request(app)
        .post("/api/curated-views")
        .send({
          connectorEntityId: await entity(createdBy),
          key: `v_${suffix()}`,
          label: "View",
        }),
    portal: async (createdBy) =>
      request(app)
        .post("/api/portals")
        .send({ stationId: await station(createdBy) }),
    entity: async (createdBy) => {
      const res = await request(app)
        .post("/api/connector-entities")
        .send({
          connectorInstanceId: await instance(createdBy),
          key: `e_${suffix()}`,
          label: "Entity",
        });
      const createdId = res.body?.payload?.connectorEntity?.id;
      if (createdId) wideTables.push(createdId);
      return res;
    },
    entity_record: async (createdBy) =>
      request(app)
        .post(`/api/connector-entities/${await entity(createdBy)}/records`)
        .send({ normalizedData: { name: "Alice" } }),
    field_mapping: async (createdBy) =>
      request(app)
        .post("/api/field-mappings")
        .send({
          connectorEntityId: await entity(createdBy),
          columnDefinitionId: await columnDefinition(createdBy),
          sourceField: "account_name",
          normalizedKey: `account_${suffix()}`,
        }),
    connector_instance: () =>
      request(app).post("/api/connector-instances").send({
        connectorDefinitionId: definitionId,
        // Must be the caller's current org, or the route refuses first.
        organizationId: fx.orgId,
        name: "Mine",
        status: "active",
      }),
    entity_group: () =>
      request(app)
        .post("/api/entity-groups")
        .send({ name: `g-${suffix()}` }),
    tag: () =>
      request(app)
        .post("/api/entity-tags")
        .send({ name: `t-${suffix()}` }),
    column_definition: () =>
      request(app)
        .post("/api/column-definitions")
        .send({ key: `k_${suffix()}`, label: "K", type: "string" }),
    toolpack: () =>
      request(app)
        .post("/api/toolpacks")
        .send({
          name: `pack_${suffix()}`,
          endpoints: {
            schema: "https://example.com/schema",
            runtime: "https://example.com/runtime",
          },
        }),
  };

  /** Read `create` as `sub`, then try the create as `sub`. */
  async function check(sub: string, type: CreatableType) {
    currentSub = sub;
    const current = await request(app).get("/api/organization/current");
    expect(current.status).toBe(200);
    const create: boolean =
      current.body.payload.resourcePermissions[type].create;
    const res = await attempt[type](userIdFor[sub]());
    return { create, res };
  }

  function expectAgreement(
    type: CreatableType,
    create: boolean,
    res: request.Response,
    expected: boolean
  ) {
    expect([type, "create", create]).toEqual([type, "create", expected]);
    if (expected) {
      // The route created it. Show the body on failure.
      expect([type, res.status, res.body?.code]).toEqual([
        type,
        expect.any(Number),
        undefined,
      ]);
      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(300);
    } else {
      // Refused by the permission check itself, not by another 403.
      expect([type, res.status, res.body?.code]).toEqual([
        type,
        403,
        ApiCode.INSUFFICIENT_ROLE,
      ]);
    }
  }

  // ── Custom callers ──────────────────────────────────────────────────

  /** A group policy with `statements`, its member `userId`. */
  async function groupPolicy(
    userId: string,
    statements: Array<{
      verb: PermissionVerb;
      resourceType: PermissionResourceType;
      condition: "created_by_caller" | null;
    }>
  ) {
    const group = new GroupModelFactory()
      .create("system")
      .update({
        organizationId: fx.orgId,
        name: `G ${suffix()}`,
        description: null,
      })
      .parse();
    const policy = new PolicyModelFactory()
      .create("system")
      .update({
        organizationId: fx.orgId,
        name: `P ${suffix()}`,
        kind: "custom",
        description: null,
      })
      .parse();
    await db.insert(schema.groups).values(group as never);
    await db.insert(schema.permissionPolicies).values(policy as never);
    for (const st of statements) {
      await db.insert(schema.permissionStatements).values(
        new PermissionStatementModelFactory()
          .create("system")
          .update({
            organizationId: fx.orgId,
            policyId: policy.id,
            effect: "allow",
            verb: st.verb,
            resourceType: st.resourceType,
            resourceId: null,
            condition: st.condition,
          })
          .parse() as never
      );
    }
    await db.insert(schema.policyAttachments).values(
      new PolicyAttachmentModelFactory()
        .create("system")
        .update({
          organizationId: fx.orgId,
          policyId: policy.id,
          principalType: "group",
          principalId: group.id,
        })
        .parse() as never
    );
    await db
      .insert(schema.userGroup)
      .values(
        new UserGroupModelFactory()
          .create("system")
          .update({ organizationId: fx.orgId, userId, groupId: group.id })
          .parse() as never
      );
  }

  /** A user in the org whose only role is a custom one with no policies. */
  async function bareUser(sub: string) {
    const user = createUser(sub);
    await db.insert(schema.users).values(user as never);
    await db
      .insert(schema.organizationUsers)
      .values(
        createOrganizationUser(fx.orgId, user.id, { role: "member" }) as never
      );
    const role = new RoleModelFactory()
      .create("system")
      .update({
        organizationId: fx.orgId,
        name: `Bare ${suffix()}`,
        slug: `bare-${suffix()}`,
        kind: "custom",
      })
      .parse();
    await db.insert(schema.roles).values(role as never);
    // A user-role assignment wins over `organization_users.role`.
    await db.insert(schema.userRole).values(
      new UserRoleModelFactory()
        .create("system")
        .update({
          userId: user.id,
          organizationId: fx.orgId,
          roleId: role.id,
        })
        .parse() as never
    );
    return user.id;
  }

  async function instanceGrant(
    userId: string,
    resourceType: PermissionResourceType,
    resourceId: string
  ) {
    await db.insert(schema.permissionGrants).values(
      new PermissionGrantModelFactory()
        .create("system")
        .update({
          organizationId: fx.orgId,
          principalType: "user",
          principalId: userId,
          effect: "allow",
          verb: "write",
          resourceType,
          resourceId,
          condition: null,
        })
        .parse() as never
    );
  }

  beforeEach(async () => {
    connection = postgres(process.env.DATABASE_URL as string, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);
    fx = await seedTenancyFixture(db, {
      owner: OWNER_SUB,
      member: MEMBER_SUB,
      otherOwner: OTHER_SUB,
    });
    definitionId = generateId();
    await db.insert(schema.connectorDefinitions).values({
      id: definitionId,
      slug: `slug-${suffix()}`,
      display: "Test Connector",
      category: "crm",
      authType: "oauth2",
      configSchema: null,
      capabilityFlags: { sync: true, read: true, write: true },
      isActive: true,
      version: "1.0.0",
      iconUrl: null,
      ...base("SYSTEM_TEST"),
    } as never);

    // A member who also holds owned-only writes on the owner/admin-only types.
    const ownedOnly = createUser(OWNED_ONLY_SUB);
    await db.insert(schema.users).values(ownedOnly as never);
    await db.insert(schema.organizationUsers).values(
      createOrganizationUser(fx.orgId, ownedOnly.id, {
        role: "member",
      }) as never
    );
    ownedOnlyId = ownedOnly.id;
    await groupPolicy(
      ownedOnlyId,
      (["tag", "column_definition", "entity_group", "toolpack"] as const).map(
        (resourceType) => ({
          verb: "write" as const,
          resourceType,
          condition: "created_by_caller" as const,
        })
      )
    );

    // A bare user holding only instance grants.
    instanceUserId = await bareUser(INSTANCE_SUB);
    await instanceGrant(instanceUserId, "connector_instance", generateId());
    await instanceGrant(instanceUserId, "station", generateId());
    await instanceGrant(instanceUserId, "pin", generateId());

    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map([["content-length", String(SCHEMA_RESPONSE.length)]]),
      text: async () => SCHEMA_RESPONSE,
    });
    currentSub = OWNER_SUB;
  });

  afterEach(async () => {
    for (const id of wideTables.splice(0)) {
      try {
        await wideTableReconcilerService.dropTable(id, db as never);
      } catch {
        /* already gone */
      }
    }
    await connection.end();
  });

  // ── The matrix ──────────────────────────────────────────────────────

  // Spec case 10.
  it.each([...OWNED_TYPES, ...CLASS_TYPES])(
    "owner: %s is creatable, and the route creates it",
    async (type) => {
      const { create, res } = await check(OWNER_SUB, type);
      expectAgreement(type, create, res, true);
    }
  );

  // Spec case 11.
  it.each(OWNED_TYPES)(
    "seeded member: %s is creatable (an owned create), and the route creates it",
    async (type) => {
      const { create, res } = await check(MEMBER_SUB, type);
      expectAgreement(type, create, res, true);
    }
  );
  it.each(CLASS_TYPES)(
    "seeded member: %s isn't creatable (owner/admin only), and the route refuses",
    async (type) => {
      const { create, res } = await check(MEMBER_SUB, type);
      expectAgreement(type, create, res, false);
    }
  );

  // Spec case 12.
  it.each(["tag", "column_definition", "entity_group", "toolpack"] as const)(
    "owned-only grant: %s isn't creatable, though its any-grant write is true",
    async (type) => {
      currentSub = OWNED_ONLY_SUB;
      const current = await request(app).get("/api/organization/current");
      expect(current.body.payload.resourcePermissions[type].write).toBe(true);
      const { create, res } = await check(OWNED_ONLY_SUB, type);
      expectAgreement(type, create, res, false);
    }
  );

  // Spec case 13.
  it.each(["connector_instance", "station", "pin"] as const)(
    "instance-only grant: %s isn't creatable, though its any-grant write is true",
    async (type) => {
      currentSub = INSTANCE_SUB;
      const current = await request(app).get("/api/organization/current");
      expect(current.body.payload.resourcePermissions[type].write).toBe(true);
      // The pin route checks the create before it loads the portal, so the
      // portal's readability can't mask the result.
      const { create, res } = await check(INSTANCE_SUB, type);
      expectAgreement(type, create, res, false);
    }
  );

  // Spec case 14: the bug that motivated #708.
  it("a seeded member's curated-view create is false, and the route returns 403", async () => {
    currentSub = MEMBER_SUB;
    const current = await request(app).get("/api/organization/current");
    const caps = current.body.payload.resourcePermissions.curated_view;
    expect(caps.write).toBe(true); // what Create View used to read
    expect(caps.create).toBe(false);
    const res = await attempt.curated_view(fx.memberId);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ApiCode.INSUFFICIENT_ROLE);
  });
});
