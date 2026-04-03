/**
 * Integration tests for the EntityGroupMembersRepository.
 *
 * Tests run against a real PostgreSQL database spun up by testcontainers.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { EntityGroupsRepository } from "../../../../db/repositories/entity-groups.repository.js";
import { EntityGroupMembersRepository } from "../../../../db/repositories/entity-group-members.repository.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import * as schema from "../../../../db/schema/index.js";
import type {
  EntityGroupInsert,
  EntityGroupMemberInsert,
  ConnectorEntityInsert,
  FieldMappingInsert,
  ColumnDefinitionInsert,
} from "../../../../db/schema/zod.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";

describe("EntityGroupMembersRepository Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let groupsRepo: EntityGroupsRepository;
  let repo: EntityGroupMembersRepository;
  let orgId: string;
  let connectorInstanceId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }

    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    groupsRepo = new EntityGroupsRepository();
    repo = new EntityGroupMembersRepository();

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
        enabledCapabilityFlags: null,
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

  function makeGroup(overrides?: Partial<EntityGroupInsert>): EntityGroupInsert {
    const now = Date.now();
    return {
      id: generateId(),
      organizationId: orgId,
      name: `group-${generateId().slice(0, 8)}`,
      description: null,
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      ...overrides,
    } as EntityGroupInsert;
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

  function makeColumnDef(overrides?: Partial<ColumnDefinitionInsert>): ColumnDefinitionInsert {
    const now = Date.now();
    return {
      id: generateId(),
      organizationId: orgId,
      key: `col_${generateId().replace(/-/g, "").slice(0, 8)}`,
      label: "Test Column",
      type: "string",
      required: false,
      defaultValue: null,
      format: null,
      enumValues: null,
      description: null,
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      ...overrides,
    } as ColumnDefinitionInsert;
  }

  function makeFieldMapping(
    connectorEntityId: string,
    columnDefinitionId: string,
    overrides?: Partial<FieldMappingInsert>
  ): FieldMappingInsert {
    const now = Date.now();
    return {
      id: generateId(),
      organizationId: orgId,
      connectorEntityId,
      columnDefinitionId,
      sourceField: `source_${generateId().slice(0, 8)}`,
      isPrimaryKey: false,
      refColumnDefinitionId: null,
      refEntityKey: null,
      refBidirectionalFieldMappingId: null,
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      ...overrides,
    } as FieldMappingInsert;
  }

  function makeMember(
    entityGroupId: string,
    connectorEntityId: string,
    linkFieldMappingId: string,
    overrides?: Partial<EntityGroupMemberInsert>
  ): EntityGroupMemberInsert {
    const now = Date.now();
    return {
      id: generateId(),
      organizationId: orgId,
      entityGroupId,
      connectorEntityId,
      linkFieldMappingId,
      isPrimary: false,
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      ...overrides,
    } as EntityGroupMemberInsert;
  }

  async function seedEntityWithMapping(): Promise<{
    entityId: string;
    fieldMappingId: string;
  }> {
    const entity = makeEntity();
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.connectorEntities)
      .values(entity as never);

    const colDef = makeColumnDef();
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.columnDefinitions)
      .values(colDef as never);

    const mapping = makeFieldMapping(entity.id, colDef.id);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.fieldMappings)
      .values(mapping as never);

    return { entityId: entity.id, fieldMappingId: mapping.id };
  }

  async function seedGroup(): Promise<string> {
    const group = await groupsRepo.create(makeGroup(), db);
    return group.id;
  }

  // ── findByEntityGroupId ──────────────────────────────────────────

  describe("findByEntityGroupId", () => {
    it("should return enriched members with entity and field mapping details when include is passed", async () => {
      const groupId = await seedGroup();
      const { entityId, fieldMappingId } = await seedEntityWithMapping();
      await repo.create(makeMember(groupId, entityId, fieldMappingId), db);

      const results = await repo.findByEntityGroupId(groupId, { include: ["connectorEntity", "fieldMapping", "columnDefinition"] }, db);
      expect(results).toHaveLength(1);
      expect(results[0].connectorEntityId).toBe(entityId);
      expect(results[0].connectorEntity).toBeDefined();
      expect(results[0].connectorEntity!.id).toBe(entityId);
      expect(results[0].fieldMapping).toBeDefined();
      expect(results[0].fieldMapping!.id).toBe(fieldMappingId);
    });

    it("should return plain members when no include is passed", async () => {
      const groupId = await seedGroup();
      const { entityId, fieldMappingId } = await seedEntityWithMapping();
      await repo.create(makeMember(groupId, entityId, fieldMappingId), db);

      const results = await repo.findByEntityGroupId(groupId, {}, db);
      expect(results).toHaveLength(1);
      expect(results[0].connectorEntityId).toBe(entityId);
      expect(results[0].connectorEntity).toBeUndefined();
      expect(results[0].fieldMapping).toBeUndefined();
    });

    it("should return empty array when group has no members", async () => {
      const groupId = await seedGroup();
      const results = await repo.findByEntityGroupId(groupId, {}, db);
      expect(results).toHaveLength(0);
    });

    it("should exclude soft-deleted members", async () => {
      const groupId = await seedGroup();
      const { entityId, fieldMappingId } = await seedEntityWithMapping();
      const member = await repo.create(makeMember(groupId, entityId, fieldMappingId), db);
      await repo.softDelete(member.id, "test-system", db);

      const results = await repo.findByEntityGroupId(groupId, { include: ["connectorEntity", "fieldMapping", "columnDefinition"] }, db);
      expect(results).toHaveLength(0);
    });
  });

  // ── findByConnectorEntityId ──────────────────────────────────────

  describe("findByConnectorEntityId", () => {
    it("should return all group memberships for an entity", async () => {
      const { entityId, fieldMappingId } = await seedEntityWithMapping();
      const groupId1 = await seedGroup();
      const groupId2 = await seedGroup();
      await repo.create(makeMember(groupId1, entityId, fieldMappingId), db);
      await repo.create(makeMember(groupId2, entityId, fieldMappingId), db);

      const results = await repo.findByConnectorEntityId(entityId, db);
      expect(results).toHaveLength(2);
      const groupIds = results.map((m) => m.entityGroupId);
      expect(groupIds).toContain(groupId1);
      expect(groupIds).toContain(groupId2);
    });

    it("should return empty array when entity has no memberships", async () => {
      const { entityId } = await seedEntityWithMapping();
      const results = await repo.findByConnectorEntityId(entityId, db);
      expect(results).toHaveLength(0);
    });
  });

  // ── findExisting ─────────────────────────────────────────────────

  describe("findExisting", () => {
    it("should detect an existing member", async () => {
      const groupId = await seedGroup();
      const { entityId, fieldMappingId } = await seedEntityWithMapping();
      await repo.create(makeMember(groupId, entityId, fieldMappingId), db);

      const found = await repo.findExisting(groupId, entityId, db);
      expect(found).toBeDefined();
      expect(found!.entityGroupId).toBe(groupId);
      expect(found!.connectorEntityId).toBe(entityId);
    });

    it("should return undefined for non-existent pair", async () => {
      const groupId = await seedGroup();
      const { entityId } = await seedEntityWithMapping();

      const found = await repo.findExisting(groupId, entityId, db);
      expect(found).toBeUndefined();
    });

    it("should return undefined for a soft-deleted member", async () => {
      const groupId = await seedGroup();
      const { entityId, fieldMappingId } = await seedEntityWithMapping();
      const member = await repo.create(makeMember(groupId, entityId, fieldMappingId), db);
      await repo.softDelete(member.id, "test-system", db);

      const found = await repo.findExisting(groupId, entityId, db);
      expect(found).toBeUndefined();
    });
  });

  // ── findPrimary ──────────────────────────────────────────────────

  describe("findPrimary", () => {
    it("should return the primary member", async () => {
      const groupId = await seedGroup();
      const { entityId, fieldMappingId } = await seedEntityWithMapping();
      const member = await repo.create(
        makeMember(groupId, entityId, fieldMappingId, { isPrimary: true }),
        db
      );

      const primary = await repo.findPrimary(groupId, db);
      expect(primary).toBeDefined();
      expect(primary!.id).toBe(member.id);
      expect(primary!.isPrimary).toBe(true);
    });

    it("should return undefined when no primary is set", async () => {
      const groupId = await seedGroup();
      const { entityId, fieldMappingId } = await seedEntityWithMapping();
      await repo.create(makeMember(groupId, entityId, fieldMappingId), db);

      const primary = await repo.findPrimary(groupId, db);
      expect(primary).toBeUndefined();
    });
  });

  // ── clearPrimary ─────────────────────────────────────────────────

  describe("clearPrimary", () => {
    it("should set isPrimary to false on all members of a group", async () => {
      const groupId = await seedGroup();
      const seed1 = await seedEntityWithMapping();
      const seed2 = await seedEntityWithMapping();
      await repo.create(
        makeMember(groupId, seed1.entityId, seed1.fieldMappingId, { isPrimary: true }),
        db
      );
      await repo.create(
        makeMember(groupId, seed2.entityId, seed2.fieldMappingId, { isPrimary: false }),
        db
      );

      await repo.clearPrimary(groupId, db);

      const primary = await repo.findPrimary(groupId, db);
      expect(primary).toBeUndefined();
    });
  });

  // ── setPrimary ───────────────────────────────────────────────────

  describe("setPrimary", () => {
    it("should set the given member as primary and clear the previous primary", async () => {
      const groupId = await seedGroup();
      const seed1 = await seedEntityWithMapping();
      const seed2 = await seedEntityWithMapping();
      const member1 = await repo.create(
        makeMember(groupId, seed1.entityId, seed1.fieldMappingId, { isPrimary: true }),
        db
      );
      const member2 = await repo.create(
        makeMember(groupId, seed2.entityId, seed2.fieldMappingId),
        db
      );

      const updated = await repo.setPrimary(member2.id, db);

      expect(updated).toBeDefined();
      expect(updated!.id).toBe(member2.id);
      expect(updated!.isPrimary).toBe(true);

      // Previous primary should be cleared
      const former = await repo.findById(member1.id, db);
      expect(former!.isPrimary).toBe(false);
    });

    it("should return undefined for a non-existent member", async () => {
      const result = await repo.setPrimary("non-existent-id", db);
      expect(result).toBeUndefined();
    });

    it("should work when no previous primary exists", async () => {
      const groupId = await seedGroup();
      const { entityId, fieldMappingId } = await seedEntityWithMapping();
      const member = await repo.create(
        makeMember(groupId, entityId, fieldMappingId),
        db
      );

      const updated = await repo.setPrimary(member.id, db);
      expect(updated).toBeDefined();
      expect(updated!.isPrimary).toBe(true);
    });
  });

  // ── Unique constraint ────────────────────────────────────────────

  describe("unique constraint", () => {
    it("should reject duplicate (entityGroupId, connectorEntityId) at DB level", async () => {
      const groupId = await seedGroup();
      const { entityId, fieldMappingId } = await seedEntityWithMapping();

      await repo.create(makeMember(groupId, entityId, fieldMappingId), db);

      await expect(
        repo.create(makeMember(groupId, entityId, fieldMappingId), db)
      ).rejects.toThrow();
    });
  });
});
