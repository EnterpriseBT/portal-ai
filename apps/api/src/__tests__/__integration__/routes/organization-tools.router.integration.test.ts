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
import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  generateId,
  seedUserAndOrg,
  teardownOrg,
} from "../utils/application.util.js";

const AUTH0_ID = "auth0|org-tools-router-test";

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
const { organizationTools } = schema;

const now = Date.now();

const WEBHOOK_IMPL = {
  type: "webhook" as const,
  url: "https://example.com/tool",
  headers: {},
};

const PARAM_SCHEMA = {
  type: "object",
  properties: { query: { type: "string" } },
};

function createOrgTool(
  organizationId: string,
  overrides?: Partial<Record<string, unknown>>
) {
  return {
    id: generateId(),
    organizationId,
    name: `tool_${generateId().replace(/-/g, "").slice(0, 8)}`,
    description: "A test tool",
    parameterSchema: PARAM_SCHEMA,
    implementation: WEBHOOK_IMPL,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    ...overrides,
  };
}

describe("Organization Tools Router", () => {
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

  // ── GET /api/organization-tools ───────────────────────────────────

  describe("GET /api/organization-tools", () => {
    it("returns tools for the org", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const tool = createOrgTool(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(organizationTools)
        .values(tool as never);

      const res = await request(app).get("/api/organization-tools").expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.payload.organizationTools).toHaveLength(1);
      expect(res.body.payload.organizationTools[0].id).toBe(tool.id);
    });
  });

  // ── POST /api/organization-tools ──────────────────────────────────

  describe("POST /api/organization-tools", () => {
    it("creates a new tool", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .post("/api/organization-tools")
        .send({
          name: "my_custom_tool",
          description: "Does something useful",
          parameterSchema: PARAM_SCHEMA,
          implementation: WEBHOOK_IMPL,
        })
        .expect(201);

      expect(res.body.payload.organizationTool.name).toBe("my_custom_tool");
    });

    it("returns 409 for duplicate name within org", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const tool = createOrgTool(organizationId, { name: "duplicate_name" });
      await (db as ReturnType<typeof drizzle>)
        .insert(organizationTools)
        .values(tool as never);

      const res = await request(app)
        .post("/api/organization-tools")
        .send({
          name: "duplicate_name",
          parameterSchema: PARAM_SCHEMA,
          implementation: WEBHOOK_IMPL,
        })
        .expect(409);

      expect(res.body.code).toBe(ApiCode.ORG_TOOL_NAME_CONFLICT);
    });

    it("returns 400 for invalid payload", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      await request(app).post("/api/organization-tools").send({}).expect(400);
    });
  });

  // ── PATCH /api/organization-tools/:toolId ─────────────────────────

  describe("PATCH /api/organization-tools/:toolId", () => {
    it("updates the tool description", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const tool = createOrgTool(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(organizationTools)
        .values(tool as never);

      const res = await request(app)
        .patch(`/api/organization-tools/${tool.id}`)
        .send({ description: "Updated description" })
        .expect(200);

      expect(res.body.payload.organizationTool.description).toBe(
        "Updated description"
      );
    });

    it("returns 409 when renaming to a conflicting name", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const toolA = createOrgTool(organizationId, { name: "tool_a" });
      const toolB = createOrgTool(organizationId, { name: "tool_b" });
      await (db as ReturnType<typeof drizzle>)
        .insert(organizationTools)
        .values([toolA as never, toolB as never]);

      const res = await request(app)
        .patch(`/api/organization-tools/${toolA.id}`)
        .send({ name: "tool_b" })
        .expect(409);

      expect(res.body.code).toBe(ApiCode.ORG_TOOL_NAME_CONFLICT);
    });

    it("returns 404 for unknown tool", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      await request(app)
        .patch(`/api/organization-tools/${generateId()}`)
        .send({ description: "x" })
        .expect(404);
    });
  });

  // ── DELETE /api/organization-tools/:toolId ────────────────────────

  describe("DELETE /api/organization-tools/:toolId", () => {
    it("soft-deletes the tool", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const tool = createOrgTool(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(organizationTools)
        .values(tool as never);

      const res = await request(app)
        .delete(`/api/organization-tools/${tool.id}`)
        .expect(200);

      expect(res.body.payload.id).toBe(tool.id);
    });

    it("returns 404 for unknown tool", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      await request(app)
        .delete(`/api/organization-tools/${generateId()}`)
        .expect(404);
    });
  });
});
