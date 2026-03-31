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
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  generateId,
  seedUserAndOrg,
  teardownOrg,
} from "../utils/application.util.js";

const AUTH0_ID = "auth0|ci-test-user";

jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { payload: { sub: AUTH0_ID } } as never;
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
  entityGroups,
  entityGroupMembers,
  connectorEntities,
  connectorInstances,
  connectorDefinitions,
  fieldMappings,
  columnDefinitions,
  entityRecords,
} = schema;

// ── Helpers ────────────────────────────────────────────────────────

const now = Date.now();

function createEntityGroup(
  organizationId: string,
  overrides?: Partial<Record<string, unknown>>
) {
  return {
    id: generateId(),
    organizationId,
    name: `group-${generateId().slice(0, 8)}`,
    description: null,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    ...overrides,
  };
}

function createConnectorDefinition() {
  return {
    id: generateId(),
    slug: `slug-${generateId()}`,
    display: "Test Connector",
    category: "crm",
    authType: "oauth2",
    configSchema: null,
    capabilityFlags: { sync: true },
    isActive: true,
    version: "1.0.0",
    iconUrl: null,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

function createConnectorInstance(connectorDefinitionId: string, organizationId: string) {
  return {
    id: generateId(),
    connectorDefinitionId,
    organizationId,
    name: "Test Instance",
    status: "active" as const,
    config: null,
    credentials: null,
    lastSyncAt: null,
    lastErrorMessage: null,
    enabledCapabilityFlags: null,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

function createConnectorEntity(organizationId: string, connectorInstanceId: string, overrides?: Partial<Record<string, unknown>>) {
  return {
    id: generateId(),
    organizationId,
    connectorInstanceId,
    key: `entity_${generateId().replace(/-/g, "").slice(0, 8)}`,
    label: "Test Entity",
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    ...overrides,
  };
}

function createColumnDef(organizationId: string, overrides?: Partial<Record<string, unknown>>) {
  return {
    id: generateId(),
    organizationId,
    key: `col_${generateId().replace(/-/g, "").slice(0, 8)}`,
    label: "Email",
    type: "string",
    required: false,
    defaultValue: null,
    format: null,
    enumValues: null,
    description: null,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    ...overrides,
  };
}

function createFieldMapping(
  organizationId: string,
  connectorEntityId: string,
  columnDefinitionId: string,
  overrides?: Partial<Record<string, unknown>>
) {
  return {
    id: generateId(),
    organizationId,
    connectorEntityId,
    columnDefinitionId,
    sourceField: "email",
    isPrimaryKey: false,
    refColumnDefinitionId: null,
    refEntityKey: null,
    refBidirectionalFieldMappingId: null,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    ...overrides,
  };
}

function createEntityRecord(
  organizationId: string,
  connectorEntityId: string,
  normalizedData: Record<string, unknown>
) {
  return {
    id: generateId(),
    organizationId,
    connectorEntityId,
    data: normalizedData,
    normalizedData,
    sourceId: `src-${generateId().slice(0, 8)}`,
    checksum: "abc123",
    syncedAt: now,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("Entity Group Member Router", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;

  interface SeedResult {
    organizationId: string;
    groupId: string;
    connectorInstanceId: string;
  }

  async function seedGroupWithInfra(): Promise<SeedResult> {
    const { organizationId } = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );

    const group = createEntityGroup(organizationId, { name: "People" });
    await (db as ReturnType<typeof drizzle>).insert(entityGroups).values(group as never);

    const connDef = createConnectorDefinition();
    await (db as ReturnType<typeof drizzle>).insert(connectorDefinitions).values(connDef as never);
    const connInst = createConnectorInstance(connDef.id, organizationId);
    await (db as ReturnType<typeof drizzle>).insert(connectorInstances).values(connInst as never);

    return { organizationId, groupId: group.id, connectorInstanceId: connInst.id };
  }

  async function seedEntityWithMapping(organizationId: string, connectorInstanceId: string, sourceField = "email") {
    const entity = createConnectorEntity(organizationId, connectorInstanceId);
    await (db as ReturnType<typeof drizzle>).insert(connectorEntities).values(entity as never);
    const colDef = createColumnDef(organizationId, { key: sourceField });
    await (db as ReturnType<typeof drizzle>).insert(columnDefinitions).values(colDef as never);
    const mapping = createFieldMapping(organizationId, entity.id, colDef.id, { sourceField });
    await (db as ReturnType<typeof drizzle>).insert(fieldMappings).values(mapping as never);
    return { entityId: entity.id, fieldMappingId: mapping.id };
  }

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });

    await teardownOrg(db as ReturnType<typeof drizzle>);
  });

  afterEach(async () => {
    await connection.end();
  });

  // ── GET /api/entity-groups/:id/members ──────────────────────────────

  describe("GET /api/entity-groups/:id/members", () => {
    it("should return members with enriched details", async () => {
      const { organizationId, groupId, connectorInstanceId } = await seedGroupWithInfra();
      const { entityId, fieldMappingId } = await seedEntityWithMapping(organizationId, connectorInstanceId);

      await (db as ReturnType<typeof drizzle>).insert(entityGroupMembers).values({
        id: generateId(), organizationId, entityGroupId: groupId,
        connectorEntityId: entityId, linkFieldMappingId: fieldMappingId,
        isPrimary: false, created: now, createdBy: "SYSTEM_TEST",
        updated: null, updatedBy: null, deleted: null, deletedBy: null,
      } as never);

      const res = await request(app)
        .get(`/api/entity-groups/${groupId}/members`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.members).toHaveLength(1);
      expect(res.body.payload.members[0].connectorEntityLabel).toBeDefined();
      expect(res.body.payload.members[0].linkFieldMappingSourceField).toBe("email");
    });
  });

  // ── POST /api/entity-groups/:id/members ─────────────────────────────

  describe("POST /api/entity-groups/:id/members", () => {
    it("should add a member, return 201", async () => {
      const { organizationId, groupId, connectorInstanceId } = await seedGroupWithInfra();
      const { entityId, fieldMappingId } = await seedEntityWithMapping(organizationId, connectorInstanceId);

      const res = await request(app)
        .post(`/api/entity-groups/${groupId}/members`)
        .set("Authorization", "Bearer test-token")
        .send({ connectorEntityId: entityId, linkFieldMappingId: fieldMappingId });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.entityGroupMember.connectorEntityId).toBe(entityId);
      expect(res.body.payload.entityGroupMember.isPrimary).toBe(false);
    });

    it("should return 409 if entity already a member", async () => {
      const { organizationId, groupId, connectorInstanceId } = await seedGroupWithInfra();
      const { entityId, fieldMappingId } = await seedEntityWithMapping(organizationId, connectorInstanceId);

      // Add first time
      await request(app)
        .post(`/api/entity-groups/${groupId}/members`)
        .set("Authorization", "Bearer test-token")
        .send({ connectorEntityId: entityId, linkFieldMappingId: fieldMappingId });

      // Try again
      const res = await request(app)
        .post(`/api/entity-groups/${groupId}/members`)
        .set("Authorization", "Bearer test-token")
        .send({ connectorEntityId: entityId, linkFieldMappingId: fieldMappingId });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ApiCode.ENTITY_GROUP_MEMBER_ALREADY_EXISTS);
    });

    it("should return 400 if link field mapping does not belong to the connector entity", async () => {
      const { organizationId, groupId, connectorInstanceId } = await seedGroupWithInfra();
      const { entityId } = await seedEntityWithMapping(organizationId, connectorInstanceId, "email");
      // Create a second entity with its own mapping
      const { fieldMappingId: otherMappingId } = await seedEntityWithMapping(organizationId, connectorInstanceId, "name");

      const res = await request(app)
        .post(`/api/entity-groups/${groupId}/members`)
        .set("Authorization", "Bearer test-token")
        .send({ connectorEntityId: entityId, linkFieldMappingId: otherMappingId });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.ENTITY_GROUP_MEMBER_LINK_FIELD_INVALID);
    });

    it("should clear existing primary and set new member as primary with isPrimary: true", async () => {
      const { organizationId, groupId, connectorInstanceId } = await seedGroupWithInfra();
      const seed1 = await seedEntityWithMapping(organizationId, connectorInstanceId, "email");
      const seed2 = await seedEntityWithMapping(organizationId, connectorInstanceId, "name");

      // Add first member as primary
      const res1 = await request(app)
        .post(`/api/entity-groups/${groupId}/members`)
        .set("Authorization", "Bearer test-token")
        .send({ connectorEntityId: seed1.entityId, linkFieldMappingId: seed1.fieldMappingId, isPrimary: true });

      expect(res1.status).toBe(201);
      expect(res1.body.payload.entityGroupMember.isPrimary).toBe(true);

      // Add second member as primary
      const res2 = await request(app)
        .post(`/api/entity-groups/${groupId}/members`)
        .set("Authorization", "Bearer test-token")
        .send({ connectorEntityId: seed2.entityId, linkFieldMappingId: seed2.fieldMappingId, isPrimary: true });

      expect(res2.status).toBe(201);
      expect(res2.body.payload.entityGroupMember.isPrimary).toBe(true);

      // Verify first member is no longer primary via list
      const listRes = await request(app)
        .get(`/api/entity-groups/${groupId}/members`)
        .set("Authorization", "Bearer test-token");

      const members = listRes.body.payload.members;
      const firstMember = members.find((m: { connectorEntityId: string }) => m.connectorEntityId === seed1.entityId);
      expect(firstMember.isPrimary).toBe(false);
    });
  });

  // ── PATCH /api/entity-groups/:id/members/:memberId ──────────────────

  describe("PATCH /api/entity-groups/:id/members/:memberId", () => {
    it("should update isPrimary correctly with transactional primary swap", async () => {
      const { organizationId, groupId, connectorInstanceId } = await seedGroupWithInfra();
      const seed1 = await seedEntityWithMapping(organizationId, connectorInstanceId, "email");
      const seed2 = await seedEntityWithMapping(organizationId, connectorInstanceId, "name");

      // Add two members, first as primary
      const res1 = await request(app)
        .post(`/api/entity-groups/${groupId}/members`)
        .set("Authorization", "Bearer test-token")
        .send({ connectorEntityId: seed1.entityId, linkFieldMappingId: seed1.fieldMappingId, isPrimary: true });

      const res2 = await request(app)
        .post(`/api/entity-groups/${groupId}/members`)
        .set("Authorization", "Bearer test-token")
        .send({ connectorEntityId: seed2.entityId, linkFieldMappingId: seed2.fieldMappingId });

      const member2Id = res2.body.payload.entityGroupMember.id;

      // Promote member2 to primary
      const patchRes = await request(app)
        .patch(`/api/entity-groups/${groupId}/members/${member2Id}`)
        .set("Authorization", "Bearer test-token")
        .send({ isPrimary: true });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.payload.entityGroupMember.isPrimary).toBe(true);

      // Verify member1 lost primary
      const listRes = await request(app)
        .get(`/api/entity-groups/${groupId}/members`)
        .set("Authorization", "Bearer test-token");

      const m1 = listRes.body.payload.members.find((m: { connectorEntityId: string }) => m.connectorEntityId === seed1.entityId);
      expect(m1.isPrimary).toBe(false);
    });

    it("should update linkFieldMappingId and validate ownership", async () => {
      const { organizationId, groupId, connectorInstanceId } = await seedGroupWithInfra();
      const { entityId, fieldMappingId } = await seedEntityWithMapping(organizationId, connectorInstanceId);

      // Create a second field mapping on the SAME entity
      const colDef2 = createColumnDef(organizationId, { key: "name" });
      await (db as ReturnType<typeof drizzle>).insert(columnDefinitions).values(colDef2 as never);
      const mapping2 = createFieldMapping(organizationId, entityId, colDef2.id, { sourceField: "name" });
      await (db as ReturnType<typeof drizzle>).insert(fieldMappings).values(mapping2 as never);

      // Add member
      const addRes = await request(app)
        .post(`/api/entity-groups/${groupId}/members`)
        .set("Authorization", "Bearer test-token")
        .send({ connectorEntityId: entityId, linkFieldMappingId: fieldMappingId });

      const memberId = addRes.body.payload.entityGroupMember.id;

      // Update to new mapping (same entity — should succeed)
      const patchRes = await request(app)
        .patch(`/api/entity-groups/${groupId}/members/${memberId}`)
        .set("Authorization", "Bearer test-token")
        .send({ linkFieldMappingId: mapping2.id });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.payload.entityGroupMember.linkFieldMappingId).toBe(mapping2.id);

      // Try to update to a mapping from a DIFFERENT entity — should fail
      const { fieldMappingId: otherMappingId } = await seedEntityWithMapping(organizationId, connectorInstanceId, "phone");

      const failRes = await request(app)
        .patch(`/api/entity-groups/${groupId}/members/${memberId}`)
        .set("Authorization", "Bearer test-token")
        .send({ linkFieldMappingId: otherMappingId });

      expect(failRes.status).toBe(400);
      expect(failRes.body.code).toBe(ApiCode.ENTITY_GROUP_MEMBER_LINK_FIELD_INVALID);
    });
  });

  // ── DELETE /api/entity-groups/:id/members/:memberId ─────────────────

  describe("DELETE /api/entity-groups/:id/members/:memberId", () => {
    it("should remove member, return 200", async () => {
      const { organizationId, groupId, connectorInstanceId } = await seedGroupWithInfra();
      const { entityId, fieldMappingId } = await seedEntityWithMapping(organizationId, connectorInstanceId);

      const addRes = await request(app)
        .post(`/api/entity-groups/${groupId}/members`)
        .set("Authorization", "Bearer test-token")
        .send({ connectorEntityId: entityId, linkFieldMappingId: fieldMappingId });

      const memberId = addRes.body.payload.entityGroupMember.id;

      const deleteRes = await request(app)
        .delete(`/api/entity-groups/${groupId}/members/${memberId}`)
        .set("Authorization", "Bearer test-token");

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.payload.id).toBe(memberId);

      // Should no longer appear in list
      const listRes = await request(app)
        .get(`/api/entity-groups/${groupId}/members`)
        .set("Authorization", "Bearer test-token");

      expect(listRes.body.payload.members).toHaveLength(0);
    });
  });

  // ── GET /api/entity-groups/:id/members/overlap ──────────────────────

  describe("GET /api/entity-groups/:id/members/overlap", () => {
    it("should return overlap statistics", async () => {
      const { organizationId, groupId, connectorInstanceId } = await seedGroupWithInfra();
      const seed1 = await seedEntityWithMapping(organizationId, connectorInstanceId, "email");

      // Add member to group
      await (db as ReturnType<typeof drizzle>).insert(entityGroupMembers).values({
        id: generateId(), organizationId, entityGroupId: groupId,
        connectorEntityId: seed1.entityId, linkFieldMappingId: seed1.fieldMappingId,
        isPrimary: true, created: now, createdBy: "SYSTEM_TEST",
        updated: null, updatedBy: null, deleted: null, deletedBy: null,
      } as never);

      // Create records for existing member
      await (db as ReturnType<typeof drizzle>).insert(entityRecords).values([
        createEntityRecord(organizationId, seed1.entityId, { email: "a@test.com" }),
        createEntityRecord(organizationId, seed1.entityId, { email: "b@test.com" }),
      ] as never);

      // Create target entity with records
      const seed2 = await seedEntityWithMapping(organizationId, connectorInstanceId, "contact_email");
      await (db as ReturnType<typeof drizzle>).insert(entityRecords).values([
        createEntityRecord(organizationId, seed2.entityId, { contact_email: "a@test.com" }),
        createEntityRecord(organizationId, seed2.entityId, { contact_email: "c@test.com" }),
      ] as never);

      const res = await request(app)
        .get(`/api/entity-groups/${groupId}/members/overlap?targetConnectorEntityId=${seed2.entityId}&targetLinkFieldMappingId=${seed2.fieldMappingId}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.sourceRecordCount).toBe(2);
      expect(res.body.payload.targetRecordCount).toBe(2);
      expect(res.body.payload.matchingRecordCount).toBe(1);
      expect(res.body.payload.overlapPercentage).toBeGreaterThan(0);
      expect(res.body.payload.overlapPercentage).toBeLessThanOrEqual(100);
    });
  });
});
