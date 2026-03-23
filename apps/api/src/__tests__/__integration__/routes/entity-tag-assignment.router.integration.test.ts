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
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

function createConnectorEntity(
  organizationId: string,
  connectorInstanceId: string,
  overrides?: Partial<Record<string, unknown>>
) {
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
    ...overrides,
  };
}

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

function createAssignment(
  organizationId: string,
  connectorEntityId: string,
  entityTagId: string
) {
  return {
    id: generateId(),
    organizationId,
    connectorEntityId,
    entityTagId,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

/** Seed a connector definition + instance and return the instance ID. */
async function seedConnectorInstance(
  db: ReturnType<typeof drizzle>,
  organizationId: string
): Promise<string> {
  const def = createConnectorDefinition();
  await db.insert(connectorDefinitions).values(def as never);
  const instance = createConnectorInstance(def.id, organizationId);
  await db.insert(connectorInstances).values(instance as never);
  return instance.id;
}

// ── Tests ──────────────────────────────────────────────────────────

describe("Entity Tag Assignment Router", () => {
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

  // ── GET /api/connector-entities/:id/tags ──────────────────────────

  describe("GET /api/connector-entities/:id/tags", () => {
    it("should return assigned tags for a connector entity", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const connInstId = await seedConnectorInstance(
        db as ReturnType<typeof drizzle>,
        organizationId
      );

      const entity = createConnectorEntity(organizationId, connInstId);
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorEntities)
        .values(entity as never);

      const tag = createEntityTag(organizationId, { name: "my-tag" });
      await (db as ReturnType<typeof drizzle>)
        .insert(entityTags)
        .values(tag as never);

      await (db as ReturnType<typeof drizzle>)
        .insert(entityTagAssignments)
        .values(createAssignment(organizationId, entity.id, tag.id) as never);

      const res = await request(app)
        .get(`/api/connector-entities/${entity.id}/tags`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.tags).toHaveLength(1);
      expect(res.body.payload.tags[0].id).toBe(tag.id);
      expect(res.body.payload.tags[0].name).toBe("my-tag");
    });

    it("should return empty array when no tags are assigned", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const connInstId = await seedConnectorInstance(
        db as ReturnType<typeof drizzle>,
        organizationId
      );

      const entity = createConnectorEntity(organizationId, connInstId);
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorEntities)
        .values(entity as never);

      const res = await request(app)
        .get(`/api/connector-entities/${entity.id}/tags`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.tags).toEqual([]);
    });
  });

  // ── POST /api/connector-entities/:id/tags ─────────────────────────

  describe("POST /api/connector-entities/:id/tags", () => {
    it("should assign a tag to a connector entity and return 201", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const connInstId = await seedConnectorInstance(
        db as ReturnType<typeof drizzle>,
        organizationId
      );

      const entity = createConnectorEntity(organizationId, connInstId);
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorEntities)
        .values(entity as never);

      const tag = createEntityTag(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(entityTags)
        .values(tag as never);

      const res = await request(app)
        .post(`/api/connector-entities/${entity.id}/tags`)
        .set("Authorization", "Bearer test-token")
        .send({ entityTagId: tag.id });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      const assignment = res.body.payload.entityTagAssignment;
      expect(assignment.connectorEntityId).toBe(entity.id);
      expect(assignment.entityTagId).toBe(tag.id);
    });

    it("should return 409 if the tag is already assigned", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const connInstId = await seedConnectorInstance(
        db as ReturnType<typeof drizzle>,
        organizationId
      );

      const entity = createConnectorEntity(organizationId, connInstId);
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorEntities)
        .values(entity as never);

      const tag = createEntityTag(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(entityTags)
        .values(tag as never);

      await (db as ReturnType<typeof drizzle>)
        .insert(entityTagAssignments)
        .values(createAssignment(organizationId, entity.id, tag.id) as never);

      const res = await request(app)
        .post(`/api/connector-entities/${entity.id}/tags`)
        .set("Authorization", "Bearer test-token")
        .send({ entityTagId: tag.id });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ApiCode.ENTITY_TAG_ASSIGNMENT_ALREADY_EXISTS);
    });

    it("should return 404 if the tag does not exist", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const connInstId = await seedConnectorInstance(
        db as ReturnType<typeof drizzle>,
        organizationId
      );

      const entity = createConnectorEntity(organizationId, connInstId);
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorEntities)
        .values(entity as never);

      const res = await request(app)
        .post(`/api/connector-entities/${entity.id}/tags`)
        .set("Authorization", "Bearer test-token")
        .send({ entityTagId: generateId() });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.ENTITY_TAG_NOT_FOUND);
    });
  });

  // ── DELETE /api/connector-entities/:id/tags/:assignmentId ─────────

  describe("DELETE /api/connector-entities/:id/tags/:assignmentId", () => {
    it("should remove the assignment and return 200", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const connInstId = await seedConnectorInstance(
        db as ReturnType<typeof drizzle>,
        organizationId
      );

      const entity = createConnectorEntity(organizationId, connInstId);
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorEntities)
        .values(entity as never);

      const tag = createEntityTag(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(entityTags)
        .values(tag as never);

      const assignment = createAssignment(organizationId, entity.id, tag.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(entityTagAssignments)
        .values(assignment as never);

      const deleteRes = await request(app)
        .delete(`/api/connector-entities/${entity.id}/tags/${assignment.id}`)
        .set("Authorization", "Bearer test-token");

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.payload.id).toBe(assignment.id);

      // Confirm the tag no longer appears in GET
      const getRes = await request(app)
        .get(`/api/connector-entities/${entity.id}/tags`)
        .set("Authorization", "Bearer test-token");
      expect(getRes.body.payload.tags).toHaveLength(0);
    });

    it("should return 404 for an unknown assignment ID", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const connInstId = await seedConnectorInstance(
        db as ReturnType<typeof drizzle>,
        organizationId
      );

      const entity = createConnectorEntity(organizationId, connInstId);
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorEntities)
        .values(entity as never);

      const res = await request(app)
        .delete(`/api/connector-entities/${entity.id}/tags/${generateId()}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.ENTITY_TAG_ASSIGNMENT_NOT_FOUND);
    });
  });

  // ── GET /api/connector-entities?include=tags ───────────────────────

  describe("GET /api/connector-entities?include=tags", () => {
    it("should return entities with tags array populated", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const connInstId = await seedConnectorInstance(
        db as ReturnType<typeof drizzle>,
        organizationId
      );

      const entity = createConnectorEntity(organizationId, connInstId);
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorEntities)
        .values(entity as never);

      const tag = createEntityTag(organizationId, { name: "included-tag" });
      await (db as ReturnType<typeof drizzle>)
        .insert(entityTags)
        .values(tag as never);

      await (db as ReturnType<typeof drizzle>)
        .insert(entityTagAssignments)
        .values(createAssignment(organizationId, entity.id, tag.id) as never);

      const res = await request(app)
        .get("/api/connector-entities?include=tags")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.connectorEntities).toHaveLength(1);
      const result = res.body.payload.connectorEntities[0];
      expect(result.tags).toHaveLength(1);
      expect(result.tags[0].name).toBe("included-tag");
    });

    it("should return empty tags array for entities with no assignments", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const connInstId = await seedConnectorInstance(
        db as ReturnType<typeof drizzle>,
        organizationId
      );

      const entity = createConnectorEntity(organizationId, connInstId);
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorEntities)
        .values(entity as never);

      const res = await request(app)
        .get("/api/connector-entities?include=tags")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.connectorEntities[0].tags).toEqual([]);
    });
  });

  // ── GET /api/connector-entities?tagIds=... ────────────────────────

  describe("GET /api/connector-entities?tagIds=...", () => {
    it("should return only entities assigned to the given tag IDs", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const connInstId = await seedConnectorInstance(
        db as ReturnType<typeof drizzle>,
        organizationId
      );

      const entityA = createConnectorEntity(organizationId, connInstId, { label: "Entity A" });
      const entityB = createConnectorEntity(organizationId, connInstId, { label: "Entity B" });
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorEntities)
        .values([entityA, entityB] as never);

      const tag = createEntityTag(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(entityTags)
        .values(tag as never);

      // Only assign entityA
      await (db as ReturnType<typeof drizzle>)
        .insert(entityTagAssignments)
        .values(createAssignment(organizationId, entityA.id, tag.id) as never);

      const res = await request(app)
        .get(`/api/connector-entities?tagIds=${tag.id}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.connectorEntities).toHaveLength(1);
      expect(res.body.payload.connectorEntities[0].id).toBe(entityA.id);
    });

    it("should return empty list when no entities match the given tag IDs", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const connInstId = await seedConnectorInstance(
        db as ReturnType<typeof drizzle>,
        organizationId
      );

      const entity = createConnectorEntity(organizationId, connInstId);
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorEntities)
        .values(entity as never);

      const res = await request(app)
        .get(`/api/connector-entities?tagIds=${generateId()}`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.connectorEntities).toHaveLength(0);
    });
  });

  // ── GET ?tagIds=...&include=tags (composable) ──────────────────────

  describe("GET /api/connector-entities?tagIds=...&include=tags", () => {
    it("should return filtered entities with full tags array", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const connInstId = await seedConnectorInstance(
        db as ReturnType<typeof drizzle>,
        organizationId
      );

      const entityA = createConnectorEntity(organizationId, connInstId, { label: "Tagged Entity" });
      const entityB = createConnectorEntity(organizationId, connInstId, { label: "Untagged Entity" });
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorEntities)
        .values([entityA, entityB] as never);

      const tag1 = createEntityTag(organizationId, { name: "filter-tag" });
      const tag2 = createEntityTag(organizationId, { name: "extra-tag" });
      await (db as ReturnType<typeof drizzle>)
        .insert(entityTags)
        .values([tag1, tag2] as never);

      // Assign both tags to entityA; entityB gets none
      await (db as ReturnType<typeof drizzle>)
        .insert(entityTagAssignments)
        .values([
          createAssignment(organizationId, entityA.id, tag1.id),
          createAssignment(organizationId, entityA.id, tag2.id),
        ] as never);

      const res = await request(app)
        .get(`/api/connector-entities?tagIds=${tag1.id}&include=tags`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      // Only entityA matches the tagIds filter
      expect(res.body.payload.connectorEntities).toHaveLength(1);
      expect(res.body.payload.connectorEntities[0].id).toBe(entityA.id);
      // Full tags array is populated (both tags on entityA)
      expect(res.body.payload.connectorEntities[0].tags).toHaveLength(2);
      const tagNames = res.body.payload.connectorEntities[0].tags.map(
        (t: { name: string }) => t.name
      );
      expect(tagNames).toContain("filter-tag");
      expect(tagNames).toContain("extra-tag");
    });
  });
});
