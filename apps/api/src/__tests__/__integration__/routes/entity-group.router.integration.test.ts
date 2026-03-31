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

// Mock the auth middleware to populate req.auth with our test sub
jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { payload: { sub: AUTH0_ID } } as never;
    next();
  },
}));

// Mock Auth0Service (required by profile router which shares the protected router)
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
  normalizedData: Record<string, unknown>,
  overrides?: Partial<Record<string, unknown>>
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
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("Entity Group Router", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;

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

  // ── GET /api/entity-groups ──────────────────────────────────────────

  describe("GET /api/entity-groups", () => {
    it("should return paginated list scoped to org", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      await (db as ReturnType<typeof drizzle>)
        .insert(entityGroups)
        .values([
          createEntityGroup(organizationId, { name: "alpha" }),
          createEntityGroup(organizationId, { name: "beta" }),
          createEntityGroup(organizationId, { name: "gamma" }),
        ] as never);

      const res = await request(app)
        .get("/api/entity-groups?limit=2&offset=0")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.entityGroups).toHaveLength(2);
      expect(res.body.payload.total).toBe(3);
      expect(res.body.payload.limit).toBe(2);
      expect(res.body.payload.offset).toBe(0);
    });

    it("should filter by name with search param", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      await (db as ReturnType<typeof drizzle>)
        .insert(entityGroups)
        .values([
          createEntityGroup(organizationId, { name: "People" }),
          createEntityGroup(organizationId, { name: "Companies" }),
          createEntityGroup(organizationId, { name: "People-Extended" }),
        ] as never);

      const res = await request(app)
        .get("/api/entity-groups?search=people")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.entityGroups).toHaveLength(2);
      const names = res.body.payload.entityGroups.map((g: { name: string }) => g.name);
      expect(names).toContain("People");
      expect(names).toContain("People-Extended");
    });
  });

  // ── GET /api/entity-groups/:id ──────────────────────────────────────

  describe("GET /api/entity-groups/:id", () => {
    it("should return 200 with members for valid ID", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const group = createEntityGroup(organizationId, { name: "People" });
      await (db as ReturnType<typeof drizzle>).insert(entityGroups).values(group as never);

      // Create connector entity with field mapping
      const connDef = createConnectorDefinition();
      await (db as ReturnType<typeof drizzle>).insert(connectorDefinitions).values(connDef as never);
      const connInst = createConnectorInstance(connDef.id, organizationId);
      await (db as ReturnType<typeof drizzle>).insert(connectorInstances).values(connInst as never);
      const entity = createConnectorEntity(organizationId, connInst.id, { label: "Employees" });
      await (db as ReturnType<typeof drizzle>).insert(connectorEntities).values(entity as never);
      const colDef = createColumnDef(organizationId, { key: "email" });
      await (db as ReturnType<typeof drizzle>).insert(columnDefinitions).values(colDef as never);
      const mapping = createFieldMapping(organizationId, entity.id, colDef.id, { sourceField: "email" });
      await (db as ReturnType<typeof drizzle>).insert(fieldMappings).values(mapping as never);

      // Add member
      await (db as ReturnType<typeof drizzle>).insert(entityGroupMembers).values({
        id: generateId(),
        organizationId,
        entityGroupId: group.id,
        connectorEntityId: entity.id,
        linkFieldMappingId: mapping.id,
        isPrimary: true,
        created: now,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);

      const res = await request(app)
        .get(`/api/entity-groups/${group.id}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.entityGroup.id).toBe(group.id);
      expect(res.body.payload.entityGroup.members).toHaveLength(1);
      expect(res.body.payload.entityGroup.members[0].connectorEntityLabel).toBe("Employees");
      expect(res.body.payload.entityGroup.members[0].linkFieldMappingSourceField).toBe("email");
    });

    it("should return 404 for unknown ID", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .get(`/api/entity-groups/${generateId()}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.ENTITY_GROUP_NOT_FOUND);
    });
  });

  // ── POST /api/entity-groups ─────────────────────────────────────────

  describe("POST /api/entity-groups", () => {
    it("should create group, return 201", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const res = await request(app)
        .post("/api/entity-groups")
        .set("Authorization", "Bearer test-token")
        .send({ name: "People", description: "Identity group" });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.entityGroup.name).toBe("People");
      expect(res.body.payload.entityGroup.description).toBe("Identity group");
      expect(res.body.payload.entityGroup.organizationId).toBe(organizationId);
    });

    it("should return 409 on duplicate name within org", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      await (db as ReturnType<typeof drizzle>)
        .insert(entityGroups)
        .values(createEntityGroup(organizationId, { name: "duplicate" }) as never);

      const res = await request(app)
        .post("/api/entity-groups")
        .set("Authorization", "Bearer test-token")
        .send({ name: "duplicate" });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ApiCode.ENTITY_GROUP_DUPLICATE_NAME);
    });
  });

  // ── PATCH /api/entity-groups/:id ────────────────────────────────────

  describe("PATCH /api/entity-groups/:id", () => {
    it("should update fields, return 200", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const group = createEntityGroup(organizationId, { name: "original" });
      await (db as ReturnType<typeof drizzle>).insert(entityGroups).values(group as never);

      const res = await request(app)
        .patch(`/api/entity-groups/${group.id}`)
        .set("Authorization", "Bearer test-token")
        .send({ name: "updated", description: "new desc" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.entityGroup.name).toBe("updated");
      expect(res.body.payload.entityGroup.description).toBe("new desc");
    });

    it("should return 409 if new name conflicts with existing group", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      await (db as ReturnType<typeof drizzle>)
        .insert(entityGroups)
        .values(createEntityGroup(organizationId, { name: "existing" }) as never);

      const groupToUpdate = createEntityGroup(organizationId, { name: "to-update" });
      await (db as ReturnType<typeof drizzle>).insert(entityGroups).values(groupToUpdate as never);

      const res = await request(app)
        .patch(`/api/entity-groups/${groupToUpdate.id}`)
        .set("Authorization", "Bearer test-token")
        .send({ name: "existing" });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ApiCode.ENTITY_GROUP_DUPLICATE_NAME);
    });
  });

  // ── DELETE /api/entity-groups/:id ───────────────────────────────────

  describe("DELETE /api/entity-groups/:id", () => {
    it("should soft-delete group and its members, return 200", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const group = createEntityGroup(organizationId, { name: "to-delete" });
      await (db as ReturnType<typeof drizzle>).insert(entityGroups).values(group as never);

      // Create member
      const connDef = createConnectorDefinition();
      await (db as ReturnType<typeof drizzle>).insert(connectorDefinitions).values(connDef as never);
      const connInst = createConnectorInstance(connDef.id, organizationId);
      await (db as ReturnType<typeof drizzle>).insert(connectorInstances).values(connInst as never);
      const entity = createConnectorEntity(organizationId, connInst.id);
      await (db as ReturnType<typeof drizzle>).insert(connectorEntities).values(entity as never);
      const colDef = createColumnDef(organizationId, { key: "email" });
      await (db as ReturnType<typeof drizzle>).insert(columnDefinitions).values(colDef as never);
      const mapping = createFieldMapping(organizationId, entity.id, colDef.id);
      await (db as ReturnType<typeof drizzle>).insert(fieldMappings).values(mapping as never);

      const memberId = generateId();
      await (db as ReturnType<typeof drizzle>).insert(entityGroupMembers).values({
        id: memberId,
        organizationId,
        entityGroupId: group.id,
        connectorEntityId: entity.id,
        linkFieldMappingId: mapping.id,
        isPrimary: false,
        created: now,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);

      const deleteRes = await request(app)
        .delete(`/api/entity-groups/${group.id}`)
        .set("Authorization", "Bearer test-token");

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.payload.id).toBe(group.id);

      // Group should no longer be retrievable
      const getRes = await request(app)
        .get(`/api/entity-groups/${group.id}`)
        .set("Authorization", "Bearer test-token");
      expect(getRes.status).toBe(404);

      // Members should also be soft-deleted
      const membersRes = await request(app)
        .get(`/api/entity-groups/${group.id}/members`)
        .set("Authorization", "Bearer test-token");
      expect(membersRes.status).toBe(200);
      expect(membersRes.body.payload.members).toHaveLength(0);
    });

    it("should return 404 for unknown ID", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .delete(`/api/entity-groups/${generateId()}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.ENTITY_GROUP_NOT_FOUND);
    });
  });

  // ── GET /api/entity-groups/:id/resolve ──────────────────────────────

  describe("GET /api/entity-groups/:id/resolve", () => {
    it("should return matching records from each member entity", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const group = createEntityGroup(organizationId, { name: "People" });
      await (db as ReturnType<typeof drizzle>).insert(entityGroups).values(group as never);

      // Create two entities with field mappings
      const connDef = createConnectorDefinition();
      await (db as ReturnType<typeof drizzle>).insert(connectorDefinitions).values(connDef as never);
      const connInst = createConnectorInstance(connDef.id, organizationId);
      await (db as ReturnType<typeof drizzle>).insert(connectorInstances).values(connInst as never);

      const entity1 = createConnectorEntity(organizationId, connInst.id, { label: "Employees" });
      await (db as ReturnType<typeof drizzle>).insert(connectorEntities).values(entity1 as never);
      const colDef1 = createColumnDef(organizationId, { key: "email" });
      await (db as ReturnType<typeof drizzle>).insert(columnDefinitions).values(colDef1 as never);
      const mapping1 = createFieldMapping(organizationId, entity1.id, colDef1.id, { sourceField: "email" });
      await (db as ReturnType<typeof drizzle>).insert(fieldMappings).values(mapping1 as never);

      const entity2 = createConnectorEntity(organizationId, connInst.id, { label: "Contacts" });
      await (db as ReturnType<typeof drizzle>).insert(connectorEntities).values(entity2 as never);
      const colDef2 = createColumnDef(organizationId, { key: "contact_email" });
      await (db as ReturnType<typeof drizzle>).insert(columnDefinitions).values(colDef2 as never);
      const mapping2 = createFieldMapping(organizationId, entity2.id, colDef2.id, { sourceField: "contact_email" });
      await (db as ReturnType<typeof drizzle>).insert(fieldMappings).values(mapping2 as never);

      // Add members
      await (db as ReturnType<typeof drizzle>).insert(entityGroupMembers).values([
        {
          id: generateId(), organizationId, entityGroupId: group.id,
          connectorEntityId: entity1.id, linkFieldMappingId: mapping1.id,
          isPrimary: true, created: now, createdBy: "SYSTEM_TEST",
          updated: null, updatedBy: null, deleted: null, deletedBy: null,
        },
        {
          id: generateId(), organizationId, entityGroupId: group.id,
          connectorEntityId: entity2.id, linkFieldMappingId: mapping2.id,
          isPrimary: false, created: now, createdBy: "SYSTEM_TEST",
          updated: null, updatedBy: null, deleted: null, deletedBy: null,
        },
      ] as never);

      // Create records
      await (db as ReturnType<typeof drizzle>).insert(entityRecords).values([
        createEntityRecord(organizationId, entity1.id, { email: "test@example.com", name: "Alice" }),
        createEntityRecord(organizationId, entity1.id, { email: "other@example.com", name: "Bob" }),
        createEntityRecord(organizationId, entity2.id, { contact_email: "test@example.com", phone: "555" }),
      ] as never);

      const res = await request(app)
        .get(`/api/entity-groups/${group.id}/resolve?linkValue=test@example.com`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.results).toHaveLength(2);

      const employeeResult = res.body.payload.results.find((r: { connectorEntityLabel: string }) => r.connectorEntityLabel === "Employees");
      expect(employeeResult.records).toHaveLength(1);
      expect(employeeResult.isPrimary).toBe(true);

      const contactResult = res.body.payload.results.find((r: { connectorEntityLabel: string }) => r.connectorEntityLabel === "Contacts");
      expect(contactResult.records).toHaveLength(1);
      expect(contactResult.isPrimary).toBe(false);
    });

    it("should return empty results array when no records match", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const group = createEntityGroup(organizationId, { name: "People" });
      await (db as ReturnType<typeof drizzle>).insert(entityGroups).values(group as never);

      const res = await request(app)
        .get(`/api/entity-groups/${group.id}/resolve?linkValue=nobody@example.com`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.results).toHaveLength(0);
    });
  });
});
