/**
 * End-to-end paginated integration test for the REST API connector.
 *
 * Drives the full phase-3 pipeline:
 *   1. seed org + user + rest-api definition + instance
 *   2. POST a `cursor`-paginated endpoint (recordsPath: "items",
 *      cursorResponsePath: "meta.next") via the slice-4 route
 *   3. stub globalThis.fetch with a programmable sequence:
 *        - page 1 → 200 + 2 records + meta.next="c2"
 *        - page 2 first try → 429 with Retry-After: 0 (withRetry retries)
 *        - page 2 retry → 200 + 2 records + meta.next=null (terminates)
 *   4. call restApiAdapter.syncInstance directly
 *   5. assert 4 records inserted; counts = {created:4, updated:0,
 *      unchanged:0, deleted:0}; second request URL carries ?cursor=c2
 *   6. re-sync with one record removed → assert deleted: 1
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
import type {
  Request,
  Response as ExpressResponse,
  NextFunction,
} from "express";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and, isNull } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  seedUserAndOrg,
  teardownOrg,
} from "../utils/application.util.js";

const AUTH0_ID = "auth0|ci-test-rest-api-paginated";

jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, _res: ExpressResponse, next: NextFunction) => {
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
    name: "Test paginated REST API",
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

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {}
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

async function loadInstance() {
  const [row] = await db
    .select()
    .from(schema.connectorInstances)
    .where(eq(schema.connectorInstances.id, instanceId));
  return row;
}

async function activeRecords(entityId: string) {
  return db
    .select()
    .from(schema.entityRecords)
    .where(
      and(
        eq(schema.entityRecords.connectorEntityId, entityId),
        isNull(schema.entityRecords.deleted)
      )
    );
}

describe("REST API connector — paginated cursor sync", () => {
  it("walks two pages, retries through a 429, and reaps removed records on resync", async () => {
    // ── Step 1: POST a cursor-paginated endpoint via the route ──────
    const created = await request(app)
      .post(`/api/connector-instances/${instanceId}/api-endpoints`)
      .send({
        key: "items",
        label: "Items",
        config: {
          path: "/items",
          method: "GET",
          recordsPath: "items",
          idField: "id",
          pagination: {
            strategy: "cursor",
            cursorParam: "cursor",
            cursorPlacement: "query",
            cursorResponsePath: "meta.next",
          },
        },
      })
      .expect(201);
    const entityId: string = created.body.payload.entity.id;

    // ── Step 2: stub fetch — 3 responses for the 2-page sync ────────
    //  page 1 → ok with cursor "c2"
    //  page 2 first attempt → 429 with Retry-After: 0 (withRetry kicks in)
    //  page 2 retry → ok with cursor null (terminates)
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ id: "a" }, { id: "b" }],
          meta: { next: "c2" },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { error: "rate limited" },
          { status: 429, headers: { "retry-after": "0" } }
        )
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ id: "c" }, { id: "d" }],
          meta: { next: null },
        })
      );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    // ── Step 3: run the sync ────────────────────────────────────────
    const instance = await loadInstance();
    const result = await restApiAdapter.syncInstance!(
      instance as never,
      userId
    );

    // ── Step 4: 3 HTTP calls, all 4 records persisted ───────────────
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.recordCounts).toEqual({
      created: 4,
      updated: 0,
      unchanged: 0,
      deleted: 0,
    });

    // Page 1 carries no cursor.
    const u1 = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(u1.searchParams.get("cursor")).toBeNull();
    // Page 2 (and its retry) carry ?cursor=c2 from the page-1 response.
    const u2 = new URL(fetchMock.mock.calls[1]![0] as string);
    expect(u2.searchParams.get("cursor")).toBe("c2");
    const u2Retry = new URL(fetchMock.mock.calls[2]![0] as string);
    expect(u2Retry.searchParams.get("cursor")).toBe("c2");

    // Records in DB.
    const after1 = await activeRecords(entityId);
    expect(after1.map((r) => r.sourceId).sort()).toEqual(["a", "b", "c", "d"]);
    expect(after1.every((r) => r.origin === "sync")).toBe(true);

    // ── Step 5: resync with "c" removed — watermark reap fires once ─
    const fetchMock2 = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ id: "a" }, { id: "b" }],
          meta: { next: "c2" },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ id: "d" }],
          meta: { next: null },
        })
      );
    globalThis.fetch = fetchMock2 as unknown as typeof globalThis.fetch;

    const instance2 = await loadInstance();
    const result2 = await restApiAdapter.syncInstance!(
      instance2 as never,
      userId
    );

    expect(result2.recordCounts.deleted).toBe(1);
    expect(result2.recordCounts.unchanged).toBe(3);

    const after2 = await activeRecords(entityId);
    expect(after2.map((r) => r.sourceId).sort()).toEqual(["a", "b", "d"]);

    // The instance's lastSyncAt advanced.
    const finalInstance = await loadInstance();
    expect(finalInstance.lastSyncAt).not.toBeNull();
    expect(finalInstance.lastErrorMessage).toBeNull();
  });
});
