import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
} from "@jest/globals";
import crypto from "crypto";
import request from "supertest";
import { Request, Response, NextFunction } from "express";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import { environment } from "../../../environment.js";
import {
  generateId,
  createUser,
  seedUserAndOrg,
  teardownOrg,
} from "../utils/application.util.js";

const AUTH0_ID = "auth0|ci-test-user";

// Set ENCRYPTION_KEY before anything imports crypto.util
const TEST_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
let _originalEncryptionKey: string | undefined;

beforeAll(() => {
  _originalEncryptionKey = environment.ENCRYPTION_KEY;
  environment.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
});

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
  connectorDefinitions,
  connectorInstances,
  connectorEntities,
  entityRecords,
  fieldMappings,
  columnDefinitions,
  entityTagAssignments,
  entityTags,
  entityGroupMembers,
  entityGroups,
  stationInstances,
  stations,
} = schema;

// ── Helpers ────────────────────────────────────────────────────────

const now = Date.now();

function createConnectorDefinition(
  overrides?: Partial<Record<string, unknown>>
) {
  return {
    id: generateId(),
    slug: `slug-${generateId()}`,
    display: "Test Connector",
    category: "crm",
    authType: "oauth2",
    configSchema: null,
    capabilityFlags: { sync: true, query: true, write: false },
    isActive: true,
    version: "1.0.0",
    iconUrl: null,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    ...overrides,
  };
}

