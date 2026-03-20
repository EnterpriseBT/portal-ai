/**
 * Integration tests for the FieldMappingsRepository.
 *
 * Tests run against a real PostgreSQL database spun up by testcontainers.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { FieldMappingsRepository } from "../../../../db/repositories/field-mappings.repository.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import * as schema from "../../../../db/schema/index.js";
import type { FieldMappingInsert } from "../../../../db/schema/zod.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";

describe("FieldMappingsRepository Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let repo: FieldMappingsRepository;
  let connectorEntityId: string;
  let columnDefinitionId: string;
  let columnDefinitionId2: string;
  let orgId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }

    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    repo = new FieldMappingsRepository();

    await teardownOrg(db as ReturnType<typeof drizzle>);

    const now = Date.now();
    const dbTyped = db as ReturnType<typeof drizzle>;

    // Seed: user → org → connector def → connector instance → connector entity
    const user = createUser(`auth0|${generateId()}`);
    await dbTyped.insert(schema.users).values(user as never);
    const org = createOrganization(user.id);
    await dbTyped.insert(schema.organizations).values(org as never);
    orgId = org.id;

    const connDefId = generateId();
    await dbTyped.insert(schema.connectorDefinitions).values({
      id: connDefId,
      slug: `test-conn-${generateId().slice(0, 8)}`,
      display: "Test Connector",
      category: "crm",
      authType: "oauth2",
      configSchema: {},
      capabilityFlags: { sync: true },
      isActive: true,
      version: "1.0.0",
      iconUrl: null,
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    const instanceId = generateId();
    await dbTyped.insert(schema.connectorInstances).values({
      id: instanceId,
      connectorDefinitionId: connDefId,
      organizationId: orgId,
      name: "Test Instance",
      status: "active",
      config: {},
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    connectorEntityId = generateId();
    await dbTyped.insert(schema.connectorEntities).values({
      id: connectorEntityId,
      organizationId: orgId,
      connectorInstanceId: instanceId,
      key: "contacts",
      label: "Contacts",
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    // Seed two column definitions for mapping targets
    columnDefinitionId = generateId();
    columnDefinitionId2 = generateId();
    await dbTyped.insert(schema.columnDefinitions).values([
      {
        id: columnDefinitionId,
        organizationId: orgId,
        key: "name",
        label: "Name",
        type: "string",
        required: true,
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
      },
      {
        id: columnDefinitionId2,
        organizationId: orgId,
        key: "email",
        label: "Email",
        type: "string",
        required: true,
        defaultValue: null,
        format: "email",
        enumValues: null,
        description: null,
        created: now,
        createdBy: "test-system",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      },
    ] as never);
  });

  afterEach(async () => {
    await connection.end();
  });

  // ── Helpers ──────────────────────────────────────────────────────

  function makeMapping(
    overrides?: Partial<FieldMappingInsert>
  ): FieldMappingInsert {
    const now = Date.now();
    return {
      id: generateId(),
      organizationId: orgId,
      connectorEntityId,
      columnDefinitionId,
      sourceField: "source_name",
      isPrimaryKey: false,
      refColumnDefinitionId: null,
      refEntityKey: null,
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      ...overrides,
    } as FieldMappingInsert;
  }

  // ── CRUD lifecycle ──────────────────────────────────────────────

  describe("CRUD lifecycle", () => {
    it("should create, read, update, and soft-delete a field mapping", async () => {
      const data = makeMapping();
      const created = await repo.create(data, db);
      expect(created.id).toBe(data.id);
      expect(created.sourceField).toBe("source_name");

      const found = await repo.findById(created.id, db);
      expect(found).toBeDefined();

      const updated = await repo.update(
        created.id,
        { sourceField: "updated_source" },
        db
      );
      expect(updated?.sourceField).toBe("updated_source");

      await repo.softDelete(created.id, "test-system", db);
      const afterDelete = await repo.findById(created.id, db);
      expect(afterDelete).toBeUndefined();
    });
  });

  // ── findByConnectorEntityId ────────────────────────────────────

  describe("findByConnectorEntityId", () => {
    it("should return all mappings for the given entity", async () => {
      await repo.create(
        makeMapping({ columnDefinitionId, sourceField: "name" }),
        db
      );
      await repo.create(
        makeMapping({ columnDefinitionId: columnDefinitionId2, sourceField: "email_addr" }),
        db
      );

      const results = await repo.findByConnectorEntityId(
        connectorEntityId,
        db
      );
      expect(results).toHaveLength(2);
      results.forEach((r) =>
        expect(r.connectorEntityId).toBe(connectorEntityId)
      );
    });

    it("should exclude soft-deleted rows", async () => {
      const m = await repo.create(makeMapping(), db);
      await repo.create(
        makeMapping({ columnDefinitionId: columnDefinitionId2, sourceField: "email" }),
        db
      );
      await repo.softDelete(m.id, "test-system", db);

      const results = await repo.findByConnectorEntityId(
        connectorEntityId,
        db
      );
      expect(results).toHaveLength(1);
    });

    it("should return empty array for unknown entity", async () => {
      const results = await repo.findByConnectorEntityId("unknown-id", db);
      expect(results).toHaveLength(0);
    });
  });

  // ── findByColumnDefinitionId ───────────────────────────────────

  describe("findByColumnDefinitionId", () => {
    it("should return all mappings across entities for a given column", async () => {
      await repo.create(
        makeMapping({ sourceField: "contact_name" }),
        db
      );

      const results = await repo.findByColumnDefinitionId(
        columnDefinitionId,
        db
      );
      expect(results).toHaveLength(1);
      expect(results[0].columnDefinitionId).toBe(columnDefinitionId);
    });

    it("should exclude soft-deleted rows", async () => {
      const m = await repo.create(makeMapping(), db);
      await repo.softDelete(m.id, "test-system", db);

      const results = await repo.findByColumnDefinitionId(
        columnDefinitionId,
        db
      );
      expect(results).toHaveLength(0);
    });
  });

  // ── upsertByEntityAndColumn ────────────────────────────────────

  describe("upsertByEntityAndColumn", () => {
    it("should insert on first call", async () => {
      const data = makeMapping({ sourceField: "full_name" });
      const result = await repo.upsertByEntityAndColumn(data, db);

      expect(result.sourceField).toBe("full_name");

      const count = await repo.count(undefined, db);
      expect(count).toBe(1);
    });

    it("should update on second call with same entity + column", async () => {
      const data = makeMapping({ sourceField: "full_name" });
      await repo.upsertByEntityAndColumn(data, db);

      const updated = await repo.upsertByEntityAndColumn(
        {
          ...data,
          id: generateId(),
          sourceField: "display_name",
          isPrimaryKey: true,
        },
        db
      );

      expect(updated.sourceField).toBe("display_name");
      expect(updated.isPrimaryKey).toBe(true);

      const count = await repo.count(undefined, db);
      expect(count).toBe(1);
    });
  });

  // ── Unique constraint ──────────────────────────────────────────

  describe("unique constraint", () => {
    it("should reject duplicate entity + column via create", async () => {
      await repo.create(makeMapping(), db);

      const duplicate = makeMapping();
      await expect(repo.create(duplicate, db)).rejects.toThrow();
    });
  });

  // ── FK constraints ─────────────────────────────────────────────

  describe("FK constraints", () => {
    it("should reject invalid connector_entity_id", async () => {
      const data = makeMapping({ connectorEntityId: "invalid-id" });
      await expect(repo.create(data, db)).rejects.toThrow();
    });

    it("should reject invalid column_definition_id", async () => {
      const data = makeMapping({ columnDefinitionId: "invalid-id" });
      await expect(repo.create(data, db)).rejects.toThrow();
    });
  });

  // ── Reference metadata ─────────────────────────────────────────

  describe("reference metadata", () => {
    it("should store and retrieve refColumnDefinitionId and refEntityKey", async () => {
      const data = makeMapping({
        refColumnDefinitionId: columnDefinitionId2,
        refEntityKey: "contacts",
      });
      const created = await repo.create(data, db);
      expect(created.refColumnDefinitionId).toBe(columnDefinitionId2);
      expect(created.refEntityKey).toBe("contacts");
    });

    it("should update ref fields via upsert", async () => {
      const data = makeMapping({ sourceField: "owner_id" });
      await repo.upsertByEntityAndColumn(data, db);

      const updated = await repo.upsertByEntityAndColumn(
        {
          ...data,
          id: generateId(),
          refColumnDefinitionId: columnDefinitionId2,
          refEntityKey: "owners",
        },
        db
      );
      expect(updated.refColumnDefinitionId).toBe(columnDefinitionId2);
      expect(updated.refEntityKey).toBe("owners");
    });

    it("should reject invalid refColumnDefinitionId", async () => {
      const data = makeMapping({ refColumnDefinitionId: "non-existent-id" });
      await expect(repo.create(data, db)).rejects.toThrow();
    });
  });
});
