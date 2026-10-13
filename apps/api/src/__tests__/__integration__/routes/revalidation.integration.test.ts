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
import { and, eq } from "drizzle-orm";
import {
  jobLockScopes,
  lockScopeKey,
  type JobType,
} from "@portalai/core/models";
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
const { RevalidationService } =
  await import("../../../services/revalidation.service.js");

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
  sourceField: string
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
  sourceId: string
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
  overrides?: Partial<Record<string, unknown>>
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
    // #769: as enqueueExclusive writes it; the lock check reads this.
    lockScopes: [`entity:${connectorEntityId}`],
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

  const mapping = createFieldMapping(
    organizationId,
    entity.id,
    colDef.id,
    "name"
  );
  await db.insert(fieldMappings).values(mapping as never);

  // Reconcile the wide table so reads + writes through the new path
  // find `er__<id>` with the right columns.
  const { wideTableReconcilerService } =
    await import("../../../services/wide-table-reconciler.service.js");
  const { wideTableStatementCache } =
    await import("../../../services/wide-table-statement.cache.js");
  wideTableStatementCache.clear();
  await wideTableReconcilerService.reconcileEntity(
    entity.id,
    db as unknown as DbClient
  );

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
    const { connectorEntityId } = await seedFullStack(
      db as ReturnType<typeof drizzle>
    );

    const res = await request(app)
      .post(revalidateUrl(connectorEntityId))
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.payload.job).toBeDefined();
    expect(res.body.payload.job.type).toBe("revalidation");
  });

  it("returns existing active job on duplicate request (idempotent)", async () => {
    const { organizationId, connectorEntityId } = await seedFullStack(
      db as ReturnType<typeof drizzle>
    );

    // Seed an active revalidation job directly
    const existingJob = createActiveRevalidationJob(
      organizationId,
      connectorEntityId
    );
    await (db as ReturnType<typeof drizzle>)
      .insert(jobs)
      .values(existingJob as never);

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
    const { organizationId, connectorEntityId } = await seedFullStack(
      db as ReturnType<typeof drizzle>
    );
    await (db as ReturnType<typeof drizzle>)
      .insert(jobs)
      .values(
        createActiveRevalidationJob(organizationId, connectorEntityId) as never
      );

    const res = await request(app)
      .post(recordsUrl(connectorEntityId))
      .set("Authorization", "Bearer test-token")
      .send({ normalizedData: { name: "Alice" } });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ApiCode.ENTITY_LOCKED_BY_JOB);
  });

  it("PATCH /:recordId returns 409 when revalidation active", async () => {
    const { organizationId, connectorEntityId } = await seedFullStack(
      db as ReturnType<typeof drizzle>
    );

    const rec = createEntityRecord(
      organizationId,
      connectorEntityId,
      { name: "Alice" },
      "src-1"
    );
    await (db as ReturnType<typeof drizzle>)
      .insert(entityRecords)
      .values(rec as never);

    await (db as ReturnType<typeof drizzle>)
      .insert(jobs)
      .values(
        createActiveRevalidationJob(organizationId, connectorEntityId) as never
      );

    const res = await request(app)
      .patch(`${recordsUrl(connectorEntityId)}/${rec.id}`)
      .set("Authorization", "Bearer test-token")
      .send({ normalizedData: { name: "Bob" } });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ApiCode.ENTITY_LOCKED_BY_JOB);
  });

  it("DELETE /:recordId returns 409 when revalidation active", async () => {
    const { organizationId, connectorEntityId } = await seedFullStack(
      db as ReturnType<typeof drizzle>
    );

    const rec = createEntityRecord(
      organizationId,
      connectorEntityId,
      { name: "Alice" },
      "src-1"
    );
    await (db as ReturnType<typeof drizzle>)
      .insert(entityRecords)
      .values(rec as never);

    await (db as ReturnType<typeof drizzle>)
      .insert(jobs)
      .values(
        createActiveRevalidationJob(organizationId, connectorEntityId) as never
      );

    const res = await request(app)
      .delete(`${recordsUrl(connectorEntityId)}/${rec.id}`)
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ApiCode.ENTITY_LOCKED_BY_JOB);
  });

  it("DELETE / (clear all) returns 409 when revalidation active", async () => {
    const { organizationId, connectorEntityId } = await seedFullStack(
      db as ReturnType<typeof drizzle>
    );
    await (db as ReturnType<typeof drizzle>)
      .insert(jobs)
      .values(
        createActiveRevalidationJob(organizationId, connectorEntityId) as never
      );

    const res = await request(app)
      .delete(recordsUrl(connectorEntityId))
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ApiCode.ENTITY_LOCKED_BY_JOB);
  });

  it("POST /import returns 409 when revalidation active", async () => {
    const { organizationId, connectorEntityId } = await seedFullStack(
      db as ReturnType<typeof drizzle>
    );
    await (db as ReturnType<typeof drizzle>)
      .insert(jobs)
      .values(
        createActiveRevalidationJob(organizationId, connectorEntityId) as never
      );

    const res = await request(app)
      .post(`${recordsUrl(connectorEntityId)}/import`)
      .set("Authorization", "Bearer test-token")
      .send({
        records: [
          {
            data: { name: "Alice" },
            normalizedData: { name: "Alice" },
            sourceId: "s1",
            checksum: "c1",
          },
        ],
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ApiCode.ENTITY_LOCKED_BY_JOB);
  });

  it("allows mutations when no revalidation job is active", async () => {
    const { connectorEntityId } = await seedFullStack(
      db as ReturnType<typeof drizzle>
    );

    const res = await request(app)
      .post(recordsUrl(connectorEntityId))
      .set("Authorization", "Bearer test-token")
      .send({ normalizedData: { name: "Alice" } });

    expect(res.status).toBe(201);
  });

  it("allows mutations when revalidation job is completed", async () => {
    const { organizationId, connectorEntityId } = await seedFullStack(
      db as ReturnType<typeof drizzle>
    );
    await (db as ReturnType<typeof drizzle>).insert(jobs).values(
      createActiveRevalidationJob(organizationId, connectorEntityId, {
        status: "completed",
      }) as never
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
    const {
      organizationId,
      connectorEntityId,
      fieldMappingId,
      columnDefinitionId,
    } = await seedFullStack(db as ReturnType<typeof drizzle>);
    await (db as ReturnType<typeof drizzle>)
      .insert(jobs)
      .values(
        createActiveRevalidationJob(organizationId, connectorEntityId) as never
      );

    const res = await request(app)
      .patch(`/api/field-mappings/${fieldMappingId}`)
      .set("Authorization", "Bearer test-token")
      .send({ sourceField: "new_name", columnDefinitionId });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ApiCode.ENTITY_LOCKED_BY_JOB);
  });

  it("DELETE /field-mappings/:id returns 409 when revalidation active", async () => {
    const { organizationId, connectorEntityId, fieldMappingId } =
      await seedFullStack(db as ReturnType<typeof drizzle>);
    await (db as ReturnType<typeof drizzle>)
      .insert(jobs)
      .values(
        createActiveRevalidationJob(organizationId, connectorEntityId) as never
      );

    const res = await request(app)
      .delete(`/api/field-mappings/${fieldMappingId}`)
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ApiCode.ENTITY_LOCKED_BY_JOB);
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
    const { organizationId, connectorEntityId, columnDefinitionId } =
      await seedFullStack(db as ReturnType<typeof drizzle>);
    await (db as ReturnType<typeof drizzle>)
      .insert(jobs)
      .values(
        createActiveRevalidationJob(organizationId, connectorEntityId) as never
      );

    const res = await request(app)
      .patch(`/api/column-definitions/${columnDefinitionId}`)
      .set("Authorization", "Bearer test-token")
      .send({ label: "Updated Name" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ApiCode.ENTITY_LOCKED_BY_JOB);
  });

  it("DELETE /column-definitions/:id returns 409 when revalidation active for an entity using it", async () => {
    const { organizationId, connectorEntityId, columnDefinitionId } =
      await seedFullStack(db as ReturnType<typeof drizzle>);
    await (db as ReturnType<typeof drizzle>)
      .insert(jobs)
      .values(
        createActiveRevalidationJob(organizationId, connectorEntityId) as never
      );

    const res = await request(app)
      .delete(`/api/column-definitions/${columnDefinitionId}`)
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ApiCode.ENTITY_LOCKED_BY_JOB);
  });

  it("allows PATCH when no revalidation is active", async () => {
    const { columnDefinitionId } = await seedFullStack(
      db as ReturnType<typeof drizzle>
    );

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

    const validRecord = createEntityRecord(
      seed.organizationId,
      seed.connectorEntityId,
      { name: "Alice" },
      "src-1"
    );
    const invalidRecord = {
      ...createEntityRecord(
        seed.organizationId,
        seed.connectorEntityId,
        { name: "" },
        "src-2"
      ),
      isValid: false,
      validationErrors: [{ field: "name", error: "required" }],
    };
    const validRecord2 = createEntityRecord(
      seed.organizationId,
      seed.connectorEntityId,
      { name: "Charlie" },
      "src-3"
    );

    await db
      .insert(entityRecords)
      .values([validRecord, invalidRecord, validRecord2] as never);

    // Mirror the rows into the wide table so the list endpoint's JOIN
    // returns them. Project the typed columns from each record's
    // normalizedData.
    const { wideTableRepo } =
      await import("../../../db/repositories/wide-table.repository.js");
    const { wideTableStatementCache } =
      await import("../../../services/wide-table-statement.cache.js");
    const { projectToWideRow, buildMappingsForProjection } =
      await import("../../../services/wide-table-projection.util.js");
    const dbClient = db as unknown as DbClient;
    const stmt = await wideTableStatementCache.get(
      seed.connectorEntityId,
      dbClient
    );
    const mappings = buildMappingsForProjection(stmt.columns);
    await wideTableRepo.upsertMany(
      seed.connectorEntityId,
      [validRecord, invalidRecord, validRecord2].map((r) =>
        projectToWideRow(
          {
            id: r.id,
            organizationId: r.organizationId,
            sourceId: r.sourceId,
            syncedAt: r.syncedAt,
            isValid: r.isValid,
            normalizedData: r.normalizedData,
          },
          mappings
        )
      ),
      dbClient
    );

    return {
      ...seed,
      validIds: [validRecord.id, validRecord2.id],
      invalidIds: [invalidRecord.id],
    };
  }

  it("GET /?isValid=true returns only valid records", async () => {
    const { connectorEntityId, validIds } = await seedWithValidationMix(
      db as ReturnType<typeof drizzle>
    );

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
    const { connectorEntityId, invalidIds } = await seedWithValidationMix(
      db as ReturnType<typeof drizzle>
    );

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
    const { connectorEntityId } = await seedWithValidationMix(
      db as ReturnType<typeof drizzle>
    );

    const res = await request(app)
      .get(recordsUrl(connectorEntityId))
      .query({ limit: 100 })
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body.payload.total).toBe(3);
  });

  it("GET /?isValid=true works combined with search", async () => {
    const { connectorEntityId } = await seedWithValidationMix(
      db as ReturnType<typeof drizzle>
    );

    const res = await request(app)
      .get(recordsUrl(connectorEntityId))
      .query({ isValid: "true", search: "Alice", limit: 100 })
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body.payload.total).toBe(1);
    expect(res.body.payload.records[0].normalizedData.name).toBe("Alice");
  });
});

