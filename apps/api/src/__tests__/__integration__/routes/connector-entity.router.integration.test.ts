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
import { eq } from "drizzle-orm";
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

const { connectorDefinitions, connectorInstances, connectorEntities, fieldMappings, columnDefinitions, entityRecords, entityTagAssignments, entityTags, entityGroups, entityGroupMembers } = schema;

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

function createConnEntity(
  organizationId: string,
  connectorInstanceId: string,
  overrides?: Partial<Record<string, unknown>>
) {
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

/** Seed a connector definition + instance and return their IDs. */
async function seedConnectorInstance(
  db: ReturnType<typeof drizzle>,
  organizationId: string
) {
  const def = createConnectorDefinition();
  await db.insert(connectorDefinitions).values(def as never);
  const instance = createConnectorInstance(def.id, organizationId);
  await db.insert(connectorInstances).values(instance as never);
  return { connectorDefinitionId: def.id, connectorInstanceId: instance.id };
}

function createColumnDefinition(
  organizationId: string,
  overrides?: Partial<Record<string, unknown>>
) {
  return {
    id: generateId(),
    organizationId,
    key: `col_${generateId().replace(/-/g, "").slice(0, 8)}`,
    label: "Test Column",
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
    sourceField: `source_${generateId().replace(/-/g, "").slice(0, 8)}`,
    isPrimaryKey: false,
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

describe("Connector Entity Router", () => {
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

  // ── GET /api/connector-entities ──────────────────────────────────

  describe("GET /api/connector-entities", () => {
    it("should return an empty list when no entities exist", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const { connectorInstanceId } = await seedConnectorInstance(
        db as ReturnType<typeof drizzle>,
        organizationId
      );

      const res = await request(app)
        .get(
          `/api/connector-entities?connectorInstanceIds=${connectorInstanceId}`
        )
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.connectorEntities).toEqual([]);
      expect(res.body.payload.total).toBe(0);
    });

    it("should return paginated connector entities", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const { connectorInstanceId } = await seedConnectorInstance(
        db as ReturnType<typeof drizzle>,
        organizationId
      );

      for (let i = 0; i < 3; i++) {
        await (db as ReturnType<typeof drizzle>)
          .insert(connectorEntities)
          .values(
            createConnEntity(organizationId, connectorInstanceId, {
              label: `Entity ${i}`,
            }) as never
          );
      }

      const res = await request(app)
        .get(
          `/api/connector-entities?connectorInstanceIds=${connectorInstanceId}&limit=2&offset=0`
        )
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.connectorEntities).toHaveLength(2);
      expect(res.body.payload.total).toBe(3);
    });

    it("should scope results to the requested connector instance", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const { connectorInstanceId: instA } = await seedConnectorInstance(
        db as ReturnType<typeof drizzle>,
        organizationId
      );
      const { connectorInstanceId: instB } = await seedConnectorInstance(
        db as ReturnType<typeof drizzle>,
        organizationId
      );

      await (db as ReturnType<typeof drizzle>)
        .insert(connectorEntities)
        .values([
          createConnEntity(organizationId, instA, { label: "Instance A Entity" }),
          createConnEntity(organizationId, instB, { label: "Instance B Entity" }),
        ] as never);

      const res = await request(app)
        .get(`/api/connector-entities?connectorInstanceIds=${instA}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.connectorEntities).toHaveLength(1);
      expect(res.body.payload.connectorEntities[0].label).toBe(
        "Instance A Entity"
      );
    });

    it("should return nested fieldMappings with columnDefinition when include=fieldMappings", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const { connectorInstanceId } = await seedConnectorInstance(
        db as ReturnType<typeof drizzle>,
        organizationId
      );

      const entity = createConnEntity(organizationId, connectorInstanceId, {
        label: "Entity With Mappings",
      });
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorEntities)
        .values(entity as never);

      const colDef = createColumnDefinition(organizationId, {
        label: "First Name",
        key: `col_${generateId().replace(/-/g, "").slice(0, 8)}`,
      });
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values(colDef as never);

      const mapping = createFieldMapping(
        organizationId,
        entity.id,
        colDef.id,
        { sourceField: "first_name" }
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(fieldMappings)
        .values(mapping as never);

      const res = await request(app)
        .get(
          `/api/connector-entities?connectorInstanceIds=${connectorInstanceId}&include=fieldMappings`
        )
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.connectorEntities).toHaveLength(1);

      const returnedEntity = res.body.payload.connectorEntities[0];
      expect(returnedEntity.fieldMappings).toBeDefined();
      expect(returnedEntity.fieldMappings).toHaveLength(1);
      expect(returnedEntity.fieldMappings[0].sourceField).toBe("first_name");
      expect(returnedEntity.fieldMappings[0].columnDefinition).toBeDefined();
      expect(returnedEntity.fieldMappings[0].columnDefinition.id).toBe(colDef.id);
      expect(returnedEntity.fieldMappings[0].columnDefinition.label).toBe("First Name");
    });

    it("should return flat data without fieldMappings key when include is not set", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const { connectorInstanceId } = await seedConnectorInstance(
        db as ReturnType<typeof drizzle>,
        organizationId
      );

      const entity = createConnEntity(organizationId, connectorInstanceId, {
        label: "Flat Entity",
      });
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorEntities)
        .values(entity as never);

      const colDef = createColumnDefinition(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values(colDef as never);

      const mapping = createFieldMapping(organizationId, entity.id, colDef.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(fieldMappings)
        .values(mapping as never);

      const res = await request(app)
        .get(
          `/api/connector-entities?connectorInstanceIds=${connectorInstanceId}`
        )
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.connectorEntities).toHaveLength(1);
      expect(res.body.payload.connectorEntities[0]).not.toHaveProperty(
        "fieldMappings"
      );
    });

    it("should filter entities by search matching label", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const { connectorInstanceId } = await seedConnectorInstance(
        db as ReturnType<typeof drizzle>,
        organizationId
      );

      await (db as ReturnType<typeof drizzle>)
        .insert(connectorEntities)
        .values([
          createConnEntity(organizationId, connectorInstanceId, {
            key: "contacts",
            label: "Contacts",
          }),
          createConnEntity(organizationId, connectorInstanceId, {
            key: "deals",
            label: "Deals",
          }),
          createConnEntity(organizationId, connectorInstanceId, {
            key: "accounts",
            label: "Accounts",
          }),
        ] as never);

      const res = await request(app)
        .get(
          `/api/connector-entities?connectorInstanceIds=${connectorInstanceId}&search=deal`
        )
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.connectorEntities).toHaveLength(1);
      expect(res.body.payload.connectorEntities[0].label).toBe("Deals");
      expect(res.body.payload.total).toBe(1);
    });

    it("should filter entities by search matching key", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const { connectorInstanceId } = await seedConnectorInstance(
        db as ReturnType<typeof drizzle>,
        organizationId
      );

      await (db as ReturnType<typeof drizzle>)
        .insert(connectorEntities)
        .values([
          createConnEntity(organizationId, connectorInstanceId, {
            key: "contacts",
            label: "People",
          }),
          createConnEntity(organizationId, connectorInstanceId, {
            key: "deals",
            label: "Opportunities",
          }),
        ] as never);

      const res = await request(app)
        .get(
          `/api/connector-entities?connectorInstanceIds=${connectorInstanceId}&search=contacts`
        )
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.connectorEntities).toHaveLength(1);
      expect(res.body.payload.connectorEntities[0].key).toBe("contacts");
      expect(res.body.payload.total).toBe(1);
    });

    it("should be case-insensitive when filtering by search", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const { connectorInstanceId } = await seedConnectorInstance(
        db as ReturnType<typeof drizzle>,
        organizationId
      );

      await (db as ReturnType<typeof drizzle>)
        .insert(connectorEntities)
        .values(
          createConnEntity(organizationId, connectorInstanceId, {
            key: "contacts",
            label: "Contacts",
          }) as never
        );

      const res = await request(app)
        .get(
          `/api/connector-entities?connectorInstanceIds=${connectorInstanceId}&search=CONTACTS`
        )
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.connectorEntities).toHaveLength(1);
      expect(res.body.payload.total).toBe(1);
    });

    it("should return no results when search does not match any entity", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const { connectorInstanceId } = await seedConnectorInstance(
        db as ReturnType<typeof drizzle>,
        organizationId
      );

      await (db as ReturnType<typeof drizzle>)
        .insert(connectorEntities)
        .values(
          createConnEntity(organizationId, connectorInstanceId, {
            key: "contacts",
            label: "Contacts",
          }) as never
        );

      const res = await request(app)
        .get(
          `/api/connector-entities?connectorInstanceIds=${connectorInstanceId}&search=zzzznotfound`
        )
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.connectorEntities).toHaveLength(0);
      expect(res.body.payload.total).toBe(0);
    });

    it("should exclude soft-deleted field mappings from include=fieldMappings", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const { connectorInstanceId } = await seedConnectorInstance(
        db as ReturnType<typeof drizzle>,
        organizationId
      );

      const entity = createConnEntity(organizationId, connectorInstanceId, {
        label: "Entity With Deleted Mapping",
      });
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorEntities)
        .values(entity as never);

      const colDefA = createColumnDefinition(organizationId, { label: "Active Col" });
      const colDefB = createColumnDefinition(organizationId, { label: "Deleted Col" });
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values([colDefA, colDefB] as never);

      const activeMapping = createFieldMapping(
        organizationId,
        entity.id,
        colDefA.id,
        { sourceField: "active_field" }
      );
      const deletedMapping = createFieldMapping(
        organizationId,
        entity.id,
        colDefB.id,
        {
          sourceField: "deleted_field",
          deleted: now,
          deletedBy: "SYSTEM_TEST",
        }
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(fieldMappings)
        .values([activeMapping, deletedMapping] as never);

      const res = await request(app)
        .get(
          `/api/connector-entities?connectorInstanceIds=${connectorInstanceId}&include=fieldMappings`
        )
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.connectorEntities).toHaveLength(1);

      const returnedEntity = res.body.payload.connectorEntities[0];
      expect(returnedEntity.fieldMappings).toHaveLength(1);
      expect(returnedEntity.fieldMappings[0].sourceField).toBe("active_field");
    });
  });

  // ── GET /api/connector-entities/:id ──────────────────────────────

  describe("GET /api/connector-entities/:id", () => {
    it("should return 404 when entity does not exist", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .get(`/api/connector-entities/${generateId()}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_ENTITY_NOT_FOUND);
    });

    it("should return a connector entity by id", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const { connectorInstanceId } = await seedConnectorInstance(
        db as ReturnType<typeof drizzle>,
        organizationId
      );

      const entity = createConnEntity(organizationId, connectorInstanceId, {
        label: "My Entity",
      });
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorEntities)
        .values(entity as never);

      const res = await request(app)
        .get(`/api/connector-entities/${entity.id}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.connectorEntity.id).toBe(entity.id);
      expect(res.body.payload.connectorEntity.label).toBe("My Entity");
    });

    it("should not return soft-deleted entities", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const { connectorInstanceId } = await seedConnectorInstance(
        db as ReturnType<typeof drizzle>,
        organizationId
      );

      const entity = createConnEntity(organizationId, connectorInstanceId, {
        deleted: now,
        deletedBy: "SYSTEM_TEST",
      });
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorEntities)
        .values(entity as never);

      const res = await request(app)
        .get(`/api/connector-entities/${entity.id}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
    });
  });

  // ── POST /api/connector-entities ─────────────────────────────────

  describe("POST /api/connector-entities", () => {
    it("should return 400 for invalid payload", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .post("/api/connector-entities")
        .set("Authorization", "Bearer test-token")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_ENTITY_INVALID_PAYLOAD);
    });

    it("should return 400 for invalid key format", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .post("/api/connector-entities")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorInstanceId: generateId(),
          key: "Invalid Key",
          label: "Test",
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_ENTITY_INVALID_PAYLOAD);
    });

    it("should return 404 when connector instance does not exist", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .post("/api/connector-entities")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorInstanceId: generateId(),
          key: "accounts",
          label: "Accounts",
        });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_INSTANCE_NOT_FOUND);
    });

    it("should create a connector entity successfully", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const { connectorInstanceId } = await seedConnectorInstance(
        db as ReturnType<typeof drizzle>,
        organizationId
      );

      const res = await request(app)
        .post("/api/connector-entities")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorInstanceId,
          key: "contacts",
          label: "Contacts",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      const created = res.body.payload.connectorEntity;
      expect(created.key).toBe("contacts");
      expect(created.label).toBe("Contacts");
      expect(created.connectorInstanceId).toBe(connectorInstanceId);
    });

    it("created entity should be retrievable via GET", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const { connectorInstanceId } = await seedConnectorInstance(
        db as ReturnType<typeof drizzle>,
        organizationId
      );

      const createRes = await request(app)
        .post("/api/connector-entities")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorInstanceId,
          key: "deals",
          label: "Deals",
        });

      const id = createRes.body.payload.connectorEntity.id;

      const getRes = await request(app)
        .get(`/api/connector-entities/${id}`)
        .set("Authorization", "Bearer test-token");

      expect(getRes.status).toBe(200);
      expect(getRes.body.payload.connectorEntity.id).toBe(id);
      expect(getRes.body.payload.connectorEntity.key).toBe("deals");
    });
  });

  // ── DELETE /api/connector-entities/:id ───────────────────────────

  describe("DELETE /api/connector-entities/:id", () => {
    it("should return 404 when entity does not exist", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .delete(`/api/connector-entities/${generateId()}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_ENTITY_NOT_FOUND);
    });

    it("should soft-delete a connector entity", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      // Use a write-enabled definition so the delete guard passes
      const def = createConnectorDefinition({
        capabilityFlags: { sync: true, query: true, write: true },
      });
      await (db as ReturnType<typeof drizzle>).insert(connectorDefinitions).values(def as never);
      const inst = createConnectorInstance(def.id, organizationId);
      await (db as ReturnType<typeof drizzle>).insert(connectorInstances).values(inst as never);

      const entity = createConnEntity(organizationId, inst.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorEntities)
        .values(entity as never);

      const deleteRes = await request(app)
        .delete(`/api/connector-entities/${entity.id}`)
        .set("Authorization", "Bearer test-token");

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.payload.id).toBe(entity.id);

      // Should not be retrievable after deletion
      const getRes = await request(app)
        .get(`/api/connector-entities/${entity.id}`)
        .set("Authorization", "Bearer test-token");

      expect(getRes.status).toBe(404);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Phase 4: Entity Delete with Guards & Impact
// ═══════════════════════════════════════════════════════════════════

describe("Connector Entity Router — Delete with Guards & Impact", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });

    await teardownOrg(db);
  });

  afterEach(async () => {
    await connection.end();
  });

  /** Seed a chain with configurable capability flags and optionally related data. */
  async function seedWithCapabilities(opts: {
    definitionWrite: boolean;
    enabledCapabilityFlags?: { write?: boolean; read?: boolean } | null;
  }) {
    const { userId, organizationId } = await seedUserAndOrg(db, AUTH0_ID);

    const def = createConnectorDefinition({
      capabilityFlags: { sync: true, query: true, write: opts.definitionWrite },
    });
    await db.insert(connectorDefinitions).values(def as never);

    const inst = createConnectorInstance(def.id, organizationId, {
      enabledCapabilityFlags: opts.enabledCapabilityFlags ?? null,
    });
    await db.insert(connectorInstances).values(inst as never);

    const entity = createConnEntity(organizationId, inst.id);
    await db.insert(connectorEntities).values(entity as never);

    return { userId, organizationId, connectorInstanceId: inst.id, connectorDefinitionId: def.id, entity };
  }

  /** Seed related child data for an entity (records, mappings, tags, group members). */
  async function seedRelatedData(
    organizationId: string,
    entityId: string,
  ) {
    // Column definition + field mapping
    const colDef = createColumnDefinition(organizationId);
    await db.insert(columnDefinitions).values(colDef as never);

    const mapping = createFieldMapping(organizationId, entityId, colDef.id);
    await db.insert(fieldMappings).values(mapping as never);

    // Entity record
    const record = {
      id: generateId(),
      organizationId,
      connectorEntityId: entityId,
      data: { name: "Alice" },
      normalizedData: { name: "Alice" },
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
    await db.insert(entityRecords).values(record as never);

    // Entity tag + assignment
    const tag = {
      id: generateId(),
      organizationId,
      name: `tag-${generateId().slice(0, 8)}`,
      color: "#000000",
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    };
    await db.insert(entityTags).values(tag as never);

    const tagAssignment = {
      id: generateId(),
      organizationId,
      connectorEntityId: entityId,
      entityTagId: tag.id,
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    };
    await db.insert(entityTagAssignments).values(tagAssignment as never);

    // Entity group + member
    const group = {
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
    };
    await db.insert(entityGroups).values(group as never);

    const member = {
      id: generateId(),
      organizationId,
      entityGroupId: group.id,
      connectorEntityId: entityId,
      linkFieldMappingId: mapping.id,
      isPrimary: false,
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    };
    await db.insert(entityGroupMembers).values(member as never);

    return { colDef, mapping, record, tag, tagAssignment, group, member };
  }

  // ── DELETE /api/connector-entities/:id ──────────────────────────

  describe("DELETE /api/connector-entities/:id (with guards)", () => {
    it("should return 422 CONNECTOR_INSTANCE_WRITE_DISABLED when instance lacks write capability", async () => {
      const { entity } = await seedWithCapabilities({
        definitionWrite: true,
        enabledCapabilityFlags: { write: false },
      });

      const res = await request(app)
        .delete(`/api/connector-entities/${entity.id}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(422);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_INSTANCE_WRITE_DISABLED);
    });

    it("should return 422 ENTITY_HAS_EXTERNAL_REFERENCES when other entities reference it via refEntityKey", async () => {
      const { organizationId, connectorInstanceId, entity } = await seedWithCapabilities({
        definitionWrite: true,
        enabledCapabilityFlags: { write: true },
      });

      // Create another entity with a field mapping that references the first entity's key
      const otherEntity = createConnEntity(organizationId, connectorInstanceId);
      await db.insert(connectorEntities).values(otherEntity as never);

      const colDef = createColumnDefinition(organizationId, { type: "reference" });
      await db.insert(columnDefinitions).values(colDef as never);

      const refMapping = createFieldMapping(organizationId, otherEntity.id, colDef.id, {
        refEntityKey: entity.key,
      });
      await db.insert(fieldMappings).values(refMapping as never);

      const res = await request(app)
        .delete(`/api/connector-entities/${entity.id}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(422);
      expect(res.body.code).toBe(ApiCode.ENTITY_HAS_EXTERNAL_REFERENCES);
    });

    it("should succeed and cascade soft-delete to records, field mappings, tag assignments, and group members", async () => {
      const { organizationId, entity } = await seedWithCapabilities({
        definitionWrite: true,
        enabledCapabilityFlags: { write: true },
      });

      await seedRelatedData(organizationId, entity.id);

      const res = await request(app)
        .delete(`/api/connector-entities/${entity.id}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.id).toBe(entity.id);
      expect(res.body.payload.cascaded.entityRecords).toBe(1);
      expect(res.body.payload.cascaded.fieldMappings).toBe(1);
      expect(res.body.payload.cascaded.entityTagAssignments).toBe(1);
      expect(res.body.payload.cascaded.entityGroupMembers).toBe(1);
    });

    it("should set deleted timestamp on all cascaded child records", async () => {
      const { organizationId, entity } = await seedWithCapabilities({
        definitionWrite: true,
        enabledCapabilityFlags: { write: true },
      });

      const related = await seedRelatedData(organizationId, entity.id);

      await request(app)
        .delete(`/api/connector-entities/${entity.id}`)
        .set("Authorization", "Bearer test-token");

      // Query with includeDeleted to verify timestamps
      const [recordRows] = await db.select().from(entityRecords).where(
        eq(entityRecords.id, related.record.id)
      );
      expect(recordRows.deleted).not.toBeNull();

      const [mappingRows] = await db.select().from(fieldMappings).where(
        eq(fieldMappings.id, related.mapping.id)
      );
      expect(mappingRows.deleted).not.toBeNull();

      const [tagAssignmentRows] = await db.select().from(entityTagAssignments).where(
        eq(entityTagAssignments.id, related.tagAssignment.id)
      );
      expect(tagAssignmentRows.deleted).not.toBeNull();

      const [memberRows] = await db.select().from(entityGroupMembers).where(
        eq(entityGroupMembers.id, related.member.id)
      );
      expect(memberRows.deleted).not.toBeNull();
    });

    it("should return 404 for non-existent entity", async () => {
      await seedWithCapabilities({
        definitionWrite: true,
        enabledCapabilityFlags: { write: true },
      });

      const res = await request(app)
        .delete(`/api/connector-entities/${generateId()}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_ENTITY_NOT_FOUND);
    });

    it("deleted entity should no longer appear in GET list", async () => {
      const { connectorInstanceId, entity } = await seedWithCapabilities({
        definitionWrite: true,
        enabledCapabilityFlags: { write: true },
      });

      await request(app)
        .delete(`/api/connector-entities/${entity.id}`)
        .set("Authorization", "Bearer test-token");

      const listRes = await request(app)
        .get(`/api/connector-entities?connectorInstanceIds=${connectorInstanceId}`)
        .set("Authorization", "Bearer test-token");

      expect(listRes.status).toBe(200);
      expect(listRes.body.payload.connectorEntities).toHaveLength(0);
    });
  });

  // ── GET /api/connector-entities/:id/impact ─────────────────────

  describe("GET /api/connector-entities/:id/impact", () => {
    it("should return correct counts including refFieldMappings", async () => {
      const { organizationId, connectorInstanceId, entity } = await seedWithCapabilities({
        definitionWrite: true,
        enabledCapabilityFlags: { write: true },
      });

      await seedRelatedData(organizationId, entity.id);

      // Create an external reference from another entity
      const otherEntity = createConnEntity(organizationId, connectorInstanceId);
      await db.insert(connectorEntities).values(otherEntity as never);

      const refColDef = createColumnDefinition(organizationId, { type: "reference" });
      await db.insert(columnDefinitions).values(refColDef as never);

      await db.insert(fieldMappings).values(
        createFieldMapping(organizationId, otherEntity.id, refColDef.id, {
          refEntityKey: entity.key,
        }) as never
      );

      const res = await request(app)
        .get(`/api/connector-entities/${entity.id}/impact`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.entityRecords).toBe(1);
      expect(res.body.payload.fieldMappings).toBe(1);
      expect(res.body.payload.entityTagAssignments).toBe(1);
      expect(res.body.payload.entityGroupMembers).toBe(1);
      expect(res.body.payload.refFieldMappings).toBe(1);
    });

    it("should return 404 for non-existent entity", async () => {
      await seedWithCapabilities({
        definitionWrite: true,
        enabledCapabilityFlags: { write: true },
      });

      const res = await request(app)
        .get(`/api/connector-entities/${generateId()}/impact`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_ENTITY_NOT_FOUND);
    });
  });

  // ── PATCH /:id — Update connector entity ───────────────────────────

  describe("PATCH /api/connector-entities/:id", () => {
    it("should return 422 CONNECTOR_INSTANCE_WRITE_DISABLED when write is disabled", async () => {
      const { entity } = await seedWithCapabilities({
        definitionWrite: true,
        enabledCapabilityFlags: { write: false },
      });

      const res = await request(app)
        .patch(`/api/connector-entities/${entity.id}`)
        .set("Authorization", "Bearer test-token")
        .send({ label: "Updated Label" });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_INSTANCE_WRITE_DISABLED);
    });

    it("should update entity when write is enabled", async () => {
      const { entity } = await seedWithCapabilities({
        definitionWrite: true,
        enabledCapabilityFlags: { write: true },
      });

      const res = await request(app)
        .patch(`/api/connector-entities/${entity.id}`)
        .set("Authorization", "Bearer test-token")
        .send({ label: "Updated Label" });

      expect(res.status).toBe(200);
      expect(res.body.payload.connectorEntity.id).toBe(entity.id);
      expect(res.body.payload.connectorEntity.label).toBe("Updated Label");
    });

    it("should return 404 for non-existent entity", async () => {
      await seedWithCapabilities({
        definitionWrite: true,
        enabledCapabilityFlags: { write: true },
      });

      const res = await request(app)
        .patch(`/api/connector-entities/${generateId()}`)
        .set("Authorization", "Bearer test-token")
        .send({ label: "Updated Label" });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_ENTITY_NOT_FOUND);
    });
  });
});
