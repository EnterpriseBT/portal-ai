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

const { entityTags, entityTagAssignments, connectorEntities, connectorInstances, connectorDefinitions } = schema;

// ── Helpers ────────────────────────────────────────────────────────

const now = Date.now();

function createEntityTag(
  organizationId: string,
  overrides?: Partial<Record<string, unknown>>
) {
  return {
    id: generateId(),
    organizationId,
    name: `tag-${generateId().slice(0, 8)}`,
    color: null,
    description: null,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    ...overrides,
  };
}

function createConnectorDefinition() {
  return {
    id: generateId(),
    slug: `slug-${generateId()}`,
    display: "Test Connector",
    category: "crm",
    authType: "oauth2",
    configSchema: null,
    capabilityFlags: { sync: true },
    isActive: true,
    version: "1.0.0",
    iconUrl: null,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

function createConnectorInstance(connectorDefinitionId: string, organizationId: string) {
  return {
    id: generateId(),
    connectorDefinitionId,
    organizationId,
    name: "Test Instance",
    status: "active" as const,
    config: null,
    credentials: null,
    lastSyncAt: null,
    lastErrorMessage: null,
    enabledCapabilityFlags: null,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

function createConnectorEntity(organizationId: string, connectorInstanceId: string) {
  return {
    id: generateId(),
    organizationId,
    connectorInstanceId,
    key: `entity_${generateId().replace(/-/g, "").slice(0, 8)}`,
    label: "Test Entity",
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("Entity Tag Router", () => {
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

  // ── GET /api/entity-tags ──────────────────────────────────────────

  describe("GET /api/entity-tags", () => {
    it("should return paginated list scoped to org", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      await (db as ReturnType<typeof drizzle>)
        .insert(entityTags)
        .values([
          createEntityTag(organizationId, { name: "alpha" }),
          createEntityTag(organizationId, { name: "beta" }),
          createEntityTag(organizationId, { name: "gamma" }),
        ] as never);

      const res = await request(app)
        .get("/api/entity-tags?limit=2&offset=0")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.entityTags).toHaveLength(2);
      expect(res.body.payload.total).toBe(3);
      expect(res.body.payload.limit).toBe(2);
      expect(res.body.payload.offset).toBe(0);
    });

    it("should filter by name with search param", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      await (db as ReturnType<typeof drizzle>)
        .insert(entityTags)
        .values([
          createEntityTag(organizationId, { name: "customers" }),
          createEntityTag(organizationId, { name: "leads" }),
          createEntityTag(organizationId, { name: "custom-fields" }),
        ] as never);

      const res = await request(app)
        .get("/api/entity-tags?search=custom")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.entityTags).toHaveLength(2);
      const names = res.body.payload.entityTags.map((t: { name: string }) => t.name);
      expect(names).toContain("customers");
      expect(names).toContain("custom-fields");
    });

    it("should return empty list when no tags exist", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .get("/api/entity-tags")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.entityTags).toEqual([]);
      expect(res.body.payload.total).toBe(0);
    });
  });

  // ── GET /api/entity-tags/:id ──────────────────────────────────────

  describe("GET /api/entity-tags/:id", () => {
    it("should return 200 for a valid ID", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const tag = createEntityTag(organizationId, { name: "my-tag" });
      await (db as ReturnType<typeof drizzle>)
        .insert(entityTags)
        .values(tag as never);

      const res = await request(app)
        .get(`/api/entity-tags/${tag.id}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.entityTag.id).toBe(tag.id);
      expect(res.body.payload.entityTag.name).toBe("my-tag");
    });

    it("should return 404 for an unknown ID", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .get(`/api/entity-tags/${generateId()}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe(ApiCode.ENTITY_TAG_NOT_FOUND);
    });
  });

  // ── POST /api/entity-tags ─────────────────────────────────────────

  describe("POST /api/entity-tags", () => {
    it("should create a tag and return 201", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const res = await request(app)
        .post("/api/entity-tags")
        .set("Authorization", "Bearer test-token")
        .send({ name: "new-tag", color: "#123456", description: "A tag" });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      const created = res.body.payload.entityTag;
      expect(created.name).toBe("new-tag");
      expect(created.color).toBe("#123456");
      expect(created.description).toBe("A tag");
      expect(created.organizationId).toBe(organizationId);
    });

    it("should return 409 on duplicate name within org", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      await (db as ReturnType<typeof drizzle>)
        .insert(entityTags)
        .values(createEntityTag(organizationId, { name: "duplicate" }) as never);

      const res = await request(app)
        .post("/api/entity-tags")
        .set("Authorization", "Bearer test-token")
        .send({ name: "duplicate" });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ApiCode.ENTITY_TAG_DUPLICATE_NAME);
    });

    it("should return 400 for invalid payload", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .post("/api/entity-tags")
        .set("Authorization", "Bearer test-token")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.ENTITY_TAG_INVALID_PAYLOAD);
    });
  });

  // ── PATCH /api/entity-tags/:id ────────────────────────────────────

  describe("PATCH /api/entity-tags/:id", () => {
    it("should update fields and return 200", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const tag = createEntityTag(organizationId, { name: "original" });
      await (db as ReturnType<typeof drizzle>)
        .insert(entityTags)
        .values(tag as never);

      const res = await request(app)
        .patch(`/api/entity-tags/${tag.id}`)
        .set("Authorization", "Bearer test-token")
        .send({ name: "updated", color: "#aabbcc" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.entityTag.name).toBe("updated");
      expect(res.body.payload.entityTag.color).toBe("#aabbcc");
    });

    it("should return 409 if new name conflicts with an existing tag", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      await (db as ReturnType<typeof drizzle>)
        .insert(entityTags)
        .values([
          createEntityTag(organizationId, { name: "existing" }),
        ] as never);

      const tagToUpdate = createEntityTag(organizationId, { name: "to-update" });
      await (db as ReturnType<typeof drizzle>)
        .insert(entityTags)
        .values(tagToUpdate as never);

      const res = await request(app)
        .patch(`/api/entity-tags/${tagToUpdate.id}`)
        .set("Authorization", "Bearer test-token")
        .send({ name: "existing" });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ApiCode.ENTITY_TAG_DUPLICATE_NAME);
    });

    it("should return 404 for unknown ID", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .patch(`/api/entity-tags/${generateId()}`)
        .set("Authorization", "Bearer test-token")
        .send({ name: "whatever" });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.ENTITY_TAG_NOT_FOUND);
    });
  });

  // ── DELETE /api/entity-tags/:id ───────────────────────────────────

  describe("DELETE /api/entity-tags/:id", () => {
    it("should soft-delete the tag and its assignments, return 200", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const tag = createEntityTag(organizationId, { name: "to-delete" });
      await (db as ReturnType<typeof drizzle>)
        .insert(entityTags)
        .values(tag as never);

      // Create a connector entity and assignment to verify cascade
      const connDef = createConnectorDefinition();
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorDefinitions)
        .values(connDef as never);
      const connInst = createConnectorInstance(connDef.id, organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorInstances)
        .values(connInst as never);
      const entity = createConnectorEntity(organizationId, connInst.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorEntities)
        .values(entity as never);

      const assignmentId = generateId();
      await (db as ReturnType<typeof drizzle>)
        .insert(entityTagAssignments)
        .values({
          id: assignmentId,
          organizationId,
          connectorEntityId: entity.id,
          entityTagId: tag.id,
          created: now,
          createdBy: "SYSTEM_TEST",
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        } as never);

      const deleteRes = await request(app)
        .delete(`/api/entity-tags/${tag.id}`)
        .set("Authorization", "Bearer test-token");

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.payload.id).toBe(tag.id);

      // Tag should no longer be retrievable
      const getRes = await request(app)
        .get(`/api/entity-tags/${tag.id}`)
        .set("Authorization", "Bearer test-token");
      expect(getRes.status).toBe(404);

      // Assignment should also be soft-deleted (not appear in GET /connector-entities/:id/tags)
      const tagsRes = await request(app)
        .get(`/api/connector-entities/${entity.id}/tags`)
        .set("Authorization", "Bearer test-token");
      expect(tagsRes.status).toBe(200);
      expect(tagsRes.body.payload.tags).toHaveLength(0);
    });

    it("should return 404 for unknown ID", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .delete(`/api/entity-tags/${generateId()}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.ENTITY_TAG_NOT_FOUND);
    });
  });
});
