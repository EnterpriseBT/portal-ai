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
import { and, eq } from "drizzle-orm";
import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  generateId,
  seedUserAndOrg,
  teardownOrg,
  createUser,
  createOrganization,
  createOrganizationUser,
} from "../utils/application.util.js";

const AUTH0_ID = "auth0|ci-test-user";
const MEMBER_AUTH0_ID = "auth0|ci-test-member";
/** #685: the caller; tests flip it to the member. */
let currentSub = AUTH0_ID;

// Mock the auth middleware to populate req.auth with our test sub
jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { payload: { sub: currentSub } } as never;
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
  entityGroups,
  entityGroupMembers,
  jobs,
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
    capabilityFlags: { sync: true, read: true, write: true },
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
    enabledCapabilityFlags: { read: true, write: true },
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

function createColDef(
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

function createFieldMap(
  organizationId: string,
  connectorEntityId: string,
  columnDefinitionId: string,
  overrides?: Partial<Record<string, unknown>>
) {
  const uniqueSuffix = generateId().replace(/-/g, "").slice(0, 8);
  return {
    id: generateId(),
    organizationId,
    connectorEntityId,
    columnDefinitionId,
    sourceField: "source_field",
    isPrimaryKey: false,
    normalizedKey: `nk_${uniqueSuffix}`,
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

function createEntityGroupMember(
  organizationId: string,
  entityGroupId: string,
  connectorEntityId: string,
  linkFieldMappingId: string,
  overrides?: Partial<Record<string, unknown>>
) {
  return {
    id: generateId(),
    organizationId,
    entityGroupId,
    connectorEntityId,
    linkFieldMappingId,
    isPrimary: false,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    ...overrides,
  };
}

/** Seed a full chain: org → connector def → connector instance → connector entity + column definition. */
async function seedFullChain(db: ReturnType<typeof drizzle>) {
  const { organizationId, userId } = await seedUserAndOrg(db, AUTH0_ID);

  const def = createConnectorDefinition();
  await db.insert(connectorDefinitions).values(def as never);

  const instance = createConnectorInstance(def.id, organizationId);
  await db.insert(connectorInstances).values(instance as never);

  const entity = createConnEntity(organizationId, instance.id);
  await db.insert(connectorEntities).values(entity as never);

  const colDef = createColDef(organizationId);
  await db.insert(columnDefinitions).values(colDef as never);

  // Reconcile the wide table so downstream reads find `er__<id>`.
  const { wideTableReconcilerService } =
    await import("../../../services/wide-table-reconciler.service.js");
  await wideTableReconcilerService.ensureTable(
    entity.id,
    db as unknown as DbClient
  );

  return {
    organizationId,
    userId,
    connectorInstanceId: instance.id,
    connectorEntityId: entity.id,
    columnDefinitionId: colDef.id,
  };
}

/** Seed a chain with explicit capability flag control for write-guard tests. */
async function seedWithCapabilities(
  db: ReturnType<typeof drizzle>,
  opts: {
    definitionWrite: boolean;
    enabledCapabilityFlags?: { write?: boolean; read?: boolean } | null;
  }
) {
  const { organizationId, userId } = await seedUserAndOrg(db, AUTH0_ID);

  const def = createConnectorDefinition({
    capabilityFlags: { sync: true, read: true, write: opts.definitionWrite },
  });
  await db.insert(connectorDefinitions).values(def as never);

  const instance = createConnectorInstance(def.id, organizationId, {
    enabledCapabilityFlags: opts.enabledCapabilityFlags ?? null,
  });
  await db.insert(connectorInstances).values(instance as never);

  const entity = createConnEntity(organizationId, instance.id);
  await db.insert(connectorEntities).values(entity as never);

  const colDef = createColDef(organizationId);
  await db.insert(columnDefinitions).values(colDef as never);

  const { wideTableReconcilerService } =
    await import("../../../services/wide-table-reconciler.service.js");
  await wideTableReconcilerService.ensureTable(
    entity.id,
    db as unknown as DbClient
  );

  return {
    organizationId,
    userId,
    connectorInstanceId: instance.id,
    connectorEntityId: entity.id,
    columnDefinitionId: colDef.id,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("Field Mapping Router", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });

    await teardownOrg(db as ReturnType<typeof drizzle>);
    currentSub = AUTH0_ID;
  });

  afterEach(async () => {
    await connection.end();
  });

  // ── GET /api/field-mappings ──────────────────────────────────────

  describe("GET /api/field-mappings", () => {
    it("should return an empty list when no field mappings exist", async () => {
      const { connectorEntityId } = await seedFullChain(
        db as ReturnType<typeof drizzle>
      );

      const res = await request(app)
        .get(`/api/field-mappings?connectorEntityId=${connectorEntityId}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.fieldMappings).toEqual([]);
      expect(res.body.payload.total).toBe(0);
    });

    it("should return paginated field mappings", async () => {
      const { connectorEntityId, columnDefinitionId, organizationId } =
        await seedFullChain(db as ReturnType<typeof drizzle>);

      // Create additional column definitions for multiple field mappings
      const colDef2 = createColDef(organizationId);
      const colDef3 = createColDef(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values([colDef2, colDef3] as never);

      await (db as ReturnType<typeof drizzle>).insert(fieldMappings).values([
        createFieldMap(organizationId, connectorEntityId, columnDefinitionId, {
          sourceField: "field_a",
        }),
        createFieldMap(organizationId, connectorEntityId, colDef2.id, {
          sourceField: "field_b",
        }),
        createFieldMap(organizationId, connectorEntityId, colDef3.id, {
          sourceField: "field_c",
        }),
      ] as never);

      const res = await request(app)
        .get(
          `/api/field-mappings?connectorEntityId=${connectorEntityId}&limit=2&offset=0`
        )
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.fieldMappings).toHaveLength(2);
      expect(res.body.payload.total).toBe(3);
    });

    it("should filter by columnDefinitionId", async () => {
      const { connectorEntityId, columnDefinitionId, organizationId } =
        await seedFullChain(db as ReturnType<typeof drizzle>);

      const colDef2 = createColDef(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values(colDef2 as never);

      await (db as ReturnType<typeof drizzle>).insert(fieldMappings).values([
        createFieldMap(organizationId, connectorEntityId, columnDefinitionId, {
          sourceField: "mapped_a",
        }),
        createFieldMap(organizationId, connectorEntityId, colDef2.id, {
          sourceField: "mapped_b",
        }),
      ] as never);

      const res = await request(app)
        .get(
          `/api/field-mappings?connectorEntityId=${connectorEntityId}&columnDefinitionId=${columnDefinitionId}`
        )
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.fieldMappings).toHaveLength(1);
      expect(res.body.payload.fieldMappings[0].sourceField).toBe("mapped_a");
    });

    it("should scope results to the requested connector entity", async () => {
      const {
        connectorEntityId,
        columnDefinitionId,
        connectorInstanceId,
        organizationId,
      } = await seedFullChain(db as ReturnType<typeof drizzle>);

      // Create a second entity
      const entity2 = createConnEntity(organizationId, connectorInstanceId);
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorEntities)
        .values(entity2 as never);

      await (db as ReturnType<typeof drizzle>).insert(fieldMappings).values([
        createFieldMap(organizationId, connectorEntityId, columnDefinitionId, {
          sourceField: "entity1_field",
        }),
        createFieldMap(organizationId, entity2.id, columnDefinitionId, {
          sourceField: "entity2_field",
        }),
      ] as never);

      const res = await request(app)
        .get(`/api/field-mappings?connectorEntityId=${connectorEntityId}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.fieldMappings).toHaveLength(1);
      expect(res.body.payload.fieldMappings[0].sourceField).toBe(
        "entity1_field"
      );
    });
  });

  // ── GET /api/field-mappings/:id ──────────────────────────────────

  describe("GET /api/field-mappings/:id", () => {
    it("should return 404 when field mapping does not exist", async () => {
      await seedFullChain(db as ReturnType<typeof drizzle>);

      const res = await request(app)
        .get(`/api/field-mappings/${generateId()}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe(ApiCode.FIELD_MAPPING_NOT_FOUND);
    });

    // #687: a DB error used to come back as the raw Drizzle message, the SQL
    // text and its bound params. A NUL byte in the id is enough to trigger one.
    it("answers a DB failure with a generic 500 that carries no SQL", async () => {
      await seedFullChain(db as ReturnType<typeof drizzle>);

      const res = await request(app)
        .get("/api/field-mappings/%00")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(500);
      expect(res.body.message).toBe("Internal server error");
      expect(res.body.code).toBeDefined();
      expect(JSON.stringify(res.body)).not.toMatch(
        /failed query|select|params/i
      );
    });

    it("should return a field mapping by id", async () => {
      const { connectorEntityId, columnDefinitionId, organizationId } =
        await seedFullChain(db as ReturnType<typeof drizzle>);

      const mapping = createFieldMap(
        organizationId,
        connectorEntityId,
        columnDefinitionId,
        {
          sourceField: "my_source",
        }
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(fieldMappings)
        .values(mapping as never);

      const res = await request(app)
        .get(`/api/field-mappings/${mapping.id}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.fieldMapping.id).toBe(mapping.id);
      expect(res.body.payload.fieldMapping.sourceField).toBe("my_source");
    });

    it("should not return soft-deleted field mappings", async () => {
      const { connectorEntityId, columnDefinitionId, organizationId } =
        await seedFullChain(db as ReturnType<typeof drizzle>);

      const mapping = createFieldMap(
        organizationId,
        connectorEntityId,
        columnDefinitionId,
        {
          deleted: now,
          deletedBy: "SYSTEM_TEST",
        }
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(fieldMappings)
        .values(mapping as never);

      const res = await request(app)
        .get(`/api/field-mappings/${mapping.id}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
    });
  });

  // ── POST /api/field-mappings ─────────────────────────────────────

  describe("POST /api/field-mappings", () => {
    it("should return 400 for invalid payload", async () => {
      await seedFullChain(db as ReturnType<typeof drizzle>);

      const res = await request(app)
        .post("/api/field-mappings")
        .set("Authorization", "Bearer test-token")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe(ApiCode.FIELD_MAPPING_INVALID_PAYLOAD);
    });

    it("should return 404 when connector entity does not exist", async () => {
      const { columnDefinitionId } = await seedFullChain(
        db as ReturnType<typeof drizzle>
      );

      const res = await request(app)
        .post("/api/field-mappings")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorEntityId: generateId(),
          columnDefinitionId,
          sourceField: "some_field",
          normalizedKey: "some_field",
        });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_ENTITY_NOT_FOUND);
    });

    it("should return 404 when column definition does not exist", async () => {
      const { connectorEntityId } = await seedFullChain(
        db as ReturnType<typeof drizzle>
      );

      const res = await request(app)
        .post("/api/field-mappings")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorEntityId,
          columnDefinitionId: generateId(),
          sourceField: "some_field",
          normalizedKey: "some_field",
        });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.COLUMN_DEFINITION_NOT_FOUND);
    });

    it("should create a field mapping successfully", async () => {
      const { connectorEntityId, columnDefinitionId } = await seedFullChain(
        db as ReturnType<typeof drizzle>
      );

      const res = await request(app)
        .post("/api/field-mappings")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorEntityId,
          columnDefinitionId,
          sourceField: "account_name",
          normalizedKey: "account_name",
          isPrimaryKey: false,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      const created = res.body.payload.fieldMapping;
      expect(created.sourceField).toBe("account_name");
      expect(created.normalizedKey).toBe("account_name");
      expect(created.isPrimaryKey).toBe(false);
      expect(created.connectorEntityId).toBe(connectorEntityId);
      expect(created.columnDefinitionId).toBe(columnDefinitionId);
    });

    it("should return 409 when a field mapping already exists for the same entity and column definition", async () => {
      const { connectorEntityId, columnDefinitionId, organizationId } =
        await seedFullChain(db as ReturnType<typeof drizzle>);

      // Seed an existing field mapping
      const existing = createFieldMap(
        organizationId,
        connectorEntityId,
        columnDefinitionId,
        {
          sourceField: "existing_field",
        }
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(fieldMappings)
        .values(existing as never);

      // Attempt to create a duplicate
      const res = await request(app)
        .post("/api/field-mappings")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorEntityId,
          columnDefinitionId,
          sourceField: "duplicate_field",
          normalizedKey: "duplicate_field",
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe(ApiCode.FIELD_MAPPING_DUPLICATE_COLUMN);
    });

    it("should allow creating a field mapping for the same column definition on a different entity", async () => {
      const {
        connectorEntityId,
        columnDefinitionId,
        connectorInstanceId,
        organizationId,
      } = await seedFullChain(db as ReturnType<typeof drizzle>);

      // Seed an existing field mapping on entity 1
      const existing = createFieldMap(
        organizationId,
        connectorEntityId,
        columnDefinitionId,
        {
          sourceField: "entity1_field",
        }
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(fieldMappings)
        .values(existing as never);

      // Create a second entity
      const entity2 = createConnEntity(organizationId, connectorInstanceId);
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorEntities)
        .values(entity2 as never);

      // Create on entity 2 with the same column definition — should succeed
      const res = await request(app)
        .post("/api/field-mappings")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorEntityId: entity2.id,
          columnDefinitionId,
          sourceField: "entity2_field",
          normalizedKey: "entity2_field",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.fieldMapping.connectorEntityId).toBe(entity2.id);
    });

    it("created field mapping should be retrievable via GET", async () => {
      const { connectorEntityId, columnDefinitionId } = await seedFullChain(
        db as ReturnType<typeof drizzle>
      );

      const createRes = await request(app)
        .post("/api/field-mappings")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorEntityId,
          columnDefinitionId,
          sourceField: "email_addr",
          normalizedKey: "email_addr",
        });

      const id = createRes.body.payload.fieldMapping.id;

      const getRes = await request(app)
        .get(`/api/field-mappings/${id}`)
        .set("Authorization", "Bearer test-token");

      expect(getRes.status).toBe(200);
      expect(getRes.body.payload.fieldMapping.id).toBe(id);
      expect(getRes.body.payload.fieldMapping.sourceField).toBe("email_addr");
    });
  });

  // ── PATCH /api/field-mappings/:id ────────────────────────────────

  describe("PATCH /api/field-mappings/:id", () => {
    it("should return 404 when field mapping does not exist", async () => {
      const { columnDefinitionId } = await seedFullChain(
        db as ReturnType<typeof drizzle>
      );

      const res = await request(app)
        .patch(`/api/field-mappings/${generateId()}`)
        .set("Authorization", "Bearer test-token")
        .send({ sourceField: "updated", columnDefinitionId });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.FIELD_MAPPING_NOT_FOUND);
    });

    it("should update a field mapping", async () => {
      const { connectorEntityId, columnDefinitionId, organizationId } =
        await seedFullChain(db as ReturnType<typeof drizzle>);

      const mapping = createFieldMap(
        organizationId,
        connectorEntityId,
        columnDefinitionId,
        {
          sourceField: "original",
        }
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(fieldMappings)
        .values(mapping as never);

      const res = await request(app)
        .patch(`/api/field-mappings/${mapping.id}`)
        .set("Authorization", "Bearer test-token")
        .send({
          sourceField: "updated_field",
          columnDefinitionId,
          isPrimaryKey: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.fieldMapping.sourceField).toBe("updated_field");
      expect(res.body.payload.fieldMapping.isPrimaryKey).toBe(true);
    });
  });

  // ── Wide-table reconciler trigger wiring ─────────────────────────

  describe("wide-table reconciler trigger wiring", () => {
    async function infoSchemaCols(
      db: ReturnType<typeof drizzle>,
      tableName: string
    ): Promise<Set<string>> {
      const result = await db.execute<{ column_name: string }>(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        `SELECT column_name FROM information_schema.columns WHERE table_name = '${tableName}'` as any
      );
      return new Set(
        (result as unknown as { column_name: string }[]).map(
          (r) => r.column_name
        )
      );
    }

    // Case 26 — POST adds a wide-table column.
    it("POST /api/field-mappings adds a `c_<key>` column on the wide table", async () => {
      const { connectorEntityId, columnDefinitionId } = await seedFullChain(
        db as ReturnType<typeof drizzle>
      );

      const res = await request(app)
        .post("/api/field-mappings")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorEntityId,
          columnDefinitionId,
          sourceField: "Account Name",
          normalizedKey: "account_name",
          isPrimaryKey: false,
        });

      expect(res.status).toBe(201);

      const cols = await infoSchemaCols(
        db as ReturnType<typeof drizzle>,
        `er__${connectorEntityId}`
      );
      expect(cols.has("c_account_name")).toBe(true);

      const meta = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(schema.wideTableColumns)
        .where(
          eq(schema.wideTableColumns.connectorEntityId, connectorEntityId)
        );
      expect(meta).toHaveLength(1);
      expect(meta[0]!.columnName).toBe("c_account_name");
    });

    // Case 27 — non-schema-changing PATCH does not emit DDL.
    it("non-schema-changing PATCH does not add or change wide-table columns", async () => {
      const { connectorEntityId, columnDefinitionId } = await seedFullChain(
        db as ReturnType<typeof drizzle>
      );

      const createRes = await request(app)
        .post("/api/field-mappings")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorEntityId,
          columnDefinitionId,
          sourceField: "src",
          normalizedKey: "value",
          isPrimaryKey: false,
        });
      const fmId = createRes.body.payload.fieldMapping.id as string;

      const colsBefore = await infoSchemaCols(
        db as ReturnType<typeof drizzle>,
        `er__${connectorEntityId}`
      );

      // Patch with same shape; only `defaultValue` changes — does not
      // affect the wide-table shape.
      const patchRes = await request(app)
        .patch(`/api/field-mappings/${fmId}`)
        .set("Authorization", "Bearer test-token")
        .send({
          sourceField: "src",
          columnDefinitionId,
          defaultValue: "fallback",
        });
      expect(patchRes.status).toBe(200);

      const colsAfter = await infoSchemaCols(
        db as ReturnType<typeof drizzle>,
        `er__${connectorEntityId}`
      );
      expect(colsAfter).toEqual(colsBefore);
    });

    // Case 28 — DELETE retires the wide-table column.
    it("DELETE retires the wide-table column (Postgres column stays on disk)", async () => {
      const { connectorEntityId, columnDefinitionId } = await seedFullChain(
        db as ReturnType<typeof drizzle>
      );

      const createRes = await request(app)
        .post("/api/field-mappings")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorEntityId,
          columnDefinitionId,
          sourceField: "src",
          normalizedKey: "to_retire",
          isPrimaryKey: false,
        });
      const fmId = createRes.body.payload.fieldMapping.id as string;

      const delRes = await request(app)
        .delete(`/api/field-mappings/${fmId}`)
        .set("Authorization", "Bearer test-token");
      expect(delRes.status).toBe(200);

      // Postgres column still on disk.
      const cols = await infoSchemaCols(
        db as ReturnType<typeof drizzle>,
        `er__${connectorEntityId}`
      );
      expect(cols.has("c_to_retire")).toBe(true);

      // Metadata row marked retired.
      const meta = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(schema.wideTableColumns)
        .where(
          and(
            eq(schema.wideTableColumns.connectorEntityId, connectorEntityId),
            eq(schema.wideTableColumns.fieldMappingId, fmId)
          )
        );
      expect(meta).toHaveLength(1);
      expect(meta[0]!.retiredAt).not.toBeNull();
    });

    // Case 29 — type-changing PATCH returns 422.
    it("PATCH that swaps to a different-typed column-definition returns 422", async () => {
      const { connectorEntityId, columnDefinitionId, organizationId } =
        await seedFullChain(db as ReturnType<typeof drizzle>);

      // First column definition is a string by default; create a number one.
      const numericColDef = createColDef(organizationId, {
        type: "number",
        key: "amount",
      });
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values(numericColDef as never);

      // Create the field-mapping pointing at the original (string) col def.
      const createRes = await request(app)
        .post("/api/field-mappings")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorEntityId,
          columnDefinitionId,
          sourceField: "src",
          normalizedKey: "value",
          isPrimaryKey: false,
        });
      const fmId = createRes.body.payload.fieldMapping.id as string;

      // Swap to the numeric col def — type changes from text → numeric.
      const patchRes = await request(app)
        .patch(`/api/field-mappings/${fmId}`)
        .set("Authorization", "Bearer test-token")
        .send({
          sourceField: "src",
          columnDefinitionId: numericColDef.id,
        });

      expect(patchRes.status).toBe(422);
      expect(patchRes.body.code).toBe(
        ApiCode.WIDE_TABLE_TYPE_CHANGE_UNSUPPORTED
      );
    });
  });

  // ── POST — refNormalizedKey ────────────────────────────────────────

  describe("POST /api/field-mappings — refNormalizedKey", () => {
    it("persists refNormalizedKey and refEntityKey for a reference-array column", async () => {
      const { connectorEntityId, organizationId } = await seedFullChain(
        db as ReturnType<typeof drizzle>
      );

      const refArrayColDef = createColDef(organizationId, {
        type: "reference-array",
      });
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values(refArrayColDef as never);

      const res = await request(app)
        .post("/api/field-mappings")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorEntityId,
          columnDefinitionId: refArrayColDef.id,
          sourceField: "friend_ids",
          normalizedKey: "friend_ids",
          refNormalizedKey: "contact_id",
          refEntityKey: "contacts",
        });

      expect(res.status).toBe(201);
      expect(res.body.payload.fieldMapping.refNormalizedKey).toBe("contact_id");
      expect(res.body.payload.fieldMapping.refEntityKey).toBe("contacts");
    });
  });

  // ── PATCH — refNormalizedKey ────────────────────────────────────────

  describe("PATCH /api/field-mappings/:id — refNormalizedKey", () => {
    it("can set refNormalizedKey and refEntityKey", async () => {
      const { connectorEntityId, columnDefinitionId, organizationId } =
        await seedFullChain(db as ReturnType<typeof drizzle>);

      const mappingA = createFieldMap(
        organizationId,
        connectorEntityId,
        columnDefinitionId,
        {
          sourceField: "field_a",
        }
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(fieldMappings)
        .values(mappingA as never);

      const res = await request(app)
        .patch(`/api/field-mappings/${mappingA.id}`)
        .set("Authorization", "Bearer test-token")
        .send({
          sourceField: "field_a",
          columnDefinitionId,
          refNormalizedKey: "user_id",
          refEntityKey: "users",
        });

      expect(res.status).toBe(200);
      expect(res.body.payload.fieldMapping.refNormalizedKey).toBe("user_id");
      expect(res.body.payload.fieldMapping.refEntityKey).toBe("users");
    });

    it("can clear refNormalizedKey back to null", async () => {
      const { connectorEntityId, columnDefinitionId, organizationId } =
        await seedFullChain(db as ReturnType<typeof drizzle>);

      const mappingA = createFieldMap(
        organizationId,
        connectorEntityId,
        columnDefinitionId,
        {
          sourceField: "field_a",
          refNormalizedKey: "user_id",
          refEntityKey: "users",
        }
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(fieldMappings)
        .values(mappingA as never);

      const res = await request(app)
        .patch(`/api/field-mappings/${mappingA.id}`)
        .set("Authorization", "Bearer test-token")
        .send({
          sourceField: "field_a",
          columnDefinitionId,
          refNormalizedKey: null,
          refEntityKey: null,
        });

      expect(res.status).toBe(200);
      expect(res.body.payload.fieldMapping.refNormalizedKey).toBeNull();
    });
  });

  // ── DELETE /api/field-mappings/:id ───────────────────────────────

  describe("DELETE /api/field-mappings/:id", () => {
    it("should return 404 when field mapping does not exist", async () => {
      await seedFullChain(db as ReturnType<typeof drizzle>);

      const res = await request(app)
        .delete(`/api/field-mappings/${generateId()}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.FIELD_MAPPING_NOT_FOUND);
    });

    it("should soft-delete a field mapping and cascade to entity group members", async () => {
      const { connectorEntityId, columnDefinitionId, organizationId } =
        await seedFullChain(db as ReturnType<typeof drizzle>);

      const mapping = createFieldMap(
        organizationId,
        connectorEntityId,
        columnDefinitionId
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(fieldMappings)
        .values(mapping as never);

      // Create a group with a member that uses this field mapping as linkFieldMappingId
      const group = createEntityGroup(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(entityGroups)
        .values(group as never);
      const member = createEntityGroupMember(
        organizationId,
        group.id,
        connectorEntityId,
        mapping.id
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(entityGroupMembers)
        .values(member as never);

      const deleteRes = await request(app)
        .delete(`/api/field-mappings/${mapping.id}`)
        .set("Authorization", "Bearer test-token");

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.payload.id).toBe(mapping.id);
      expect(deleteRes.body.payload.cascaded.entityGroupMembers).toBe(1);

      // Field mapping should not be retrievable
      const getRes = await request(app)
        .get(`/api/field-mappings/${mapping.id}`)
        .set("Authorization", "Bearer test-token");
      expect(getRes.status).toBe(404);

      // Entity group member should also be soft-deleted (not in list)
      const membersRes = await request(app)
        .get(`/api/entity-groups/${group.id}/members`)
        .set("Authorization", "Bearer test-token");
      expect(membersRes.body.payload.members).toHaveLength(0);
    });

    it("should return cascaded.entityGroupMembers: 0 when no dependent group members exist", async () => {
      const { connectorEntityId, columnDefinitionId, organizationId } =
        await seedFullChain(db as ReturnType<typeof drizzle>);

      const mapping = createFieldMap(
        organizationId,
        connectorEntityId,
        columnDefinitionId
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(fieldMappings)
        .values(mapping as never);

      const deleteRes = await request(app)
        .delete(`/api/field-mappings/${mapping.id}`)
        .set("Authorization", "Bearer test-token");

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.payload.id).toBe(mapping.id);
      expect(deleteRes.body.payload.cascaded.entityGroupMembers).toBe(0);
    });

    it("deleted field mapping should no longer appear in GET /api/field-mappings list", async () => {
      const { connectorEntityId, columnDefinitionId, organizationId } =
        await seedFullChain(db as ReturnType<typeof drizzle>);

      const mapping = createFieldMap(
        organizationId,
        connectorEntityId,
        columnDefinitionId
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(fieldMappings)
        .values(mapping as never);

      // Verify it exists
      const listBefore = await request(app)
        .get(`/api/field-mappings?connectorEntityId=${connectorEntityId}`)
        .set("Authorization", "Bearer test-token");
      expect(listBefore.body.payload.total).toBe(1);

      // Delete
      await request(app)
        .delete(`/api/field-mappings/${mapping.id}`)
        .set("Authorization", "Bearer test-token");

      // Verify it's gone
      const listAfter = await request(app)
        .get(`/api/field-mappings?connectorEntityId=${connectorEntityId}`)
        .set("Authorization", "Bearer test-token");
      expect(listAfter.body.payload.total).toBe(0);
      expect(listAfter.body.payload.fieldMappings).toHaveLength(0);
    });
  });

  // ── GET /api/field-mappings/:id/impact ──────────────────────────────

  describe("GET /api/field-mappings/:id/impact", () => {
    it("should return correct entityGroupMembers count", async () => {
      const {
        connectorEntityId,
        columnDefinitionId,
        organizationId,
        connectorInstanceId,
      } = await seedFullChain(db as ReturnType<typeof drizzle>);

      const mapping = createFieldMap(
        organizationId,
        connectorEntityId,
        columnDefinitionId
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(fieldMappings)
        .values(mapping as never);

      // Create a group with two members using this field mapping
      const group = createEntityGroup(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(entityGroups)
        .values(group as never);

      // Need a second entity for the second member
      const entity2 = createConnEntity(organizationId, connectorInstanceId);
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorEntities)
        .values(entity2 as never);

      // Need a second field mapping for entity2 that maps to the same column def
      const mapping2 = createFieldMap(
        organizationId,
        entity2.id,
        columnDefinitionId,
        { sourceField: "other_field" }
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(fieldMappings)
        .values(mapping2 as never);

      const member1 = createEntityGroupMember(
        organizationId,
        group.id,
        connectorEntityId,
        mapping.id
      );
      const member2 = createEntityGroupMember(
        organizationId,
        group.id,
        entity2.id,
        mapping.id
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(entityGroupMembers)
        .values([member1, member2] as never);

      const res = await request(app)
        .get(`/api/field-mappings/${mapping.id}/impact`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.entityGroupMembers).toBe(2);
    });

    it("should return 404 for non-existent field mapping", async () => {
      await seedFullChain(db as ReturnType<typeof drizzle>);

      const res = await request(app)
        .get(`/api/field-mappings/${generateId()}/impact`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.FIELD_MAPPING_NOT_FOUND);
    });
  });

  // ── GET /api/field-mappings/:id/validate-bidirectional ───────────

  describe("GET /api/field-mappings/:id/validate-bidirectional", () => {
    it("returns 400 when the column type is not reference-array", async () => {
      const { connectorEntityId, columnDefinitionId, organizationId } =
        await seedFullChain(db as ReturnType<typeof drizzle>);

      // columnDefinitionId has type "string" by default
      const mapping = createFieldMap(
        organizationId,
        connectorEntityId,
        columnDefinitionId
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(fieldMappings)
        .values(mapping as never);

      const res = await request(app)
        .get(`/api/field-mappings/${mapping.id}/validate-bidirectional`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(
        ApiCode.FIELD_MAPPING_BIDIRECTIONAL_VALIDATION_FAILED
      );
    });

    it("returns isConsistent: null when ref fields are not set", async () => {
      const { connectorEntityId, organizationId } = await seedFullChain(
        db as ReturnType<typeof drizzle>
      );

      const refArrayColDef = createColDef(organizationId, {
        type: "reference-array",
      });
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values(refArrayColDef as never);

      const mapping = createFieldMap(
        organizationId,
        connectorEntityId,
        refArrayColDef.id
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(fieldMappings)
        .values(mapping as never);

      const res = await request(app)
        .get(`/api/field-mappings/${mapping.id}/validate-bidirectional`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.isConsistent).toBeNull();
      expect(res.body.payload.reason).toBe("no-back-reference-configured");
    });

    it("returns isConsistent: true when arrays are in agreement", async () => {
      const { connectorEntityId, connectorInstanceId, organizationId } =
        await seedFullChain(db as ReturnType<typeof drizzle>);

      const entityBKey = `ent_b_${generateId().replace(/-/g, "").slice(0, 8)}`;
      const entityB = createConnEntity(organizationId, connectorInstanceId, {
        key: entityBKey,
      });
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorEntities)
        .values(entityB as never);

      // Get entity A's key for ref fields
      const [entityA] = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(connectorEntities)
        .where(eq(connectorEntities.id, connectorEntityId));

      const colDefA = createColDef(organizationId, {
        type: "reference-array",
        key: `frd_a_${generateId().replace(/-/g, "").slice(0, 6)}`,
      });
      const colDefB = createColDef(organizationId, {
        type: "reference-array",
        key: `frd_b_${generateId().replace(/-/g, "").slice(0, 6)}`,
      });
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values([colDefA, colDefB] as never);

      const nkA = `friends_a_${generateId().replace(/-/g, "").slice(0, 6)}`;
      const nkB = `friends_b_${generateId().replace(/-/g, "").slice(0, 6)}`;

      const mappingA = createFieldMap(
        organizationId,
        connectorEntityId,
        colDefA.id,
        {
          sourceField: "friends_a",
          normalizedKey: nkA,
          refEntityKey: entityBKey,
          refNormalizedKey: nkB,
        }
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(fieldMappings)
        .values(mappingA as never);

      const mappingB = createFieldMap(organizationId, entityB.id, colDefB.id, {
        sourceField: "friends_b",
        normalizedKey: nkB,
        refEntityKey: entityA.key,
        refNormalizedKey: nkA,
      });
      await (db as ReturnType<typeof drizzle>)
        .insert(fieldMappings)
        .values(mappingB as never);

      // Reconcile both entities so the wide tables grow their c_<key>
      // columns before we seed rows.
      const { wideTableReconcilerService } =
        await import("../../../services/wide-table-reconciler.service.js");
      await wideTableReconcilerService.reconcileEntity(
        connectorEntityId,
        db as unknown as DbClient
      );
      await wideTableReconcilerService.reconcileEntity(
        entityB.id,
        db as unknown as DbClient
      );

      // Consistent: A["a1"] → ["b1"] and B["b1"] → ["a1"]
      const idA = generateId();
      const idB = generateId();
      await (db as ReturnType<typeof drizzle>)
        .insert(schema.entityRecords)
        .values([
          {
            id: idA,
            organizationId,
            connectorEntityId,
            sourceId: "a1",
            data: {},
            checksum: "ca",
            syncedAt: now,
            created: now,
            createdBy: "test",
            updated: null,
            updatedBy: null,
            deleted: null,
            deletedBy: null,
          },
          {
            id: idB,
            organizationId,
            connectorEntityId: entityB.id,
            sourceId: "b1",
            data: {},
            checksum: "cb",
            syncedAt: now,
            created: now,
            createdBy: "test",
            updated: null,
            updatedBy: null,
            deleted: null,
            deletedBy: null,
          },
        ] as never);

      // Seed the wide-table sides with the reference-array values.
      const { wideTableRepo } =
        await import("../../../db/repositories/wide-table.repository.js");
      const { wideTableStatementCache } =
        await import("../../../services/wide-table-statement.cache.js");
      const { projectToWideRow, buildMappingsForProjection } =
        await import("../../../services/wide-table-projection.util.js");
      const stmtA = await wideTableStatementCache.get(
        connectorEntityId,
        db as unknown as DbClient
      );
      const mappingsA = buildMappingsForProjection(stmtA.columns);
      await wideTableRepo.upsertMany(
        connectorEntityId,
        [
          projectToWideRow(
            {
              id: idA,
              organizationId,
              sourceId: "a1",
              syncedAt: now,
              isValid: true,
              normalizedData: { [nkA]: ["b1"] },
            },
            mappingsA
          ),
        ],
        db as unknown as DbClient
      );
      const stmtB = await wideTableStatementCache.get(
        entityB.id,
        db as unknown as DbClient
      );
      const mappingsB = buildMappingsForProjection(stmtB.columns);
      await wideTableRepo.upsertMany(
        entityB.id,
        [
          projectToWideRow(
            {
              id: idB,
              organizationId,
              sourceId: "b1",
              syncedAt: now,
              isValid: true,
              normalizedData: { [nkB]: ["a1"] },
            },
            mappingsB
          ),
        ],
        db as unknown as DbClient
      );

      const res = await request(app)
        .get(`/api/field-mappings/${mappingA.id}/validate-bidirectional`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.isConsistent).toBe(true);
      expect(res.body.payload.inconsistentRecordIds).toHaveLength(0);
      expect(res.body.payload.totalChecked).toBe(1);
    });

    it("returns isConsistent: false with inconsistentRecordIds when arrays diverge", async () => {
      const { connectorEntityId, connectorInstanceId, organizationId } =
        await seedFullChain(db as ReturnType<typeof drizzle>);

      const entityBKey = `ent_b2_${generateId().replace(/-/g, "").slice(0, 7)}`;
      const entityB = createConnEntity(organizationId, connectorInstanceId, {
        key: entityBKey,
      });
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorEntities)
        .values(entityB as never);

      const [entityA] = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(connectorEntities)
        .where(eq(connectorEntities.id, connectorEntityId));

      const colDefA = createColDef(organizationId, {
        type: "reference-array",
        key: `tg_a_${generateId().replace(/-/g, "").slice(0, 6)}`,
      });
      const colDefB = createColDef(organizationId, {
        type: "reference-array",
        key: `tg_b_${generateId().replace(/-/g, "").slice(0, 6)}`,
      });
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values([colDefA, colDefB] as never);

      const nkA = `tags_a_${generateId().replace(/-/g, "").slice(0, 6)}`;
      const nkB = `tags_b_${generateId().replace(/-/g, "").slice(0, 6)}`;

      const mappingA = createFieldMap(
        organizationId,
        connectorEntityId,
        colDefA.id,
        {
          sourceField: "tags_a",
          normalizedKey: nkA,
          refEntityKey: entityBKey,
          refNormalizedKey: nkB,
        }
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(fieldMappings)
        .values(mappingA as never);

      const mappingB = createFieldMap(organizationId, entityB.id, colDefB.id, {
        sourceField: "tags_b",
        normalizedKey: nkB,
        refEntityKey: entityA.key,
        refNormalizedKey: nkA,
      });
      await (db as ReturnType<typeof drizzle>)
        .insert(fieldMappings)
        .values(mappingB as never);

      // Reconcile both entities' wide tables before seeding rows.
      const { wideTableReconcilerService: recSvc2 } =
        await import("../../../services/wide-table-reconciler.service.js");
      await recSvc2.reconcileEntity(
        connectorEntityId,
        db as unknown as DbClient
      );
      await recSvc2.reconcileEntity(entityB.id, db as unknown as DbClient);

      // Inconsistent: A["a1"] → ["b1"] but B["b1"] → [] (missing back-ref)
      const recAId = generateId();
      const recBId = generateId();
      await (db as ReturnType<typeof drizzle>)
        .insert(schema.entityRecords)
        .values([
          {
            id: recAId,
            organizationId,
            connectorEntityId,
            sourceId: "a1",
            data: {},
            checksum: "ca",
            syncedAt: now,
            created: now,
            createdBy: "test",
            updated: null,
            updatedBy: null,
            deleted: null,
            deletedBy: null,
          },
          {
            id: recBId,
            organizationId,
            connectorEntityId: entityB.id,
            sourceId: "b1",
            data: {},
            checksum: "cb",
            syncedAt: now,
            created: now,
            createdBy: "test",
            updated: null,
            updatedBy: null,
            deleted: null,
            deletedBy: null,
          },
        ] as never);

      const { wideTableRepo: wtRepo2 } =
        await import("../../../db/repositories/wide-table.repository.js");
      const { wideTableStatementCache: cache2 } =
        await import("../../../services/wide-table-statement.cache.js");
      const {
        projectToWideRow: project2,
        buildMappingsForProjection: buildMap2,
      } = await import("../../../services/wide-table-projection.util.js");
      const stmtA2 = await cache2.get(
        connectorEntityId,
        db as unknown as DbClient
      );
      const mappingsA2 = buildMap2(stmtA2.columns);
      await wtRepo2.upsertMany(
        connectorEntityId,
        [
          project2(
            {
              id: recAId,
              organizationId,
              sourceId: "a1",
              syncedAt: now,
              isValid: true,
              normalizedData: { [nkA]: ["b1"] },
            },
            mappingsA2
          ),
        ],
        db as unknown as DbClient
      );
      const stmtB2 = await cache2.get(entityB.id, db as unknown as DbClient);
      const mappingsB2 = buildMap2(stmtB2.columns);
      await wtRepo2.upsertMany(
        entityB.id,
        [
          project2(
            {
              id: recBId,
              organizationId,
              sourceId: "b1",
              syncedAt: now,
              isValid: true,
              normalizedData: { [nkB]: [] },
            },
            mappingsB2
          ),
        ],
        db as unknown as DbClient
      );

      const res = await request(app)
        .get(`/api/field-mappings/${mappingA.id}/validate-bidirectional`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.isConsistent).toBe(false);
      expect(res.body.payload.inconsistentRecordIds).toContain(recAId);
      expect(res.body.payload.totalChecked).toBe(1);
    });
  });

  // ── Phase 4: New field acceptance & normalizedKey uniqueness ─────

  describe("Phase 4 — POST with new fields", () => {
    it("should accept and persist normalizedKey, required, defaultValue, format, enumValues", async () => {
      const { connectorEntityId, columnDefinitionId } = await seedFullChain(
        db as ReturnType<typeof drizzle>
      );

      const res = await request(app)
        .post("/api/field-mappings")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorEntityId,
          columnDefinitionId,
          sourceField: "status_code",
          normalizedKey: "status_code",
          required: true,
          defaultValue: "active",
          format: "uppercase",
          enumValues: ["ACTIVE", "INACTIVE"],
        });

      expect(res.status).toBe(201);
      const created = res.body.payload.fieldMapping;
      expect(created.normalizedKey).toBe("status_code");
      expect(created.required).toBe(true);
      expect(created.defaultValue).toBe("active");
      expect(created.format).toBe("uppercase");
      expect(created.enumValues).toEqual(["ACTIVE", "INACTIVE"]);
    });

    it("should reject when normalizedKey is missing", async () => {
      const { connectorEntityId, columnDefinitionId } = await seedFullChain(
        db as ReturnType<typeof drizzle>
      );

      const res = await request(app)
        .post("/api/field-mappings")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorEntityId,
          columnDefinitionId,
          sourceField: "no_nk",
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.FIELD_MAPPING_INVALID_PAYLOAD);
    });

    it("should reject duplicate normalizedKey within the same connectorEntityId", async () => {
      const { connectorEntityId, columnDefinitionId, organizationId } =
        await seedFullChain(db as ReturnType<typeof drizzle>);

      // Seed existing mapping with normalizedKey "email"
      const existing = createFieldMap(
        organizationId,
        connectorEntityId,
        columnDefinitionId,
        {
          normalizedKey: "email",
        }
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(fieldMappings)
        .values(existing as never);

      // Create a second column definition
      const colDef2 = createColDef(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values(colDef2 as never);

      const res = await request(app)
        .post("/api/field-mappings")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorEntityId,
          columnDefinitionId: colDef2.id,
          sourceField: "email_addr",
          normalizedKey: "email",
        });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe(
        ApiCode.FIELD_MAPPING_DUPLICATE_NORMALIZED_KEY
      );
    });

    it("should allow same normalizedKey across different entities", async () => {
      const {
        connectorEntityId,
        columnDefinitionId,
        connectorInstanceId,
        organizationId,
      } = await seedFullChain(db as ReturnType<typeof drizzle>);

      // Create mapping on entity 1
      await request(app)
        .post("/api/field-mappings")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorEntityId,
          columnDefinitionId,
          sourceField: "email",
          normalizedKey: "email",
        });

      // Create a second entity
      const entity2 = createConnEntity(organizationId, connectorInstanceId);
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorEntities)
        .values(entity2 as never);

      // Same normalizedKey on different entity — should succeed
      const res = await request(app)
        .post("/api/field-mappings")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorEntityId: entity2.id,
          columnDefinitionId,
          sourceField: "email",
          normalizedKey: "email",
        });

      expect(res.status).toBe(201);
    });
  });

  describe("Phase 4 — PATCH with new fields", () => {
    it("should accept and persist normalizedKey, required, defaultValue, format, enumValues", async () => {
      const { connectorEntityId, columnDefinitionId, organizationId } =
        await seedFullChain(db as ReturnType<typeof drizzle>);

      const mapping = createFieldMap(
        organizationId,
        connectorEntityId,
        columnDefinitionId
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(fieldMappings)
        .values(mapping as never);

      const res = await request(app)
        .patch(`/api/field-mappings/${mapping.id}`)
        .set("Authorization", "Bearer test-token")
        .send({
          sourceField: mapping.sourceField,
          columnDefinitionId,
          normalizedKey: "updated_key",
          required: true,
          defaultValue: "n/a",
          format: "lowercase",
          enumValues: ["a", "b", "c"],
        });

      expect(res.status).toBe(200);
      const updated = res.body.payload.fieldMapping;
      expect(updated.normalizedKey).toBe("updated_key");
      expect(updated.required).toBe(true);
      expect(updated.defaultValue).toBe("n/a");
      expect(updated.format).toBe("lowercase");
      expect(updated.enumValues).toEqual(["a", "b", "c"]);
    });

    it("should reject duplicate normalizedKey within the same entity on PATCH", async () => {
      const { connectorEntityId, columnDefinitionId, organizationId } =
        await seedFullChain(db as ReturnType<typeof drizzle>);

      const colDef2 = createColDef(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values(colDef2 as never);

      const mappingA = createFieldMap(
        organizationId,
        connectorEntityId,
        columnDefinitionId,
        {
          normalizedKey: "field_a",
        }
      );
      const mappingB = createFieldMap(
        organizationId,
        connectorEntityId,
        colDef2.id,
        {
          normalizedKey: "field_b",
        }
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(fieldMappings)
        .values([mappingA, mappingB] as never);

      // Try to change mappingB's normalizedKey to "field_a" — should conflict
      const res = await request(app)
        .patch(`/api/field-mappings/${mappingB.id}`)
        .set("Authorization", "Bearer test-token")
        .send({
          sourceField: mappingB.sourceField,
          columnDefinitionId: colDef2.id,
          normalizedKey: "field_a",
        });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe(
        ApiCode.FIELD_MAPPING_DUPLICATE_NORMALIZED_KEY
      );
    });

    it("should NOT trigger revalidation when only sourceField changes", async () => {
      const { connectorEntityId, columnDefinitionId, organizationId } =
        await seedFullChain(db as ReturnType<typeof drizzle>);

      const mapping = createFieldMap(
        organizationId,
        connectorEntityId,
        columnDefinitionId
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(fieldMappings)
        .values(mapping as never);

      const res = await request(app)
        .patch(`/api/field-mappings/${mapping.id}`)
        .set("Authorization", "Bearer test-token")
        .send({
          sourceField: "new_source_field",
          columnDefinitionId,
        });

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

      expect(jobRows).toHaveLength(0);
    });
  });

  describe("Phase 4 — Revalidation triggers on field mapping PATCH", () => {
    const revalidationFields = [
      { field: "format", value: "YYYY-MM-DD" },
      { field: "required", value: true },
      { field: "enumValues", value: ["x", "y"] },
      { field: "defaultValue", value: "fallback" },
      { field: "normalizedKey", value: "changed_key" },
    ] as const;

    for (const { field, value } of revalidationFields) {
      it(`should trigger revalidation when ${field} changes`, async () => {
        const { connectorEntityId, columnDefinitionId, organizationId } =
          await seedFullChain(db as ReturnType<typeof drizzle>);

        const mapping = createFieldMap(
          organizationId,
          connectorEntityId,
          columnDefinitionId
        );
        await (db as ReturnType<typeof drizzle>)
          .insert(fieldMappings)
          .values(mapping as never);

        const res = await request(app)
          .patch(`/api/field-mappings/${mapping.id}`)
          .set("Authorization", "Bearer test-token")
          .send({
            sourceField: mapping.sourceField,
            columnDefinitionId,
            [field]: value,
          });

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
          (j) =>
            (j.metadata as Record<string, unknown>).connectorEntityId ===
            connectorEntityId
        );
        expect(revalJob).toBeDefined();
      });
    }
  });

  describe("Phase 4 — GET response includes new fields", () => {
    it("should include normalizedKey, required, defaultValue, format, enumValues in response", async () => {
      const { connectorEntityId, columnDefinitionId, organizationId } =
        await seedFullChain(db as ReturnType<typeof drizzle>);

      const mapping = createFieldMap(
        organizationId,
        connectorEntityId,
        columnDefinitionId,
        {
          normalizedKey: "test_key",
          required: true,
          defaultValue: "default_val",
          format: "uppercase",
          enumValues: ["A", "B"],
        }
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(fieldMappings)
        .values(mapping as never);

      const res = await request(app)
        .get(`/api/field-mappings?connectorEntityId=${connectorEntityId}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      const returned = res.body.payload.fieldMappings[0];
      expect(returned.normalizedKey).toBe("test_key");
      expect(returned.required).toBe(true);
      expect(returned.defaultValue).toBe("default_val");
      expect(returned.format).toBe("uppercase");
      expect(returned.enumValues).toEqual(["A", "B"]);
    });
  });

  // ── Write capability guards ─────────────────────────────────────────

  describe("Write capability guards", () => {
    describe("POST /api/field-mappings", () => {
      it("should return 422 CONNECTOR_INSTANCE_WRITE_DISABLED when instance write is disabled", async () => {
        const { connectorEntityId, columnDefinitionId } =
          await seedWithCapabilities(db as ReturnType<typeof drizzle>, {
            definitionWrite: true,
            enabledCapabilityFlags: { write: false },
          });

        const res = await request(app)
          .post("/api/field-mappings")
          .set("Authorization", "Bearer test-token")
          .send({
            connectorEntityId,
            columnDefinitionId,
            sourceField: "blocked_field",
            normalizedKey: "blocked_field",
          });

        expect(res.status).toBe(422);
        expect(res.body.code).toBe(ApiCode.CONNECTOR_INSTANCE_WRITE_DISABLED);
      });
    });

    describe("PATCH /api/field-mappings/:id", () => {
      it("should return 422 CONNECTOR_INSTANCE_WRITE_DISABLED when instance write is disabled", async () => {
        const { connectorEntityId, columnDefinitionId, organizationId } =
          await seedWithCapabilities(db as ReturnType<typeof drizzle>, {
            definitionWrite: true,
            enabledCapabilityFlags: { write: false },
          });

        const mapping = createFieldMap(
          organizationId,
          connectorEntityId,
          columnDefinitionId
        );
        await (db as ReturnType<typeof drizzle>)
          .insert(fieldMappings)
          .values(mapping as never);

        const res = await request(app)
          .patch(`/api/field-mappings/${mapping.id}`)
          .set("Authorization", "Bearer test-token")
          .send({ sourceField: "updated", columnDefinitionId });

        expect(res.status).toBe(422);
        expect(res.body.code).toBe(ApiCode.CONNECTOR_INSTANCE_WRITE_DISABLED);
      });

      it("should return 422 when enabledCapabilityFlags is null", async () => {
        const { connectorEntityId, columnDefinitionId, organizationId } =
          await seedWithCapabilities(db as ReturnType<typeof drizzle>, {
            definitionWrite: true,
            enabledCapabilityFlags: null,
          });

        const mapping = createFieldMap(
          organizationId,
          connectorEntityId,
          columnDefinitionId
        );
        await (db as ReturnType<typeof drizzle>)
          .insert(fieldMappings)
          .values(mapping as never);

        const res = await request(app)
          .patch(`/api/field-mappings/${mapping.id}`)
          .set("Authorization", "Bearer test-token")
          .send({ sourceField: "updated", columnDefinitionId });

        expect(res.status).toBe(422);
        expect(res.body.code).toBe(ApiCode.CONNECTOR_INSTANCE_WRITE_DISABLED);
      });
    });

    describe("DELETE /api/field-mappings/:id", () => {
      it("should return 422 CONNECTOR_INSTANCE_WRITE_DISABLED when instance write is disabled", async () => {
        const { connectorEntityId, columnDefinitionId, organizationId } =
          await seedWithCapabilities(db as ReturnType<typeof drizzle>, {
            definitionWrite: true,
            enabledCapabilityFlags: { write: false },
          });

        const mapping = createFieldMap(
          organizationId,
          connectorEntityId,
          columnDefinitionId
        );
        await (db as ReturnType<typeof drizzle>)
          .insert(fieldMappings)
          .values(mapping as never);

        const res = await request(app)
          .delete(`/api/field-mappings/${mapping.id}`)
          .set("Authorization", "Bearer test-token");

        expect(res.status).toBe(422);
        expect(res.body.code).toBe(ApiCode.CONNECTOR_INSTANCE_WRITE_DISABLED);
      });
    });
  });

  // ── #685: DELETE resolved any mapping by id, across orgs ───────────

  describe("cross-tenant DELETE (#685)", () => {
    it("DELETE another org's field mapping is a 404, and the mapping stays", async () => {
      const drz = db as ReturnType<typeof drizzle>;
      await seedFullChain(drz); // the caller's own org
      const owner = createUser(`auth0|other-${generateId()}`);
      await drz.insert(schema.users).values(owner as never);
      const org = createOrganization(owner.id);
      await drz.insert(schema.organizations).values(org as never);
      const def = createConnectorDefinition();
      await drz.insert(connectorDefinitions).values(def as never);
      const instance = createConnectorInstance(def.id, org.id);
      await drz.insert(connectorInstances).values(instance as never);
      const entity = createConnEntity(org.id, instance.id);
      await drz.insert(connectorEntities).values(entity as never);
      const colDef = createColDef(org.id);
      await drz.insert(columnDefinitions).values(colDef as never);
      const mapping = createFieldMap(org.id, entity.id, colDef.id);
      await drz.insert(fieldMappings).values(mapping as never);

      const res = await request(app)
        .delete(`/api/field-mappings/${mapping.id}`)
        .set("Authorization", "Bearer test-token");
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.FIELD_MAPPING_NOT_FOUND);

      const [row] = await drz
        .select()
        .from(fieldMappings)
        .where(eq(fieldMappings.id, mapping.id));
      expect(row?.deleted).toBeNull();
    });
  });

  // ── #685: org scope on PATCH/POST, and the caller's permission ──────

  describe("authorization (#685)", () => {
    const drz = () => db as ReturnType<typeof drizzle>;

    /** Another org with a full chain and one mapping. */
    async function otherOrgChain() {
      const owner = createUser(`auth0|other-${generateId()}`);
      await drz()
        .insert(schema.users)
        .values(owner as never);
      const org = createOrganization(owner.id);
      await drz()
        .insert(schema.organizations)
        .values(org as never);
      const def = createConnectorDefinition();
      await drz()
        .insert(connectorDefinitions)
        .values(def as never);
      const instance = createConnectorInstance(def.id, org.id);
      await drz()
        .insert(connectorInstances)
        .values(instance as never);
      const entity = createConnEntity(org.id, instance.id);
      await drz()
        .insert(connectorEntities)
        .values(entity as never);
      const colDef = createColDef(org.id);
      await drz()
        .insert(columnDefinitions)
        .values(colDef as never);
      const mapping = createFieldMap(org.id, entity.id, colDef.id);
      await drz()
        .insert(fieldMappings)
        .values(mapping as never);
      return {
        entityId: entity.id,
        columnDefinitionId: colDef.id,
        mappingId: mapping.id,
        sourceField: mapping.sourceField,
      };
    }

    async function addMember(organizationId: string) {
      const member = createUser(MEMBER_AUTH0_ID);
      await drz()
        .insert(schema.users)
        .values(member as never);
      await drz()
        .insert(schema.organizationUsers)
        .values(
          createOrganizationUser(organizationId, member.id, {
            role: "member",
          }) as never
        );
      return member.id;
    }

    async function mappingRow(id: string) {
      const [row] = await drz()
        .select()
        .from(fieldMappings)
        .where(eq(fieldMappings.id, id));
      return row;
    }

    it("PATCH another org's mapping is a 404, and it's unchanged", async () => {
      await seedFullChain(drz());
      const theirs = await otherOrgChain();
      const res = await request(app)
        .patch(`/api/field-mappings/${theirs.mappingId}`)
        .set("Authorization", "Bearer test-token")
        .send({
          sourceField: "hijacked",
          columnDefinitionId: theirs.columnDefinitionId,
        });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.FIELD_MAPPING_NOT_FOUND);
      expect((await mappingRow(theirs.mappingId)).sourceField).toBe(
        theirs.sourceField
      );
    });

    it("POST under another org's connector entity, or with its column definition, is a 404", async () => {
      const mine = await seedFullChain(drz());
      const theirs = await otherOrgChain();
      const onTheirEntity = await request(app)
        .post("/api/field-mappings")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorEntityId: theirs.entityId,
          columnDefinitionId: mine.columnDefinitionId,
          sourceField: "x",
          normalizedKey: "x_one",
        });
      expect(onTheirEntity.status).toBe(404);
      expect(onTheirEntity.body.code).toBe(ApiCode.CONNECTOR_ENTITY_NOT_FOUND);

      const withTheirColumn = await request(app)
        .post("/api/field-mappings")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorEntityId: mine.connectorEntityId,
          columnDefinitionId: theirs.columnDefinitionId,
          sourceField: "y",
          normalizedKey: "y_one",
        });
      expect(withTheirColumn.status).toBe(404);
      expect(withTheirColumn.body.code).toBe(
        ApiCode.COLUMN_DEFINITION_NOT_FOUND
      );
    });

    it("a member can't change or delete a mapping someone else made (403)", async () => {
      const mine = await seedFullChain(drz());
      const mapping = createFieldMap(
        mine.organizationId,
        mine.connectorEntityId,
        mine.columnDefinitionId
      );
      await drz()
        .insert(fieldMappings)
        .values(mapping as never);
      await addMember(mine.organizationId);
      currentSub = MEMBER_AUTH0_ID;

      const patch = await request(app)
        .patch(`/api/field-mappings/${mapping.id}`)
        .set("Authorization", "Bearer test-token")
        .send({
          sourceField: "theirs_now",
          columnDefinitionId: mine.columnDefinitionId,
        });
      expect(patch.status).toBe(403);
      const del = await request(app)
        .delete(`/api/field-mappings/${mapping.id}`)
        .set("Authorization", "Bearer test-token");
      expect(del.status).toBe(403);
      const row = await mappingRow(mapping.id);
      expect(row.sourceField).toBe(mapping.sourceField);
      expect(row.deleted).toBeNull();
    });

    it("a member can't map onto an entity they can't read (404), and can onto their own (201)", async () => {
      const mine = await seedFullChain(drz());
      const memberId = await addMember(mine.organizationId);
      // An entity the owner made. (Fixture rows are created by SYSTEM_TEST,
      // which is the integration SYSTEM_ID, and members may read system
      // rows; so the unreadable entity has to be the owner's.)
      const ownersEntity = createConnEntity(
        mine.organizationId,
        mine.connectorInstanceId,
        { createdBy: mine.userId }
      );
      await drz()
        .insert(connectorEntities)
        .values(ownersEntity as never);
      // The member's own entity, on the same connector instance.
      const own = createConnEntity(
        mine.organizationId,
        mine.connectorInstanceId,
        {
          createdBy: memberId,
        }
      );
      await drz()
        .insert(connectorEntities)
        .values(own as never);
      const { wideTableReconcilerService } =
        await import("../../../services/wide-table-reconciler.service.js");
      await wideTableReconcilerService.ensureTable(
        own.id,
        db as unknown as DbClient
      );
      currentSub = MEMBER_AUTH0_ID;

      const refused = await request(app)
        .post("/api/field-mappings")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorEntityId: ownersEntity.id,
          columnDefinitionId: mine.columnDefinitionId,
          sourceField: "a",
          normalizedKey: "a_one",
        });
      expect(refused.status).toBe(404);
      expect(refused.body.code).toBe(ApiCode.CONNECTOR_ENTITY_NOT_FOUND);

      const ok = await request(app)
        .post("/api/field-mappings")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorEntityId: own.id,
          columnDefinitionId: mine.columnDefinitionId,
          sourceField: "b",
          normalizedKey: "b_one",
        });
      expect(ok.status).toBe(201);
      expect(ok.body.payload.fieldMapping.createdBy).toBe(memberId);
    });

    // ── #692: reads were never authorized ─────────────────────────────

    /** An owner-created entity + mapping (unreadable to a member), and the
     *  member's own entity + mapping. */
    async function ownerAndMemberMappings() {
      const mine = await seedFullChain(drz());
      const memberId = await addMember(mine.organizationId);
      const ownersEntity = createConnEntity(
        mine.organizationId,
        mine.connectorInstanceId,
        { createdBy: mine.userId }
      );
      const membersEntity = createConnEntity(
        mine.organizationId,
        mine.connectorInstanceId,
        { createdBy: memberId }
      );
      await drz()
        .insert(connectorEntities)
        .values([ownersEntity, membersEntity] as never);
      const ownersMapping = createFieldMap(
        mine.organizationId,
        ownersEntity.id,
        mine.columnDefinitionId,
        { createdBy: mine.userId, sourceField: "owners_secret_field" }
      );
      const membersMapping = createFieldMap(
        mine.organizationId,
        membersEntity.id,
        mine.columnDefinitionId,
        { createdBy: memberId, sourceField: "members_field" }
      );
      await drz()
        .insert(fieldMappings)
        .values([ownersMapping, membersMapping] as never);
      return { mine, memberId, ownersEntity, ownersMapping, membersMapping };
    }

    const BY_ID_READS = [
      (id: string) => `/api/field-mappings/${id}`,
      (id: string) => `/api/field-mappings/${id}/impact`,
      (id: string) => `/api/field-mappings/${id}/validate-bidirectional`,
    ];

    it("GET by id, impact and validate on another org's mapping are 404 (#692)", async () => {
      await seedFullChain(drz());
      const theirs = await otherOrgChain();
      for (const path of BY_ID_READS) {
        const res = await request(app)
          .get(path(theirs.mappingId))
          .set("Authorization", "Bearer test-token");
        expect(res.status).toBe(404);
        expect(res.body.code).toBe(ApiCode.FIELD_MAPPING_NOT_FOUND);
        expect(JSON.stringify(res.body)).not.toContain(theirs.sourceField);
      }
    });

    it("a member's list holds only the mappings they can read (#692)", async () => {
      const { ownersMapping, membersMapping } = await ownerAndMemberMappings();
      currentSub = MEMBER_AUTH0_ID;
      const res = await request(app)
        .get("/api/field-mappings?limit=100")
        .set("Authorization", "Bearer test-token");
      expect(res.status).toBe(200);
      const ids = res.body.payload.fieldMappings.map(
        (m: { id: string }) => m.id
      );
      expect(ids).toContain(membersMapping.id);
      expect(ids).not.toContain(ownersMapping.id);
      expect(res.body.payload.total).toBe(ids.length);
    });

    it("a member gets 404 on the owner's mapping by id, impact and validate, and 200 on their own (#692)", async () => {
      const { ownersMapping, membersMapping } = await ownerAndMemberMappings();
      currentSub = MEMBER_AUTH0_ID;
      for (const path of BY_ID_READS) {
        const refused = await request(app)
          .get(path(ownersMapping.id))
          .set("Authorization", "Bearer test-token");
        expect(refused.status).toBe(404);
        expect(refused.body.code).toBe(ApiCode.FIELD_MAPPING_NOT_FOUND);
      }
      const own = await request(app)
        .get(`/api/field-mappings/${membersMapping.id}`)
        .set("Authorization", "Bearer test-token");
      expect(own.status).toBe(200);
      expect(own.body.payload.fieldMapping.id).toBe(membersMapping.id);
    });

    it("the owner still reads every mapping in the org (#692)", async () => {
      const { ownersMapping, membersMapping } = await ownerAndMemberMappings();
      const res = await request(app)
        .get("/api/field-mappings?limit=100")
        .set("Authorization", "Bearer test-token");
      const ids = res.body.payload.fieldMappings.map(
        (m: { id: string }) => m.id
      );
      expect(ids).toEqual(
        expect.arrayContaining([ownersMapping.id, membersMapping.id])
      );
      for (const path of BY_ID_READS.slice(0, 2)) {
        const res2 = await request(app)
          .get(path(ownersMapping.id))
          .set("Authorization", "Bearer test-token");
        expect(res2.status).toBe(200);
      }
      // validate-bidirectional 400s a non-reference mapping; the point here
      // is only that the read check lets the owner through.
      const validate = await request(app)
        .get(BY_ID_READS[2](ownersMapping.id))
        .set("Authorization", "Bearer test-token");
      expect(validate.status).not.toBe(404);
    });

    it("a mapping in a curated view shared with the member becomes readable (in_curated_view, #692)", async () => {
      const { ownersEntity, ownersMapping, memberId } =
        await ownerAndMemberMappings();
      const view = await request(app)
        .post("/api/curated-views")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorEntityId: ownersEntity.id,
          key: `v_${generateId().replace(/-/g, "").slice(0, 8)}`,
          label: "Shared view",
          fieldMappingIds: [ownersMapping.id],
        });
      expect(view.status).toBe(201);
      const share = await request(app)
        .post("/api/grants")
        .set("Authorization", "Bearer test-token")
        .send({
          resourceType: "curated_view",
          resourceId: view.body.payload.curatedView.id,
          grantee: { type: "user", userId: memberId },
          access: "read",
        });
      expect(share.status).toBe(200);

      currentSub = MEMBER_AUTH0_ID;
      const res = await request(app)
        .get(`/api/field-mappings/${ownersMapping.id}`)
        .set("Authorization", "Bearer test-token");
      expect(res.status).toBe(200);
      const list = await request(app)
        .get("/api/field-mappings?limit=100")
        .set("Authorization", "Bearer test-token");
      expect(
        list.body.payload.fieldMappings.map((m: { id: string }) => m.id)
      ).toContain(ownersMapping.id);
    });
  });
});
