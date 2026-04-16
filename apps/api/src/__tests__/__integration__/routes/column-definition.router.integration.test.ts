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
import { and, eq } from "drizzle-orm";
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
  connectorDefinitions,
  connectorInstances,
  connectorEntities,
  columnDefinitions,
  fieldMappings,
  entityRecords,
  organizations,
  jobs,
} = schema;

// ── Helpers ────────────────────────────────────────────────────────

const now = Date.now();

function createColumnDefinition(
  organizationId: string,
  overrides?: Partial<Record<string, unknown>>
) {
  return {
    id: generateId(),
    organizationId,
    key: `col_${generateId().replace(/-/g, "").slice(0, 8)}`,
    label: "Test Column",
    type: "string" as const,
    description: null,
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: null,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    ...overrides,
  };
}

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
    capabilityFlags: { sync: true, read: true, write: false },
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

function createFieldMap(
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
    sourceField: "source_field",
    isPrimaryKey: false,
    normalizedKey: "source_field",
    required: false,
    defaultValue: null,
    format: null,
    enumValues: null,
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
  overrides?: Partial<Record<string, unknown>>
) {
  return {
    id: generateId(),
    organizationId,
    connectorEntityId,
    data: { name: "Test" },
    normalizedData: { name: "test" },
    sourceId: `src_${generateId().replace(/-/g, "").slice(0, 8)}`,
    checksum: "abc123",
    syncedAt: now,
    validationErrors: null,
    isValid: true,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    ...overrides,
  };
}

