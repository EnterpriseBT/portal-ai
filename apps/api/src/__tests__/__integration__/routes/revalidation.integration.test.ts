/**
 * Integration tests for the revalidation background job feature.
 *
 * Tests the POST /revalidate endpoint, mutation guards on entity records,
 * field mappings, and column definitions when a revalidation job is active.
 */

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

const AUTH0_ID = "auth0|ci-test-revalidation";

// Mock the auth middleware
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
  connectorDefinitions,
  connectorInstances,
  connectorEntities,
  columnDefinitions,
  fieldMappings,
  entityRecords,
  jobs,
} = schema;

// ── Helpers ─────────────────────────────────────────────────────────

const now = Date.now();

function createConnectorDefinition(overrides?: Partial<Record<string, unknown>>) {
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
  overrides?: Partial<Record<string, unknown>>,
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
    enabledCapabilityFlags: { write: true },
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    ...overrides,
  };
}

function createConnEntity(organizationId: string, connectorInstanceId: string) {
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
  };
}

function createColumnDef(organizationId: string, key: string, type: string) {
  return {
    id: generateId(),
    organizationId,
    key,
    label: key,
    type,
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
  };
}

function createFieldMapping(
  organizationId: string,
  connectorEntityId: string,
  columnDefinitionId: string,
  sourceField: string,
) {
  return {
    id: generateId(),
    organizationId,
    connectorEntityId,
    columnDefinitionId,
    sourceField,
    isPrimaryKey: false,
    normalizedKey: sourceField,
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
  };
}

function createEntityRecord(
  organizationId: string,
  connectorEntityId: string,
  data: Record<string, unknown>,
  sourceId: string,
) {
  return {
    id: generateId(),
    organizationId,
    connectorEntityId,
    data,
    normalizedData: data,
    sourceId,
    checksum: generateId().slice(0, 16),
    syncedAt: now,
    origin: "manual" as const,
    validationErrors: null,
    isValid: true,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

function createActiveRevalidationJob(
  organizationId: string,
  connectorEntityId: string,
  overrides?: Partial<Record<string, unknown>>,
) {
  return {
    id: generateId(),
    organizationId,
    type: "revalidation" as const,
    status: "active" as const,
    progress: 50,
    metadata: { connectorEntityId, organizationId },
    result: null,
    error: null,
    startedAt: now,
    completedAt: null,
    bullJobId: null,
    attempts: 1,
    maxAttempts: 3,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    ...overrides,
  };
}

/** Seed the full chain: user, org, definition, instance, entity, column def, field mapping. */
async function seedFullStack(db: ReturnType<typeof drizzle>) {
  const { userId, organizationId } = await seedUserAndOrg(db, AUTH0_ID);

  const def = createConnectorDefinition();
  await db.insert(connectorDefinitions).values(def as never);

  const inst = createConnectorInstance(def.id, organizationId);
  await db.insert(connectorInstances).values(inst as never);

  const entity = createConnEntity(organizationId, inst.id);
  await db.insert(connectorEntities).values(entity as never);

  const colDef = createColumnDef(organizationId, "name", "string");
  await db.insert(columnDefinitions).values(colDef as never);

  const mapping = createFieldMapping(organizationId, entity.id, colDef.id, "name");
  await db.insert(fieldMappings).values(mapping as never);

  return {
    userId,
    organizationId,
    connectorEntityId: entity.id,
    columnDefinitionId: colDef.id,
    fieldMappingId: mapping.id,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("Revalidation — POST /revalidate endpoint", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db as ReturnType<typeof drizzle>);
  });

  afterEach(async () => {
    await connection.end();
  });

  const revalidateUrl = (connectorEntityId: string) =>
    `/api/connector-entities/${connectorEntityId}/records/revalidate`;

  it("returns 404 when connector entity does not exist", async () => {
    await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

    const res = await request(app)
      .post(revalidateUrl("nonexistent-id"))
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(404);
  });

  it("returns 202 with a job object on success", async () => {
    const { connectorEntityId } = await seedFullStack(db as ReturnType<typeof drizzle>);

    const res = await request(app)
      .post(revalidateUrl(connectorEntityId))
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.payload.job).toBeDefined();
    expect(res.body.payload.job.type).toBe("revalidation");
  });

  it("returns existing active job on duplicate request (idempotent)", async () => {
    const { organizationId, connectorEntityId } = await seedFullStack(db as ReturnType<typeof drizzle>);

    // Seed an active revalidation job directly
    const existingJob = createActiveRevalidationJob(organizationId, connectorEntityId);
    await (db as ReturnType<typeof drizzle>).insert(jobs).values(existingJob as never);

    const res = await request(app)
      .post(revalidateUrl(connectorEntityId))
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(202);
    expect(res.body.payload.job.id).toBe(existingJob.id);
  });
});

