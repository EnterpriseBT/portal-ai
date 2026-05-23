/**
 * Integration tests for `POST /api/connector-instances/:id/test-connection`.
 *
 * Exercises the shared route + the REST API adapter's `testConnection`
 * implementation end-to-end:
 *   - happy path (200 + { ok: true, sample })
 *   - adapter-side failures projected as { ok: false, code, ... } at HTTP 200
 *   - 404 when the adapter doesn't implement testConnection
 *   - 404 when the instance doesn't exist (or doesn't belong to the org)
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
import postgres from "postgres";
import * as schema from "../../../db/schema/index.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  generateId,
  seedUserAndOrg,
  teardownOrg,
} from "../utils/application.util.js";

const AUTH0_ID = "auth0|ci-test-test-connection";

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

let connection!: ReturnType<typeof postgres>;
let db!: ReturnType<typeof drizzle>;
let orgId: string;
let userId: string;
let restApiDefId: string;
let sandboxDefId: string;
let restApiInstanceId: string;
let sandboxInstanceId: string;
let originalFetch: typeof globalThis.fetch;

async function seedDefinition(slug: string, definitionId: string) {
  await db.insert(schema.connectorDefinitions).values({
    id: definitionId,
    slug,
    display: `Test ${slug}`,
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
}

async function seedInstance(definitionId: string): Promise<string> {
  const id = generateId();
  await db.insert(schema.connectorInstances).values({
    id,
    connectorDefinitionId: definitionId,
    organizationId: orgId,
    name: `Test instance ${id.slice(0, 6)}`,
    status: "active",
    config: { baseUrl: "https://api.example.com", auth: { mode: "none" } },
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
  return id;
}

async function createUsersEndpoint(): Promise<string> {
  const res = await request(app)
    .post(`/api/connector-instances/${restApiInstanceId}/api-endpoints`)
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
    throw new Error(
      `Failed to seed endpoint (status ${res.status}): ${JSON.stringify(res.body)}`
    );
  }
  return res.body.payload.entity.id;
}

function stubFetchOnce(body: unknown, status = 200) {
  globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValueOnce(
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  ) as unknown as typeof globalThis.fetch;
}

beforeEach(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  connection = postgres(process.env.DATABASE_URL, { max: 1 });
  db = drizzle(connection, { schema });

  await teardownOrg(db);
  const seed = await seedUserAndOrg(db, AUTH0_ID);
  orgId = seed.organizationId;
  userId = seed.userId;

  restApiDefId = generateId();
  sandboxDefId = generateId();
  await seedDefinition("rest-api", restApiDefId);
  await seedDefinition("sandbox", sandboxDefId);

  restApiInstanceId = await seedInstance(restApiDefId);
  sandboxInstanceId = await seedInstance(sandboxDefId);

  originalFetch = globalThis.fetch;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await connection.end();
});

describe("POST /api/connector-instances/:id/test-connection — REST API adapter", () => {
  it("returns { ok: true, sample } when the endpoint returns an array", async () => {
    const entityId = await createUsersEndpoint();
    stubFetchOnce([{ id: "a" }, { id: "b" }, { id: "c" }]);

    const res = await request(app)
      .post(`/api/connector-instances/${restApiInstanceId}/test-connection`)
      .send({ endpointEntityId: entityId });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.payload).toEqual({
      ok: true,
      sample: [{ id: "a" }, { id: "b" }, { id: "c" }],
    });
  });

  it("returns 200 + { ok: false, code: REST_API_INVALID_JSON } when the response isn't valid JSON", async () => {
    const entityId = await createUsersEndpoint();
    stubFetchOnce("not valid json", 200);

    const res = await request(app)
      .post(`/api/connector-instances/${restApiInstanceId}/test-connection`)
      .send({ endpointEntityId: entityId });

    expect(res.status).toBe(200);
    expect(res.body.payload).toMatchObject({
      ok: false,
      code: ApiCode.REST_API_INVALID_JSON,
    });
  });

  it("returns 200 + { ok: false, code: REST_API_ENDPOINT_NOT_FOUND } when endpointEntityId is unknown", async () => {
    const res = await request(app)
      .post(`/api/connector-instances/${restApiInstanceId}/test-connection`)
      .send({ endpointEntityId: "missing-entity-id" });

    expect(res.status).toBe(200);
    expect(res.body.payload).toMatchObject({
      ok: false,
      code: ApiCode.REST_API_ENDPOINT_NOT_FOUND,
    });
  });
});

describe("POST /api/connector-instances/:id/test-connection — route guards", () => {
  it("returns 404 TEST_CONNECTION_NOT_SUPPORTED when the adapter doesn't implement testConnection", async () => {
    const res = await request(app)
      .post(`/api/connector-instances/${sandboxInstanceId}/test-connection`)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ApiCode.TEST_CONNECTION_NOT_SUPPORTED);
  });

  it("returns 404 CONNECTOR_INSTANCE_NOT_FOUND when the instance doesn't exist", async () => {
    const res = await request(app)
      .post(`/api/connector-instances/${generateId()}/test-connection`)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ApiCode.CONNECTOR_INSTANCE_NOT_FOUND);
  });
});