function createConnectorInstance(
  connectorDefinitionId: string,
  organizationId: string,
  overrides?: Partial<Record<string, unknown>>
) {
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
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("Connector Instance Router", () => {
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

  // ── GET /api/connector-instances ────────────────────────────────

  describe("GET /api/connector-instances", () => {
    it("should return an empty list when no instances exist", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .get("/api/connector-instances")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.connectorInstances).toEqual([]);
      expect(res.body.payload.total).toBe(0);
    });

    it("should return paginated connector instances", async () => {
      const { organizationId: orgId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const def = createConnectorDefinition();
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorDefinitions)
        .values(def as never);

      // Insert 3 instances
      for (let i = 0; i < 3; i++) {
        await (db as ReturnType<typeof drizzle>)
          .insert(connectorInstances)
          .values(
            createConnectorInstance(def.id, orgId, {
              name: `Instance ${i}`,
            }) as never
          );
      }

      const res = await request(app)
        .get("/api/connector-instances?limit=2&offset=0")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.connectorInstances).toHaveLength(2);
      expect(res.body.payload.total).toBe(3);
      expect(res.body.payload.limit).toBe(2);
      expect(res.body.payload.offset).toBe(0);
    });

    it("should filter by connectorDefinitionId", async () => {
      const { organizationId: orgId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const def1 = createConnectorDefinition();
      const def2 = createConnectorDefinition();
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorDefinitions)
        .values([def1, def2] as never);

      await (db as ReturnType<typeof drizzle>)
        .insert(connectorInstances)
        .values([
          createConnectorInstance(def1.id, orgId, { name: "A" }),
          createConnectorInstance(def2.id, orgId, { name: "B" }),
        ] as never);

      const res = await request(app)
        .get(
          `/api/connector-instances?connectorDefinitionId=${def1.id}`
        )
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.connectorInstances).toHaveLength(1);
      expect(res.body.payload.connectorInstances[0].name).toBe("A");
    });

    it("should filter by status", async () => {
      const { organizationId: orgId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const def = createConnectorDefinition();
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorDefinitions)
        .values(def as never);

      await (db as ReturnType<typeof drizzle>)
        .insert(connectorInstances)
        .values([
          createConnectorInstance(def.id, orgId, {
            name: "Active",
            status: "active",
          }),
          createConnectorInstance(def.id, orgId, {
            name: "Pending",
            status: "pending",
          }),
        ] as never);

      const res = await request(app)
        .get("/api/connector-instances?status=pending")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.connectorInstances).toHaveLength(1);
      expect(res.body.payload.connectorInstances[0].name).toBe("Pending");
    });

    it("should filter by multiple statuses (comma-separated)", async () => {
      const { organizationId: orgId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const def = createConnectorDefinition();
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorDefinitions)
        .values(def as never);

      await (db as ReturnType<typeof drizzle>)
        .insert(connectorInstances)
        .values([
          createConnectorInstance(def.id, orgId, {
            name: "Active",
            status: "active",
          }),
          createConnectorInstance(def.id, orgId, {
            name: "Error",
            status: "error",
          }),
          createConnectorInstance(def.id, orgId, {
            name: "Pending",
            status: "pending",
          }),
        ] as never);

      const res = await request(app)
        .get("/api/connector-instances?status=active,error")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.connectorInstances).toHaveLength(2);
      const names = res.body.payload.connectorInstances.map(
        (ci: { name: string }) => ci.name
      );
      expect(names).toContain("Active");
      expect(names).toContain("Error");
      expect(names).not.toContain("Pending");
    });

    it("should attach connectorDefinition when include=connectorDefinition", async () => {
      const { organizationId: orgId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const def = createConnectorDefinition({ display: "My Connector" });
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorDefinitions)
        .values(def as never);
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorInstances)
        .values(createConnectorInstance(def.id, orgId) as never);

      const res = await request(app)
        .get("/api/connector-instances?include=connectorDefinition")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.connectorInstances).toHaveLength(1);
      const inst = res.body.payload.connectorInstances[0];
      expect(inst.connectorDefinition).toBeDefined();
      expect(inst.connectorDefinition.id).toBe(def.id);
      expect(inst.connectorDefinition.display).toBe("My Connector");
    });

    it("should filter by search (case-insensitive name match)", async () => {
      const { organizationId: orgId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const def = createConnectorDefinition();
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorDefinitions)
        .values(def as never);

      await (db as ReturnType<typeof drizzle>)
        .insert(connectorInstances)
        .values([
          createConnectorInstance(def.id, orgId, { name: "Salesforce Prod" }),
          createConnectorInstance(def.id, orgId, { name: "HubSpot Dev" }),
        ] as never);

      const res = await request(app)
        .get("/api/connector-instances?search=salesforce")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.connectorInstances).toHaveLength(1);
      expect(res.body.payload.connectorInstances[0].name).toBe(
        "Salesforce Prod"
      );
    });
  });

  // ── GET /api/connector-instances/:id ────────────────────────────

  describe("GET /api/connector-instances/:id", () => {
    it("should return 404 when instance does not exist", async () => {
      const res = await request(app)
        .get(`/api/connector-instances/${generateId()}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_INSTANCE_NOT_FOUND);
    });

    it("should return a connector instance by id", async () => {
      const def = createConnectorDefinition();
      const orgId = generateId();
      const instance = createConnectorInstance(def.id, orgId, {
        name: "My Instance",
      });

      await (db as ReturnType<typeof drizzle>)
        .insert(connectorDefinitions)
        .values(def as never);
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorInstances)
        .values(instance as never);

      const res = await request(app)
        .get(`/api/connector-instances/${instance.id}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.connectorInstance.id).toBe(instance.id);
      expect(res.body.payload.connectorInstance.name).toBe("My Instance");
    });

    it("should not return soft-deleted instances", async () => {
      const def = createConnectorDefinition();
      const orgId = generateId();
      const instance = createConnectorInstance(def.id, orgId, {
        deleted: now,
        deletedBy: "SYSTEM_TEST",
      });

      await (db as ReturnType<typeof drizzle>)
        .insert(connectorDefinitions)
        .values(def as never);
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorInstances)
        .values(instance as never);

      const res = await request(app)
        .get(`/api/connector-instances/${instance.id}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
    });

    it("should return connectorDefinition in the response", async () => {
      const def = createConnectorDefinition({
        display: "Salesforce CRM",
        slug: `sf-${generateId()}`,
      });
      const orgId = generateId();
      const instance = createConnectorInstance(def.id, orgId, {
        name: "SF Production",
      });

      await (db as ReturnType<typeof drizzle>)
        .insert(connectorDefinitions)
        .values(def as never);
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorInstances)
        .values(instance as never);

      const res = await request(app)
        .get(`/api/connector-instances/${instance.id}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const returned = res.body.payload.connectorInstance;
      expect(returned.connectorDefinition).toBeDefined();
      expect(returned.connectorDefinition).toEqual(
        expect.objectContaining({
          id: def.id,
          display: "Salesforce CRM",
          slug: def.slug,
          category: def.category,
          authType: def.authType,
        })
      );
    });
  });

  // ── DELETE /api/connector-instances/:id ──────────────────────────

  /** Seed a full connector instance with all related data for cascade/impact tests. */
  async function seedInstanceWithRelatedData(orgId: string, userId: string) {
      const def = createConnectorDefinition();
      await (db as ReturnType<typeof drizzle>).insert(connectorDefinitions).values(def as never);

      const instance = createConnectorInstance(def.id, orgId, { name: "To Delete" });
      await (db as ReturnType<typeof drizzle>).insert(connectorInstances).values(instance as never);

      // Connector entity
      const entity = {
        id: generateId(),
        organizationId: orgId,
        connectorInstanceId: instance.id,
        key: "accounts",
        label: "Accounts",
        created: now,
        createdBy: userId,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      };
      await (db as ReturnType<typeof drizzle>).insert(connectorEntities).values(entity as never);

      // Column definition (needed for field mapping FK)
      const colDef = {
        id: generateId(),
        organizationId: orgId,
        key: `col-${generateId()}`,
        label: "Name",
        type: "string" as const,
        required: false,
        defaultValue: null,
        format: null,
        enumValues: null,
        description: null,
        created: now,
        createdBy: userId,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      };
      await (db as ReturnType<typeof drizzle>).insert(columnDefinitions).values(colDef as never);

      // Field mapping
      const mapping = {
        id: generateId(),
        organizationId: orgId,
        connectorEntityId: entity.id,
        columnDefinitionId: colDef.id,
        sourceField: "name",
        isPrimaryKey: false,
        refColumnDefinitionId: null,
        refEntityKey: null,
        refBidirectionalFieldMappingId: null,
        created: now,
        createdBy: userId,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      };
      await (db as ReturnType<typeof drizzle>).insert(fieldMappings).values(mapping as never);

      // Entity record
      const record = {
        id: generateId(),
        organizationId: orgId,
        connectorEntityId: entity.id,
        sourceId: "src-1",
        data: { name: "Acme" },
        normalizedData: { name: "acme" },
        checksum: "abc123",
        syncedAt: now,
        created: now,
        createdBy: userId,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      };
      await (db as ReturnType<typeof drizzle>).insert(entityRecords).values(record as never);

      // Entity tag + assignment
      const tag = {
        id: generateId(),
        organizationId: orgId,
        name: "important",
        color: "#ff0000",
        created: now,
        createdBy: userId,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      };
      await (db as ReturnType<typeof drizzle>).insert(entityTags).values(tag as never);

      const tagAssignment = {
        id: generateId(),
        organizationId: orgId,
        connectorEntityId: entity.id,
        entityTagId: tag.id,
        created: now,
        createdBy: userId,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      };
      await (db as ReturnType<typeof drizzle>).insert(entityTagAssignments).values(tagAssignment as never);

      // Entity group + member
      const group = {
        id: generateId(),
        organizationId: orgId,
        name: "Test Group",
        created: now,
        createdBy: userId,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      };
      await (db as ReturnType<typeof drizzle>).insert(entityGroups).values(group as never);

      const groupMember = {
        id: generateId(),
        organizationId: orgId,
        entityGroupId: group.id,
        connectorEntityId: entity.id,
        linkFieldMappingId: mapping.id,
        isPrimary: false,
        created: now,
        createdBy: userId,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      };
      await (db as ReturnType<typeof drizzle>).insert(entityGroupMembers).values(groupMember as never);

      // Station + station_instance link
      const station = {
        id: generateId(),
        organizationId: orgId,
        name: "Test Station",
        description: null,
        toolPacks: [],
        created: now,
        createdBy: userId,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      };
      await (db as ReturnType<typeof drizzle>).insert(stations).values(station as never);

      const stationInstance = {
        id: generateId(),
        stationId: station.id,
        connectorInstanceId: instance.id,
        created: now,
        createdBy: userId,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      };
      await (db as ReturnType<typeof drizzle>).insert(stationInstances).values(stationInstance as never);

      return {
        instance,
        entity,
        record,
        mapping,
        colDef,
        tag,
        tagAssignment,
        group,
        groupMember,
        station,
        stationInstance,
      };
  }

  describe("DELETE /api/connector-instances/:id", () => {
    it("should return 404 for non-existent connector instance", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .delete(`/api/connector-instances/${generateId()}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_INSTANCE_NOT_FOUND);
    });

    it("should return 404 for already-deleted connector instance", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);
      const def = createConnectorDefinition();
      await (db as ReturnType<typeof drizzle>).insert(connectorDefinitions).values(def as never);

      const instance = createConnectorInstance(def.id, generateId(), {
        deleted: now,
        deletedBy: "SYSTEM_TEST",
      });
      await (db as ReturnType<typeof drizzle>).insert(connectorInstances).values(instance as never);

      const res = await request(app)
        .delete(`/api/connector-instances/${instance.id}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
    });

    it("should delete a connector instance and return its id", async () => {
      const { organizationId: orgId } = await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);
      const def = createConnectorDefinition();
      await (db as ReturnType<typeof drizzle>).insert(connectorDefinitions).values(def as never);
      const instance = createConnectorInstance(def.id, orgId);
      await (db as ReturnType<typeof drizzle>).insert(connectorInstances).values(instance as never);

      const res = await request(app)
        .delete(`/api/connector-instances/${instance.id}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.id).toBe(instance.id);
    });

    it("should cascade soft-delete to all related data and hard-delete station links", async () => {
      const { organizationId: orgId, userId } = await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);
      const seeded = await seedInstanceWithRelatedData(orgId, userId);

      const res = await request(app)
        .delete(`/api/connector-instances/${seeded.instance.id}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);

      // Verify connector entity is soft-deleted
      const entityRows = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(connectorEntities);
      const deletedEntity = entityRows.find((e) => e.id === seeded.entity.id);
      expect(deletedEntity).toBeDefined();
      expect(deletedEntity!.deleted).not.toBeNull();

      // Verify entity record is soft-deleted
      const records = await (db as ReturnType<typeof drizzle>).select().from(entityRecords);
      const deletedRecord = records.find((r) => r.id === seeded.record.id);
      expect(deletedRecord).toBeDefined();
      expect(deletedRecord!.deleted).not.toBeNull();

      // Verify field mapping is soft-deleted
      const mappings = await (db as ReturnType<typeof drizzle>).select().from(fieldMappings);
      const deletedMapping = mappings.find((m) => m.id === seeded.mapping.id);
      expect(deletedMapping).toBeDefined();
      expect(deletedMapping!.deleted).not.toBeNull();

      // Verify tag assignment is soft-deleted
      const assignments = await (db as ReturnType<typeof drizzle>).select().from(entityTagAssignments);
      const deletedAssignment = assignments.find((a) => a.id === seeded.tagAssignment.id);
      expect(deletedAssignment).toBeDefined();
      expect(deletedAssignment!.deleted).not.toBeNull();

      // Verify group member is soft-deleted
      const members = await (db as ReturnType<typeof drizzle>).select().from(entityGroupMembers);
      const deletedMember = members.find((m) => m.id === seeded.groupMember.id);
      expect(deletedMember).toBeDefined();
      expect(deletedMember!.deleted).not.toBeNull();

      // Verify station_instances join row is hard-deleted
      const stationLinks = await (db as ReturnType<typeof drizzle>).select().from(stationInstances);
      const link = stationLinks.find((s) => s.id === seeded.stationInstance.id);
      expect(link).toBeUndefined();

      // Verify the connector instance itself is soft-deleted
      const instances = await (db as ReturnType<typeof drizzle>).select().from(connectorInstances);
      const deletedInstance = instances.find((i) => i.id === seeded.instance.id);
      expect(deletedInstance).toBeDefined();
      expect(deletedInstance!.deleted).not.toBeNull();
    });

    it("should no longer return deleted instance in GET list", async () => {
      const { organizationId: orgId } = await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);
      const def = createConnectorDefinition();
      await (db as ReturnType<typeof drizzle>).insert(connectorDefinitions).values(def as never);
      const instance = createConnectorInstance(def.id, orgId, { name: "Soon Gone" });
      await (db as ReturnType<typeof drizzle>).insert(connectorInstances).values(instance as never);

      // Delete it
      await request(app)
        .delete(`/api/connector-instances/${instance.id}`)
        .set("Authorization", "Bearer test-token");

      // Verify it's gone from list
      const listRes = await request(app)
        .get("/api/connector-instances")
        .set("Authorization", "Bearer test-token");

      expect(listRes.status).toBe(200);
      const names = listRes.body.payload.connectorInstances.map((ci: { name: string }) => ci.name);
      expect(names).not.toContain("Soon Gone");
    });
  });

  // ── GET /api/connector-instances/:id/impact ─────────────────────

  describe("GET /api/connector-instances/:id/impact", () => {
    it("should return 404 for non-existent connector instance", async () => {
      const res = await request(app)
        .get(`/api/connector-instances/${generateId()}/impact`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_INSTANCE_NOT_FOUND);
    });

    it("should return all zeros for an instance with no associated data", async () => {
      const { organizationId: orgId } = await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);
      const def = createConnectorDefinition();
      await (db as ReturnType<typeof drizzle>).insert(connectorDefinitions).values(def as never);
      const instance = createConnectorInstance(def.id, orgId);
      await (db as ReturnType<typeof drizzle>).insert(connectorInstances).values(instance as never);

      const res = await request(app)
        .get(`/api/connector-instances/${instance.id}/impact`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload).toEqual({
        connectorEntities: 0,
        entityRecords: 0,
        fieldMappings: 0,
        entityTagAssignments: 0,
        entityGroupMembers: 0,
        stations: 0,
      });
    });

    it("should return correct counts for an instance with associated data", async () => {
      const { organizationId: orgId, userId } = await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);
      const seeded = await seedInstanceWithRelatedData(orgId, userId);

      const res = await request(app)
        .get(`/api/connector-instances/${seeded.instance.id}/impact`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload).toEqual({
        connectorEntities: 1,
        entityRecords: 1,
        fieldMappings: 1,
        entityTagAssignments: 1,
        entityGroupMembers: 1,
        stations: 1,
      });
    });
  });

  // ── PATCH /api/connector-instances/:id ─────────────────────────

  describe("PATCH /api/connector-instances/:id", () => {
    it("should return 404 for non-existent connector instance", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .patch(`/api/connector-instances/${generateId()}`)
        .set("Authorization", "Bearer test-token")
        .send({ name: "New Name" });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_INSTANCE_NOT_FOUND);
    });

    it("should return 400 for empty name", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .patch(`/api/connector-instances/${generateId()}`)
        .set("Authorization", "Bearer test-token")
        .send({ name: "" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_INSTANCE_INVALID_PAYLOAD);
    });

    it("should return 400 for missing name", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .patch(`/api/connector-instances/${generateId()}`)
        .set("Authorization", "Bearer test-token")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_INSTANCE_INVALID_PAYLOAD);
    });

    it("should rename a connector instance and return updated record", async () => {
      const { organizationId: orgId } = await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);
      const def = createConnectorDefinition();
      await (db as ReturnType<typeof drizzle>).insert(connectorDefinitions).values(def as never);
      const instance = createConnectorInstance(def.id, orgId, { name: "Old Name" });
      await (db as ReturnType<typeof drizzle>).insert(connectorInstances).values(instance as never);

      const res = await request(app)
        .patch(`/api/connector-instances/${instance.id}`)
        .set("Authorization", "Bearer test-token")
        .send({ name: "New Name" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.connectorInstance.name).toBe("New Name");
      expect(res.body.payload.connectorInstance.id).toBe(instance.id);
      expect(res.body.payload.connectorInstance.updatedBy).toBeDefined();
    });

    it("should update enabledCapabilityFlags", async () => {
      const { organizationId: orgId } = await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);
      const def = createConnectorDefinition({ capabilityFlags: { sync: true, query: true, write: true } });
      await (db as ReturnType<typeof drizzle>).insert(connectorDefinitions).values(def as never);
      const instance = createConnectorInstance(def.id, orgId);
      await (db as ReturnType<typeof drizzle>).insert(connectorInstances).values(instance as never);

      const res = await request(app)
        .patch(`/api/connector-instances/${instance.id}`)
        .set("Authorization", "Bearer test-token")
        .send({ name: "Test Instance", enabledCapabilityFlags: { read: true, write: true } });

      expect(res.status).toBe(200);
      expect(res.body.payload.connectorInstance.enabledCapabilityFlags).toEqual({ read: true, write: true });
    });

    it("should reject write: true when definition does not support writes", async () => {
      const { organizationId: orgId } = await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);
      const def = createConnectorDefinition({ capabilityFlags: { sync: true, query: true, write: false } });
      await (db as ReturnType<typeof drizzle>).insert(connectorDefinitions).values(def as never);
      const instance = createConnectorInstance(def.id, orgId);
      await (db as ReturnType<typeof drizzle>).insert(connectorInstances).values(instance as never);

      const res = await request(app)
        .patch(`/api/connector-instances/${instance.id}`)
        .set("Authorization", "Bearer test-token")
        .send({ name: "Test Instance", enabledCapabilityFlags: { read: true, write: true } });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_INSTANCE_CAPABILITY_NOT_SUPPORTED);
    });

    it("should allow setting enabledCapabilityFlags to null", async () => {
      const { organizationId: orgId } = await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);
      const def = createConnectorDefinition();
      await (db as ReturnType<typeof drizzle>).insert(connectorDefinitions).values(def as never);
      const instance = createConnectorInstance(def.id, orgId, {
        enabledCapabilityFlags: { read: true, write: false },
      });
      await (db as ReturnType<typeof drizzle>).insert(connectorInstances).values(instance as never);

      const res = await request(app)
        .patch(`/api/connector-instances/${instance.id}`)
        .set("Authorization", "Bearer test-token")
        .send({ name: "Test Instance", enabledCapabilityFlags: null });

      expect(res.status).toBe(200);
      expect(res.body.payload.connectorInstance.enabledCapabilityFlags).toBeNull();
    });
  });

  // ── POST /api/connector-instances ───────────────────────────────

  describe("POST /api/connector-instances", () => {
    it("should return 400 for invalid payload", async () => {
      const res = await request(app)
        .post("/api/connector-instances")
        .set("Authorization", "Bearer test-token")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_INSTANCE_INVALID_PAYLOAD);
    });

    it("should return 400 when name is empty", async () => {
      const res = await request(app)
        .post("/api/connector-instances")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorDefinitionId: generateId(),
          organizationId: generateId(),
          name: "",
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_INSTANCE_INVALID_PAYLOAD);
    });

    it("should return 404 when connector definition does not exist", async () => {
      const user = createUser(AUTH0_ID);
      await (db as ReturnType<typeof drizzle>)
        .insert(schema.users)
        .values(user as never);

      const res = await request(app)
        .post("/api/connector-instances")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorDefinitionId: generateId(),
          organizationId: generateId(),
          name: "New Instance",
        });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_DEFINITION_NOT_FOUND);
    });

    it("should return 404 when user does not exist", async () => {
      const def = createConnectorDefinition();
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorDefinitions)
        .values(def as never);

      const res = await request(app)
        .post("/api/connector-instances")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorDefinitionId: def.id,
          organizationId: generateId(),
          name: "New Instance",
        });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_INSTANCE_USER_NOT_FOUND);
    });

    it("should create a connector instance successfully", async () => {
      const def = createConnectorDefinition();
      const user = createUser(AUTH0_ID);
      const orgId = generateId();

      await (db as ReturnType<typeof drizzle>)
        .insert(connectorDefinitions)
        .values(def as never);
      await (db as ReturnType<typeof drizzle>)
        .insert(schema.users)
        .values(user as never);

      const res = await request(app)
        .post("/api/connector-instances")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorDefinitionId: def.id,
          organizationId: orgId,
          name: "My New Instance",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      const created = res.body.payload.connectorInstance;
      expect(created.name).toBe("My New Instance");
      expect(created.connectorDefinitionId).toBe(def.id);
      expect(created.organizationId).toBe(orgId);
      expect(created.status).toBe("pending");
      expect(created.config).toBeNull();
      expect(created.credentials).toBeNull();
    });

    it("should create an instance with config and credentials", async () => {
      const def = createConnectorDefinition();
      const user = createUser(AUTH0_ID);
      const orgId = generateId();

      await (db as ReturnType<typeof drizzle>)
        .insert(connectorDefinitions)
        .values(def as never);
      await (db as ReturnType<typeof drizzle>)
        .insert(schema.users)
        .values(user as never);

      const res = await request(app)
        .post("/api/connector-instances")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorDefinitionId: def.id,
          organizationId: orgId,
          name: "Configured Instance",
          config: { endpoint: "https://api.example.com" },
          credentials: { apiKey: "secret-key-123" },
        });

      expect(res.status).toBe(201);
      const created = res.body.payload.connectorInstance;
      expect(created.config).toEqual({ endpoint: "https://api.example.com" });
      // Credentials should be returned decrypted through the API
      expect(created.credentials).toEqual({ apiKey: "secret-key-123" });
    });

    it("created instance should be retrievable via GET", async () => {
      const def = createConnectorDefinition();
      const user = createUser(AUTH0_ID);
      const orgId = generateId();

      await (db as ReturnType<typeof drizzle>)
        .insert(connectorDefinitions)
        .values(def as never);
      await (db as ReturnType<typeof drizzle>)
        .insert(schema.users)
        .values(user as never);

      const createRes = await request(app)
        .post("/api/connector-instances")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorDefinitionId: def.id,
          organizationId: orgId,
          name: "Retrievable Instance",
        });

      const id = createRes.body.payload.connectorInstance.id;

      const getRes = await request(app)
        .get(`/api/connector-instances/${id}`)
        .set("Authorization", "Bearer test-token");

      expect(getRes.status).toBe(200);
      expect(getRes.body.payload.connectorInstance.id).toBe(id);
      expect(getRes.body.payload.connectorInstance.name).toBe(
        "Retrievable Instance"
      );
    });
  });
});
