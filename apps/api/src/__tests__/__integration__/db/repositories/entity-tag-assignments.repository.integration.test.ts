/**
 * Integration tests for the EntityTagAssignmentsRepository.
 *
 * Tests run against a real PostgreSQL database spun up by testcontainers.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { EntityTagsRepository } from "../../../../db/repositories/entity-tags.repository.js";
import { EntityTagAssignmentsRepository } from "../../../../db/repositories/entity-tag-assignments.repository.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import * as schema from "../../../../db/schema/index.js";
import type { EntityTagInsert, EntityTagAssignmentInsert, ConnectorEntityInsert } from "../../../../db/schema/zod.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";

describe("EntityTagAssignmentsRepository Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let tagsRepo: EntityTagsRepository;
  let assignmentsRepo: EntityTagAssignmentsRepository;
  let orgId: string;
  let connectorInstanceId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }

    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    tagsRepo = new EntityTagsRepository();
    assignmentsRepo = new EntityTagAssignmentsRepository();

    await teardownOrg(db as ReturnType<typeof drizzle>);

    const user = createUser(`auth0|${generateId()}`);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.users)
      .values(user as never);
    const org = createOrganization(user.id);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.organizations)
      .values(org as never);
    orgId = org.id;

    const connDefId = generateId();
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.connectorDefinitions)
      .values({
        id: connDefId,
        slug: `test-connector-${generateId().slice(0, 8)}`,
        display: "Test Connector",
        category: "crm",
        authType: "oauth2",
        configSchema: {},
        capabilityFlags: { sync: true },
        isActive: true,
        version: "1.0.0",
        iconUrl: null,
        created: Date.now(),
        createdBy: "test-system",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);

    connectorInstanceId = generateId();
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.connectorInstances)
      .values({
        id: connectorInstanceId,
        connectorDefinitionId: connDefId,
        organizationId: orgId,
        name: "Test Instance",
        status: "active",
        config: {},
        credentials: null,
        lastSyncAt: null,
        lastErrorMessage: null,
        created: Date.now(),
        createdBy: "test-system",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
  });

  afterEach(async () => {
    await connection.end();
  });

  // ── Helpers ──────────────────────────────────────────────────────

  function makeTag(overrides?: Partial<EntityTagInsert>): EntityTagInsert {
    const now = Date.now();
    return {
      id: generateId(),
      organizationId: orgId,
      name: `tag-${generateId().slice(0, 8)}`,
      color: null,
      description: null,
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      ...overrides,
    } as EntityTagInsert;
  }

  function makeEntity(overrides?: Partial<ConnectorEntityInsert>): ConnectorEntityInsert {
    const now = Date.now();
    return {
      id: generateId(),
      organizationId: orgId,
      connectorInstanceId,
      key: `entity_${generateId().replace(/-/g, "").slice(0, 8)}`,
      label: "Test Entity",
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      ...overrides,
    } as ConnectorEntityInsert;
  }

  function makeAssignment(
    connectorEntityId: string,
    entityTagId: string,
    overrides?: Partial<EntityTagAssignmentInsert>
  ): EntityTagAssignmentInsert {
    const now = Date.now();
    return {
      id: generateId(),
      organizationId: orgId,
      connectorEntityId,
      entityTagId,
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      ...overrides,
    } as EntityTagAssignmentInsert;
  }

  async function seedEntity(): Promise<string> {
    const entity = makeEntity();
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.connectorEntities)
      .values(entity as never);
    return entity.id;
  }

  async function seedTag(): Promise<string> {
    const tag = await tagsRepo.create(makeTag(), db);
    return tag.id;
  }

  // ── findByConnectorEntityId ──────────────────────────────────────

  describe("findByConnectorEntityId", () => {
    it("should return enriched assignments with tag details when include is passed", async () => {
      const entityId = await seedEntity();
      const tagId = await seedTag();
      await assignmentsRepo.create(makeAssignment(entityId, tagId), db);

      const results = await assignmentsRepo.findByConnectorEntityId(entityId, { include: ["entityTag"] }, db);
      expect(results).toHaveLength(1);
      expect(results[0].connectorEntityId).toBe(entityId);
      expect(results[0].entityTagId).toBe(tagId);
      expect(results[0].tag).toBeDefined();
      expect(results[0].tag!.id).toBe(tagId);
    });

    it("should return plain assignments when no include is passed", async () => {
      const entityId = await seedEntity();
      const tagId = await seedTag();
      await assignmentsRepo.create(makeAssignment(entityId, tagId), db);

      const results = await assignmentsRepo.findByConnectorEntityId(entityId, {}, db);
      expect(results).toHaveLength(1);
      expect(results[0].connectorEntityId).toBe(entityId);
      expect(results[0].tag).toBeUndefined();
    });

    it("should return empty array when entity has no assignments", async () => {
      const entityId = await seedEntity();
      const results = await assignmentsRepo.findByConnectorEntityId(entityId, {}, db);
      expect(results).toHaveLength(0);
    });

    it("should exclude soft-deleted assignments", async () => {
      const entityId = await seedEntity();
      const tagId = await seedTag();
      const assignment = await assignmentsRepo.create(makeAssignment(entityId, tagId), db);
      await assignmentsRepo.softDelete(assignment.id, "test-system", db);

      const results = await assignmentsRepo.findByConnectorEntityId(entityId, { include: ["entityTag"] }, db);
      expect(results).toHaveLength(0);
    });
  });

  // ── findByConnectorEntityIds ─────────────────────────────────────

  describe("findByConnectorEntityIds", () => {
    it("should batch-load tags for multiple entity IDs", async () => {
      const entityId1 = await seedEntity();
      const entityId2 = await seedEntity();
      const tagId1 = await seedTag();
      const tagId2 = await seedTag();

      await assignmentsRepo.create(makeAssignment(entityId1, tagId1), db);
      await assignmentsRepo.create(makeAssignment(entityId2, tagId2), db);

      const map = await assignmentsRepo.findByConnectorEntityIds([entityId1, entityId2], db);

      expect(map.get(entityId1)).toHaveLength(1);
      expect(map.get(entityId1)![0].id).toBe(tagId1);
      expect(map.get(entityId2)).toHaveLength(1);
      expect(map.get(entityId2)![0].id).toBe(tagId2);
    });

    it("should return empty map for empty input", async () => {
      const map = await assignmentsRepo.findByConnectorEntityIds([], db);
      expect(map.size).toBe(0);
    });

    it("should omit entities with no assignments from the map", async () => {
      const entityWithTag = await seedEntity();
      const entityWithoutTag = await seedEntity();
      const tagId = await seedTag();

      await assignmentsRepo.create(makeAssignment(entityWithTag, tagId), db);

      const map = await assignmentsRepo.findByConnectorEntityIds(
        [entityWithTag, entityWithoutTag],
        db
      );

      expect(map.has(entityWithTag)).toBe(true);
      expect(map.has(entityWithoutTag)).toBe(false);
    });
  });

  // ── findExisting ─────────────────────────────────────────────────

  describe("findExisting", () => {
    it("should detect an existing assignment", async () => {
      const entityId = await seedEntity();
      const tagId = await seedTag();
      await assignmentsRepo.create(makeAssignment(entityId, tagId), db);

      const found = await assignmentsRepo.findExisting(entityId, tagId, db);
      expect(found).toBeDefined();
      expect(found!.connectorEntityId).toBe(entityId);
      expect(found!.entityTagId).toBe(tagId);
    });

    it("should return undefined for non-existent pair", async () => {
      const entityId = await seedEntity();
      const tagId = await seedTag();

      const found = await assignmentsRepo.findExisting(entityId, tagId, db);
      expect(found).toBeUndefined();
    });

    it("should return undefined for a soft-deleted assignment", async () => {
      const entityId = await seedEntity();
      const tagId = await seedTag();
      const assignment = await assignmentsRepo.create(makeAssignment(entityId, tagId), db);
      await assignmentsRepo.softDelete(assignment.id, "test-system", db);

      const found = await assignmentsRepo.findExisting(entityId, tagId, db);
      expect(found).toBeUndefined();
    });
  });

  // ── Unique constraint ────────────────────────────────────────────

  describe("unique constraint", () => {
    it("should reject duplicate (connectorEntityId, entityTagId) at DB level", async () => {
      const entityId = await seedEntity();
      const tagId = await seedTag();

      await assignmentsRepo.create(makeAssignment(entityId, tagId), db);

      await expect(
        assignmentsRepo.create(makeAssignment(entityId, tagId), db)
      ).rejects.toThrow();
    });
  });
});