describe("Revalidation — Entity Record Mutation Guards", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db as ReturnType<typeof drizzle>);
  });

  afterEach(async () => {
    await connection.end();
  });

  const recordsUrl = (connectorEntityId: string) =>
    `/api/connector-entities/${connectorEntityId}/records`;

  it("POST / (create record) returns 409 when revalidation active", async () => {
    const { organizationId, connectorEntityId } = await seedFullStack(db as ReturnType<typeof drizzle>);
    await (db as ReturnType<typeof drizzle>).insert(jobs).values(
      createActiveRevalidationJob(organizationId, connectorEntityId) as never,
    );

    const res = await request(app)
      .post(recordsUrl(connectorEntityId))
      .set("Authorization", "Bearer test-token")
      .send({ normalizedData: { name: "Alice" } });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ApiCode.REVALIDATION_ACTIVE);
  });

  it("PATCH /:recordId returns 409 when revalidation active", async () => {
    const { organizationId, connectorEntityId } = await seedFullStack(db as ReturnType<typeof drizzle>);

    const rec = createEntityRecord(organizationId, connectorEntityId, { name: "Alice" }, "src-1");
    await (db as ReturnType<typeof drizzle>).insert(entityRecords).values(rec as never);

    await (db as ReturnType<typeof drizzle>).insert(jobs).values(
      createActiveRevalidationJob(organizationId, connectorEntityId) as never,
    );

    const res = await request(app)
      .patch(`${recordsUrl(connectorEntityId)}/${rec.id}`)
      .set("Authorization", "Bearer test-token")
      .send({ normalizedData: { name: "Bob" } });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ApiCode.REVALIDATION_ACTIVE);
  });

  it("DELETE /:recordId returns 409 when revalidation active", async () => {
    const { organizationId, connectorEntityId } = await seedFullStack(db as ReturnType<typeof drizzle>);

    const rec = createEntityRecord(organizationId, connectorEntityId, { name: "Alice" }, "src-1");
    await (db as ReturnType<typeof drizzle>).insert(entityRecords).values(rec as never);

    await (db as ReturnType<typeof drizzle>).insert(jobs).values(
      createActiveRevalidationJob(organizationId, connectorEntityId) as never,
    );

    const res = await request(app)
      .delete(`${recordsUrl(connectorEntityId)}/${rec.id}`)
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ApiCode.REVALIDATION_ACTIVE);
  });

  it("DELETE / (clear all) returns 409 when revalidation active", async () => {
    const { organizationId, connectorEntityId } = await seedFullStack(db as ReturnType<typeof drizzle>);
    await (db as ReturnType<typeof drizzle>).insert(jobs).values(
      createActiveRevalidationJob(organizationId, connectorEntityId) as never,
    );

    const res = await request(app)
      .delete(recordsUrl(connectorEntityId))
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ApiCode.REVALIDATION_ACTIVE);
  });

  it("POST /import returns 409 when revalidation active", async () => {
    const { organizationId, connectorEntityId } = await seedFullStack(db as ReturnType<typeof drizzle>);
    await (db as ReturnType<typeof drizzle>).insert(jobs).values(
      createActiveRevalidationJob(organizationId, connectorEntityId) as never,
    );

    const res = await request(app)
      .post(`${recordsUrl(connectorEntityId)}/import`)
      .set("Authorization", "Bearer test-token")
      .send({
        records: [
          { data: { name: "Alice" }, normalizedData: { name: "Alice" }, sourceId: "s1", checksum: "c1" },
        ],
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ApiCode.REVALIDATION_ACTIVE);
  });

  it("allows mutations when no revalidation job is active", async () => {
    const { connectorEntityId } = await seedFullStack(db as ReturnType<typeof drizzle>);

    const res = await request(app)
      .post(recordsUrl(connectorEntityId))
      .set("Authorization", "Bearer test-token")
      .send({ normalizedData: { name: "Alice" } });

    expect(res.status).toBe(201);
  });

  it("allows mutations when revalidation job is completed", async () => {
    const { organizationId, connectorEntityId } = await seedFullStack(db as ReturnType<typeof drizzle>);
    await (db as ReturnType<typeof drizzle>).insert(jobs).values(
      createActiveRevalidationJob(organizationId, connectorEntityId, { status: "completed" }) as never,
    );

    const res = await request(app)
      .post(recordsUrl(connectorEntityId))
      .set("Authorization", "Bearer test-token")
      .send({ normalizedData: { name: "Alice" } });

    expect(res.status).toBe(201);
  });
});

describe("Revalidation — Field Mapping Mutation Guards", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db as ReturnType<typeof drizzle>);
  });

  afterEach(async () => {
    await connection.end();
  });

  it("PATCH /field-mappings/:id returns 409 when revalidation active", async () => {
    const { organizationId, connectorEntityId, fieldMappingId, columnDefinitionId } = await seedFullStack(
      db as ReturnType<typeof drizzle>,
    );
    await (db as ReturnType<typeof drizzle>).insert(jobs).values(
      createActiveRevalidationJob(organizationId, connectorEntityId) as never,
    );

    const res = await request(app)
      .patch(`/api/field-mappings/${fieldMappingId}`)
      .set("Authorization", "Bearer test-token")
      .send({ sourceField: "new_name", columnDefinitionId });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ApiCode.REVALIDATION_ACTIVE);
  });

  it("DELETE /field-mappings/:id returns 409 when revalidation active", async () => {
    const { organizationId, connectorEntityId, fieldMappingId } = await seedFullStack(
      db as ReturnType<typeof drizzle>,
    );
    await (db as ReturnType<typeof drizzle>).insert(jobs).values(
      createActiveRevalidationJob(organizationId, connectorEntityId) as never,
    );

    const res = await request(app)
      .delete(`/api/field-mappings/${fieldMappingId}`)
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ApiCode.REVALIDATION_ACTIVE);
  });
});

