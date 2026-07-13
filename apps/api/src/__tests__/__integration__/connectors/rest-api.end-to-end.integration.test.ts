/**
 * End-to-end happy-path integration test for the REST API connector.
 *
 * Drives the full pipeline:
 *   1. seed org + user + rest-api connector definition + instance
 *   2. POST a new endpoint via the slice-4 route
 *   3. stub globalThis.fetch with two successive payloads
 *   4. call restApiAdapter.syncInstance directly (slice 7 will register
 *      it in ConnectorAdapterRegistry; we call it directly here so the
 *      test stays focused on adapter behavior, not queue dispatch)
 *   5. assert entity_records populate with correct sourceIds + checksums
 *   6. re-sync with a modified payload and assert created/updated/
 *      deleted counts.
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
import type { Request, Response, NextFunction } from "express";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and, isNull } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  seedUserAndOrg,
  teardownOrg,
} from "../utils/application.util.js";

const AUTH0_ID = "auth0|ci-test-rest-api-e2e";

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
const { restApiAdapter } =
  await import("../../../adapters/rest-api/rest-api.adapter.js");

let connection!: ReturnType<typeof postgres>;
let db!: ReturnType<typeof drizzle>;
let orgId: string;
let userId: string;
let connDefId: string;
let instanceId: string;
let originalFetch: typeof globalThis.fetch;

beforeEach(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  connection = postgres(process.env.DATABASE_URL, { max: 1 });
  db = drizzle(connection, { schema });

  await teardownOrg(db);
  const seed = await seedUserAndOrg(db, AUTH0_ID);
  orgId = seed.organizationId;
  userId = seed.userId;

  connDefId = generateId();
  await db.insert(schema.connectorDefinitions).values({
    id: connDefId,
    slug: "rest-api",
    display: "REST API",
    category: "api",
    authType: "none",
    configSchema: null,
    capabilityFlags: { sync: true, read: true },
    isActive: true,
    version: "0.1.0",
    iconUrl: null,
    created: Date.now(),
    createdBy: userId,
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  } as never);

  instanceId = generateId();
  await db.insert(schema.connectorInstances).values({
    id: instanceId,
    connectorDefinitionId: connDefId,
    organizationId: orgId,
    name: "Test REST API",
    status: "active",
    config: {
      baseUrl: "https://mock.example.com",
      auth: { mode: "none" },
    },
    credentials: null,
    lastSyncAt: null,
    lastErrorMessage: null,
    enabledCapabilityFlags: null,
    created: Date.now(),
    createdBy: userId,
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  } as never);

  originalFetch = globalThis.fetch;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await connection.end();
});

function stubFetchOnce(body: unknown, status = 200) {
  globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  ) as unknown as typeof globalThis.fetch;
}

async function loadInstance() {
  const [row] = await db
    .select()
    .from(schema.connectorInstances)
    .where(eq(schema.connectorInstances.id, instanceId));
  return row;
}

describe("REST API connector — end-to-end sync", () => {
  it("creates endpoint via route, then syncInstance populates entity_records, then resync reports created/updated/deleted", async () => {
    // ── Step 1: create endpoint via the slice-4 route ─────────────────
    const created = await request(app)
      .post(`/api/connector-instances/${instanceId}/api-endpoints`)
      .send({
        key: "users",
        label: "Users",
        config: {
          path: "/users",
          method: "GET",
          recordsPath: "",
          idField: "id",
          pagination: { strategy: "none" },
        },
      })
      .expect(201);
    const entityId: string = created.body.payload.entity.id;

    // ── Step 2: first sync — three users ──────────────────────────────
    stubFetchOnce([
      { id: "a", name: "Alice" },
      { id: "b", name: "Bob" },
      { id: "c", name: "Carol" },
    ]);

    const instance = await loadInstance();
    const result1 = await restApiAdapter.syncInstance!(
      instance as never,
      userId
    );
    expect(result1.recordCounts).toEqual({
      created: 3,
      updated: 0,
      unchanged: 0,
      deleted: 0,
    });

    const records1 = await db
      .select()
      .from(schema.entityRecords)
      .where(
        and(
          eq(schema.entityRecords.connectorEntityId, entityId),
          isNull(schema.entityRecords.deleted)
        )
      );
    expect(records1).toHaveLength(3);
    expect(records1.map((r) => r.sourceId).sort()).toEqual(["a", "b", "c"]);
    expect(records1.every((r) => r.origin === "sync")).toBe(true);

    // ── Step 3: second sync — Alice updated, Carol dropped, Dave added
    stubFetchOnce([
      { id: "a", name: "Alice (updated)" },
      { id: "b", name: "Bob" },
      { id: "d", name: "Dave" },
    ]);

    const instance2 = await loadInstance();
    const result2 = await restApiAdapter.syncInstance!(
      instance2 as never,
      userId
    );
    expect(result2.recordCounts.created).toBe(1); // Dave
    expect(result2.recordCounts.updated).toBe(1); // Alice
    expect(result2.recordCounts.unchanged).toBe(1); // Bob
    expect(result2.recordCounts.deleted).toBe(1); // Carol

    // ── Step 4: verify final DB shape ─────────────────────────────────
    const records2 = await db
      .select()
      .from(schema.entityRecords)
      .where(
        and(
          eq(schema.entityRecords.connectorEntityId, entityId),
          isNull(schema.entityRecords.deleted)
        )
      );
    expect(records2.map((r) => r.sourceId).sort()).toEqual(["a", "b", "d"]);

    // Carol is soft-deleted, not hard-deleted.
    const allRecords = await db
      .select()
      .from(schema.entityRecords)
      .where(eq(schema.entityRecords.connectorEntityId, entityId));
    const carol = allRecords.find((r) => r.sourceId === "c");
    expect(carol).toBeTruthy();
    expect(carol!.deleted).not.toBeNull();

    // ── Step 5: instance.lastSyncAt updated ──────────────────────────
    const finalInstance = await loadInstance();
    expect(finalInstance.lastSyncAt).not.toBeNull();
    expect(finalInstance.lastErrorMessage).toBeNull();
  });

  it("walks recordsPath into a nested array", async () => {
    const created = await request(app)
      .post(`/api/connector-instances/${instanceId}/api-endpoints`)
      .send({
        key: "items",
        label: "Items",
        config: {
          path: "/items",
          method: "GET",
          recordsPath: "data.items",
          idField: "id",
          pagination: { strategy: "none" },
        },
      })
      .expect(201);
    const entityId: string = created.body.payload.entity.id;

    stubFetchOnce({
      data: { items: [{ id: "x" }, { id: "y" }] },
      meta: { total: 2 },
    });

    const instance = await loadInstance();
    const result = await restApiAdapter.syncInstance!(
      instance as never,
      userId
    );
    expect(result.recordCounts.created).toBe(2);

    const records = await db
      .select()
      .from(schema.entityRecords)
      .where(
        and(
          eq(schema.entityRecords.connectorEntityId, entityId),
          isNull(schema.entityRecords.deleted)
        )
      );
    expect(records.map((r) => r.sourceId).sort()).toEqual(["x", "y"]);
  });

  it("uses synthetic source ids when idField is unset (full replacement on resync)", async () => {
    const created = await request(app)
      .post(`/api/connector-instances/${instanceId}/api-endpoints`)
      .send({
        key: "events",
        label: "Events",
        config: {
          path: "/events",
          method: "GET",
          recordsPath: "",
          idField: null,
          pagination: { strategy: "none" },
        },
      })
      .expect(201);
    const entityId: string = created.body.payload.entity.id;

    stubFetchOnce([{ name: "first" }, { name: "second" }]);
    const inst1 = await loadInstance();
    const r1 = await restApiAdapter.syncInstance!(inst1 as never, userId);
    expect(r1.recordCounts.created).toBe(2);

    stubFetchOnce([{ name: "third" }, { name: "fourth" }, { name: "fifth" }]);
    const inst2 = await loadInstance();
    const r2 = await restApiAdapter.syncInstance!(inst2 as never, userId);
    // Synthetic ids are run-keyed, so every prior record is "missing"
    // and every new record is "new" → full replacement diff.
    expect(r2.recordCounts.created).toBe(3);
    expect(r2.recordCounts.deleted).toBe(2);
    expect(r2.recordCounts.updated).toBe(0);

    const live = await db
      .select()
      .from(schema.entityRecords)
      .where(
        and(
          eq(schema.entityRecords.connectorEntityId, entityId),
          isNull(schema.entityRecords.deleted)
        )
      );
    expect(live).toHaveLength(3);
  });
});
