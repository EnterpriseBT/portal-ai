/**
 * Integration tests for the slice-6 pre-commit probe-draft route:
 *   POST /api/connector-instances/probe-endpoint-draft
 *
 * Exercises the full stack: route → adapter → ProbeCache + heuristic +
 * (stubbed) classifier — without seeding a persisted ConnectorInstance
 * or ApiEndpoint row. The probe-draft path synthesizes its ProbeContext
 * from the request body and caches on the canonical probeInputHash from
 * slice 3.
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
import {
  seedUserAndOrg,
  teardownOrg,
} from "../utils/application.util.js";

const AUTH0_ID = "auth0|ci-test-probe-endpoint-draft";

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

let connection!: ReturnType<typeof postgres>;
let db!: ReturnType<typeof drizzle>;
let originalFetch: typeof globalThis.fetch;

beforeEach(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  connection = postgres(process.env.DATABASE_URL, { max: 1 });
  db = drizzle(connection, { schema });
  await teardownOrg(db);
  await seedUserAndOrg(db, AUTH0_ID);
  originalFetch = globalThis.fetch;
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

const validBody = {
  baseUrl: "https://api.example.com",
  auth: { mode: "none" },
  credentials: null,
  endpoint: {
    path: "/users",
    method: "GET",
    recordsPath: "",
    idField: "id",
    pagination: { strategy: "none" },
  },
};

describe("POST /api/connector-instances/probe-endpoint-draft — happy paths", () => {
  it("returns source:live + DiscoverColumnsResult on a valid body", async () => {
    globalThis.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse([
          { id: "a", name: "Alice" },
          { id: "b", name: "Bob" },
        ])
      ) as unknown as typeof globalThis.fetch;

    const res = await request(app)
      .post("/api/connector-instances/probe-endpoint-draft")
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.payload.source).toBe("live");
    expect(res.body.payload.recordsScanned).toBe(2);
    expect(res.body.payload.columns.map((c: { key: string }) => c.key).sort()).toEqual([
      "id",
      "name",
    ]);
  });

  it("returns degradation: transform-failed on a parse-error transform", async () => {
    globalThis.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 1 }] })
      ) as unknown as typeof globalThis.fetch;

    const res = await request(app)
      .post("/api/connector-instances/probe-endpoint-draft")
      .send({
        ...validBody,
        endpoint: { ...validBody.endpoint, transform: "data.{ unclosed" },
      });

    expect(res.status).toBe(200);
    expect(res.body.payload.degradation).toBe("transform-failed");
    expect(res.body.payload.recordsScanned).toBe(0);
    expect(res.body.payload.transformError.kind).toBe("parse");
  });

  it("second identical call hits the cache (no second outbound fetch)", async () => {
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([{ id: "a" }]));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const first = await request(app)
      .post("/api/connector-instances/probe-endpoint-draft")
      .send(validBody);
    expect(first.body.payload.source).toBe("live");

    const second = await request(app)
      .post("/api/connector-instances/probe-endpoint-draft")
      .send(validBody);
    expect(second.body.payload.source).toBe("cache");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cache miss when a probe-relevant field changes (path)", async () => {
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([{ id: "a" }]))
      .mockResolvedValueOnce(jsonResponse([{ id: "b" }]));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await request(app)
      .post("/api/connector-instances/probe-endpoint-draft")
      .send(validBody);
    const second = await request(app)
      .post("/api/connector-instances/probe-endpoint-draft")
      .send({
        ...validBody,
        endpoint: { ...validBody.endpoint, path: "/admins" },
      });
    expect(second.body.payload.source).toBe("live");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("forceRefresh:true bypasses the cache and re-fetches", async () => {
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([{ id: "a" }]))
      .mockResolvedValueOnce(jsonResponse([{ id: "a" }]));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await request(app)
      .post("/api/connector-instances/probe-endpoint-draft")
      .send(validBody);
    const refreshed = await request(app)
      .post("/api/connector-instances/probe-endpoint-draft")
      .send({ ...validBody, forceRefresh: true });
    expect(refreshed.body.payload.source).toBe("live");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("POST /api/connector-instances/probe-endpoint-draft — validation", () => {
  it("rejects a body that sets both transform and recordsPath (transform XOR recordsPath)", async () => {
    const res = await request(app)
      .post("/api/connector-instances/probe-endpoint-draft")
      .send({
        ...validBody,
        endpoint: {
          ...validBody.endpoint,
          recordsPath: "items",
          transform: "data.items",
        },
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("REST_API_INVALID_CONFIG");
  });

  it("rejects a body missing required fields with 400", async () => {
    const res = await request(app)
      .post("/api/connector-instances/probe-endpoint-draft")
      .send({ baseUrl: "https://api.example.com" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("REST_API_INVALID_CONFIG");
  });
});