describe("Revalidation — Column Definition Mutation Guards", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db as ReturnType<typeof drizzle>);
  });

  afterEach(async () => {
    await connection.end();
  });

  it("PATCH /column-definitions/:id returns 409 when revalidation active for an entity using it", async () => {
    const { organizationId, connectorEntityId, columnDefinitionId } = await seedFullStack(
      db as ReturnType<typeof drizzle>,
    );
    await (db as ReturnType<typeof drizzle>).insert(jobs).values(
      createActiveRevalidationJob(organizationId, connectorEntityId) as never,
    );

    const res = await request(app)
      .patch(`/api/column-definitions/${columnDefinitionId}`)
      .set("Authorization", "Bearer test-token")
      .send({ label: "Updated Name" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ApiCode.REVALIDATION_ACTIVE);
  });

  it("DELETE /column-definitions/:id returns 409 when revalidation active for an entity using it", async () => {
    const { organizationId, connectorEntityId, columnDefinitionId } = await seedFullStack(
      db as ReturnType<typeof drizzle>,
    );
    await (db as ReturnType<typeof drizzle>).insert(jobs).values(
      createActiveRevalidationJob(organizationId, connectorEntityId) as never,
    );

    const res = await request(app)
      .delete(`/api/column-definitions/${columnDefinitionId}`)
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ApiCode.REVALIDATION_ACTIVE);
  });

  it("allows PATCH when no revalidation is active", async () => {
    const { columnDefinitionId } = await seedFullStack(db as ReturnType<typeof drizzle>);

    const res = await request(app)
      .patch(`/api/column-definitions/${columnDefinitionId}`)
      .set("Authorization", "Bearer test-token")
      .send({ label: "Updated Name" });

    expect(res.status).toBe(200);
  });
});

describe("Entity Record Router — isValid Filter", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db as ReturnType<typeof drizzle>);
  });

  afterEach(async () => {
    await connection.end();
  });

  const recordsUrl = (connectorEntityId: string) =>
    `/api/connector-entities/${connectorEntityId}/records`;

  async function seedWithValidationMix(db: ReturnType<typeof drizzle>) {
    const seed = await seedFullStack(db);

    const validRecord = createEntityRecord(seed.organizationId, seed.connectorEntityId, { name: "Alice" }, "src-1");
    const invalidRecord = {
      ...createEntityRecord(seed.organizationId, seed.connectorEntityId, { name: "" }, "src-2"),
      isValid: false,
      validationErrors: [{ field: "name", error: "required" }],
    };
    const validRecord2 = createEntityRecord(seed.organizationId, seed.connectorEntityId, { name: "Charlie" }, "src-3");

    await db.insert(entityRecords).values([validRecord, invalidRecord, validRecord2] as never);

    return { ...seed, validIds: [validRecord.id, validRecord2.id], invalidIds: [invalidRecord.id] };
  }

  it("GET /?isValid=true returns only valid records", async () => {
    const { connectorEntityId, validIds } = await seedWithValidationMix(db as ReturnType<typeof drizzle>);

    const res = await request(app)
      .get(recordsUrl(connectorEntityId))
      .query({ isValid: "true", limit: 100 })
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    const ids = res.body.payload.records.map((r: { id: string }) => r.id);
    expect(ids.sort()).toEqual(validIds.sort());
    expect(res.body.payload.total).toBe(2);
  });

  it("GET /?isValid=false returns only invalid records", async () => {
    const { connectorEntityId, invalidIds } = await seedWithValidationMix(db as ReturnType<typeof drizzle>);

    const res = await request(app)
      .get(recordsUrl(connectorEntityId))
      .query({ isValid: "false", limit: 100 })
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    const ids = res.body.payload.records.map((r: { id: string }) => r.id);
    expect(ids).toEqual(invalidIds);
    expect(res.body.payload.total).toBe(1);
  });

  it("GET / without isValid returns all records", async () => {
    const { connectorEntityId } = await seedWithValidationMix(db as ReturnType<typeof drizzle>);

    const res = await request(app)
      .get(recordsUrl(connectorEntityId))
      .query({ limit: 100 })
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body.payload.total).toBe(3);
  });

  it("GET /?isValid=true works combined with search", async () => {
    const { connectorEntityId } = await seedWithValidationMix(db as ReturnType<typeof drizzle>);

    const res = await request(app)
      .get(recordsUrl(connectorEntityId))
      .query({ isValid: "true", search: "Alice", limit: 100 })
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body.payload.total).toBe(1);
    expect(res.body.payload.records[0].normalizedData.name).toBe("Alice");
  });
});
