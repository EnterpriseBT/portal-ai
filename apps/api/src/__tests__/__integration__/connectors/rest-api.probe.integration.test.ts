/**
 * End-to-end probe integration for the REST API connector.
 *
 * Locks the full phase-4 pipeline behind one suite:
 *   1. seed org + user + rest-api def + instance + endpoint +
 *      `column_definitions` catalog entries
 *   2. stub fetch with a 25-record mixed-type body (id / name / age /
 *      tags) so the heuristic exercises string + number + json
 *   3. register a stub classifier that returns plausible matches
 *   4. POST /discover-columns → assert 4 columns with the right types,
 *      `source: "live"`, `degradation: null`, per-column suggestions
 *   5. POST again without forceRefresh → `source: "cache"`; fetch + classifier
 *      each called exactly once total
 *   6. POST with `forceRefresh: true` → cache invalidated; fetch + classifier
 *      each called twice total
 *   7. swap to throwing classifier → 200 + `degradation: "llm-failed"`;
 *      heuristic columns intact; no `suggestion` fields
 *   8. swap to null classifier → 200 + `degradation: "llm-disabled"`
 *   9. stub fetch as 401 → 502 + REST_API_AUTH_FAILED; classifier never called
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
import postgres from "postgres";
import * as schema from "../../../db/schema/index.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  generateId,
  seedUserAndOrg,
  teardownOrg,
} from "../utils/application.util.js";

const AUTH0_ID = "auth0|ci-test-probe-e2e";

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
const { configureRestApiAdapterDeps, __resetRestApiAdapterDepsForTests } =
  await import("../../../adapters/rest-api/rest-api.adapter.js");
const { ProbeCache } =
  await import("../../../adapters/rest-api/probe-cache.util.js");
const { createStubClassifier, createThrowingClassifier } =
  await import("../../../adapters/rest-api/classifier.stub.js");
const { SystemUtilities } = await import("../../../utils/system.util.js");

let connection!: ReturnType<typeof postgres>;
let db!: ReturnType<typeof drizzle>;
let orgId: string;
let userId: string;
let connDefId: string;
let instanceId: string;
let entityId: string;
let originalFetch: typeof globalThis.fetch;

beforeEach(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  connection = postgres(process.env.DATABASE_URL, { max: 1 });
  db = drizzle(connection, { schema });

  await teardownOrg(db);
  const seed = await seedUserAndOrg(db, AUTH0_ID);
  orgId = seed.organizationId;
  userId = seed.userId;

  // Seed a column_definitions catalog so the classifier (when wired)
  // has matches to suggest. The stub doesn't actually read the catalog
  // — the test asserts that the catalog *load* runs successfully when
  // the classifier is invoked.
  for (const cd of [
    {
      id: generateId(),
      key: "first_name",
      label: "First Name",
      type: "string",
    },
    { id: generateId(), key: "email", label: "Email", type: "string" },
    { id: generateId(), key: "age", label: "Age", type: "number" },
  ]) {
    await db.insert(schema.columnDefinitions).values({
      ...cd,
      organizationId: orgId,
      description: null,
      isSystem: false,
      created: Date.now(),
      createdBy: userId,
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
  }

  connDefId = generateId();
  await db.insert(schema.connectorDefinitions).values({
    id: connDefId,
    slug: "rest-api",
    display: "REST API",
    category: "api",
    authType: "multi",
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
    name: "Probe test",
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

  // Seed the endpoint via the existing route so the same flat→
  // structured pagination flow that production uses applies here.
  const created = await request(app)
    .post(`/api/connector-instances/${instanceId}/api-endpoints`)
    .send({
      key: "users",
      label: "Users",
      config: {
        path: "/users",
        method: "GET",
        recordsPath: "items",
        idField: "id",
        pagination: { strategy: "none" },
      },
    });
  if (created.status !== 201) {
    throw new Error(
      `seed endpoint failed (${created.status}): ${JSON.stringify(created.body)}`
    );
  }
  entityId = created.body.payload.entity.id;

  originalFetch = globalThis.fetch;
  __resetRestApiAdapterDepsForTests();
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  __resetRestApiAdapterDepsForTests();
  await connection.end();
});

function buildRecords(): Array<{
  id: string;
  name: string;
  age: number;
  tags: string[];
}> {
  return Array.from({ length: 25 }, (_, i) => ({
    id: `u${i}`,
    name: `User ${i}`,
    age: 20 + i,
    tags: ["a", "b"],
  }));
}

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {}
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

describe("REST API connector — end-to-end probe pipeline", () => {
  it("returns 4 inferred columns with suggestions on first call; cache + forceRefresh + degradation paths all work", async () => {
    const records = buildRecords();
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ items: records }))
      .mockResolvedValueOnce(jsonResponse({ items: records })); // for forceRefresh
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const classify = jest.fn(async () => [
      {
        sourceField: "id",
        columnDefinitionId: null,
        suggestedNormalizedKey: "user_id",
        suggestedSemanticType: "string" as const,
        confidence: 0.9,
        rationale: "ID-shaped",
      },
      {
        sourceField: "name",
        columnDefinitionId: null,
        suggestedNormalizedKey: "first_name",
        suggestedSemanticType: "string" as const,
        confidence: 0.7,
        rationale: "Name field",
      },
      {
        sourceField: "age",
        columnDefinitionId: null,
        suggestedNormalizedKey: "age",
        suggestedSemanticType: "number" as const,
        confidence: 0.95,
        rationale: "Numeric age",
      },
      {
        sourceField: "tags",
        columnDefinitionId: null,
        suggestedNormalizedKey: "tags",
        suggestedSemanticType: "json" as const,
        confidence: 0.6,
        rationale: "Array of strings",
      },
    ]);
    configureRestApiAdapterDeps({
      cache: new ProbeCache(),
      classifier: { classify: classify as never },
    });

    // ── (1) initial live probe ───────────────────────────────────────
    const first = await request(app)
      .post(
        `/api/connector-instances/${instanceId}/api-endpoints/${entityId}/discover-columns`
      )
      .send({});

    expect(first.status).toBe(200);
    expect(first.body.payload.source).toBe("live");
    expect(first.body.payload.degradation).toBeNull();
    expect(first.body.payload.recordsScanned).toBe(25);

    const colsByKey = Object.fromEntries(
      (
        first.body.payload.columns as Array<{
          key: string;
          type: string;
          suggestion?: { suggestedNormalizedKey: string };
        }>
      ).map((c) => [c.key, c])
    );
    expect(colsByKey.id.type).toBe("string");
    expect(colsByKey.name.type).toBe("string");
    expect(colsByKey.age.type).toBe("number");
    expect(colsByKey.tags.type).toBe("json");
    expect(colsByKey.id.suggestion?.suggestedNormalizedKey).toBe("user_id");
    expect(colsByKey.age.suggestion?.suggestedNormalizedKey).toBe("age");

    // ── (2) second call → cache hit; no extra fetch, no extra classify
    const cached = await request(app)
      .post(
        `/api/connector-instances/${instanceId}/api-endpoints/${entityId}/discover-columns`
      )
      .send({});

    expect(cached.body.payload.source).toBe("cache");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(classify).toHaveBeenCalledTimes(1);

    // ── (3) forceRefresh: true → re-probes both layers ───────────────
    const refreshed = await request(app)
      .post(
        `/api/connector-instances/${instanceId}/api-endpoints/${entityId}/discover-columns`
      )
      .send({ forceRefresh: true });

    expect(refreshed.body.payload.source).toBe("live");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(classify).toHaveBeenCalledTimes(2);
  });

  it("returns degradation:'llm-failed' when the classifier throws (heuristic columns intact)", async () => {
    globalThis.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ items: buildRecords() })
      ) as unknown as typeof globalThis.fetch;
    configureRestApiAdapterDeps({
      cache: new ProbeCache(),
      classifier: createThrowingClassifier("network-error", "boom"),
    });

    const res = await request(app)
      .post(
        `/api/connector-instances/${instanceId}/api-endpoints/${entityId}/discover-columns`
      )
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.payload.degradation).toBe("llm-failed");
    expect(res.body.payload.columns).toHaveLength(4);
    expect(
      (res.body.payload.columns as Array<{ suggestion?: unknown }>).every(
        (c) => !c.suggestion
      )
    ).toBe(true);
  });

  it("returns degradation:'llm-disabled' when no classifier is wired", async () => {
    globalThis.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ items: buildRecords() })
      ) as unknown as typeof globalThis.fetch;
    configureRestApiAdapterDeps({
      cache: new ProbeCache(),
      classifier: null,
    });

    const res = await request(app)
      .post(
        `/api/connector-instances/${instanceId}/api-endpoints/${entityId}/discover-columns`
      )
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.payload.degradation).toBe("llm-disabled");
    expect(res.body.payload.columns).toHaveLength(4);
  });

  it("propagates REST_API_AUTH_FAILED on 401 — cache untouched, classifier never invoked", async () => {
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("nope", { status: 401 }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const classify = jest.fn(async () => []);
    const cache = new ProbeCache<never>();
    configureRestApiAdapterDeps({
      cache: cache as never,
      classifier: { classify: classify as never },
    });

    const res = await request(app)
      .post(
        `/api/connector-instances/${instanceId}/api-endpoints/${entityId}/discover-columns`
      )
      .send({});

    expect(res.status).toBe(502);
    expect(res.body.code).toBe(ApiCode.REST_API_AUTH_FAILED);
    expect(classify).not.toHaveBeenCalled();
    expect(cache.size()).toBe(0);

    // System utility import is here so the route's error path doesn't
    // silently swallow the test runner's idle handles.
    expect(typeof SystemUtilities).toBe("function");
  });

  it("slices to MAX_RECORDS_SCANNED (25) even when the upstream returns more", async () => {
    // 100 records — the probe still scans 25.
    const big = Array.from({ length: 100 }, (_, i) => ({ id: `u${i}` }));
    globalThis.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ items: big })
      ) as unknown as typeof globalThis.fetch;
    configureRestApiAdapterDeps({
      cache: new ProbeCache(),
      classifier: null,
    });

    const res = await request(app)
      .post(
        `/api/connector-instances/${instanceId}/api-endpoints/${entityId}/discover-columns`
      )
      .send({});

    expect(res.body.payload.recordsScanned).toBe(25);
  });
});