// #769: one lock model. Any running job whose scope covers an entity refuses
// writes to its records and field mappings, not only a revalidation.
describe("Job locks on record and field-mapping writes (#769)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);
  });

  afterEach(async () => {
    await connection.end();
  });

  const recordsUrl = (id: string) => `/api/connector-entities/${id}/records`;

  /** A running job row with the scopes job creation would give it. */
  async function seedJob(
    organizationId: string,
    type: JobType,
    metadata: Record<string, unknown>,
    status = "active"
  ) {
    const id = generateId();
    await db.insert(jobs).values({
      id,
      organizationId,
      type,
      status,
      progress: 0,
      metadata,
      attempts: 1,
      maxAttempts: 3,
      lockScopes: jobLockScopes(type, metadata).map(lockScopeKey),
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    return id;
  }

  async function instanceOf(connectorEntityId: string) {
    const [row] = await db
      .select()
      .from(connectorEntities)
      .where(eq(connectorEntities.id, connectorEntityId));
    return row!.connectorInstanceId;
  }

  const createRecord = (connectorEntityId: string) =>
    request(app)
      .post(recordsUrl(connectorEntityId))
      .set("Authorization", "Bearer test-token")
      .send({ normalizedData: { name: "Alice" } });

  it("a sync on the connector refuses a record create, naming it", async () => {
    const { organizationId, connectorEntityId } = await seedFullStack(db);
    const jobId = await seedJob(organizationId, "connector_sync", {
      connectorInstanceId: await instanceOf(connectorEntityId),
    });

    const res = await createRecord(connectorEntityId);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ApiCode.ENTITY_LOCKED_BY_JOB);
    expect(res.body.message).toMatch(/^Sync is running on this connector/);
    expect(res.body.details.runningJobs[0].id).toBe(jobId);
  });

  it("a bulk transform locks its source entity, not only its targets", async () => {
    const { organizationId, connectorEntityId } = await seedFullStack(db);
    await seedJob(organizationId, "bulk_transform", {
      sourceConnectorEntityId: connectorEntityId,
      targetConnectorEntityIds: ["some-other-entity"],
    });

    const res = await createRecord(connectorEntityId);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(
      /^Bulk transform is running on this entity/
    );
  });

  it("a bulk geocode refuses a field-mapping delete", async () => {
    const { organizationId, connectorEntityId, fieldMappingId } =
      await seedFullStack(db);
    await seedJob(organizationId, "bulk_geocode", {
      connectorEntityId,
      targetConnectorEntityIds: [connectorEntityId],
    });

    const res = await request(app)
      .delete(`/api/field-mappings/${fieldMappingId}`)
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ApiCode.ENTITY_LOCKED_BY_JOB);
    const [mapping] = await db
      .select()
      .from(fieldMappings)
      .where(eq(fieldMappings.id, fieldMappingId));
    expect(mapping!.deleted).toBeNull();
  });

  it("a field-mapping create is refused while the entity is locked", async () => {
    const { organizationId, connectorEntityId } = await seedFullStack(db);
    await seedJob(organizationId, "revalidation", { connectorEntityId });
    const colDef = createColumnDef(organizationId, "email", "string");
    await db.insert(columnDefinitions).values(colDef as never);

    const res = await request(app)
      .post("/api/field-mappings")
      .set("Authorization", "Bearer test-token")
      .send({
        connectorEntityId,
        columnDefinitionId: colDef.id,
        sourceField: "email",
        normalizedKey: "email",
      });

    expect(res.status).toBe(409);
  });

  it("every non-terminal status locks; once the job finishes the write goes through", async () => {
    const { organizationId, connectorEntityId } = await seedFullStack(db);
    for (const status of [
      "pending",
      "active",
      "awaiting_confirmation",
      "stalled",
    ]) {
      const id = await seedJob(
        organizationId,
        "revalidation",
        { connectorEntityId },
        status
      );
      expect((await createRecord(connectorEntityId)).status).toBe(409);
      await db
        .update(jobs)
        .set({ status: "completed" } as never)
        .where(eq(jobs.id, id));
    }
    expect((await createRecord(connectorEntityId)).status).toBe(201);
  });

  it("an import is refused even when none of its rows changed", async () => {
    const { organizationId, connectorEntityId } = await seedFullStack(db);
    const body = {
      records: [
        {
          data: { name: "Alice" },
          normalizedData: { name: "Alice" },
          sourceId: "s1",
          checksum: "c1",
        },
      ],
    };
    const first = await request(app)
      .post(`${recordsUrl(connectorEntityId)}/import`)
      .set("Authorization", "Bearer test-token")
      .send(body);
    expect(first.status).toBe(201);

    await seedJob(organizationId, "revalidation", { connectorEntityId });
    const again = await request(app)
      .post(`${recordsUrl(connectorEntityId)}/import`)
      .set("Authorization", "Bearer test-token")
      .send(body);

    expect(again.status).toBe(409);
  });

  it("Re-validate All is refused during a bulk transform on the entity", async () => {
    const { organizationId, connectorEntityId } = await seedFullStack(db);
    await seedJob(organizationId, "bulk_transform", {
      sourceConnectorEntityId: connectorEntityId,
      targetConnectorEntityIds: [connectorEntityId],
    });

    const res = await request(app)
      .post(`${recordsUrl(connectorEntityId)}/revalidate`)
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(409);
    const revalidations = await db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.type, "revalidation"),
          eq(jobs.organizationId, organizationId)
        )
      );
    expect(revalidations).toHaveLength(0);
  });

  it("a field-mapping change that affects validity queues a revalidation after it commits", async () => {
    const { organizationId, fieldMappingId, columnDefinitionId } =
      await seedFullStack(db);

    const res = await request(app)
      .patch(`/api/field-mappings/${fieldMappingId}`)
      .set("Authorization", "Bearer test-token")
      .send({ sourceField: "name", columnDefinitionId, required: true });

    expect(res.status).toBe(200);
    const [queued] = await db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.type, "revalidation"),
          eq(jobs.organizationId, organizationId)
        )
      );
    expect(queued?.lockScopes).toEqual([
      `entity:${res.body.payload.fieldMapping.connectorEntityId}`,
    ]);
  });

  it("the post-edit revalidation logs, not throws, when a job holds the entity by then", async () => {
    const { organizationId, connectorEntityId, userId } =
      await seedFullStack(db);
    await seedJob(organizationId, "bulk_geocode", {
      connectorEntityId,
      targetConnectorEntityIds: [connectorEntityId],
    });

    await expect(
      RevalidationService.enqueueAfterEdit(
        connectorEntityId,
        organizationId,
        userId
      )
    ).resolves.toBeUndefined();
    const revalidations = await db
      .select()
      .from(jobs)
      .where(eq(jobs.type, "revalidation"));
    expect(revalidations).toHaveLength(0);
  });
});

