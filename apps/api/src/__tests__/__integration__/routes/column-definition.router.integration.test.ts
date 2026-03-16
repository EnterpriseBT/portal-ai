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

const { columnDefinitions, organizations } = schema;

// ── Helpers ────────────────────────────────────────────────────────

const now = Date.now();

function createColumnDefinition(
  organizationId: string,
  overrides?: Partial<Record<string, unknown>>
) {
  return {
    id: generateId(),
    organizationId,
    key: `col_${generateId().replace(/-/g, "").slice(0, 8)}`,
    label: "Test Column",
    type: "string" as const,
    required: false,
    defaultValue: null,
    format: null,
    enumValues: null,
    description: null,
    refColumnDefinitionId: null,
    refEntityKey: null,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("Column Definition Router", () => {
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

  // ── GET /api/column-definitions ──────────────────────────────────

  describe("GET /api/column-definitions", () => {
    it("should return an empty list when no column definitions exist", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .get("/api/column-definitions")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.columnDefinitions).toEqual([]);
      expect(res.body.payload.total).toBe(0);
    });

    it("should return paginated column definitions", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      for (let i = 0; i < 3; i++) {
        await (db as ReturnType<typeof drizzle>)
          .insert(columnDefinitions)
          .values(
            createColumnDefinition(organizationId, {
              label: `Column ${i}`,
            }) as never
          );
      }

      const res = await request(app)
        .get("/api/column-definitions?limit=2&offset=0")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.columnDefinitions).toHaveLength(2);
      expect(res.body.payload.total).toBe(3);
      expect(res.body.payload.limit).toBe(2);
      expect(res.body.payload.offset).toBe(0);
    });

    it("should filter by type", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values([
          createColumnDefinition(organizationId, {
            label: "String Col",
            type: "string",
          }),
          createColumnDefinition(organizationId, {
            label: "Number Col",
            type: "number",
          }),
        ] as never);

      const res = await request(app)
        .get("/api/column-definitions?type=number")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.columnDefinitions).toHaveLength(1);
      expect(res.body.payload.columnDefinitions[0].label).toBe("Number Col");
    });

    it("should filter by required", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values([
          createColumnDefinition(organizationId, {
            label: "Optional",
            required: false,
          }),
          createColumnDefinition(organizationId, {
            label: "Required",
            required: true,
          }),
        ] as never);

      const res = await request(app)
        .get("/api/column-definitions?required=true")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.columnDefinitions).toHaveLength(1);
      expect(res.body.payload.columnDefinitions[0].label).toBe("Required");
    });

    it("should scope results to the requested organization", async () => {
      const { organizationId: orgA, userId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      // Create a second org owned by the same user (valid FK)
      const orgBId = generateId();
      await (db as ReturnType<typeof drizzle>)
        .insert(organizations)
        .values({
          id: orgBId,
          name: "Org B",
          timezone: "UTC",
          ownerUserId: userId,
          created: now,
          createdBy: "SYSTEM_TEST",
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        } as never);

      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values([
          createColumnDefinition(orgA, { label: "Org A Col" }),
          createColumnDefinition(orgBId, { label: "Org B Col" }),
        ] as never);

      const res = await request(app)
        .get("/api/column-definitions")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.columnDefinitions).toHaveLength(1);
      expect(res.body.payload.columnDefinitions[0].label).toBe("Org A Col");
    });
  });

  // ── GET /api/column-definitions/:id ──────────────────────────────

  describe("GET /api/column-definitions/:id", () => {
    it("should return 404 when column definition does not exist", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .get(`/api/column-definitions/${generateId()}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe(ApiCode.COLUMN_DEFINITION_NOT_FOUND);
    });

    it("should return a column definition by id", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const colDef = createColumnDefinition(organizationId, { label: "My Column" });
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values(colDef as never);

      const res = await request(app)
        .get(`/api/column-definitions/${colDef.id}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.columnDefinition.id).toBe(colDef.id);
      expect(res.body.payload.columnDefinition.label).toBe("My Column");
    });

    it("should not return soft-deleted column definitions", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const colDef = createColumnDefinition(organizationId, {
        deleted: now,
        deletedBy: "SYSTEM_TEST",
      });
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values(colDef as never);

      const res = await request(app)
        .get(`/api/column-definitions/${colDef.id}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
    });
  });

  // ── POST /api/column-definitions ─────────────────────────────────

  describe("POST /api/column-definitions", () => {
    it("should return 400 for invalid payload", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .post("/api/column-definitions")
        .set("Authorization", "Bearer test-token")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe(ApiCode.COLUMN_DEFINITION_INVALID_PAYLOAD);
    });

    it("should return 400 for invalid key format", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .post("/api/column-definitions")
        .set("Authorization", "Bearer test-token")
        .send({
          key: "Invalid Key",
          label: "Test",
          type: "string",
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.COLUMN_DEFINITION_INVALID_PAYLOAD);
    });

    it("should create a column definition successfully", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const res = await request(app)
        .post("/api/column-definitions")
        .set("Authorization", "Bearer test-token")
        .send({
          key: "email",
          label: "Email Address",
          type: "string",
          required: true,
          format: "email",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      const created = res.body.payload.columnDefinition;
      expect(created.key).toBe("email");
      expect(created.label).toBe("Email Address");
      expect(created.type).toBe("string");
      expect(created.required).toBe(true);
      expect(created.format).toBe("email");
      expect(created.organizationId).toBe(organizationId);
    });

    it("created column definition should be retrievable via GET", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const createRes = await request(app)
        .post("/api/column-definitions")
        .set("Authorization", "Bearer test-token")
        .send({
          key: "name",
          label: "Name",
          type: "string",
        });

      const id = createRes.body.payload.columnDefinition.id;

      const getRes = await request(app)
        .get(`/api/column-definitions/${id}`)
        .set("Authorization", "Bearer test-token");

      expect(getRes.status).toBe(200);
      expect(getRes.body.payload.columnDefinition.id).toBe(id);
      expect(getRes.body.payload.columnDefinition.key).toBe("name");
    });
  });

  // ── PATCH /api/column-definitions/:id ────────────────────────────

  describe("PATCH /api/column-definitions/:id", () => {
    it("should return 404 when column definition does not exist", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .patch(`/api/column-definitions/${generateId()}`)
        .set("Authorization", "Bearer test-token")
        .send({ label: "Updated" });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.COLUMN_DEFINITION_NOT_FOUND);
    });

    it("should update a column definition", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const colDef = createColumnDefinition(organizationId, {
        label: "Original",
      });
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values(colDef as never);

      const res = await request(app)
        .patch(`/api/column-definitions/${colDef.id}`)
        .set("Authorization", "Bearer test-token")
        .send({ label: "Updated Label", required: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.columnDefinition.label).toBe("Updated Label");
      expect(res.body.payload.columnDefinition.required).toBe(true);
    });
  });

  // ── DELETE /api/column-definitions/:id ───────────────────────────

  describe("DELETE /api/column-definitions/:id", () => {
    it("should return 404 when column definition does not exist", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .delete(`/api/column-definitions/${generateId()}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.COLUMN_DEFINITION_NOT_FOUND);
    });

    it("should soft-delete a column definition", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const colDef = createColumnDefinition(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values(colDef as never);

      const deleteRes = await request(app)
        .delete(`/api/column-definitions/${colDef.id}`)
        .set("Authorization", "Bearer test-token");

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.payload.id).toBe(colDef.id);

      // Should not be retrievable after deletion
      const getRes = await request(app)
        .get(`/api/column-definitions/${colDef.id}`)
        .set("Authorization", "Bearer test-token");

      expect(getRes.status).toBe(404);
    });
  });
});