/** Seed a full chain: org → connector def → instance → entity + column definition. */
async function seedFullChain(db: ReturnType<typeof drizzle>) {
  const { organizationId, userId } = await seedUserAndOrg(db, AUTH0_ID);

  const def = createConnectorDefinition();
  await db.insert(connectorDefinitions).values(def as never);

  const instance = createConnectorInstance(def.id, organizationId);
  await db.insert(connectorInstances).values(instance as never);

  const entity = createConnEntity(organizationId, instance.id);
  await db.insert(connectorEntities).values(entity as never);

  return {
    organizationId,
    userId,
    connectorDefinitionId: def.id,
    connectorInstanceId: instance.id,
    connectorEntityId: entity.id,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("Column Definition Router", () => {
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

  // ── GET /api/column-definitions ──────────────────────────────────

  describe("GET /api/column-definitions", () => {
    it("should return an empty list when no column definitions exist", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .get("/api/column-definitions")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.columnDefinitions).toEqual([]);
      expect(res.body.payload.total).toBe(0);
    });

    it("should return paginated column definitions", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      for (let i = 0; i < 3; i++) {
        await (db as ReturnType<typeof drizzle>)
          .insert(columnDefinitions)
          .values(
            createColumnDefinition(organizationId, {
              label: `Column ${i}`,
            }) as never
          );
      }

      const res = await request(app)
        .get("/api/column-definitions?limit=2&offset=0")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.columnDefinitions).toHaveLength(2);
      expect(res.body.payload.total).toBe(3);
      expect(res.body.payload.limit).toBe(2);
      expect(res.body.payload.offset).toBe(0);
    });

    it("should filter by type", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values([
          createColumnDefinition(organizationId, {
            label: "String Col",
            type: "string",
          }),
          createColumnDefinition(organizationId, {
            label: "Number Col",
            type: "number",
          }),
        ] as never);

      const res = await request(app)
        .get("/api/column-definitions?type=number")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.columnDefinitions).toHaveLength(1);
      expect(res.body.payload.columnDefinitions[0].label).toBe("Number Col");
    });

    it("should filter by multiple types (comma-separated)", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values([
          createColumnDefinition(organizationId, {
            label: "String Col",
            type: "string",
          }),
          createColumnDefinition(organizationId, {
            label: "Number Col",
            type: "number",
          }),
          createColumnDefinition(organizationId, {
            label: "Boolean Col",
            type: "boolean",
          }),
        ] as never);

      const res = await request(app)
        .get("/api/column-definitions?type=string,boolean")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.columnDefinitions).toHaveLength(2);
      const labels = res.body.payload.columnDefinitions.map(
        (cd: { label: string }) => cd.label
      );
      expect(labels).toContain("String Col");
      expect(labels).toContain("Boolean Col");
      expect(labels).not.toContain("Number Col");
    });

    it("should filter by search", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values([
          createColumnDefinition(organizationId, {
            label: "Email Address",
          }),
          createColumnDefinition(organizationId, {
            label: "Phone Number",
          }),
        ] as never);

      const res = await request(app)
        .get("/api/column-definitions?search=email")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.columnDefinitions).toHaveLength(1);
      expect(res.body.payload.columnDefinitions[0].label).toBe("Email Address");
    });

    it("should scope results to the requested organization", async () => {
      const { organizationId: orgA, userId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      // Create a second org owned by the same user (valid FK)
      const orgBId = generateId();
      await (db as ReturnType<typeof drizzle>)
        .insert(organizations)
        .values({
          id: orgBId,
          name: "Org B",
          timezone: "UTC",
          ownerUserId: userId,
          created: now,
          createdBy: "SYSTEM_TEST",
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        } as never);

      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values([
          createColumnDefinition(orgA, { label: "Org A Col" }),
          createColumnDefinition(orgBId, { label: "Org B Col" }),
        ] as never);

      const res = await request(app)
        .get("/api/column-definitions")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.columnDefinitions).toHaveLength(1);
      expect(res.body.payload.columnDefinitions[0].label).toBe("Org A Col");
    });

    it("should filter by system=true (system rows only)", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values([
          createColumnDefinition(organizationId, { label: "Seeded", system: true }),
          createColumnDefinition(organizationId, { label: "Custom", system: false }),
        ] as never);

      const res = await request(app)
        .get("/api/column-definitions?system=true")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.columnDefinitions).toHaveLength(1);
      expect(res.body.payload.columnDefinitions[0].label).toBe("Seeded");
    });

    it("should filter by system=false (custom rows only, excludes seeded)", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values([
          createColumnDefinition(organizationId, { label: "Seeded", system: true }),
          createColumnDefinition(organizationId, { label: "Custom", system: false }),
        ] as never);

      const res = await request(app)
        .get("/api/column-definitions?system=false")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.columnDefinitions).toHaveLength(1);
      expect(res.body.payload.columnDefinitions[0].label).toBe("Custom");
    });
  });

  // ── GET /api/column-definitions/:id ──────────────────────────────

  describe("GET /api/column-definitions/:id", () => {
    it("should return 404 when column definition does not exist", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .get(`/api/column-definitions/${generateId()}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe(ApiCode.COLUMN_DEFINITION_NOT_FOUND);
    });

    it("should return a column definition by id", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const colDef = createColumnDefinition(organizationId, { label: "My Column" });
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values(colDef as never);

      const res = await request(app)
        .get(`/api/column-definitions/${colDef.id}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.columnDefinition.id).toBe(colDef.id);
      expect(res.body.payload.columnDefinition.label).toBe("My Column");
    });

    it("should not return soft-deleted column definitions", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const colDef = createColumnDefinition(organizationId, {
        deleted: now,
        deletedBy: "SYSTEM_TEST",
      });
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values(colDef as never);

      const res = await request(app)
        .get(`/api/column-definitions/${colDef.id}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
    });
  });

  // ── POST /api/column-definitions ─────────────────────────────────

  describe("POST /api/column-definitions", () => {
    it("should return 400 for invalid payload", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .post("/api/column-definitions")
        .set("Authorization", "Bearer test-token")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe(ApiCode.COLUMN_DEFINITION_INVALID_PAYLOAD);
    });

    it("should return 400 for invalid key format", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .post("/api/column-definitions")
        .set("Authorization", "Bearer test-token")
        .send({
          key: "Invalid Key",
          label: "Test",
          type: "string",
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.COLUMN_DEFINITION_INVALID_PAYLOAD);
    });

    it("should create a column definition successfully", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const res = await request(app)
        .post("/api/column-definitions")
        .set("Authorization", "Bearer test-token")
        .send({
          key: "email",
          label: "Email Address",
          type: "string",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      const created = res.body.payload.columnDefinition;
      expect(created.key).toBe("email");
      expect(created.label).toBe("Email Address");
      expect(created.type).toBe("string");
      expect(created.organizationId).toBe(organizationId);
    });

    it("created column definition should be retrievable via GET", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const createRes = await request(app)
        .post("/api/column-definitions")
        .set("Authorization", "Bearer test-token")
        .send({
          key: "name",
          label: "Name",
          type: "string",
        });

      const id = createRes.body.payload.columnDefinition.id;

      const getRes = await request(app)
        .get(`/api/column-definitions/${id}`)
        .set("Authorization", "Bearer test-token");

      expect(getRes.status).toBe(200);
      expect(getRes.body.payload.columnDefinition.id).toBe(id);
      expect(getRes.body.payload.columnDefinition.key).toBe("name");
    });

    it("should ignore a client-supplied system:true and persist system:false", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .post("/api/column-definitions")
        .set("Authorization", "Bearer test-token")
        .send({
          key: "foo_bar",
          label: "Foo Bar",
          type: "string",
          system: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.payload.columnDefinition.system).toBe(false);
    });
  });

  // ── PATCH /api/column-definitions/:id ────────────────────────────

  describe("PATCH /api/column-definitions/:id", () => {
    it("should return 404 when column definition does not exist", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .patch(`/api/column-definitions/${generateId()}`)
        .set("Authorization", "Bearer test-token")
        .send({ label: "Updated" });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.COLUMN_DEFINITION_NOT_FOUND);
    });

    it("should update a column definition", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const colDef = createColumnDefinition(organizationId, {
        label: "Original",
      });
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values(colDef as never);

      const res = await request(app)
        .patch(`/api/column-definitions/${colDef.id}`)
        .set("Authorization", "Bearer test-token")
        .send({ label: "Updated Label" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.columnDefinition.label).toBe("Updated Label");
    });

    // 1.T6: PATCH with `key` in body returns 422 COLUMN_DEFINITION_KEY_IMMUTABLE
    it("should return 422 when attempting to change key (Rule 2)", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const colDef = createColumnDefinition(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values(colDef as never);

      const res = await request(app)
        .patch(`/api/column-definitions/${colDef.id}`)
        .set("Authorization", "Bearer test-token")
        .send({ key: "new_key", label: "Updated" });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe(ApiCode.COLUMN_DEFINITION_KEY_IMMUTABLE);
    });

    // 1.T7: PATCH with allowed type transition succeeds (string -> enum)
    it("should allow valid type transition (string -> enum)", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const colDef = createColumnDefinition(organizationId, { type: "string" });
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values(colDef as never);

      const res = await request(app)
        .patch(`/api/column-definitions/${colDef.id}`)
        .set("Authorization", "Bearer test-token")
        .send({ type: "enum" });

      expect(res.status).toBe(200);
      expect(res.body.payload.columnDefinition.type).toBe("enum");
    });

    // 1.T8: PATCH with blocked type transition returns 422 (string -> boolean)
    it("should block invalid type transition (string -> boolean)", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const colDef = createColumnDefinition(organizationId, { type: "string" });
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values(colDef as never);

      const res = await request(app)
        .patch(`/api/column-definitions/${colDef.id}`)
        .set("Authorization", "Bearer test-token")
        .send({ type: "boolean" });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe(ApiCode.COLUMN_DEFINITION_TYPE_CHANGE_BLOCKED);
    });

    // 1.T9: PATCH with transition to/from reference returns 422
    it("should block type transition to reference (blocked type)", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const colDef = createColumnDefinition(organizationId, { type: "string" });
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values(colDef as never);

      const res = await request(app)
        .patch(`/api/column-definitions/${colDef.id}`)
        .set("Authorization", "Bearer test-token")
        .send({ type: "reference" });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe(ApiCode.COLUMN_DEFINITION_TYPE_CHANGE_BLOCKED);
    });

    it("should block type transition from reference (blocked type)", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const colDef = createColumnDefinition(organizationId, { type: "reference" });
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values(colDef as never);

      const res = await request(app)
        .patch(`/api/column-definitions/${colDef.id}`)
        .set("Authorization", "Bearer test-token")
        .send({ type: "string" });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe(ApiCode.COLUMN_DEFINITION_TYPE_CHANGE_BLOCKED);
    });

    // 1.T10: PATCH updating description returns 200
    it("should update description successfully", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const colDef = createColumnDefinition(organizationId, {
        type: "string",
      });
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values(colDef as never);

      const res = await request(app)
        .patch(`/api/column-definitions/${colDef.id}`)
        .set("Authorization", "Bearer test-token")
        .send({ description: "Updated description" });

      expect(res.status).toBe(200);
      expect(res.body.payload.columnDefinition.description).toBe("Updated description");
    });

    it("should return 422 COLUMN_DEFINITION_SYSTEM_READONLY for a system row", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const colDef = createColumnDefinition(organizationId, {
        label: "Email",
        key: "email",
        system: true,
      });
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values(colDef as never);

      const res = await request(app)
        .patch(`/api/column-definitions/${colDef.id}`)
        .set("Authorization", "Bearer test-token")
        .send({ label: "Electronic Mail" });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe(ApiCode.COLUMN_DEFINITION_SYSTEM_READONLY);
    });
  });

  // ── DELETE /api/column-definitions/:id ───────────────────────────

  describe("DELETE /api/column-definitions/:id", () => {
    it("should return 404 when column definition does not exist", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .delete(`/api/column-definitions/${generateId()}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.COLUMN_DEFINITION_NOT_FOUND);
    });

    // 1.T5: DELETE returns 404 for already-deleted column
    it("should return 404 for already soft-deleted column definition", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const colDef = createColumnDefinition(organizationId, {
        deleted: now,
        deletedBy: "SYSTEM_TEST",
      });
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values(colDef as never);

      const res = await request(app)
        .delete(`/api/column-definitions/${colDef.id}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.COLUMN_DEFINITION_NOT_FOUND);
    });

    // 1.T3: DELETE succeeds when no field mappings reference it
    it("should soft-delete a column definition when no dependencies exist", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const colDef = createColumnDefinition(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values(colDef as never);

      const deleteRes = await request(app)
        .delete(`/api/column-definitions/${colDef.id}`)
        .set("Authorization", "Bearer test-token");

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.payload.id).toBe(colDef.id);

      // Should not be retrievable after deletion
      const getRes = await request(app)
        .get(`/api/column-definitions/${colDef.id}`)
        .set("Authorization", "Bearer test-token");

      expect(getRes.status).toBe(404);
    });

    // 1.T1: DELETE returns 422 when field mappings reference it via columnDefinitionId
    it("should return 422 when field mappings reference it via columnDefinitionId (Rule 1)", async () => {
      const { organizationId, connectorEntityId } = await seedFullChain(
        db as ReturnType<typeof drizzle>
      );

      const colDef = createColumnDefinition(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values(colDef as never);

      const fm = createFieldMap(organizationId, connectorEntityId, colDef.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(fieldMappings)
        .values(fm as never);

      const res = await request(app)
        .delete(`/api/column-definitions/${colDef.id}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(422);
      expect(res.body.code).toBe(ApiCode.COLUMN_DEFINITION_HAS_DEPENDENCIES);
      expect(res.body.details.fieldMappings).toContain(fm.id);
    });

    it("should return 422 COLUMN_DEFINITION_SYSTEM_READONLY for a system row", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const colDef = createColumnDefinition(organizationId, {
        label: "Email",
        key: "email",
        system: true,
      });
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values(colDef as never);

      const res = await request(app)
        .delete(`/api/column-definitions/${colDef.id}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(422);
      expect(res.body.code).toBe(ApiCode.COLUMN_DEFINITION_SYSTEM_READONLY);
    });

  });

  // ── GET /api/column-definitions/:id/impact ──────────────────────

  describe("GET /api/column-definitions/:id/impact", () => {
    // 1.T13: GET /impact returns 404 for non-existent column
    it("should return 404 for non-existent column definition", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .get(`/api/column-definitions/${generateId()}/impact`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.COLUMN_DEFINITION_NOT_FOUND);
    });

    // 1.T12: GET /impact returns correct counts
    it("should return correct impact counts", async () => {
      const { organizationId, connectorEntityId } = await seedFullChain(
        db as ReturnType<typeof drizzle>
      );

      const colDef = createColumnDefinition(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values(colDef as never);

      // Create field mapping referencing colDef via columnDefinitionId
      const fm1 = createFieldMap(organizationId, connectorEntityId, colDef.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(fieldMappings)
        .values(fm1 as never);

      // Create entity records in the entity that uses this column definition
      for (let i = 0; i < 3; i++) {
        await (db as ReturnType<typeof drizzle>)
          .insert(entityRecords)
          .values(createEntityRecord(organizationId, connectorEntityId) as never);
      }

      const res = await request(app)
        .get(`/api/column-definitions/${colDef.id}/impact`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.fieldMappings).toBe(1);
      expect(res.body.payload.entityRecords).toBe(3);
    });

    it("should return zero counts when no dependencies exist", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const colDef = createColumnDefinition(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values(colDef as never);

      const res = await request(app)
        .get(`/api/column-definitions/${colDef.id}/impact`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.fieldMappings).toBe(0);
      expect(res.body.payload.entityRecords).toBe(0);
    });
  });

  // ── Phase 4: Field ownership & revalidation triggers ────────────

  describe("Phase 4 — Field ownership validation", () => {
    describe("POST /api/column-definitions", () => {
      it("should reject request body containing removed fields (required, defaultValue, format, enumValues)", async () => {
        await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

        // Zod strict parsing strips unknown keys, so these are just ignored.
        // But the important check is that these fields do NOT appear on the created resource.
        const res = await request(app)
          .post("/api/column-definitions")
          .set("Authorization", "Bearer test-token")
          .send({
            key: "test_removed_fields",
            label: "Test",
            type: "string",
            required: true,
            defaultValue: "foo",
            format: "uppercase",
            enumValues: ["a", "b"],
          });

        expect(res.status).toBe(201);
        const created = res.body.payload.columnDefinition;
        expect(created).not.toHaveProperty("required");
        expect(created).not.toHaveProperty("defaultValue");
        expect(created).not.toHaveProperty("format");
        expect(created).not.toHaveProperty("enumValues");
      });

      it("should accept and persist validationPattern, validationMessage, canonicalFormat", async () => {
        await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

        const res = await request(app)
          .post("/api/column-definitions")
          .set("Authorization", "Bearer test-token")
          .send({
            key: "email_field",
            label: "Email",
            type: "string",
            validationPattern: "^[^@]+@[^@]+\\.[^@]+$",
            validationMessage: "Must be a valid email",
            canonicalFormat: "lowercase",
          });

        expect(res.status).toBe(201);
        const created = res.body.payload.columnDefinition;
        expect(created.validationPattern).toBe("^[^@]+@[^@]+\\.[^@]+$");
        expect(created.validationMessage).toBe("Must be a valid email");
        expect(created.canonicalFormat).toBe("lowercase");
      });

      it("should reject an invalid validationPattern regex on POST", async () => {
        await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

        const res = await request(app)
          .post("/api/column-definitions")
          .set("Authorization", "Bearer test-token")
          .send({
            key: "bad_pattern",
            label: "Bad Pattern",
            type: "string",
            validationPattern: "[invalid(",
          });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe(ApiCode.COLUMN_DEFINITION_INVALID_VALIDATION_PATTERN);
      });

      it("should reject type 'currency'", async () => {
        await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

        const res = await request(app)
          .post("/api/column-definitions")
          .set("Authorization", "Bearer test-token")
          .send({
            key: "price",
            label: "Price",
            type: "currency",
          });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe(ApiCode.COLUMN_DEFINITION_INVALID_PAYLOAD);
      });
    });

    describe("PATCH /api/column-definitions/:id", () => {
      it("should ignore removed fields in request body (required, defaultValue, format, enumValues)", async () => {
        const { organizationId } = await seedUserAndOrg(
          db as ReturnType<typeof drizzle>,
          AUTH0_ID
        );

        const colDef = createColumnDefinition(organizationId);
        await (db as ReturnType<typeof drizzle>)
          .insert(columnDefinitions)
          .values(colDef as never);

        const res = await request(app)
          .patch(`/api/column-definitions/${colDef.id}`)
          .set("Authorization", "Bearer test-token")
          .send({
            label: "Updated",
            required: true,
            defaultValue: "foo",
            format: "uppercase",
            enumValues: ["a"],
          });

        expect(res.status).toBe(200);
        const updated = res.body.payload.columnDefinition;
        expect(updated.label).toBe("Updated");
        expect(updated).not.toHaveProperty("required");
        expect(updated).not.toHaveProperty("defaultValue");
        expect(updated).not.toHaveProperty("format");
        expect(updated).not.toHaveProperty("enumValues");
      });

      it("should reject an invalid validationPattern regex on PATCH", async () => {
        const { organizationId } = await seedUserAndOrg(
          db as ReturnType<typeof drizzle>,
          AUTH0_ID
        );

        const colDef = createColumnDefinition(organizationId);
        await (db as ReturnType<typeof drizzle>)
          .insert(columnDefinitions)
          .values(colDef as never);

        const res = await request(app)
          .patch(`/api/column-definitions/${colDef.id}`)
          .set("Authorization", "Bearer test-token")
          .send({ validationPattern: "(unclosed" });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe(ApiCode.COLUMN_DEFINITION_INVALID_VALIDATION_PATTERN);
      });

      it("should accept and persist validationPattern, validationMessage, canonicalFormat", async () => {
        const { organizationId } = await seedUserAndOrg(
          db as ReturnType<typeof drizzle>,
          AUTH0_ID
        );

        const colDef = createColumnDefinition(organizationId);
        await (db as ReturnType<typeof drizzle>)
          .insert(columnDefinitions)
          .values(colDef as never);

        const res = await request(app)
          .patch(`/api/column-definitions/${colDef.id}`)
          .set("Authorization", "Bearer test-token")
          .send({
            validationPattern: "^\\d{3}-\\d{4}$",
            validationMessage: "Must be XXX-XXXX format",
            canonicalFormat: "phone",
          });

        expect(res.status).toBe(200);
        const updated = res.body.payload.columnDefinition;
        expect(updated.validationPattern).toBe("^\\d{3}-\\d{4}$");
        expect(updated.validationMessage).toBe("Must be XXX-XXXX format");
        expect(updated.canonicalFormat).toBe("phone");
      });
    });

    describe("GET /api/column-definitions", () => {
      it("should include new fields and exclude removed fields in response", async () => {
        const { organizationId } = await seedUserAndOrg(
          db as ReturnType<typeof drizzle>,
          AUTH0_ID
        );

        const colDef = createColumnDefinition(organizationId, {
          validationPattern: "^\\w+$",
          validationMessage: "Alphanumeric only",
          canonicalFormat: "lowercase",
        });
        await (db as ReturnType<typeof drizzle>)
          .insert(columnDefinitions)
          .values(colDef as never);

        const res = await request(app)
          .get("/api/column-definitions")
          .set("Authorization", "Bearer test-token");

        expect(res.status).toBe(200);
        const returned = res.body.payload.columnDefinitions[0];
        // New fields present
        expect(returned.validationPattern).toBe("^\\w+$");
        expect(returned.validationMessage).toBe("Alphanumeric only");
        expect(returned.canonicalFormat).toBe("lowercase");
        // Old fields absent
        expect(returned).not.toHaveProperty("required");
        expect(returned).not.toHaveProperty("defaultValue");
        expect(returned).not.toHaveProperty("format");
        expect(returned).not.toHaveProperty("enumValues");
      });

      it("should not accept 'required' as a filter query parameter", async () => {
        const { organizationId } = await seedUserAndOrg(
          db as ReturnType<typeof drizzle>,
          AUTH0_ID
        );

        await (db as ReturnType<typeof drizzle>)
          .insert(columnDefinitions)
          .values([
            createColumnDefinition(organizationId, { label: "Col A" }),
            createColumnDefinition(organizationId, { label: "Col B" }),
          ] as never);

        // 'required' param should be ignored — all results returned
        const res = await request(app)
          .get("/api/column-definitions?required=true")
          .set("Authorization", "Bearer test-token");

        expect(res.status).toBe(200);
        expect(res.body.payload.columnDefinitions).toHaveLength(2);
      });
    });
  });

  describe("Phase 4 — Revalidation triggers on PATCH", () => {
    it("should trigger revalidation when validationPattern changes", async () => {
      const { organizationId, connectorEntityId } = await seedFullChain(
        db as ReturnType<typeof drizzle>
      );

      const colDef = createColumnDefinition(organizationId, {
        validationPattern: null,
      });
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values(colDef as never);

      // Create field mapping linking entity to this column def
      const fm = createFieldMap(organizationId, connectorEntityId, colDef.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(fieldMappings)
        .values(fm as never);

      const res = await request(app)
        .patch(`/api/column-definitions/${colDef.id}`)
        .set("Authorization", "Bearer test-token")
        .send({ validationPattern: "^[A-Z]+$" });

      expect(res.status).toBe(200);

      // Verify a revalidation job was created
      const jobRows = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.type, "revalidation"),
            eq(jobs.organizationId, organizationId)
          )
        );

      expect(jobRows.length).toBeGreaterThanOrEqual(1);
      const revalJob = jobRows.find(
        (j) => (j.metadata as Record<string, unknown>).connectorEntityId === connectorEntityId
      );
      expect(revalJob).toBeDefined();
    });

    it("should trigger revalidation when canonicalFormat changes", async () => {
      const { organizationId, connectorEntityId } = await seedFullChain(
        db as ReturnType<typeof drizzle>
      );

      const colDef = createColumnDefinition(organizationId, {
        canonicalFormat: null,
      });
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values(colDef as never);

      const fm = createFieldMap(organizationId, connectorEntityId, colDef.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(fieldMappings)
        .values(fm as never);

      const res = await request(app)
        .patch(`/api/column-definitions/${colDef.id}`)
        .set("Authorization", "Bearer test-token")
        .send({ canonicalFormat: "YYYY-MM-DD" });

      expect(res.status).toBe(200);

      const jobRows = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.type, "revalidation"),
            eq(jobs.organizationId, organizationId)
          )
        );

      expect(jobRows.length).toBeGreaterThanOrEqual(1);
      const revalJob = jobRows.find(
        (j) => (j.metadata as Record<string, unknown>).connectorEntityId === connectorEntityId
      );
      expect(revalJob).toBeDefined();
    });

    it("should NOT trigger revalidation when only validationMessage changes", async () => {
      const { organizationId, connectorEntityId } = await seedFullChain(
        db as ReturnType<typeof drizzle>
      );

      const colDef = createColumnDefinition(organizationId, {
        validationMessage: "Old message",
      });
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values(colDef as never);

      const fm = createFieldMap(organizationId, connectorEntityId, colDef.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(fieldMappings)
        .values(fm as never);

      const res = await request(app)
        .patch(`/api/column-definitions/${colDef.id}`)
        .set("Authorization", "Bearer test-token")
        .send({ validationMessage: "New message" });

      expect(res.status).toBe(200);

      // No revalidation job should have been created
      const jobRows = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.type, "revalidation"),
            eq(jobs.organizationId, organizationId)
          )
        );

      expect(jobRows).toHaveLength(0);
    });
  });
});
