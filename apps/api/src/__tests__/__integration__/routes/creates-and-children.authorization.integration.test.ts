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
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema/index.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  generateId,
  seedTenancyFixture,
  teardownOrg,
  type TenancyFixture,
} from "../utils/application.util.js";

/**
 * #685 slice 6: rows that belong to a parent (group members, tag
 * assignments) are authorized through that parent, and every create route
 * checks read on what it's created under plus the create rule for its type:
 * - owned create (members may create their own) for portal, entity,
 *   entity_record, field_mapping and connector_instance;
 * - class create (owner/admin only) for tag, entity_group and
 *   column_definition.
 * Also: POST /api/connector-instances no longer writes to the org named in
 * the body, and the generic POST /api/jobs is gone.
 *
 * Fixture rows are created by the owner or the member, never SYSTEM_TEST
 * (the integration SYSTEM_ID, which members may read).
 */

const OWNER_SUB = "auth0|cc-owner";
const MEMBER_SUB = "auth0|cc-member";
const OTHER_SUB = "auth0|cc-other-owner";
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

const { app } = await import("../../../app.js");

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

describe("Child rows and creates authorization (#685)", () => {
  let connection: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;
  let fx: TenancyFixture;
  let definitionId: string;

  async function instance(orgId: string, createdBy: string) {
    const id = generateId();
    await db.insert(schema.connectorInstances).values({
      id,
      connectorDefinitionId: definitionId,
      organizationId: orgId,
      name: "Instance",
      status: "active",
      config: null,
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: { read: true, write: true },
      ...base(createdBy),
    } as never);
    return id;
  }

  async function entity(orgId: string, createdBy: string) {
    const instanceId = await instance(orgId, createdBy);
    const id = generateId();
    await db.insert(schema.connectorEntities).values({
      id,
      organizationId: orgId,
      connectorInstanceId: instanceId,
      key: `entity_${suffix()}`,
      label: "Entity",
      ...base(createdBy),
    } as never);
    return id;
  }

  async function mapping(orgId: string, entityId: string, createdBy: string) {
    const colId = generateId();
    await db.insert(schema.columnDefinitions).values({
      id: colId,
      organizationId: orgId,
      key: `col_${suffix()}`,
      label: "Col",
      type: "string",
      description: null,
      validationPattern: null,
      validationMessage: null,
      canonicalFormat: null,
      ...base(createdBy),
    } as never);
    const id = generateId();
    await db.insert(schema.fieldMappings).values({
      id,
      organizationId: orgId,
      connectorEntityId: entityId,
      columnDefinitionId: colId,
      sourceField: "email",
      isPrimaryKey: false,
      normalizedKey: `nk_${suffix()}`,
      required: false,
      defaultValue: null,
      format: null,
      enumValues: null,
      ...base(createdBy),
    } as never);
    return id;
  }

  async function group(orgId: string, createdBy: string) {
    const id = generateId();
    await db.insert(schema.entityGroups).values({
      id,
      organizationId: orgId,
      name: `group-${suffix()}`,
      description: null,
      ...base(createdBy),
    } as never);
    return id;
  }

  async function member(
    orgId: string,
    groupId: string,
    entityId: string,
    fieldMappingId: string
  ) {
    const id = generateId();
    await db.insert(schema.entityGroupMembers).values({
      id,
      organizationId: orgId,
      entityGroupId: groupId,
      connectorEntityId: entityId,
      linkFieldMappingId: fieldMappingId,
      isPrimary: false,
      ...base(fx.ownerId),
    } as never);
    return id;
  }

  async function tag(orgId: string, createdBy: string) {
    const id = generateId();
    await db.insert(schema.entityTags).values({
      id,
      organizationId: orgId,
      name: `tag-${suffix()}`,
      color: null,
      description: null,
      ...base(createdBy),
    } as never);
    return id;
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
    currentSub = OWNER_SUB;
  });

  afterEach(async () => {
    await connection.end();
  });

  // ── Group members: authorized through the group ─────────────────────

  it("a member gets 404 adding, changing or removing members of the owner's group; nothing is written", async () => {
    const groupId = await group(fx.orgId, fx.ownerId);
    const entityId = await entity(fx.orgId, fx.ownerId);
    const fmId = await mapping(fx.orgId, entityId, fx.ownerId);
    const existing = await member(fx.orgId, groupId, entityId, fmId);
    const otherEntity = await entity(fx.orgId, fx.ownerId);
    const otherFm = await mapping(fx.orgId, otherEntity, fx.ownerId);
    currentSub = MEMBER_SUB;

    const add = await request(app)
      .post(`/api/entity-groups/${groupId}/members`)
      .send({ connectorEntityId: otherEntity, linkFieldMappingId: otherFm });
    const change = await request(app)
      .patch(`/api/entity-groups/${groupId}/members/${existing}`)
      .send({ isPrimary: true });
    const remove = await request(app).delete(
      `/api/entity-groups/${groupId}/members/${existing}`
    );
    for (const res of [add, change, remove]) {
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.ENTITY_GROUP_NOT_FOUND);
    }
    const rows = await db
      .select()
      .from(schema.entityGroupMembers)
      .where(eq(schema.entityGroupMembers.entityGroupId, groupId));
    expect(rows).toHaveLength(1);
    expect(rows[0].deleted).toBeNull();
    expect(rows[0].isPrimary).toBe(false);
  });

  it("adding a member to another org's group is a 404", async () => {
    const theirGroup = await group(fx.otherOrgId, fx.otherOwnerId);
    const entityId = await entity(fx.orgId, fx.ownerId);
    const fmId = await mapping(fx.orgId, entityId, fx.ownerId);
    const res = await request(app)
      .post(`/api/entity-groups/${theirGroup}/members`)
      .send({ connectorEntityId: entityId, linkFieldMappingId: fmId });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ApiCode.ENTITY_GROUP_NOT_FOUND);
  });

  it("the owner adds a member to their group", async () => {
    const groupId = await group(fx.orgId, fx.ownerId);
    const entityId = await entity(fx.orgId, fx.ownerId);
    const fmId = await mapping(fx.orgId, entityId, fx.ownerId);
    const res = await request(app)
      .post(`/api/entity-groups/${groupId}/members`)
      .send({ connectorEntityId: entityId, linkFieldMappingId: fmId });
    expect(res.status).toBe(201);
  });

  // ── Tag assignments: authorized through the entity, and the tag ─────

  it("a member can't tag an entity they can't read (404), nor use a tag they can't read (404)", async () => {
    const ownersEntity = await entity(fx.orgId, fx.ownerId);
    const ownEntity = await entity(fx.orgId, fx.memberId);
    const tagId = await tag(fx.orgId, fx.ownerId);
    currentSub = MEMBER_SUB;

    const onTheirs = await request(app)
      .post(`/api/connector-entities/${ownersEntity}/tags`)
      .send({ entityTagId: tagId });
    expect(onTheirs.status).toBe(404);
    expect(onTheirs.body.code).toBe(ApiCode.CONNECTOR_ENTITY_NOT_FOUND);

    const theirTag = await request(app)
      .post(`/api/connector-entities/${ownEntity}/tags`)
      .send({ entityTagId: tagId });
    expect(theirTag.status).toBe(404);
    expect(theirTag.body.code).toBe(ApiCode.ENTITY_TAG_NOT_FOUND);

    const rows = await db.select().from(schema.entityTagAssignments);
    expect(rows).toHaveLength(0);
  });

  it("a member can't remove a tag from an entity they can't read (404)", async () => {
    const ownersEntity = await entity(fx.orgId, fx.ownerId);
    const tagId = await tag(fx.orgId, fx.ownerId);
    const assignmentId = generateId();
    await db.insert(schema.entityTagAssignments).values({
      id: assignmentId,
      organizationId: fx.orgId,
      connectorEntityId: ownersEntity,
      entityTagId: tagId,
      ...base(fx.ownerId),
    } as never);
    currentSub = MEMBER_SUB;
    const res = await request(app).delete(
      `/api/connector-entities/${ownersEntity}/tags/${assignmentId}`
    );
    expect(res.status).toBe(404);
    const [row] = await db
      .select()
      .from(schema.entityTagAssignments)
      .where(eq(schema.entityTagAssignments.id, assignmentId));
    expect(row.deleted).toBeNull();
  });

  it("the owner tags an entity", async () => {
    const entityId = await entity(fx.orgId, fx.ownerId);
    const tagId = await tag(fx.orgId, fx.ownerId);
    const res = await request(app)
      .post(`/api/connector-entities/${entityId}/tags`)
      .send({ entityTagId: tagId });
    expect(res.status).toBe(201);
  });

  // ── Class creates: owner/admin only ─────────────────────────────────

  it("a member can't create a column definition, entity group or tag (403); the owner can (201)", async () => {
    const bodies = [
      [
        "/api/column-definitions",
        () => ({ key: `k_${suffix()}`, label: "K", type: "string" }),
      ],
      ["/api/entity-groups", () => ({ name: `g-${suffix()}` })],
      ["/api/entity-tags", () => ({ name: `t-${suffix()}` })],
    ] as const;
    currentSub = MEMBER_SUB;
    for (const [url, body] of bodies) {
      const res = await request(app).post(url).send(body());
      expect({ url, status: res.status, code: res.body.code }).toEqual({
        url,
        status: 403,
        code: ApiCode.PERMISSION_DENIED,
      });
    }
    currentSub = OWNER_SUB;
    for (const [url, body] of bodies) {
      const res = await request(app).post(url).send(body());
      expect({ url, status: res.status }).toEqual({ url, status: 201 });
    }
  });

  // ── Connector instances: the caller's org, never the body's ─────────

  it("a connector instance can't be created in another org named in the body (403); nothing is written there", async () => {
    currentSub = MEMBER_SUB;
    const res = await request(app).post("/api/connector-instances").send({
      connectorDefinitionId: definitionId,
      organizationId: fx.otherOrgId,
      name: "Planted",
      status: "active",
    });
    expect(res.status).toBe(403);
    const planted = await db
      .select()
      .from(schema.connectorInstances)
      .where(eq(schema.connectorInstances.organizationId, fx.otherOrgId));
    expect(planted).toHaveLength(0);
  });

  it("a member creates a connector instance in their own org (owned create)", async () => {
    currentSub = MEMBER_SUB;
    const res = await request(app).post("/api/connector-instances").send({
      connectorDefinitionId: definitionId,
      organizationId: fx.orgId,
      name: "Mine",
      status: "active",
    });
    expect(res.status).toBe(201);
    expect(res.body.payload.connectorInstance.organizationId).toBe(fx.orgId);
  });

  // ── Connector entities and records: under a readable parent ─────────

  it("a connector entity can't be created under another org's instance, or one the caller can't read (404)", async () => {
    const theirInstance = await instance(fx.otherOrgId, fx.otherOwnerId);
    const crossOrg = await request(app)
      .post("/api/connector-entities")
      .send({
        connectorInstanceId: theirInstance,
        key: `e_${suffix()}`,
        label: "E",
      });
    expect(crossOrg.status).toBe(404);
    expect(crossOrg.body.code).toBe(ApiCode.CONNECTOR_INSTANCE_NOT_FOUND);

    const ownersInstance = await instance(fx.orgId, fx.ownerId);
    currentSub = MEMBER_SUB;
    const unreadable = await request(app)
      .post("/api/connector-entities")
      .send({
        connectorInstanceId: ownersInstance,
        key: `e_${suffix()}`,
        label: "E",
      });
    expect(unreadable.status).toBe(404);
    expect(unreadable.body.code).toBe(ApiCode.CONNECTOR_INSTANCE_NOT_FOUND);

    const ownInstance = await instance(fx.orgId, fx.memberId);
    const ok = await request(app)
      .post("/api/connector-entities")
      .send({
        connectorInstanceId: ownInstance,
        key: `e_${suffix()}`,
        label: "E",
      });
    expect(ok.status).toBe(201);
  });

  it("a member can't create a record in an entity they can't read (404)", async () => {
    const ownersEntity = await entity(fx.orgId, fx.ownerId);
    currentSub = MEMBER_SUB;
    const res = await request(app)
      .post(`/api/connector-entities/${ownersEntity}/records`)
      .send({ normalizedData: { email: "x@y.co" } });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ApiCode.CONNECTOR_ENTITY_NOT_FOUND);
  });

  // ── The generic job create is gone ──────────────────────────────────

  it("POST /api/jobs no longer exists", async () => {
    const res = await request(app)
      .post("/api/jobs")
      .send({ type: "system_check", organizationId: fx.otherOrgId });
    expect(res.status).toBe(404);
    const jobs = await db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.organizationId, fx.otherOrgId));
    expect(jobs).toHaveLength(0);
  });

  // ── Slice 6b: cross-tenant gaps the route inventory found ───────────

  it("an owner can't change or delete another org's connector entity by id (404); it's unchanged", async () => {
    const theirs = await entity(fx.otherOrgId, fx.otherOwnerId);
    const patch = await request(app)
      .patch(`/api/connector-entities/${theirs}`)
      .send({ label: "Hijacked" });
    expect(patch.status).toBe(404);
    expect(patch.body.code).toBe(ApiCode.CONNECTOR_ENTITY_NOT_FOUND);
    const del = await request(app).delete(`/api/connector-entities/${theirs}`);
    expect(del.status).toBe(404);
    const [row] = await db
      .select()
      .from(schema.connectorEntities)
      .where(eq(schema.connectorEntities.id, theirs));
    expect(row.label).toBe("Entity");
    expect(row.deleted).toBeNull();
  });

  it("the cross-org /api/admin routes no longer exist", async () => {
    for (const send of [
      () => request(app).post("/api/admin/wide-table/resync"),
      () => request(app).post("/api/admin/dissolve/reenqueue"),
      () => request(app).get("/api/admin/maintenance"),
    ]) {
      expect((await send()).status).toBe(404);
    }
  });
});
