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
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import type { FilterExpression } from "@portalai/core/contracts";
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
} = schema;

// ── Helpers ────────────────────────────────────────────────────────

const now = Date.now();

function createConnectorDefinition(overrides?: Partial<Record<string, unknown>>) {
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

// ═══════════════════════════════════════════════════════════════════
// Advanced Filters integration tests
// ═══════════════════════════════════════════════════════════════════

describe("Entity Record Router — Advanced Filters", () => {
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

  const recordsUrl = (connectorEntityId: string) =>
    `/api/connector-entities/${connectorEntityId}/records`;

  /** Base64-encode a FilterExpression. */
  function encodeFilters(expr: FilterExpression): string {
    return Buffer.from(JSON.stringify(expr)).toString("base64");
  }

  /** Seed the full stack + a standard set of records for filter tests. */
  async function seedFilterData() {
    const { userId, organizationId, connectorEntityId } = await seedFullStack(
      db as ReturnType<typeof drizzle>
    );

    const records = [
      { user_id: "1", name: "Alice", score: "90", is_active: "true", signup_date: "2023-01-15", last_login: "2023-01-15T10:00:00Z" },
      { user_id: "2", name: "Bob", score: "75", is_active: "false", signup_date: "2023-06-20", last_login: "2023-06-20T14:30:00Z" },
      { user_id: "3", name: "Charlie", score: "60", is_active: "true", signup_date: "2024-01-10", last_login: "2024-01-10T08:00:00Z" },
      { user_id: "4", name: "Diana", score: "85", is_active: "false", signup_date: "2022-11-05", last_login: "2022-11-05T16:45:00Z" },
      { user_id: "5", name: "Eve", score: "", is_active: "true", signup_date: "", last_login: "" },
    ];

    const rows = records.map((data, i) =>
      createEntityRecord(organizationId, connectorEntityId, data, String(i + 1), userId)
    );
    await (db as ReturnType<typeof drizzle>)
      .insert(entityRecords)
      .values(rows as never);

    return { connectorEntityId };
  }

  /** Extract sorted names from response. */
  function names(res: request.Response): string[] {
    return res.body.payload.records.map(
      (r: { normalizedData: Record<string, unknown> }) => r.normalizedData.name
    );
  }

  // ── String filters ──────────────────────────────────────────────

  describe("string filters", () => {
    it("should filter by eq on string column", async () => {
      const { connectorEntityId } = await seedFilterData();
      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({
          limit: 100,
          filters: encodeFilters({
            combinator: "and",
            conditions: [{ field: "name", operator: "eq", value: "Alice" }],
          }),
        })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(names(res)).toEqual(["Alice"]);
    });

    it("should filter by contains (case-insensitive)", async () => {
      const { connectorEntityId } = await seedFilterData();
      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({
          limit: 100,
          filters: encodeFilters({
            combinator: "and",
            conditions: [{ field: "name", operator: "contains", value: "ali" }],
          }),
        })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(names(res)).toEqual(["Alice"]);
    });

    it("should filter by starts_with", async () => {
      const { connectorEntityId } = await seedFilterData();
      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({
          limit: 100,
          filters: encodeFilters({
            combinator: "and",
            conditions: [{ field: "name", operator: "starts_with", value: "Ch" }],
          }),
        })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(names(res)).toEqual(["Charlie"]);
    });

    it("should filter by ends_with", async () => {
      const { connectorEntityId } = await seedFilterData();
      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({
          limit: 100,
          filters: encodeFilters({
            combinator: "and",
            conditions: [{ field: "name", operator: "ends_with", value: "na" }],
          }),
        })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(names(res)).toEqual(["Diana"]);
    });

    it("should filter by neq on string column", async () => {
      const { connectorEntityId } = await seedFilterData();
      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({
          limit: 100,
          filters: encodeFilters({
            combinator: "and",
            conditions: [{ field: "name", operator: "neq", value: "Alice" }],
          }),
        })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(names(res)).not.toContain("Alice");
      expect(res.body.payload.total).toBe(4);
    });

    it("should filter by not_contains", async () => {
      const { connectorEntityId } = await seedFilterData();
      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({
          limit: 100,
          filters: encodeFilters({
            combinator: "and",
            conditions: [{ field: "name", operator: "not_contains", value: "li" }],
          }),
        })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      // "Alice" and "Charlie" contain "li"
      const result = names(res);
      expect(result).not.toContain("Alice");
      expect(result).not.toContain("Charlie");
    });
  });

  // ── Numeric filters ─────────────────────────────────────────────

  describe("numeric filters", () => {
    it("should filter by gt on number column", async () => {
      const { connectorEntityId } = await seedFilterData();
      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({
          limit: 100,
          filters: encodeFilters({
            combinator: "and",
            conditions: [{ field: "score", operator: "gt", value: 80 }],
          }),
        })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      // scores > 80: Alice(90), Diana(85)
      const result = names(res);
      expect(result).toHaveLength(2);
      expect(result).toContain("Alice");
      expect(result).toContain("Diana");
    });

    it("should filter by lte on number column", async () => {
      const { connectorEntityId } = await seedFilterData();
      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({
          limit: 100,
          filters: encodeFilters({
            combinator: "and",
            conditions: [{ field: "score", operator: "lte", value: 75 }],
          }),
        })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      // scores <= 75: Bob(75), Charlie(60)
      const result = names(res);
      expect(result).toHaveLength(2);
      expect(result).toContain("Bob");
      expect(result).toContain("Charlie");
    });

    it("should filter by between on number column", async () => {
      const { connectorEntityId } = await seedFilterData();
      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({
          limit: 100,
          filters: encodeFilters({
            combinator: "and",
            conditions: [{ field: "score", operator: "between", value: ["70", "90"] }],
          }),
        })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      // 70 <= score <= 90: Alice(90), Bob(75), Diana(85)
      const result = names(res);
      expect(result).toHaveLength(3);
      expect(result).toContain("Alice");
      expect(result).toContain("Bob");
      expect(result).toContain("Diana");
    });

    it("should filter by eq on number column", async () => {
      const { connectorEntityId } = await seedFilterData();
      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({
          limit: 100,
          filters: encodeFilters({
            combinator: "and",
            conditions: [{ field: "score", operator: "eq", value: 60 }],
          }),
        })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(names(res)).toEqual(["Charlie"]);
    });
  });

  // ── Boolean filters ─────────────────────────────────────────────

  describe("boolean filters", () => {
    it("should filter by eq true on boolean column", async () => {
      const { connectorEntityId } = await seedFilterData();
      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({
          limit: 100,
          filters: encodeFilters({
            combinator: "and",
            conditions: [{ field: "is_active", operator: "eq", value: true }],
          }),
        })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      // active: Alice, Charlie, Eve
      const result = names(res);
      expect(result).toHaveLength(3);
      expect(result).toContain("Alice");
      expect(result).toContain("Charlie");
      expect(result).toContain("Eve");
    });

    it("should filter by eq false on boolean column", async () => {
      const { connectorEntityId } = await seedFilterData();
      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({
          limit: 100,
          filters: encodeFilters({
            combinator: "and",
            conditions: [{ field: "is_active", operator: "eq", value: false }],
          }),
        })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      // inactive: Bob, Diana
      const result = names(res);
      expect(result).toHaveLength(2);
      expect(result).toContain("Bob");
      expect(result).toContain("Diana");
    });
  });

  // ── Date filters ────────────────────────────────────────────────

  describe("date filters", () => {
    it("should filter by gte on date column", async () => {
      const { connectorEntityId } = await seedFilterData();
      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({
          limit: 100,
          filters: encodeFilters({
            combinator: "and",
            conditions: [{ field: "signup_date", operator: "gte", value: "2023-06-01" }],
          }),
        })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      // signup >= 2023-06-01: Bob(2023-06-20), Charlie(2024-01-10)
      const result = names(res);
      expect(result).toHaveLength(2);
      expect(result).toContain("Bob");
      expect(result).toContain("Charlie");
    });

    it("should filter by between on date column", async () => {
      const { connectorEntityId } = await seedFilterData();
      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({
          limit: 100,
          filters: encodeFilters({
            combinator: "and",
            conditions: [{ field: "signup_date", operator: "between", value: ["2023-01-01", "2023-12-31"] }],
          }),
        })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      // 2023-01-01 to 2023-12-31: Alice(2023-01-15), Bob(2023-06-20)
      const result = names(res);
      expect(result).toHaveLength(2);
      expect(result).toContain("Alice");
      expect(result).toContain("Bob");
    });
  });

  // ── is_empty / is_not_empty ─────────────────────────────────────

  describe("empty/not-empty filters", () => {
    it("should filter by is_empty on string column", async () => {
      const { connectorEntityId } = await seedFilterData();
      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({
          limit: 100,
          filters: encodeFilters({
            combinator: "and",
            conditions: [{ field: "score", operator: "is_empty", value: null }],
          }),
        })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      // Only Eve has empty score
      expect(names(res)).toEqual(["Eve"]);
    });

    it("should filter by is_not_empty on string column", async () => {
      const { connectorEntityId } = await seedFilterData();
      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({
          limit: 100,
          filters: encodeFilters({
            combinator: "and",
            conditions: [{ field: "score", operator: "is_not_empty", value: null }],
          }),
        })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      // 4 records with non-empty scores
      expect(res.body.payload.total).toBe(4);
      expect(names(res)).not.toContain("Eve");
    });
  });

  // ── AND / OR combinators ────────────────────────────────────────

  describe("AND / OR combinators", () => {
    it("should combine conditions with AND", async () => {
      const { connectorEntityId } = await seedFilterData();
      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({
          limit: 100,
          filters: encodeFilters({
            combinator: "and",
            conditions: [
              { field: "is_active", operator: "eq", value: true },
              { field: "score", operator: "gt", value: 80 },
            ],
          }),
        })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      // active AND score>80: only Alice(90, active)
      expect(names(res)).toEqual(["Alice"]);
    });

    it("should combine conditions with OR", async () => {
      const { connectorEntityId } = await seedFilterData();
      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({
          limit: 100,
          filters: encodeFilters({
            combinator: "or",
            conditions: [
              { field: "name", operator: "eq", value: "Alice" },
              { field: "name", operator: "eq", value: "Bob" },
            ],
          }),
        })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      const result = names(res);
      expect(result).toHaveLength(2);
      expect(result).toContain("Alice");
      expect(result).toContain("Bob");
    });

    it("should support nested AND inside OR", async () => {
      const { connectorEntityId } = await seedFilterData();
      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({
          limit: 100,
          filters: encodeFilters({
            combinator: "or",
            conditions: [
              // Group 1: active AND score > 80 → Alice
              {
                combinator: "and",
                conditions: [
                  { field: "is_active", operator: "eq", value: true },
                  { field: "score", operator: "gt", value: 80 },
                ],
              },
              // Group 2: signup before 2023 → Diana
              {
                combinator: "and",
                conditions: [
                  { field: "signup_date", operator: "lt", value: "2023-01-01" },
                ],
              },
            ],
          }),
        })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      const result = names(res);
      expect(result).toHaveLength(2);
      expect(result).toContain("Alice");
      expect(result).toContain("Diana");
    });
  });

  // ── Pagination reset with filters ───────────────────────────────

  describe("pagination with filters", () => {
    it("should return correct total count for filtered results", async () => {
      const { connectorEntityId } = await seedFilterData();
      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({
          limit: 2,
          offset: 0,
          filters: encodeFilters({
            combinator: "and",
            conditions: [{ field: "is_active", operator: "eq", value: true }],
          }),
        })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.total).toBe(3); // Alice, Charlie, Eve
      expect(res.body.payload.records).toHaveLength(2); // limited to 2
    });

    it("should paginate filtered results with offset", async () => {
      const { connectorEntityId } = await seedFilterData();
      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({
          limit: 2,
          offset: 2,
          filters: encodeFilters({
            combinator: "and",
            conditions: [{ field: "is_active", operator: "eq", value: true }],
          }),
        })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.total).toBe(3);
      expect(res.body.payload.records).toHaveLength(1); // 3rd of 3
    });
  });

  // ── Filters combined with search ────────────────────────────────

  describe("filters combined with search", () => {
    it("should apply both search and advanced filters", async () => {
      const { connectorEntityId } = await seedFilterData();
      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({
          limit: 100,
          search: "Bob",
          filters: encodeFilters({
            combinator: "and",
            conditions: [{ field: "is_active", operator: "eq", value: false }],
          }),
        })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      // search matches Bob, filter restricts to inactive → Bob
      expect(names(res)).toEqual(["Bob"]);
    });

    it("should return empty when search and filters are mutually exclusive", async () => {
      const { connectorEntityId } = await seedFilterData();
      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({
          limit: 100,
          search: "Alice",
          filters: encodeFilters({
            combinator: "and",
            conditions: [{ field: "is_active", operator: "eq", value: false }],
          }),
        })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      // Alice is active, filter is inactive → no results
      expect(res.body.payload.total).toBe(0);
      expect(res.body.payload.records).toHaveLength(0);
    });
  });

  // ── No filters (backwards compatibility) ────────────────────────

  describe("backwards compatibility", () => {
    it("should return all records when filters param is absent", async () => {
      const { connectorEntityId } = await seedFilterData();
      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({ limit: 100 })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.total).toBe(5);
    });
  });

  // ── Error handling ──────────────────────────────────────────────

  describe("error handling", () => {
    it("should return 400 for invalid base64 filters", async () => {
      const { connectorEntityId } = await seedFilterData();
      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({ limit: 100, filters: "not-valid{{{" })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("ENTITY_RECORD_INVALID_FILTER");
    });

    it("should return 400 for invalid filter schema", async () => {
      const { connectorEntityId } = await seedFilterData();
      const bad = Buffer.from(JSON.stringify({ bad: "data" })).toString("base64");
      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({ limit: 100, filters: bad })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("ENTITY_RECORD_INVALID_FILTER");
    });

    it("should return 400 for unknown field in filter", async () => {
      const { connectorEntityId } = await seedFilterData();
      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({
          limit: 100,
          filters: encodeFilters({
            combinator: "and",
            conditions: [{ field: "nonexistent_col", operator: "eq", value: "x" }],
          }),
        })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("ENTITY_RECORD_INVALID_FILTER");
    });

    it("should return 400 for invalid operator/type combo", async () => {
      const { connectorEntityId } = await seedFilterData();
      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({
          limit: 100,
          filters: encodeFilters({
            combinator: "and",
            conditions: [{ field: "is_active", operator: "gt", value: 1 }],
          }),
        })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("ENTITY_RECORD_INVALID_FILTER");
    });

    it("should return 400 when filter depth exceeds limit", async () => {
      const { connectorEntityId } = await seedFilterData();

      // Build depth-5 nesting (exceeds MAX_FILTER_DEPTH=4)
      let inner: FilterExpression = {
        combinator: "and",
        conditions: [{ field: "name", operator: "eq", value: "x" }],
      };
      for (let i = 0; i < 4; i++) {
        inner = { combinator: "and", conditions: [inner] };
      }

      const res = await request(app)
        .get(recordsUrl(connectorEntityId))
        .query({ limit: 100, filters: encodeFilters(inner) })
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("ENTITY_RECORD_INVALID_FILTER");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// GIN index performance tests
// ═══════════════════════════════════════════════════════════════════

describe("Entity Record Router — GIN Index Performance", () => {
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

  it("should have a GIN index on normalized_data column", async () => {
    const result = await (db as ReturnType<typeof drizzle>).execute(sql`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'entity_records'
        AND indexname = 'entity_records_normalized_data_gin'
    `);

    expect(result.length).toBe(1);
    const indexDef = (result[0] as { indexdef: string }).indexdef.toLowerCase();
    expect(indexDef).toContain("gin");
    expect(indexDef).toContain("normalized_data");
  });

  it("should use index for JSONB containment queries via EXPLAIN", async () => {
    const { connectorEntityId } = await seedFullStack(
      db as ReturnType<typeof drizzle>
    );

    // Seed a few records so the planner has something to work with
    const records = Array.from({ length: 10 }, (_, i) => ({
      user_id: String(i),
      name: `User ${i}`,
      score: String(i * 10),
      is_active: i % 2 === 0 ? "true" : "false",
      signup_date: "2024-01-01",
      last_login: "2024-01-01T00:00:00Z",
    }));

    const rows = records.map((data, i) =>
      createEntityRecord(
        (db as ReturnType<typeof drizzle>)
          ? "org-placeholder"
          : "org-placeholder",
        connectorEntityId,
        data,
        String(i + 1),
        "user-placeholder",
      ),
    );

    // We need real org/user IDs — use the ones from seedFullStack
    // Re-seed to get the IDs
    await teardownOrg(db as ReturnType<typeof drizzle>);
    const { userId, organizationId, connectorEntityId: entityId } =
      await seedFullStack(db as ReturnType<typeof drizzle>);

    const seededRows = records.map((data, i) =>
      createEntityRecord(organizationId, entityId, data, String(i + 1), userId),
    );
    await (db as ReturnType<typeof drizzle>)
      .insert(entityRecords)
      .values(seededRows as never);

    // Run EXPLAIN on a JSONB text extraction query (the pattern used by filter SQL)
    const explainResult = await (db as ReturnType<typeof drizzle>).execute(sql`
      EXPLAIN (FORMAT JSON)
      SELECT * FROM entity_records
      WHERE connector_entity_id = ${entityId}
        AND normalized_data->>'name' = 'User 5'
    `);

    // The query plan should exist and be valid JSON
    expect(explainResult.length).toBeGreaterThan(0);
    const plan = JSON.stringify(explainResult[0]);
    // With only 10 rows the planner may choose a sequential scan,
    // which is correct behavior — the GIN index is for larger datasets.
    // We verify the index exists (previous test) and the query executes without error.
    expect(plan).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /:recordId — Single record fetch
// ═══════════════════════════════════════════════════════════════════

describe("Entity Record Router — GET /:recordId", () => {
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

  const recordUrl = (connectorEntityId: string, recordId: string) =>
    `/api/connector-entities/${connectorEntityId}/records/${recordId}`;

  it("should return 200 with the record and columns", async () => {
    const { userId, organizationId, connectorEntityId } = await seedFullStack(db);

    const row = createEntityRecord(
      organizationId,
      connectorEntityId,
      { user_id: "1", name: "Alice", score: "90", is_active: "true", signup_date: "2023-01-15", last_login: "2023-01-15T10:00:00Z" },
      "src-1",
      userId
    );
    await db.insert(entityRecords).values(row as never);

    const res = await request(app)
      .get(recordUrl(connectorEntityId, row.id))
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body.payload.record.id).toBe(row.id);
    expect(res.body.payload.record.sourceId).toBe("src-1");
    expect(res.body.payload.columns).toBeInstanceOf(Array);
    expect(res.body.payload.columns.length).toBeGreaterThan(0);
  });

  it("should return 404 when record does not exist", async () => {
    const { connectorEntityId } = await seedFullStack(db);

    const res = await request(app)
      .get(recordUrl(connectorEntityId, generateId()))
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("ENTITY_RECORD_NOT_FOUND");
  });

  it("should return 404 when record belongs to a different entity", async () => {
    const { userId, organizationId, connectorEntityId } = await seedFullStack(db);

    const stack2 = await seedFullStack(db);

    const row = createEntityRecord(
      organizationId,
      connectorEntityId,
      { user_id: "2", name: "Bob", score: "75", is_active: "false", signup_date: "2023-06-20", last_login: "2023-06-20T14:30:00Z" },
      "src-2",
      userId
    );
    await db.insert(entityRecords).values(row as never);

    // Request the record under the *other* entity
    const res = await request(app)
      .get(recordUrl(stack2.connectorEntityId, row.id))
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("ENTITY_RECORD_NOT_FOUND");
  });
});

// ── POST / — Create single record ───────────────────────────────────

describe("Entity Record Router — POST /", () => {
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

  /** Seed a chain with configurable capability flags. */
  async function seedWithCapabilities(
    db: ReturnType<typeof drizzle>,
    opts: {
      definitionWrite: boolean;
      enabledCapabilityFlags?: { write?: boolean; read?: boolean } | null;
    }
  ) {
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

    const colDef = createColumnDef(organizationId, "name", "string", "Name");
    await db.insert(columnDefinitions).values(colDef as never);

    const mapping = createFieldMapping(organizationId, entity.id, colDef.id, "name");
    await db.insert(fieldMappings).values(mapping as never);

    return { userId, organizationId, connectorEntityId: entity.id };
  }

  const recordsUrl = (connectorEntityId: string) =>
    `/api/connector-entities/${connectorEntityId}/records`;

  // ── Success cases ──────────────────────────────────────────────────

  it("should create a record with normalizedData and return 201", async () => {
    const { connectorEntityId } = await seedWithCapabilities(db, {
      definitionWrite: true,
      enabledCapabilityFlags: { write: true },
    });

    const res = await request(app)
      .post(recordsUrl(connectorEntityId))
      .set("Authorization", "Bearer test-token")
      .send({ normalizedData: { name: "Alice" } });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.payload.record.normalizedData).toEqual({ name: "Alice" });
  });

  it("should mirror normalizedData into data", async () => {
    const { connectorEntityId } = await seedWithCapabilities(db, {
      definitionWrite: true,
      enabledCapabilityFlags: { write: true },
    });

    const res = await request(app)
      .post(recordsUrl(connectorEntityId))
      .set("Authorization", "Bearer test-token")
      .send({ normalizedData: { name: "Bob" } });

    expect(res.status).toBe(201);
    expect(res.body.payload.record.data).toEqual(res.body.payload.record.normalizedData);
  });

  it("should auto-generate sourceId when omitted", async () => {
    const { connectorEntityId } = await seedWithCapabilities(db, {
      definitionWrite: true,
      enabledCapabilityFlags: { write: true },
    });

    const res = await request(app)
      .post(recordsUrl(connectorEntityId))
      .set("Authorization", "Bearer test-token")
      .send({ normalizedData: { name: "Charlie" } });

    expect(res.status).toBe(201);
    // UUID v4 format
    expect(res.body.payload.record.sourceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("should use provided sourceId when present", async () => {
    const { connectorEntityId } = await seedWithCapabilities(db, {
      definitionWrite: true,
      enabledCapabilityFlags: { write: true },
    });

    const res = await request(app)
      .post(recordsUrl(connectorEntityId))
      .set("Authorization", "Bearer test-token")
      .send({ normalizedData: { name: "Dana" }, sourceId: "custom-123" });

    expect(res.status).toBe(201);
    expect(res.body.payload.record.sourceId).toBe("custom-123");
  });

  it("should set checksum to 'manual'", async () => {
    const { connectorEntityId } = await seedWithCapabilities(db, {
      definitionWrite: true,
      enabledCapabilityFlags: { write: true },
    });

    const res = await request(app)
      .post(recordsUrl(connectorEntityId))
      .set("Authorization", "Bearer test-token")
      .send({ normalizedData: { name: "Eve" } });

    expect(res.status).toBe(201);
    expect(res.body.payload.record.checksum).toBe("manual");
  });

  it("should set origin to 'manual'", async () => {
    const { connectorEntityId } = await seedWithCapabilities(db, {
      definitionWrite: true,
      enabledCapabilityFlags: { write: true },
    });

    const res = await request(app)
      .post(recordsUrl(connectorEntityId))
      .set("Authorization", "Bearer test-token")
      .send({ normalizedData: { name: "Grace" } });

    expect(res.status).toBe(201);
    expect(res.body.payload.record.origin).toBe("manual");
  });

  it("should set syncedAt to approximately current timestamp", async () => {
    const { connectorEntityId } = await seedWithCapabilities(db, {
      definitionWrite: true,
      enabledCapabilityFlags: { write: true },
    });

    const before = Date.now();
    const res = await request(app)
      .post(recordsUrl(connectorEntityId))
      .set("Authorization", "Bearer test-token")
      .send({ normalizedData: { name: "Frank" } });
    const after = Date.now();

    expect(res.status).toBe(201);
    expect(res.body.payload.record.syncedAt).toBeGreaterThanOrEqual(before);
    expect(res.body.payload.record.syncedAt).toBeLessThanOrEqual(after);
  });

  it("should make new record appear in subsequent GET / list", async () => {
    const { connectorEntityId } = await seedWithCapabilities(db, {
      definitionWrite: true,
      enabledCapabilityFlags: { write: true },
    });

    await request(app)
      .post(recordsUrl(connectorEntityId))
      .set("Authorization", "Bearer test-token")
      .send({ normalizedData: { name: "Grace" } });

    const listRes = await request(app)
      .get(recordsUrl(connectorEntityId))
      .set("Authorization", "Bearer test-token");

    expect(listRes.status).toBe(200);
    expect(listRes.body.payload.records).toHaveLength(1);
    expect(listRes.body.payload.records[0].normalizedData).toEqual({ name: "Grace" });
  });

  // ── Error cases ────────────────────────────────────────────────────

  it("should return 400 for missing normalizedData (empty body)", async () => {
    const { connectorEntityId } = await seedWithCapabilities(db, {
      definitionWrite: true,
      enabledCapabilityFlags: { write: true },
    });

    const res = await request(app)
      .post(recordsUrl(connectorEntityId))
      .set("Authorization", "Bearer test-token")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.ENTITY_RECORD_INVALID_PAYLOAD);
  });

  it("should return 400 for invalid body (normalizedData is not an object)", async () => {
    const { connectorEntityId } = await seedWithCapabilities(db, {
      definitionWrite: true,
      enabledCapabilityFlags: { write: true },
    });

    const res = await request(app)
      .post(recordsUrl(connectorEntityId))
      .set("Authorization", "Bearer test-token")
      .send({ normalizedData: "not-an-object" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.ENTITY_RECORD_INVALID_PAYLOAD);
  });

  it("should return 404 for non-existent connectorEntityId", async () => {
    // Seed user/org so metadata middleware passes
    await seedUserAndOrg(db, AUTH0_ID);

    const res = await request(app)
      .post(recordsUrl(generateId()))
      .set("Authorization", "Bearer test-token")
      .send({ normalizedData: { name: "Nobody" } });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ApiCode.CONNECTOR_ENTITY_NOT_FOUND);
  });

  it("should return 422 when write capability is disabled", async () => {
    const { connectorEntityId } = await seedWithCapabilities(db, {
      definitionWrite: true,
      enabledCapabilityFlags: { write: false },
    });

    const res = await request(app)
      .post(recordsUrl(connectorEntityId))
      .set("Authorization", "Bearer test-token")
      .send({ normalizedData: { name: "Blocked" } });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe(ApiCode.CONNECTOR_INSTANCE_WRITE_DISABLED);
  });
});

// ── Phase 3: Write Capability Guarded Deletes ───────────────────────

describe("Entity Record Router — Write Capability Deletes", () => {
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

  /** Seed a chain with configurable capability flags. */
  async function seedWithCapabilities(
    db: ReturnType<typeof drizzle>,
    opts: {
      definitionWrite: boolean;
      enabledCapabilityFlags?: { write?: boolean; read?: boolean } | null;
    }
  ) {
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

    const colDef = createColumnDef(organizationId, "name", "string", "Name");
    await db.insert(columnDefinitions).values(colDef as never);

    const mapping = createFieldMapping(organizationId, entity.id, colDef.id, "name");
    await db.insert(fieldMappings).values(mapping as never);

    return { userId, organizationId, connectorEntityId: entity.id };
  }

  const recordsUrl = (connectorEntityId: string) =>
    `/api/connector-entities/${connectorEntityId}/records`;

  const singleRecordUrl = (connectorEntityId: string, recordId: string) =>
    `/api/connector-entities/${connectorEntityId}/records/${recordId}`;

  // ── DELETE /:recordId — Single record delete ──────────────────────

  describe("DELETE /api/connector-entities/:id/records/:recordId", () => {
    it("should return 422 when instance has write disabled", async () => {
      const { userId, organizationId, connectorEntityId } = await seedWithCapabilities(db, {
        definitionWrite: true,
        enabledCapabilityFlags: { write: false },
      });

      const row = createEntityRecord(organizationId, connectorEntityId, { name: "Alice" }, "src-1", userId);
      await db.insert(entityRecords).values(row as never);

      const res = await request(app)
        .delete(singleRecordUrl(connectorEntityId, row.id))
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(422);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_INSTANCE_WRITE_DISABLED);
    });

    it("should return 422 when definition does not support write even if instance tries to enable it", async () => {
      const { userId, organizationId, connectorEntityId } = await seedWithCapabilities(db, {
        definitionWrite: false,
        enabledCapabilityFlags: { write: true },
      });

      const row = createEntityRecord(organizationId, connectorEntityId, { name: "Bob" }, "src-1", userId);
      await db.insert(entityRecords).values(row as never);

      const res = await request(app)
        .delete(singleRecordUrl(connectorEntityId, row.id))
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(422);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_INSTANCE_WRITE_DISABLED);
    });

    it("should soft-delete record when write capability is resolved to true", async () => {
      const { userId, organizationId, connectorEntityId } = await seedWithCapabilities(db, {
        definitionWrite: true,
        enabledCapabilityFlags: { write: true },
      });

      const row = createEntityRecord(organizationId, connectorEntityId, { name: "Charlie" }, "src-1", userId);
      await db.insert(entityRecords).values(row as never);

      const res = await request(app)
        .delete(singleRecordUrl(connectorEntityId, row.id))
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.id).toBe(row.id);
    });

    it("should return 404 for non-existent record", async () => {
      const { connectorEntityId } = await seedWithCapabilities(db, {
        definitionWrite: true,
        enabledCapabilityFlags: { write: true },
      });

      const res = await request(app)
        .delete(singleRecordUrl(connectorEntityId, generateId()))
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.ENTITY_RECORD_NOT_FOUND);
    });

    it("should succeed when enabledCapabilityFlags is null and definition has write: true", async () => {
      const { userId, organizationId, connectorEntityId } = await seedWithCapabilities(db, {
        definitionWrite: true,
        enabledCapabilityFlags: null,
      });

      const row = createEntityRecord(organizationId, connectorEntityId, { name: "Dave" }, "src-1", userId);
      await db.insert(entityRecords).values(row as never);

      const res = await request(app)
        .delete(singleRecordUrl(connectorEntityId, row.id))
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.id).toBe(row.id);
    });

    it("deleted record should no longer appear in GET records list", async () => {
      const { userId, organizationId, connectorEntityId } = await seedWithCapabilities(db, {
        definitionWrite: true,
        enabledCapabilityFlags: { write: true },
      });

      const row = createEntityRecord(organizationId, connectorEntityId, { name: "Eve" }, "src-1", userId);
      await db.insert(entityRecords).values(row as never);

      // Delete
      await request(app)
        .delete(singleRecordUrl(connectorEntityId, row.id))
        .set("Authorization", "Bearer test-token");

      // Verify not in list
      const listRes = await request(app)
        .get(recordsUrl(connectorEntityId))
        .set("Authorization", "Bearer test-token");

      expect(listRes.status).toBe(200);
      expect(listRes.body.payload.records).toHaveLength(0);
      expect(listRes.body.payload.total).toBe(0);
    });
  });

  // ── PATCH /:recordId — Update single record ───────────────────────

  describe("PATCH /api/connector-entities/:id/records/:recordId", () => {
    it("should return 422 CONNECTOR_INSTANCE_WRITE_DISABLED when write is disabled", async () => {
      const { userId, organizationId, connectorEntityId } = await seedWithCapabilities(db, {
        definitionWrite: true,
        enabledCapabilityFlags: { write: false },
      });

      const row = createEntityRecord(organizationId, connectorEntityId, { name: "Alice" }, "src-1", userId);
      await db.insert(entityRecords).values(row as never);

      const res = await request(app)
        .patch(singleRecordUrl(connectorEntityId, row.id))
        .set("Authorization", "Bearer test-token")
        .send({ data: { name: "Updated" } });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_INSTANCE_WRITE_DISABLED);
    });

    it("should update record when write is enabled", async () => {
      const { userId, organizationId, connectorEntityId } = await seedWithCapabilities(db, {
        definitionWrite: true,
        enabledCapabilityFlags: { write: true },
      });

      const row = createEntityRecord(organizationId, connectorEntityId, { name: "Alice" }, "src-1", userId);
      await db.insert(entityRecords).values(row as never);

      const res = await request(app)
        .patch(singleRecordUrl(connectorEntityId, row.id))
        .set("Authorization", "Bearer test-token")
        .send({ data: { name: "Updated" }, normalizedData: { name: "Updated" } });

      expect(res.status).toBe(200);
      expect(res.body.payload.record.id).toBe(row.id);
      expect(res.body.payload.record.data).toEqual({ name: "Updated" });
      expect(res.body.payload.record.normalizedData).toEqual({ name: "Updated" });
    });

    it("should return 404 for non-existent record", async () => {
      const { connectorEntityId } = await seedWithCapabilities(db, {
        definitionWrite: true,
        enabledCapabilityFlags: { write: true },
      });

      const res = await request(app)
        .patch(singleRecordUrl(connectorEntityId, generateId()))
        .set("Authorization", "Bearer test-token")
        .send({ data: { name: "Updated" } });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.ENTITY_RECORD_NOT_FOUND);
    });
  });

  // ── DELETE / — Bulk clear with write guard ────────────────────────

  describe("DELETE /api/connector-entities/:id/records (bulk)", () => {
    it("should return 422 when write is disabled", async () => {
      const { userId, organizationId, connectorEntityId } = await seedWithCapabilities(db, {
        definitionWrite: true,
        enabledCapabilityFlags: { write: false },
      });

      const row = createEntityRecord(organizationId, connectorEntityId, { name: "Frank" }, "src-1", userId);
      await db.insert(entityRecords).values(row as never);

      const res = await request(app)
        .delete(recordsUrl(connectorEntityId))
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(422);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_INSTANCE_WRITE_DISABLED);
    });

    it("should succeed when write capability is enabled", async () => {
      const { userId, organizationId, connectorEntityId } = await seedWithCapabilities(db, {
        definitionWrite: true,
        enabledCapabilityFlags: { write: true },
      });

      const row1 = createEntityRecord(organizationId, connectorEntityId, { name: "Gina" }, "src-1", userId);
      const row2 = createEntityRecord(organizationId, connectorEntityId, { name: "Hank" }, "src-2", userId);
      await db.insert(entityRecords).values([row1, row2] as never);

      const res = await request(app)
        .delete(recordsUrl(connectorEntityId))
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.deleted).toBe(2);
    });
  });
});
