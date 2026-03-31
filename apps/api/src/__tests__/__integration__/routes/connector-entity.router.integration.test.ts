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

const { connectorDefinitions, connectorInstances, connectorEntities, fieldMappings, columnDefinitions } = schema;

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
      const { connectorInstanceId } = await seedConnectorInstance(
        db as ReturnType<typeof drizzle>,
        organizationId
      );

      const entity = createConnEntity(organizationId, connectorInstanceId);
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
