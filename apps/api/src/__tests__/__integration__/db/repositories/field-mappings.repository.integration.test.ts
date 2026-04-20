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
      enabledCapabilityFlags: null,
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
        description: null,
        validationPattern: null,
        validationMessage: null,
        canonicalFormat: null,
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
        description: null,
        validationPattern: null,
        validationMessage: null,
        canonicalFormat: null,
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
    const uniqueSuffix = generateId().replace(/-/g, "").slice(0, 8);
    return {
      id: generateId(),
      organizationId: orgId,
      connectorEntityId,
      columnDefinitionId,
      sourceField: "source_name",
      isPrimaryKey: false,
      normalizedKey: `nk_${uniqueSuffix}`,
      required: false,
      defaultValue: null,
      format: null,
      enumValues: null,
      refNormalizedKey: null,
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
        makeMapping({
          columnDefinitionId: columnDefinitionId2,
          sourceField: "email_addr",
        }),
        db
      );

      const results = await repo.findByConnectorEntityId(connectorEntityId, db);
      expect(results).toHaveLength(2);
      results.forEach((r) =>
        expect(r.connectorEntityId).toBe(connectorEntityId)
      );
    });

    it("should exclude soft-deleted rows", async () => {
      const m = await repo.create(makeMapping(), db);
      await repo.create(
        makeMapping({
          columnDefinitionId: columnDefinitionId2,
          sourceField: "email",
        }),
        db
      );
      await repo.softDelete(m.id, "test-system", db);

      const results = await repo.findByConnectorEntityId(connectorEntityId, db);
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
      await repo.create(makeMapping({ sourceField: "contact_name" }), db);

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

  // ── upsertByEntityAndNormalizedKey ──────────────────────────────

  describe("upsertByEntityAndNormalizedKey", () => {
    it("should insert on first call", async () => {
      const data = makeMapping({
        sourceField: "full_name",
        normalizedKey: "full_name",
      });
      const result = await repo.upsertByEntityAndNormalizedKey(data, db);

      expect(result.sourceField).toBe("full_name");

      const count = await repo.count(undefined, db);
      expect(count).toBe(1);
    });

    it("should update on second call with same entity + normalizedKey", async () => {
      const data = makeMapping({
        sourceField: "full_name",
        normalizedKey: "full_name",
      });
      await repo.upsertByEntityAndNormalizedKey(data, db);

      const updated = await repo.upsertByEntityAndNormalizedKey(
        {
          ...data,
          id: generateId(),
          sourceField: "display_name",
          columnDefinitionId: columnDefinitionId2,
          isPrimaryKey: true,
        },
        db
      );

      expect(updated.sourceField).toBe("display_name");
      expect(updated.columnDefinitionId).toBe(columnDefinitionId2);
      expect(updated.isPrimaryKey).toBe(true);

      const count = await repo.count(undefined, db);
      expect(count).toBe(1);
    });

    it("should allow two mappings with same columnDefinitionId but different normalizedKey", async () => {
      const a = makeMapping({ normalizedKey: "name_a", columnDefinitionId });
      const b = makeMapping({ normalizedKey: "name_b", columnDefinitionId });
      await repo.upsertByEntityAndNormalizedKey(a, db);
      await repo.upsertByEntityAndNormalizedKey(b, db);

      const count = await repo.count(undefined, db);
      expect(count).toBe(2);
    });
  });

  // ── findBidirectionalPair ──────────────────────────────────────────

  describe("findBidirectionalPair", () => {
    it("returns { mapping, counterpart: null } when ref fields are null", async () => {
      const data = makeMapping({ refEntityKey: null, refNormalizedKey: null });
      await repo.create(data, db);

      const result = await repo.findBidirectionalPair(data.id, db);
      expect(result.mapping.id).toBe(data.id);
      expect(result.counterpart).toBeNull();
    });

    it("returns both mappings when bidirectional pair exists via ref fields", async () => {
      // Create a second entity for the counterpart
      const dbTyped = db as any;
      const entity2Id = generateId();
      const [firstEntity] = await dbTyped
        .select()
        .from(schema.connectorEntities);
      await dbTyped.insert(schema.connectorEntities).values({
        id: entity2Id,
        organizationId: orgId,
        connectorInstanceId: firstEntity.connectorInstanceId,
        key: "tags",
        label: "Tags",
        created: Date.now(),
        createdBy: "test-system",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);

      // Mapping A: entity "contacts", normalizedKey "tag_id", points to entity "tags" / "contact_id"
      const dataA = makeMapping({
        connectorEntityId,
        columnDefinitionId,
        sourceField: "tag_id",
        normalizedKey: "tag_id",
        refEntityKey: "tags",
        refNormalizedKey: "contact_id",
      });
      await repo.create(dataA, db);

      // Mapping B: entity "tags", normalizedKey "contact_id", points back to entity "contacts" / "tag_id"
      const dataB = makeMapping({
        connectorEntityId: entity2Id,
        columnDefinitionId: columnDefinitionId2,
        sourceField: "contact_id",
        normalizedKey: "contact_id",
        refEntityKey: "contacts",
        refNormalizedKey: "tag_id",
      });
      await repo.create(dataB, db);

      const result = await repo.findBidirectionalPair(dataA.id, db);
      expect(result.mapping.id).toBe(dataA.id);
      expect(result.counterpart?.id).toBe(dataB.id);
    });
  });

  // ── findCounterpart ───────────────────────────────────────────────

  describe("findCounterpart", () => {
    let entity2Id: string;

    beforeEach(async () => {
      const dbTyped = db as any;
      const [firstEntity] = await dbTyped
        .select()
        .from(schema.connectorEntities);
      entity2Id = generateId();
      await dbTyped.insert(schema.connectorEntities).values({
        id: entity2Id,
        organizationId: orgId,
        connectorInstanceId: firstEntity.connectorInstanceId,
        key: "tags",
        label: "Tags",
        created: Date.now(),
        createdBy: "test-system",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
    });

    it("returns counterpart when bidirectional pair exists", async () => {
      // Mapping in "tags" entity pointing back to "contacts"
      const counterpart = makeMapping({
        connectorEntityId: entity2Id,
        columnDefinitionId: columnDefinitionId2,
        sourceField: "contact_id",
        normalizedKey: "contact_id",
        refEntityKey: "contacts",
        refNormalizedKey: "tag_id",
      });
      await repo.create(counterpart, db);

      const result = await repo.findCounterpart(
        orgId,
        "contacts",
        "tags",
        "contact_id",
        db
      );
      expect(result).not.toBeNull();
      expect(result!.id).toBe(counterpart.id);
    });

    it("returns null when no counterpart exists", async () => {
      const result = await repo.findCounterpart(
        orgId,
        "contacts",
        "tags",
        "contact_id",
        db
      );
      expect(result).toBeNull();
    });

    it("returns null when target mapping exists but doesn't point back", async () => {
      // Mapping in "tags" entity but refEntityKey points elsewhere
      const notCounterpart = makeMapping({
        connectorEntityId: entity2Id,
        columnDefinitionId: columnDefinitionId2,
        sourceField: "contact_id",
        normalizedKey: "contact_id",
        refEntityKey: "other_entity",
        refNormalizedKey: "tag_id",
      });
      await repo.create(notCounterpart, db);

      const result = await repo.findCounterpart(
        orgId,
        "contacts",
        "tags",
        "contact_id",
        db
      );
      expect(result).toBeNull();
    });

    it("skips soft-deleted mappings", async () => {
      const counterpart = makeMapping({
        connectorEntityId: entity2Id,
        columnDefinitionId: columnDefinitionId2,
        sourceField: "contact_id",
        normalizedKey: "contact_id",
        refEntityKey: "contacts",
        refNormalizedKey: "tag_id",
      });
      await repo.create(counterpart, db);
      await repo.softDelete(counterpart.id, "test-system", db);

      const result = await repo.findCounterpart(
        orgId,
        "contacts",
        "tags",
        "contact_id",
        db
      );
      expect(result).toBeNull();
    });
  });

  // ── Unique constraint ──────────────────────────────────────────

  describe("unique constraint", () => {
    it("should reject duplicate entity + normalizedKey via create", async () => {
      const nk = `nk_${generateId().replace(/-/g, "").slice(0, 8)}`;
      await repo.create(makeMapping({ normalizedKey: nk }), db);

      const duplicate = makeMapping({
        normalizedKey: nk,
        columnDefinitionId: columnDefinitionId2,
      });
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

  // ── findMany with include ──────────────────────────────────────

  describe("findMany with include", () => {
    it("should attach connectorEntity when include contains connectorEntity", async () => {
      await repo.create(makeMapping({ sourceField: "full_name" }), db);

      const results = await repo.findMany(
        undefined,
        { include: ["connectorEntity"] },
        db
      );

      expect(results).toHaveLength(1);
      const enriched = results[0] as Record<string, unknown>;
      expect(enriched.connectorEntity).toBeDefined();
      expect((enriched.connectorEntity as { id: string }).id).toBe(
        connectorEntityId
      );
    });

    it("should return plain rows when include is empty", async () => {
      await repo.create(makeMapping(), db);

      const results = await repo.findMany(undefined, { include: [] }, db);

      expect(results).toHaveLength(1);
      expect(
        (results[0] as Record<string, unknown>).connectorEntity
      ).toBeUndefined();
    });
  });

  // ── Reference metadata ─────────────────────────────────────────

  describe("reference metadata", () => {
    it("should store and retrieve refNormalizedKey and refEntityKey", async () => {
      const data = makeMapping({
        refNormalizedKey: "user_id",
        refEntityKey: "contacts",
      });
      const created = await repo.create(data, db);
      expect(created.refNormalizedKey).toBe("user_id");
      expect(created.refEntityKey).toBe("contacts");
    });

    it("should update ref fields via upsert", async () => {
      const nk = `nk_${generateId().replace(/-/g, "").slice(0, 8)}`;
      const data = makeMapping({ sourceField: "owner_id", normalizedKey: nk });
      await repo.upsertByEntityAndNormalizedKey(data, db);

      const updated = await repo.upsertByEntityAndNormalizedKey(
        {
          ...data,
          id: generateId(),
          refNormalizedKey: "owner_key",
          refEntityKey: "owners",
        },
        db
      );
      expect(updated.refNormalizedKey).toBe("owner_key");
      expect(updated.refEntityKey).toBe("owners");
    });
  });
});
