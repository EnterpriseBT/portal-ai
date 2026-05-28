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
import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  generateId,
  seedUserAndOrg,
  teardownOrg,
} from "../utils/application.util.js";

const AUTH0_ID = "auth0|ci-test-api-endpoints";

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
let connDefId: string; // rest-api definition
let otherDefId: string; // a non-rest-api definition (sandbox)
let restApiInstanceId: string;
let sandboxInstanceId: string;

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

beforeEach(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL not set");
  }
  connection = postgres(process.env.DATABASE_URL, { max: 1 });
  db = drizzle(connection, { schema });

  await teardownOrg(db);
  const seed = await seedUserAndOrg(db, AUTH0_ID);
  orgId = seed.organizationId;
  userId = seed.userId;

  connDefId = generateId();
  otherDefId = generateId();
  await seedDefinition("rest-api", connDefId);
  await seedDefinition("sandbox", otherDefId);

  restApiInstanceId = await seedInstance(connDefId);
  sandboxInstanceId = await seedInstance(otherDefId);
});

afterEach(async () => {
  await connection.end();
});

describe("POST /api/connector-instances/:instanceId/api-endpoints", () => {
  it("creates entity + config with a valid payload", async () => {
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

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.payload.entity.key).toBe("users");
    expect(res.body.payload.entity.label).toBe("Users");
    expect(res.body.payload.config.path).toBe("/users");
    expect(res.body.payload.config.method).toBe("GET");
    expect(res.body.payload.config.idField).toBe("id");
  });

  it("returns 400 REST_API_INVALID_CONFIG on invalid payload", async () => {
    const res = await request(app)
      .post(`/api/connector-instances/${restApiInstanceId}/api-endpoints`)
      .send({
        key: "x",
        label: "X",
        config: { path: "", method: "PATCH" }, // empty path + invalid method
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.REST_API_INVALID_CONFIG);
  });

  it("returns 404 when instance isn't a rest-api connector", async () => {
    const res = await request(app)
      .post(`/api/connector-instances/${sandboxInstanceId}/api-endpoints`)
      .send({
        key: "x",
        label: "X",
        config: { path: "/x", method: "GET", recordsPath: "", pagination: { strategy: "none" } },
      });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ApiCode.CONNECTOR_INSTANCE_NOT_FOUND);
  });

  it("returns 409 CONNECTOR_ENTITY_KEY_CONFLICT on duplicate org-wide key", async () => {
    // First create succeeds.
    await request(app)
      .post(`/api/connector-instances/${restApiInstanceId}/api-endpoints`)
      .send({
        key: "uniq",
        label: "Uniq",
        config: { path: "/x", method: "GET", recordsPath: "", pagination: { strategy: "none" } },
      })
      .expect(201);

    // Second create with same key fails (org-wide uniqueness on connector_entities.key).
    const res = await request(app)
      .post(`/api/connector-instances/${restApiInstanceId}/api-endpoints`)
      .send({
        key: "uniq",
        label: "Uniq Again",
        config: { path: "/y", method: "GET", recordsPath: "", pagination: { strategy: "none" } },
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ApiCode.CONNECTOR_ENTITY_KEY_CONFLICT);
  });
});

describe("GET /api/connector-instances/:instanceId/api-endpoints", () => {
  it("lists all endpoints for the instance", async () => {
    await request(app)
      .post(`/api/connector-instances/${restApiInstanceId}/api-endpoints`)
      .send({
        key: "a",
        label: "A",
        config: { path: "/a", method: "GET", recordsPath: "", pagination: { strategy: "none" } },
      })
      .expect(201);
    await request(app)
      .post(`/api/connector-instances/${restApiInstanceId}/api-endpoints`)
      .send({
        key: "b",
        label: "B",
        config: { path: "/b", method: "POST", recordsPath: "data", pagination: { strategy: "none" } },
      })
      .expect(201);

    const res = await request(app)
      .get(`/api/connector-instances/${restApiInstanceId}/api-endpoints`)
      .expect(200);

    expect(res.body.payload.endpoints).toHaveLength(2);
    const keys = res.body.payload.endpoints.map(
      (e: { entity: { key: string } }) => e.entity.key
    );
    expect(keys).toEqual(expect.arrayContaining(["a", "b"]));
  });
});

describe("GET /api/connector-instances/:instanceId/api-endpoints/:entityId", () => {
  it("returns the joined endpoint", async () => {
    const created = await request(app)
      .post(`/api/connector-instances/${restApiInstanceId}/api-endpoints`)
      .send({
        key: "single",
        label: "Single",
        config: { path: "/single", method: "GET", recordsPath: "items", pagination: { strategy: "none" } },
      })
      .expect(201);

    const entityId = created.body.payload.entity.id;
    const res = await request(app)
      .get(
        `/api/connector-instances/${restApiInstanceId}/api-endpoints/${entityId}`
      )
      .expect(200);

    expect(res.body.payload.entity.id).toBe(entityId);
    expect(res.body.payload.config.recordsPath).toBe("items");
  });

  it("returns 404 REST_API_ENDPOINT_NOT_FOUND on unknown entity id", async () => {
    const res = await request(app)
      .get(
        `/api/connector-instances/${restApiInstanceId}/api-endpoints/nope`
      );

    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ApiCode.REST_API_ENDPOINT_NOT_FOUND);
  });
});

describe("PATCH /api/connector-instances/:instanceId/api-endpoints/:entityId", () => {
  it("patches only the supplied config fields", async () => {
    const created = await request(app)
      .post(`/api/connector-instances/${restApiInstanceId}/api-endpoints`)
      .send({
        key: "patchable",
        label: "Patchable",
        config: { path: "/old", method: "GET", recordsPath: "", pagination: { strategy: "none" } },
      })
      .expect(201);

    const entityId = created.body.payload.entity.id;
    const res = await request(app)
      .patch(
        `/api/connector-instances/${restApiInstanceId}/api-endpoints/${entityId}`
      )
      .send({
        label: "Patched",
        config: { path: "/new", idField: "uuid" },
      })
      .expect(200);

    expect(res.body.payload.entity.label).toBe("Patched");
    expect(res.body.payload.config.path).toBe("/new");
    expect(res.body.payload.config.idField).toBe("uuid");
    expect(res.body.payload.config.method).toBe("GET");
  });
});

describe("DELETE /api/connector-instances/:instanceId/api-endpoints/:entityId", () => {
  it("soft-deletes; subsequent GET returns 404", async () => {
    const created = await request(app)
      .post(`/api/connector-instances/${restApiInstanceId}/api-endpoints`)
      .send({
        key: "deletable",
        label: "Deletable",
        config: { path: "/d", method: "GET", recordsPath: "", pagination: { strategy: "none" } },
      })
      .expect(201);

    const entityId = created.body.payload.entity.id;
    const del = await request(app)
      .delete(
        `/api/connector-instances/${restApiInstanceId}/api-endpoints/${entityId}`
      )
      .expect(200);
    expect(del.body.payload.ok).toBe(true);

    const get = await request(app).get(
      `/api/connector-instances/${restApiInstanceId}/api-endpoints/${entityId}`
    );
    expect(get.status).toBe(404);
    expect(get.body.code).toBe(ApiCode.REST_API_ENDPOINT_NOT_FOUND);
  });
});
