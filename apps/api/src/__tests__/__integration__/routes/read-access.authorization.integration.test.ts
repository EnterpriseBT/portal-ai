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

import * as schema from "../../../db/schema/index.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  generateId,
  seedTenancyFixture,
  teardownOrg,
  type TenancyFixture,
} from "../utils/application.util.js";

/**
 * #692: read routes that skipped the org check, the caller's read permission,
 * or both. #685 inventoried mutation and SSE routes; reads were never
 * inventoried, so a by-id GET could return another org's row (the permission
 * engine doesn't see orgs, so an owner/admin of any org passes a bare `can`).
 *
 * Unreadable == absent: every refusal is a 404 that reveals nothing. Fixture
 * rows are owner-created (never SYSTEM_TEST, which members may read).
 */

const OWNER_SUB = "auth0|ra-owner";
const MEMBER_SUB = "auth0|ra-member";
const OTHER_SUB = "auth0|ra-other-owner";
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

describe("Read access (#692)", () => {
  let connection: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;
  let fx: TenancyFixture;

  const as = (sub: string) => {
    currentSub = sub;
  };
  const get = (path: string) => request(app).get(path);

  /** A connector instance + entity + column definition + field mapping in an
   *  org, all created by `createdBy`. */
  async function entityChain(
    organizationId: string,
    createdBy: string,
    opts: { refEntityKey?: string } = {}
  ) {
    const definitionId = generateId();
    await db.insert(schema.connectorDefinitions).values({
      id: definitionId,
      slug: `ra-${suffix()}`,
      display: "RA",
      category: "test",
      authType: "none",
      configSchema: null,
      capabilityFlags: { sync: true, read: true, write: true },
      isActive: true,
      version: "1.0.0",
      iconUrl: null,
      ...base("SYSTEM_TEST"),
    } as never);
    const instanceId = generateId();
    await db.insert(schema.connectorInstances).values({
      id: instanceId,
      connectorDefinitionId: definitionId,
      organizationId,
      name: "Instance",
      status: "active",
      config: {},
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: { read: true, write: true },
      ...base(createdBy),
    } as never);
    const entityId = generateId();
    const entityKey = `ent_${suffix()}`;
    await db.insert(schema.connectorEntities).values({
      id: entityId,
      organizationId,
      connectorInstanceId: instanceId,
      key: entityKey,
      label: "Owner secret entity",
      ...base(createdBy),
    } as never);
    const columnDefinitionId = generateId();
    await db.insert(schema.columnDefinitions).values({
      id: columnDefinitionId,
      organizationId,
      key: `col_${suffix()}`,
      label: "Col",
      type: "string",
      description: null,
      validationPattern: null,
      validationMessage: null,
      canonicalFormat: null,
      ...base(createdBy),
    } as never);
    const fieldMappingId = generateId();
    await db.insert(schema.fieldMappings).values({
      id: fieldMappingId,
      organizationId,
      connectorEntityId: entityId,
      columnDefinitionId,
      sourceField: "secret_source_field",
      isPrimaryKey: false,
      normalizedKey: `nk_${suffix()}`,
      required: false,
      defaultValue: null,
      format: null,
      enumValues: null,
      refEntityKey: opts.refEntityKey ?? null,
      ...base(createdBy),
    } as never);
    // Reconcile the wide table so record reads find `er__<id>`.
    const { wideTableReconcilerService } =
      await import("../../../services/wide-table-reconciler.service.js");
    await wideTableReconcilerService.ensureTable(entityId, db as never);
    return {
      instanceId,
      entityId,
      entityKey,
      columnDefinitionId,
      fieldMappingId,
    };
  }

  async function tagOn(
    organizationId: string,
    connectorEntityId: string,
    createdBy: string
  ) {
    const tagId = generateId();
    await db.insert(schema.entityTags).values({
      id: tagId,
      organizationId,
      name: `secret-tag-${suffix()}`,
      color: null,
      description: null,
      ...base(createdBy),
    } as never);
    await db.insert(schema.entityTagAssignments).values({
      id: generateId(),
      organizationId,
      connectorEntityId,
      entityTagId: tagId,
      ...base(createdBy),
    } as never);
    return tagId;
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
    as(OWNER_SUB);
  });

  afterEach(async () => {
    await connection.end();
  });

  // ── Connector entities ──────────────────────────────────────────────

  it("connector entity GET, impact and tags: another org's owner gets 404 and nothing leaks", async () => {
    const chain = await entityChain(fx.orgId, fx.ownerId);
    await tagOn(fx.orgId, chain.entityId, fx.ownerId);
    as(OTHER_SUB);
    for (const path of [
      `/api/connector-entities/${chain.entityId}`,
      `/api/connector-entities/${chain.entityId}/impact`,
      `/api/connector-entities/${chain.entityId}/tags`,
    ]) {
      const res = await get(path);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_ENTITY_NOT_FOUND);
      expect(JSON.stringify(res.body)).not.toMatch(/secret/);
    }
  });

  it("connector entity tags: a member gets 404 on an entity they can't read", async () => {
    const chain = await entityChain(fx.orgId, fx.ownerId);
    await tagOn(fx.orgId, chain.entityId, fx.ownerId);
    as(MEMBER_SUB);
    const res = await get(`/api/connector-entities/${chain.entityId}/tags`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ApiCode.CONNECTOR_ENTITY_NOT_FOUND);
  });

  it("connector entity GET, impact and tags still serve the owner", async () => {
    const chain = await entityChain(fx.orgId, fx.ownerId);
    const tagId = await tagOn(fx.orgId, chain.entityId, fx.ownerId);
    expect(
      (await get(`/api/connector-entities/${chain.entityId}`)).status
    ).toBe(200);
    expect(
      (await get(`/api/connector-entities/${chain.entityId}/impact`)).status
    ).toBe(200);
    const tags = await get(`/api/connector-entities/${chain.entityId}/tags`);
    expect(tags.status).toBe(200);
    expect(tags.body.payload.tags.map((t: { id: string }) => t.id)).toContain(
      tagId
    );
  });

  it("connector entity impact counts referencing mappings in the caller's org only", async () => {
    const chain = await entityChain(fx.orgId, fx.ownerId);
    // Another org has a mapping whose refEntityKey happens to match.
    await entityChain(fx.otherOrgId, fx.otherOwnerId, {
      refEntityKey: chain.entityKey,
    });
    const res = await get(`/api/connector-entities/${chain.entityId}/impact`);
    expect(res.status).toBe(200);
    expect(res.body.payload.refFieldMappings).toBe(0);
  });

  // ── Entity-group members ────────────────────────────────────────────

  /** An owner-created group with one member (the chain's entity). */
  async function groupWithMember(organizationId: string, createdBy: string) {
    const chain = await entityChain(organizationId, createdBy);
    const groupId = generateId();
    await db.insert(schema.entityGroups).values({
      id: groupId,
      organizationId,
      name: `secret-group-${suffix()}`,
      description: null,
      ...base(createdBy),
    } as never);
    await db.insert(schema.entityGroupMembers).values({
      id: generateId(),
      organizationId,
      entityGroupId: groupId,
      connectorEntityId: chain.entityId,
      linkFieldMappingId: chain.fieldMappingId,
      isPrimary: false,
      ...base(createdBy),
    } as never);
    return { ...chain, groupId };
  }

  const overlapPath = (
    groupId: string,
    targetEntityId: string,
    targetMappingId: string
  ) =>
    `/api/entity-groups/${groupId}/members/overlap?targetConnectorEntityId=${targetEntityId}&targetLinkFieldMappingId=${targetMappingId}`;

  it("group members and overlap: another org's owner gets 404 and nothing leaks", async () => {
    const g = await groupWithMember(fx.orgId, fx.ownerId);
    as(OTHER_SUB);
    for (const path of [
      `/api/entity-groups/${g.groupId}/members`,
      overlapPath(g.groupId, g.entityId, g.fieldMappingId),
    ]) {
      const res = await get(path);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.ENTITY_GROUP_NOT_FOUND);
      expect(JSON.stringify(res.body)).not.toMatch(/secret/i);
    }
  });

  it("group members and overlap: a member who can't read the group gets 404", async () => {
    const g = await groupWithMember(fx.orgId, fx.ownerId);
    as(MEMBER_SUB);
    for (const path of [
      `/api/entity-groups/${g.groupId}/members`,
      overlapPath(g.groupId, g.entityId, g.fieldMappingId),
    ]) {
      const res = await get(path);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.ENTITY_GROUP_NOT_FOUND);
    }
  });

  it("overlap: a target entity in another org is 404, and a target mapping not on the target entity is refused", async () => {
    const g = await groupWithMember(fx.orgId, fx.ownerId);
    const theirs = await entityChain(fx.otherOrgId, fx.otherOwnerId);
    const crossOrg = await get(
      overlapPath(g.groupId, theirs.entityId, theirs.fieldMappingId)
    );
    expect(crossOrg.status).toBe(404);
    expect(crossOrg.body.code).toBe(ApiCode.CONNECTOR_ENTITY_NOT_FOUND);

    // Our own target entity, but another org's mapping.
    const ours = await entityChain(fx.orgId, fx.ownerId);
    const foreignMapping = await get(
      overlapPath(g.groupId, ours.entityId, theirs.fieldMappingId)
    );
    expect(foreignMapping.status).toBe(400);
    expect(foreignMapping.body.code).toBe(
      ApiCode.ENTITY_GROUP_MEMBER_LINK_FIELD_INVALID
    );

    // Both ours, but the mapping belongs to a different entity.
    const mismatched = await get(
      overlapPath(g.groupId, ours.entityId, g.fieldMappingId)
    );
    expect(mismatched.status).toBe(400);
    expect(mismatched.body.code).toBe(
      ApiCode.ENTITY_GROUP_MEMBER_LINK_FIELD_INVALID
    );
  });

  it("group members and overlap still serve the owner", async () => {
    const g = await groupWithMember(fx.orgId, fx.ownerId);
    const target = await entityChain(fx.orgId, fx.ownerId);
    const members = await get(`/api/entity-groups/${g.groupId}/members`);
    expect(members.status).toBe(200);
    expect(members.body.payload.members).toHaveLength(1);
    const overlap = await get(
      overlapPath(g.groupId, target.entityId, target.fieldMappingId)
    );
    expect(overlap.status).toBe(200);
  });
});
