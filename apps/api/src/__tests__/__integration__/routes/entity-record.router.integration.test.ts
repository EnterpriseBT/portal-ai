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
} = schema;

// ── Helpers ────────────────────────────────────────────────────────

const now = Date.now();

function createConnectorDefinition() {
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
  };
}

function createConnectorInstance(
  connectorDefinitionId: string,
  organizationId: string
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
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

function createConnEntity(
  organizationId: string,
  connectorInstanceId: string
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
  };
}

function createColumnDef(
  organizationId: string,
  key: string,
  type: string,
  label?: string
) {
  return {
    id: generateId(),
    organizationId,
    key,
    label: label ?? key,
    type,
    required: false,
    defaultValue: null,
    format: null,
    enumValues: null,
    description: null,
    refColumnDefinitionId: null,
    refEntityKey: null,
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
  createdBy: string
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
    created: now,
    createdBy,
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

/** Seed the full chain: user, org, definition, instance, entity, column definitions, field mappings. */
async function seedFullStack(db: ReturnType<typeof drizzle>) {
  const { userId, organizationId } = await seedUserAndOrg(db, AUTH0_ID);

  const def = createConnectorDefinition();
  await db.insert(connectorDefinitions).values(def as never);

  const inst = createConnectorInstance(def.id, organizationId);
  await db.insert(connectorInstances).values(inst as never);

  const entity = createConnEntity(organizationId, inst.id);
  await db.insert(connectorEntities).values(entity as never);

  // Column definitions for all testable types
  const cols = {
    user_id: createColumnDef(organizationId, "user_id", "number", "User ID"),
    name: createColumnDef(organizationId, "name", "string", "Name"),
    score: createColumnDef(organizationId, "score", "number", "Score"),
    is_active: createColumnDef(organizationId, "is_active", "boolean", "Active"),
    signup_date: createColumnDef(organizationId, "signup_date", "date", "Signup Date"),
    last_login: createColumnDef(organizationId, "last_login", "datetime", "Last Login"),
  };

  await db
    .insert(columnDefinitions)
    .values(Object.values(cols) as never);

  // Field mappings connect column definitions to the entity
  const mappings = Object.entries(cols).map(([key, col]) =>
    createFieldMapping(organizationId, entity.id, col.id, key)
  );
  await db.insert(fieldMappings).values(mappings as never);

  return { userId, organizationId, connectorEntityId: entity.id, cols };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("Entity Record Router — Sorting", () => {
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

  /** Build the records URL for a given entity. */
  const recordsUrl = (connectorEntityId: string) =>
    `/api/connector-entities/${connectorEntityId}/records`;

  // ── Helper: seed records and assert sort order ──────────────────

  async function seedRecordsAndSort(opts: {
    sortBy: string;
    sortOrder: "asc" | "desc";
    records: Record<string, unknown>[];
    expectedOrder: unknown[];
    fieldKey: string;
  }) {
    const { userId, organizationId, connectorEntityId } = await seedFullStack(
      db as ReturnType<typeof drizzle>
    );

    // Insert entity records
    const rows = opts.records.map((data, i) =>
      createEntityRecord(
        organizationId,
        connectorEntityId,
        data,
        String(i + 1),
        userId
      )
    );
    await (db as ReturnType<typeof drizzle>)
      .insert(entityRecords)
      .values(rows as never);

    const res = await request(app)
      .get(recordsUrl(connectorEntityId))
      .query({
        sortBy: opts.sortBy,
        sortOrder: opts.sortOrder,
        limit: 100,
      })
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const actual = res.body.payload.records.map(
      (r: { normalizedData: Record<string, unknown> }) =>
        r.normalizedData[opts.fieldKey]
    );
    expect(actual).toEqual(opts.expectedOrder);
  }

  // ── Number sorting ─────────────────────────────────────────────

  describe("number columns", () => {
    const records = [
      { user_id: "3", name: "Charlie", score: "10.5", is_active: "true", signup_date: "2023-01-01", last_login: "2023-01-01T00:00:00Z" },
      { user_id: "1", name: "Alice", score: "2.3", is_active: "false", signup_date: "2022-06-15", last_login: "2022-06-15T12:00:00Z" },
      { user_id: "20", name: "Bob", score: "100", is_active: "true", signup_date: "2024-03-10", last_login: "2024-03-10T08:30:00Z" },
      { user_id: "5", name: "Diana", score: "7.8", is_active: "false", signup_date: "2023-09-20", last_login: "2023-09-20T16:45:00Z" },
    ];

    it("should sort by numeric column ascending (user_id)", async () => {
      await seedRecordsAndSort({
        sortBy: "user_id",
        sortOrder: "asc",
        records,
        expectedOrder: ["1", "3", "5", "20"],
        fieldKey: "user_id",
      });
    });

    it("should sort by numeric column descending (user_id)", async () => {
      await seedRecordsAndSort({
        sortBy: "user_id",
        sortOrder: "desc",
        records,
        expectedOrder: ["20", "5", "3", "1"],
        fieldKey: "user_id",
      });
    });

    it("should sort by decimal number column ascending (score)", async () => {
      await seedRecordsAndSort({
        sortBy: "score",
        sortOrder: "asc",
        records,
        expectedOrder: ["2.3", "7.8", "10.5", "100"],
        fieldKey: "score",
      });
    });

    it("should sort by decimal number column descending (score)", async () => {
      await seedRecordsAndSort({
        sortBy: "score",
        sortOrder: "desc",
        records,
        expectedOrder: ["100", "10.5", "7.8", "2.3"],
        fieldKey: "score",
      });
    });
  });

  // ── String sorting ─────────────────────────────────────────────

  describe("string columns", () => {
    const records = [
      { user_id: "1", name: "Charlie", score: "1", is_active: "true", signup_date: "2023-01-01", last_login: "2023-01-01T00:00:00Z" },
      { user_id: "2", name: "Alice", score: "2", is_active: "true", signup_date: "2023-01-02", last_login: "2023-01-02T00:00:00Z" },
      { user_id: "3", name: "Bob", score: "3", is_active: "true", signup_date: "2023-01-03", last_login: "2023-01-03T00:00:00Z" },
    ];

    it("should sort by string column ascending (name)", async () => {
      await seedRecordsAndSort({
        sortBy: "name",
        sortOrder: "asc",
        records,
        expectedOrder: ["Alice", "Bob", "Charlie"],
        fieldKey: "name",
      });
    });

    it("should sort by string column descending (name)", async () => {
      await seedRecordsAndSort({
        sortBy: "name",
        sortOrder: "desc",
        records,
        expectedOrder: ["Charlie", "Bob", "Alice"],
        fieldKey: "name",
      });
    });
  });

  // ── Date sorting ───────────────────────────────────────────────

  describe("date columns", () => {
    const records = [
      { user_id: "1", name: "A", score: "1", is_active: "true", signup_date: "2024-03-10", last_login: "2024-03-10T08:30:00Z" },
      { user_id: "2", name: "B", score: "2", is_active: "true", signup_date: "2022-06-15", last_login: "2022-06-15T12:00:00Z" },
      { user_id: "3", name: "C", score: "3", is_active: "true", signup_date: "2023-01-01", last_login: "2023-01-01T00:00:00Z" },
      { user_id: "4", name: "D", score: "4", is_active: "true", signup_date: "2023-09-20", last_login: "2023-09-20T16:45:00Z" },
    ];

    it("should sort by date column ascending (signup_date)", async () => {
      await seedRecordsAndSort({
        sortBy: "signup_date",
        sortOrder: "asc",
        records,
        expectedOrder: ["2022-06-15", "2023-01-01", "2023-09-20", "2024-03-10"],
        fieldKey: "signup_date",
      });
    });

    it("should sort by date column descending (signup_date)", async () => {
      await seedRecordsAndSort({
        sortBy: "signup_date",
        sortOrder: "desc",
        records,
        expectedOrder: ["2024-03-10", "2023-09-20", "2023-01-01", "2022-06-15"],
        fieldKey: "signup_date",
      });
    });
  });

  // ── Datetime sorting ───────────────────────────────────────────

  describe("datetime columns", () => {
    const records = [
      { user_id: "1", name: "A", score: "1", is_active: "true", signup_date: "2023-01-01", last_login: "2024-03-10T08:30:00Z" },
      { user_id: "2", name: "B", score: "2", is_active: "true", signup_date: "2023-01-02", last_login: "2022-06-15T12:00:00Z" },
      { user_id: "3", name: "C", score: "3", is_active: "true", signup_date: "2023-01-03", last_login: "2023-01-01T00:00:00Z" },
      { user_id: "4", name: "D", score: "4", is_active: "true", signup_date: "2023-01-04", last_login: "2023-09-20T16:45:00Z" },
    ];

    it("should sort by datetime column ascending (last_login)", async () => {
      await seedRecordsAndSort({
        sortBy: "last_login",
        sortOrder: "asc",
        records,
        expectedOrder: [
          "2022-06-15T12:00:00Z",
          "2023-01-01T00:00:00Z",
          "2023-09-20T16:45:00Z",
          "2024-03-10T08:30:00Z",
        ],
        fieldKey: "last_login",
      });
    });

    it("should sort by datetime column descending (last_login)", async () => {
      await seedRecordsAndSort({
        sortBy: "last_login",
        sortOrder: "desc",
        records,
        expectedOrder: [
          "2024-03-10T08:30:00Z",
          "2023-09-20T16:45:00Z",
          "2023-01-01T00:00:00Z",
          "2022-06-15T12:00:00Z",
        ],
        fieldKey: "last_login",
      });
    });
  });

  // ── Null / empty value handling ──────────────────────────────────

  describe("null and empty value handling", () => {
    it("should sort numeric column with missing values (nulls last)", async () => {
      await seedRecordsAndSort({
        sortBy: "score",
        sortOrder: "asc",
        records: [
          { user_id: "1", name: "A", score: "50", is_active: "true", signup_date: "2023-01-01", last_login: "2023-01-01T00:00:00Z" },
          { user_id: "2", name: "B", score: "", is_active: "true", signup_date: "2023-01-02", last_login: "2023-01-02T00:00:00Z" },
          { user_id: "3", name: "C", score: "10", is_active: "true", signup_date: "2023-01-03", last_login: "2023-01-03T00:00:00Z" },
        ],
        // Empty string treated as null, pushed to end
        expectedOrder: ["10", "50", ""],
        fieldKey: "score",
      });
    });

    it("should sort numeric column with missing values descending (nulls last)", async () => {
      await seedRecordsAndSort({
        sortBy: "score",
        sortOrder: "desc",
        records: [
          { user_id: "1", name: "A", score: "50", is_active: "true", signup_date: "2023-01-01", last_login: "2023-01-01T00:00:00Z" },
          { user_id: "2", name: "B", score: "", is_active: "true", signup_date: "2023-01-02", last_login: "2023-01-02T00:00:00Z" },
          { user_id: "3", name: "C", score: "10", is_active: "true", signup_date: "2023-01-03", last_login: "2023-01-03T00:00:00Z" },
        ],
        expectedOrder: ["50", "10", ""],
        fieldKey: "score",
      });
    });

    it("should sort date column with missing values (nulls last)", async () => {
      await seedRecordsAndSort({
        sortBy: "signup_date",
        sortOrder: "asc",
        records: [
          { user_id: "1", name: "A", score: "1", is_active: "true", signup_date: "2024-01-15", last_login: "2024-01-15T00:00:00Z" },
          { user_id: "2", name: "B", score: "2", is_active: "true", signup_date: "", last_login: "2023-01-01T00:00:00Z" },
          { user_id: "3", name: "C", score: "3", is_active: "true", signup_date: "2023-06-01", last_login: "2023-06-01T00:00:00Z" },
        ],
        expectedOrder: ["2023-06-01", "2024-01-15", ""],
        fieldKey: "signup_date",
      });
    });

    it("should handle records where the sort key is entirely absent", async () => {
      const { userId, organizationId, connectorEntityId } =
        await seedFullStack(db as ReturnType<typeof drizzle>);

      // One record has score, the other doesn't have the key at all
      const rows = [
        createEntityRecord(
          organizationId, connectorEntityId,
          { user_id: "1", name: "A", is_active: "true", signup_date: "2023-01-01", last_login: "2023-01-01T00:00:00Z" },
          "1", userId
        ),
        createEntityRecord(
          organizationId, connectorEntityId,
          { user_id: "2", name: "B", score: "42", is_active: "true", signup_date: "2023-01-02", last_login: "2023-01-02T00:00:00Z" },
          "2", userId
        ),
      ];
      await (db as ReturnType<typeof drizzle>)
        .insert(entityRecords)
        .values(rows as never);

      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({ sortBy: "score", sortOrder: "asc", limit: 100 })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      // Record with score=42 comes first, missing key sorts last
      const scores = res.body.payload.records.map(
        (r: { normalizedData: Record<string, unknown> }) =>
          r.normalizedData.score ?? null
      );
      expect(scores).toEqual(["42", null]);
    });
  });

  // ── Invalid / mixed data handling ───────────────────────────────

  describe("invalid data handling", () => {
    it("should not fail when numeric column contains non-numeric text", async () => {
      await seedRecordsAndSort({
        sortBy: "score",
        sortOrder: "asc",
        records: [
          { user_id: "1", name: "A", score: "25", is_active: "true", signup_date: "2023-01-01", last_login: "2023-01-01T00:00:00Z" },
          { user_id: "2", name: "B", score: "N/A", is_active: "true", signup_date: "2023-01-02", last_login: "2023-01-02T00:00:00Z" },
          { user_id: "3", name: "C", score: "10", is_active: "true", signup_date: "2023-01-03", last_login: "2023-01-03T00:00:00Z" },
        ],
        // Non-numeric "N/A" treated as NULL, pushed to end
        expectedOrder: ["10", "25", "N/A"],
        fieldKey: "score",
      });
    });

    it("should fall back to created sort for non-sortable boolean column", async () => {
      const { userId, organizationId, connectorEntityId } =
        await seedFullStack(db as ReturnType<typeof drizzle>);

      const rows = [
        createEntityRecord(organizationId, connectorEntityId, { user_id: "1", name: "A", score: "1", is_active: "false", signup_date: "2023-01-01", last_login: "2023-01-01T00:00:00Z" }, "1", userId),
        createEntityRecord(organizationId, connectorEntityId, { user_id: "2", name: "B", score: "2", is_active: "true", signup_date: "2023-01-02", last_login: "2023-01-02T00:00:00Z" }, "2", userId),
      ];
      rows[0].created = now - 1000;
      rows[1].created = now;

      await (db as ReturnType<typeof drizzle>)
        .insert(entityRecords)
        .values(rows as never);

      // Boolean is not sortable, so it falls back to created asc
      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({ sortBy: "is_active", sortOrder: "asc", limit: 100 })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      const ids = res.body.payload.records.map(
        (r: { sourceId: string }) => r.sourceId
      );
      expect(ids).toEqual(["1", "2"]);
    });
  });

  // ── Table column sorting (fallback) ────────────────────────────

  describe("table column sorting", () => {
    it("should sort by built-in created column ascending", async () => {
      const { userId, organizationId, connectorEntityId } =
        await seedFullStack(db as ReturnType<typeof drizzle>);

      const rows = [
        createEntityRecord(organizationId, connectorEntityId, { user_id: "1", name: "A", score: "1", is_active: "true", signup_date: "2023-01-01", last_login: "2023-01-01T00:00:00Z" }, "1", userId),
        createEntityRecord(organizationId, connectorEntityId, { user_id: "2", name: "B", score: "2", is_active: "true", signup_date: "2023-01-02", last_login: "2023-01-02T00:00:00Z" }, "2", userId),
      ];
      // Offset the created timestamps so ordering is deterministic
      rows[0].created = now - 1000;
      rows[1].created = now;

      await (db as ReturnType<typeof drizzle>)
        .insert(entityRecords)
        .values(rows as never);

      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({ sortBy: "created", sortOrder: "asc", limit: 100 })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      const ids = res.body.payload.records.map(
        (r: { sourceId: string }) => r.sourceId
      );
      expect(ids).toEqual(["1", "2"]);
    });

    it("should fall back to created when sortBy is unknown", async () => {
      const { userId, organizationId, connectorEntityId } =
        await seedFullStack(db as ReturnType<typeof drizzle>);

      const rows = [
        createEntityRecord(organizationId, connectorEntityId, { user_id: "1", name: "A", score: "1", is_active: "true", signup_date: "2023-01-01", last_login: "2023-01-01T00:00:00Z" }, "1", userId),
        createEntityRecord(organizationId, connectorEntityId, { user_id: "2", name: "B", score: "2", is_active: "true", signup_date: "2023-01-02", last_login: "2023-01-02T00:00:00Z" }, "2", userId),
      ];
      rows[0].created = now - 1000;
      rows[1].created = now;

      await (db as ReturnType<typeof drizzle>)
        .insert(entityRecords)
        .values(rows as never);

      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({ sortBy: "nonexistent_field", sortOrder: "desc", limit: 100 })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      // Falls back to sorting by created desc
      const ids = res.body.payload.records.map(
        (r: { sourceId: string }) => r.sourceId
      );
      expect(ids).toEqual(["2", "1"]);
    });
  });
});
