/**
 * Integration tests for the EntityGroupsRepository.
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

describe("EntityGroupsRepository Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let repo: EntityGroupsRepository;
  let membersRepo: EntityGroupMembersRepository;
  let orgId: string;
  let connectorInstanceId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }

    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    repo = new EntityGroupsRepository();
    membersRepo = new EntityGroupMembersRepository();

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

  // ── create ───────────────────────────────────────────────────────

  describe("create", () => {
    it("should insert and return the full row", async () => {
      const data = makeGroup({ name: "my-group", description: "A test group" });
      const created = await repo.create(data, db);

      expect(created.id).toBe(data.id);
      expect(created.name).toBe("my-group");
      expect(created.description).toBe("A test group");
      expect(created.organizationId).toBe(orgId);
    });
  });

  // ── findByOrganizationId ─────────────────────────────────────────

  describe("findByOrganizationId", () => {
    it("should return groups scoped to the organization", async () => {
      await repo.create(makeGroup({ name: "alpha" }), db);
      await repo.create(makeGroup({ name: "beta" }), db);

      const results = await repo.findByOrganizationId(orgId, {}, db);
      expect(results).toHaveLength(2);
      results.forEach((g) => expect(g.organizationId).toBe(orgId));
    });

    it("should exclude soft-deleted groups", async () => {
      const group = await repo.create(makeGroup(), db);
      await repo.create(makeGroup(), db);
      await repo.softDelete(group.id, "test-system", db);

      const results = await repo.findByOrganizationId(orgId, {}, db);
      expect(results).toHaveLength(1);
      expect(results[0].id).not.toBe(group.id);
    });

    it("should return empty array for unknown organization", async () => {
      const results = await repo.findByOrganizationId("unknown-org", {}, db);
      expect(results).toHaveLength(0);
    });
  });

  // ── findByName ───────────────────────────────────────────────────

  describe("findByName", () => {
    it("should return the group on exact name match within org", async () => {
      const data = makeGroup({ name: "exact-name" });
      await repo.create(data, db);

      const found = await repo.findByName(orgId, "exact-name", db);
      expect(found).toBeDefined();
      expect(found!.id).toBe(data.id);
    });

    it("should return undefined for a non-existent name", async () => {
      const found = await repo.findByName(orgId, "does-not-exist", db);
      expect(found).toBeUndefined();
    });

    it("should not return soft-deleted groups", async () => {
      const group = await repo.create(makeGroup({ name: "deleted-group" }), db);
      await repo.softDelete(group.id, "test-system", db);

      const found = await repo.findByName(orgId, "deleted-group", db);
      expect(found).toBeUndefined();
    });
  });

  // ── findByConnectorEntityId ──────────────────────────────────────

  describe("findByConnectorEntityId", () => {
    it("should return groups the entity belongs to", async () => {
      const { entityId, fieldMappingId } = await seedEntityWithMapping();
      const group1 = await repo.create(makeGroup({ name: "group-1" }), db);
      const group2 = await repo.create(makeGroup({ name: "group-2" }), db);

      await membersRepo.create(makeMember(group1.id, entityId, fieldMappingId), db);
      await membersRepo.create(makeMember(group2.id, entityId, fieldMappingId), db);

      const results = await repo.findByConnectorEntityId(entityId, db);
      expect(results).toHaveLength(2);
      const ids = results.map((g) => g.id);
      expect(ids).toContain(group1.id);
      expect(ids).toContain(group2.id);
    });

    it("should return empty array when entity has no memberships", async () => {
      const { entityId } = await seedEntityWithMapping();
      const results = await repo.findByConnectorEntityId(entityId, db);
      expect(results).toHaveLength(0);
    });

    it("should exclude soft-deleted groups", async () => {
      const { entityId, fieldMappingId } = await seedEntityWithMapping();
      const group = await repo.create(makeGroup(), db);
      await membersRepo.create(makeMember(group.id, entityId, fieldMappingId), db);
      await repo.softDelete(group.id, "test-system", db);

      const results = await repo.findByConnectorEntityId(entityId, db);
      expect(results).toHaveLength(0);
    });
  });

  // ── update ───────────────────────────────────────────────────────

  describe("update", () => {
    it("should modify fields and return updated row", async () => {
      const group = await repo.create(makeGroup({ name: "original", description: null }), db);

      const updated = await repo.update(
        group.id,
        { name: "renamed", description: "new desc" },
        db
      );

      expect(updated?.name).toBe("renamed");
      expect(updated?.description).toBe("new desc");
    });
  });

  // ── softDelete ───────────────────────────────────────────────────

  describe("softDelete", () => {
    it("should set deleted timestamp and exclude row from subsequent reads", async () => {
      const group = await repo.create(makeGroup(), db);

      await repo.softDelete(group.id, "test-system", db);

      const found = await repo.findById(group.id, db);
      expect(found).toBeUndefined();

      const list = await repo.findByOrganizationId(orgId, {}, db);
      expect(list.find((g) => g.id === group.id)).toBeUndefined();
    });
  });
});