// #769: the rest of the write paths. A job on an entity locks its connector's
// writes too, and a column definition through every entity that maps it.
describe("Job locks on entity, connector and column-definition writes (#769)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);
  });

  afterEach(async () => {
    await connection.end();
  });

  async function seedJob(
    organizationId: string,
    type: JobType,
    metadata: Record<string, unknown>
  ) {
    const id = generateId();
    await db.insert(jobs).values({
      id,
      organizationId,
      type,
      status: "active",
      progress: 0,
      metadata,
      attempts: 1,
      maxAttempts: 3,
      lockScopes: jobLockScopes(type, metadata).map(lockScopeKey),
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    return id;
  }

  async function seed() {
    const stack = await seedFullStack(db);
    const [entity] = await db
      .select()
      .from(connectorEntities)
      .where(eq(connectorEntities.id, stack.connectorEntityId));
    return { ...stack, connectorInstanceId: entity!.connectorInstanceId };
  }

  const auth = (r: request.Test) => r.set("Authorization", "Bearer test-token");

  it("an entity job refuses an edit to the entity", async () => {
    const { organizationId, connectorEntityId } = await seed();
    await seedJob(organizationId, "bulk_geocode", {
      connectorEntityId,
      targetConnectorEntityIds: [connectorEntityId],
    });

    const res = await auth(
      request(app).patch(`/api/connector-entities/${connectorEntityId}`)
    ).send({ label: "Renamed" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ApiCode.ENTITY_LOCKED_BY_JOB);
    expect(res.body.message).toMatch(/^Geocoding is running on this entity/);
  });

  it("a job on one of a connector's entities refuses editing or deleting the connector", async () => {
    const { organizationId, connectorEntityId, connectorInstanceId } =
      await seed();
    await seedJob(organizationId, "revalidation", { connectorEntityId });

    const patch = await auth(
      request(app).patch(`/api/connector-instances/${connectorInstanceId}`)
    ).send({ name: "Renamed" });
    expect(patch.status).toBe(409);
    expect(patch.body.message).toMatch(
      /^Revalidation is running on one of this connector's entities/
    );

    const del = await auth(
      request(app).delete(`/api/connector-instances/${connectorInstanceId}`)
    );
    expect(del.status).toBe(409);
    const [inst] = await db
      .select()
      .from(connectorInstances)
      .where(eq(connectorInstances.id, connectorInstanceId));
    expect(inst!.deleted).toBeNull();
  });

  it("a new entity is refused while a sibling entity is locked", async () => {
    const { organizationId, connectorEntityId, connectorInstanceId } =
      await seed();
    await seedJob(organizationId, "revalidation", { connectorEntityId });

    const res = await auth(request(app).post("/api/connector-entities")).send({
      connectorInstanceId,
      key: "sibling",
      label: "Sibling",
    });

    expect(res.status).toBe(409);
  });

  it("a sync on a mapped entity's connector refuses a column-definition edit", async () => {
    const { organizationId, connectorInstanceId, columnDefinitionId } =
      await seed();
    await seedJob(organizationId, "connector_sync", { connectorInstanceId });

    const res = await auth(
      request(app).patch(`/api/column-definitions/${columnDefinitionId}`)
    ).send({ label: "Renamed" });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(
      /^Sync is running on an entity that uses this column definition/
    );
  });

  it("every running-jobs endpoint lists a revalidation that covers it", async () => {
    const {
      organizationId,
      connectorEntityId,
      connectorInstanceId,
      columnDefinitionId,
    } = await seed();
    const jobId = await seedJob(organizationId, "revalidation", {
      connectorEntityId,
    });

    // A summary carries only the scopes the URL names: an instance or column
    // definition page learns that a job runs, not which entity it holds.
    for (const [url, lockScopes] of [
      [
        `/api/connector-entities/${connectorEntityId}/running-jobs`,
        [`entity:${connectorEntityId}`],
      ],
      [`/api/connector-instances/${connectorInstanceId}/running-jobs`, []],
      [`/api/column-definitions/${columnDefinitionId}/running-jobs`, []],
    ] as const) {
      const res = await auth(request(app).get(url));
      expect(res.status).toBe(200);
      expect(res.body.payload.runningJobs).toEqual([
        expect.objectContaining({
          id: jobId,
          type: "revalidation",
          lockScopes,
        }),
      ]);
    }
  });

  it("the column-definition running-jobs endpoint is empty when nothing runs", async () => {
    const { columnDefinitionId } = await seed();
    const res = await auth(
      request(app).get(
        `/api/column-definitions/${columnDefinitionId}/running-jobs`
      )
    );
    expect(res.status).toBe(200);
    expect(res.body.payload.runningJobs).toEqual([]);
  });

  it("the column-definition running-jobs endpoint answers 404 for an unknown id", async () => {
    await seed();
    const res = await auth(
      request(app).get(`/api/column-definitions/${generateId()}/running-jobs`)
    );
    expect(res.status).toBe(404);
  });
});
