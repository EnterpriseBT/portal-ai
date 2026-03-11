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
import { UUIDv4Factory } from "@mcp-ui/core/utils";
import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import type { ConnectorDefinitionInsert } from "../../../db/schema/zod.js";

const AUTH0_ID = "auth0|cd-test-user";

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

const { connectorDefinitions } = schema;
const idFactory = new UUIDv4Factory();
const generateId = () => idFactory.generate();

function buildConnectorDefinition(
  overrides?: Partial<ConnectorDefinitionInsert>
): ConnectorDefinitionInsert {
  const now = Date.now();
  return {
    id: generateId(),
    slug: `connector-${generateId().slice(0, 8)}`,
    display: "Test Connector",
    category: "database",
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

describe("Connector Definition Router", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }

    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });

    // Clean connector_definitions table
    await db.delete(connectorDefinitions);
  });

  afterEach(async () => {
    await connection.end();
  });

  // ── GET / ───────────────────────────────────────────────────────────

  describe("GET /api/connector-definitions", () => {
    it("should return an empty list when no definitions exist", async () => {
      const res = await request(app)
        .get("/api/connector-definitions")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.connectorDefinitions).toEqual([]);
      expect(res.body.payload.total).toBe(0);
      expect(res.body.payload.limit).toBe(20);
      expect(res.body.payload.offset).toBe(0);
    });

    it("should return all definitions", async () => {
      const defs = [
        buildConnectorDefinition({ display: "Alpha" }),
        buildConnectorDefinition({ display: "Beta" }),
      ];
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorDefinitions)
        .values(defs as never);

      const res = await request(app)
        .get("/api/connector-definitions")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.connectorDefinitions).toHaveLength(2);
      expect(res.body.payload.total).toBe(2);
    });

    // ── Pagination ──────────────────────────────────────────────────

    it("should paginate with limit and offset", async () => {
      const defs = Array.from({ length: 5 }, (_, i) =>
        buildConnectorDefinition({ display: `Connector ${i}` })
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorDefinitions)
        .values(defs as never);

      const res = await request(app)
        .get("/api/connector-definitions?limit=2&offset=2")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.connectorDefinitions).toHaveLength(2);
      expect(res.body.payload.total).toBe(5);
      expect(res.body.payload.limit).toBe(2);
      expect(res.body.payload.offset).toBe(2);
    });

    it("should clamp limit to a maximum of 100", async () => {
      const res = await request(app)
        .get("/api/connector-definitions?limit=999")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.limit).toBe(100);
    });

    it("should default limit to 20 and offset to 0", async () => {
      const res = await request(app)
        .get("/api/connector-definitions")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.limit).toBe(20);
      expect(res.body.payload.offset).toBe(0);
    });

    // ── Filtering ───────────────────────────────────────────────────

    it("should filter by category", async () => {
      const defs = [
        buildConnectorDefinition({ display: "DB One", category: "database" }),
        buildConnectorDefinition({ display: "API One", category: "api" }),
      ];
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorDefinitions)
        .values(defs as never);

      const res = await request(app)
        .get("/api/connector-definitions?category=database")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.connectorDefinitions).toHaveLength(1);
      expect(res.body.payload.connectorDefinitions[0].category).toBe(
        "database"
      );
      expect(res.body.payload.total).toBe(1);
    });

    it("should filter by authType", async () => {
      const defs = [
        buildConnectorDefinition({ display: "OAuth", authType: "oauth2" }),
        buildConnectorDefinition({ display: "API Key", authType: "api_key" }),
      ];
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorDefinitions)
        .values(defs as never);

      const res = await request(app)
        .get("/api/connector-definitions?authType=api_key")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.connectorDefinitions).toHaveLength(1);
      expect(res.body.payload.connectorDefinitions[0].authType).toBe(
        "api_key"
      );
    });

    it("should filter by isActive", async () => {
      const defs = [
        buildConnectorDefinition({ display: "Active", isActive: true }),
        buildConnectorDefinition({ display: "Inactive", isActive: false }),
      ];
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorDefinitions)
        .values(defs as never);

      const res = await request(app)
        .get("/api/connector-definitions?isActive=true")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.connectorDefinitions).toHaveLength(1);
      expect(res.body.payload.connectorDefinitions[0].isActive).toBe(true);
    });

    it("should filter by search (case-insensitive on display)", async () => {
      const defs = [
        buildConnectorDefinition({ display: "PostgreSQL Connector" }),
        buildConnectorDefinition({ display: "MySQL Connector" }),
        buildConnectorDefinition({ display: "Stripe API" }),
      ];
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorDefinitions)
        .values(defs as never);

      const res = await request(app)
        .get("/api/connector-definitions?search=connector")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.connectorDefinitions).toHaveLength(2);
      expect(res.body.payload.total).toBe(2);
    });

    it("should combine multiple filters", async () => {
      const defs = [
        buildConnectorDefinition({
          display: "Active DB",
          category: "database",
          isActive: true,
        }),
        buildConnectorDefinition({
          display: "Inactive DB",
          category: "database",
          isActive: false,
        }),
        buildConnectorDefinition({
          display: "Active API",
          category: "api",
          isActive: true,
        }),
      ];
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorDefinitions)
        .values(defs as never);

      const res = await request(app)
        .get(
          "/api/connector-definitions?category=database&isActive=true"
        )
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.connectorDefinitions).toHaveLength(1);
      expect(res.body.payload.connectorDefinitions[0].display).toBe(
        "Active DB"
      );
    });

    // ── Sorting ─────────────────────────────────────────────────────

    it("should sort by display ascending by default", async () => {
      const defs = [
        buildConnectorDefinition({ display: "Charlie" }),
        buildConnectorDefinition({ display: "Alpha" }),
        buildConnectorDefinition({ display: "Bravo" }),
      ];
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorDefinitions)
        .values(defs as never);

      const res = await request(app)
        .get("/api/connector-definitions")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      const displays = res.body.payload.connectorDefinitions.map(
        (d: { display: string }) => d.display
      );
      expect(displays).toEqual(["Alpha", "Bravo", "Charlie"]);
    });

    it("should sort by display descending", async () => {
      const defs = [
        buildConnectorDefinition({ display: "Alpha" }),
        buildConnectorDefinition({ display: "Charlie" }),
        buildConnectorDefinition({ display: "Bravo" }),
      ];
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorDefinitions)
        .values(defs as never);

      const res = await request(app)
        .get("/api/connector-definitions?sortBy=display&sortOrder=desc")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      const displays = res.body.payload.connectorDefinitions.map(
        (d: { display: string }) => d.display
      );
      expect(displays).toEqual(["Charlie", "Bravo", "Alpha"]);
    });

    it("should sort by category", async () => {
      const defs = [
        buildConnectorDefinition({ display: "Z", category: "storage" }),
        buildConnectorDefinition({ display: "A", category: "api" }),
        buildConnectorDefinition({ display: "M", category: "database" }),
      ];
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorDefinitions)
        .values(defs as never);

      const res = await request(app)
        .get("/api/connector-definitions?sortBy=category&sortOrder=asc")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      const categories = res.body.payload.connectorDefinitions.map(
        (d: { category: string }) => d.category
      );
      expect(categories).toEqual(["api", "database", "storage"]);
    });

    it("should fall back to display sort for invalid sortBy", async () => {
      const defs = [
        buildConnectorDefinition({ display: "Bravo" }),
        buildConnectorDefinition({ display: "Alpha" }),
      ];
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorDefinitions)
        .values(defs as never);

      const res = await request(app)
        .get("/api/connector-definitions?sortBy=invalid_field")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      const displays = res.body.payload.connectorDefinitions.map(
        (d: { display: string }) => d.display
      );
      expect(displays).toEqual(["Alpha", "Bravo"]);
    });

    // ── Soft-delete awareness ───────────────────────────────────────

    it("should exclude soft-deleted definitions", async () => {
      const defs = [
        buildConnectorDefinition({ display: "Visible" }),
        buildConnectorDefinition({
          display: "Deleted",
          deleted: Date.now(),
          deletedBy: "SYSTEM_TEST",
        }),
      ];
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorDefinitions)
        .values(defs as never);

      const res = await request(app)
        .get("/api/connector-definitions")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.connectorDefinitions).toHaveLength(1);
      expect(res.body.payload.connectorDefinitions[0].display).toBe("Visible");
      expect(res.body.payload.total).toBe(1);
    });
  });

  // ── GET /:id ────────────────────────────────────────────────────────

  describe("GET /api/connector-definitions/:id", () => {
    it("should return a connector definition by ID", async () => {
      const def = buildConnectorDefinition({ display: "My Connector" });
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorDefinitions)
        .values(def as never);

      const res = await request(app)
        .get(`/api/connector-definitions/${def.id}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.connectorDefinition.id).toBe(def.id);
      expect(res.body.payload.connectorDefinition.display).toBe(
        "My Connector"
      );
      expect(res.body.payload.connectorDefinition.slug).toBe(def.slug);
      expect(res.body.payload.connectorDefinition.category).toBe("database");
    });

    it("should return 404 for a non-existent ID", async () => {
      const res = await request(app)
        .get(`/api/connector-definitions/${generateId()}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_DEFINITION_NOT_FOUND);
    });

    it("should return 404 for a soft-deleted definition", async () => {
      const def = buildConnectorDefinition({
        display: "Deleted",
        deleted: Date.now(),
        deletedBy: "SYSTEM_TEST",
      });
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorDefinitions)
        .values(def as never);

      const res = await request(app)
        .get(`/api/connector-definitions/${def.id}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_DEFINITION_NOT_FOUND);
    });
  });
});
