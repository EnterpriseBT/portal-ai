/**
 * Integration tests for the phase-4 probe route:
 *   POST /api/connector-instances/:instanceId/api-endpoints/:entityId/discover-columns
 *
 * Exercises the full stack: route → adapter → ProbeCache + heuristic +
 * (stubbed) classifier. The classifier is wired/unwired per-test so we
 * can hit the degradation paths without invoking the real Haiku
 * endpoint.
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

const AUTH0_ID = "auth0|ci-test-discover-columns";

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
const {
  configureRestApiAdapterDeps,
  __resetRestApiAdapterDepsForTests,
} = await import("../../../adapters/rest-api/rest-api.adapter.js");
const { ProbeCache } = await import(
  "../../../adapters/rest-api/probe-cache.util.js"
);
const { createStubClassifier, createThrowingClassifier } = await import(
  "../../../adapters/rest-api/classifier.stub.js"
);

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
    name: "Test discover-columns",
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
  // Default deps: fresh cache + no classifier. Tests override per-case.
  __resetRestApiAdapterDepsForTests();
  configureRestApiAdapterDeps({
    cache: new ProbeCache(),
    classifier: null,
  });
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  __resetRestApiAdapterDepsForTests();
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

async function seedEndpoint(): Promise<string> {
  const res = await request(app)
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
    });
  if (res.status !== 201) {
    throw new Error(`seedEndpoint failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.payload.entity.id;
}

describe("POST .../api-endpoints/:entityId/discover-columns — happy paths", () => {
  it("returns source:live + degradation:'llm-disabled' when no classifier is wired", async () => {
    const entityId = await seedEndpoint();
    globalThis.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse([
          { id: "a", name: "Alice" },
          { id: "b", name: "Bob" },
        ])
      ) as unknown as typeof globalThis.fetch;

    const res = await request(app)
      .post(
        `/api/connector-instances/${instanceId}/api-endpoints/${entityId}/discover-columns`
      )
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.payload.source).toBe("live");
    expect(res.body.payload.degradation).toBe("llm-disabled");
    expect(res.body.payload.recordsScanned).toBe(2);
    expect(res.body.payload.columns).toHaveLength(2);
    expect(res.body.payload.columns.every((c: { suggestion?: unknown }) => !c.suggestion)).toBe(true);
  });

  it("returns source:live + per-column suggestions when the classifier is wired", async () => {
    const entityId = await seedEndpoint();
    configureRestApiAdapterDeps({
      classifier: createStubClassifier([
        {
          sourceField: "id",
          columnDefinitionId: null,
          suggestedNormalizedKey: "user_id",
          suggestedSemanticType: "string",
          confidence: 0.9,
          rationale: "ID",
        },
        {
          sourceField: "name",
          columnDefinitionId: null,
          suggestedNormalizedKey: "user_name",
          suggestedSemanticType: "string",
          confidence: 0.8,
          rationale: "Name",
        },
      ]),
    });
    globalThis.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse([{ id: "a", name: "Alice" }])
      ) as unknown as typeof globalThis.fetch;

    const res = await request(app)
      .post(
        `/api/connector-instances/${instanceId}/api-endpoints/${entityId}/discover-columns`
      )
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.payload.degradation).toBeNull();
    const byKey = Object.fromEntries(
      (res.body.payload.columns as Array<{ key: string; suggestion?: { suggestedNormalizedKey: string } }>).map((c) => [c.key, c])
    );
    expect(byKey.id.suggestion?.suggestedNormalizedKey).toBe("user_id");
    expect(byKey.name.suggestion?.suggestedNormalizedKey).toBe("user_name");
  });

  it("second call returns source:cache without re-fetching", async () => {
    const entityId = await seedEndpoint();
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([{ id: "a" }]));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const first = await request(app)
      .post(
        `/api/connector-instances/${instanceId}/api-endpoints/${entityId}/discover-columns`
      )
      .send({});
    expect(first.body.payload.source).toBe("live");

    const second = await request(app)
      .post(
        `/api/connector-instances/${instanceId}/api-endpoints/${entityId}/discover-columns`
      )
      .send({});
    expect(second.body.payload.source).toBe("cache");
    expect(second.body.payload.cachedAt).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("forceRefresh:true invalidates cache → source:live again", async () => {
    const entityId = await seedEndpoint();
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([{ id: "a" }]))
      .mockResolvedValueOnce(jsonResponse([{ id: "b" }]));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await request(app)
      .post(
        `/api/connector-instances/${instanceId}/api-endpoints/${entityId}/discover-columns`
      )
      .send({});
    const refreshed = await request(app)
      .post(
        `/api/connector-instances/${instanceId}/api-endpoints/${entityId}/discover-columns`
      )
      .send({ forceRefresh: true });

    expect(refreshed.body.payload.source).toBe("live");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("POST .../discover-columns — degradation + error paths", () => {
  it("returns 200 + degradation:'llm-failed' when the classifier throws (heuristic columns intact)", async () => {
    const entityId = await seedEndpoint();
    configureRestApiAdapterDeps({
      classifier: createThrowingClassifier("network-error", "boom"),
    });
    globalThis.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([{ id: "a" }])) as unknown as typeof globalThis.fetch;

    const res = await request(app)
      .post(
        `/api/connector-instances/${instanceId}/api-endpoints/${entityId}/discover-columns`
      )
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.payload.degradation).toBe("llm-failed");
    expect(res.body.payload.columns).toHaveLength(1);
    expect(res.body.payload.columns[0].suggestion).toBeUndefined();
  });

  it("propagates REST_API_AUTH_FAILED on 401 from upstream", async () => {
    const entityId = await seedEndpoint();
    globalThis.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("nope", { status: 401 })
      ) as unknown as typeof globalThis.fetch;

    const res = await request(app)
      .post(
        `/api/connector-instances/${instanceId}/api-endpoints/${entityId}/discover-columns`
      )
      .send({});

    expect(res.status).toBe(502);
    expect(res.body.code).toBe(ApiCode.REST_API_AUTH_FAILED);
  });

  it("returns 404 REST_API_ENDPOINT_NOT_FOUND when the entityId doesn't exist", async () => {
    await seedEndpoint(); // unrelated; ensures the instance is healthy

    const res = await request(app)
      .post(
        `/api/connector-instances/${instanceId}/api-endpoints/${generateId()}/discover-columns`
      )
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ApiCode.REST_API_ENDPOINT_NOT_FOUND);
  });

  it("returns 404 CONNECTOR_INSTANCE_NOT_FOUND when the instance isn't a rest-api connector", async () => {
    // Seed a sandbox instance so the route's requireRestApiInstance
    // guard fires.
    const sandboxDefId = generateId();
    await db.insert(schema.connectorDefinitions).values({
      id: sandboxDefId,
      slug: "sandbox",
      display: "Sandbox",
      category: "test",
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
    const sandboxInstanceId = generateId();
    await db.insert(schema.connectorInstances).values({
      id: sandboxInstanceId,
      connectorDefinitionId: sandboxDefId,
      organizationId: orgId,
      name: "Sandbox",
      status: "active",
      config: {},
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

    const res = await request(app)
      .post(
        `/api/connector-instances/${sandboxInstanceId}/api-endpoints/${generateId()}/discover-columns`
      )
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ApiCode.CONNECTOR_INSTANCE_NOT_FOUND);
  });
});
