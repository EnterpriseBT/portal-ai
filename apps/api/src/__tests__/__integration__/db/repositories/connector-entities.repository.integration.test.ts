/**
 * Integration tests for the ConnectorEntitiesRepository.
 *
 * Tests run against a real PostgreSQL database spun up by testcontainers.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { ConnectorEntitiesRepository } from "../../../../db/repositories/connector-entities.repository.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import * as schema from "../../../../db/schema/index.js";
import type { ConnectorEntityInsert } from "../../../../db/schema/zod.js";
import { ApiCode } from "../../../../constants/api-codes.constants.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";

describe("ConnectorEntitiesRepository Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let repo: ConnectorEntitiesRepository;
  let connectorInstanceId: string;
  let orgId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }

    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    repo = new ConnectorEntitiesRepository();

    await teardownOrg(db as ReturnType<typeof drizzle>);

    // Seed user → org → connector definition → connector instance
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
        organizationId: org.id,
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

  function makeEntity(
    overrides?: Partial<ConnectorEntityInsert>
  ): ConnectorEntityInsert {
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

  // ── CRUD lifecycle ──────────────────────────────────────────────

  describe("CRUD lifecycle", () => {
    it("should create, read, update, and soft-delete a connector entity", async () => {
      const data = makeEntity();
      const created = await repo.create(data, db);
      expect(created.id).toBe(data.id);

      const found = await repo.findById(created.id, db);
      expect(found).toBeDefined();
      expect(found?.label).toBe("Test Entity");

      const updated = await repo.update(
        created.id,
        { label: "Updated Entity" },
        db
      );
      expect(updated?.label).toBe("Updated Entity");

      await repo.softDelete(created.id, "test-system", db);
      const afterDelete = await repo.findById(created.id, db);
      expect(afterDelete).toBeUndefined();
    });
  });

  // ── findByConnectorInstanceId ──────────────────────────────────

  describe("findByConnectorInstanceId", () => {
    it("should return only entities for the given connector instance", async () => {
      await repo.create(makeEntity(), db);
      await repo.create(makeEntity(), db);

      const results = await repo.findByConnectorInstanceId(
        connectorInstanceId,
        db
      );
      expect(results).toHaveLength(2);
      results.forEach((r) =>
        expect(r.connectorInstanceId).toBe(connectorInstanceId)
      );
    });

    it("should exclude soft-deleted rows", async () => {
      const ent = await repo.create(makeEntity(), db);
      await repo.create(makeEntity(), db);
      await repo.softDelete(ent.id, "test-system", db);

      const results = await repo.findByConnectorInstanceId(
        connectorInstanceId,
        db
      );
      expect(results).toHaveLength(1);
    });

    it("should return empty array for unknown instance", async () => {
      const results = await repo.findByConnectorInstanceId("unknown-id", db);
      expect(results).toHaveLength(0);
    });
  });

  // ── findByKey ──────────────────────────────────────────────────

  describe("findByKey", () => {
    it("should return the entity matching instance + key", async () => {
      const data = makeEntity({ key: "contacts" });
      await repo.create(data, db);

      const found = await repo.findByKey(connectorInstanceId, "contacts", db);
      expect(found).toBeDefined();
      expect(found?.id).toBe(data.id);
    });

    it("should return undefined for non-existent key", async () => {
      const found = await repo.findByKey(connectorInstanceId, "nope", db);
      expect(found).toBeUndefined();
    });

    it("should not return soft-deleted rows", async () => {
      const data = makeEntity({ key: "deals" });
      const ent = await repo.create(data, db);
      await repo.softDelete(ent.id, "test-system", db);

      const found = await repo.findByKey(connectorInstanceId, "deals", db);
      expect(found).toBeUndefined();
    });
  });

  // ── Unique constraint ──────────────────────────────────────────

  describe("unique constraint", () => {
    it("rejects duplicate (organization_id, key) via create (C2)", async () => {
      const data = makeEntity({ key: "accounts" });
      await repo.create(data, db);

      // Same org, same key, different connector — rejected by the partial
      // unique index on (organization_id, key) WHERE deleted IS NULL.
      const otherConnDefId = generateId();
      await (db as ReturnType<typeof drizzle>)
        .insert(schema.connectorDefinitions)
        .values({
          id: otherConnDefId,
          slug: `test-connector-${generateId().slice(0, 8)}`,
          display: "Other Connector",
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
      const otherInstanceId = generateId();
      await (db as ReturnType<typeof drizzle>)
        .insert(schema.connectorInstances)
        .values({
          id: otherInstanceId,
          connectorDefinitionId: otherConnDefId,
          organizationId: orgId,
          name: "Other Instance",
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

      const duplicate = makeEntity({
        key: "accounts",
        connectorInstanceId: otherInstanceId,
      });
      await expect(repo.create(duplicate, db)).rejects.toThrow();
    });
  });

  // ── upsertByKey (C2 behavior) ──────────────────────────────────

  describe("upsertByKey — C2 org-wide uniqueness", () => {
    async function seedOtherConnectorInstance(): Promise<string> {
      const defId = generateId();
      await (db as ReturnType<typeof drizzle>)
        .insert(schema.connectorDefinitions)
        .values({
          id: defId,
          slug: `other-${generateId().slice(0, 8)}`,
          display: "Other",
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
      const instId = generateId();
      await (db as ReturnType<typeof drizzle>)
        .insert(schema.connectorInstances)
        .values({
          id: instId,
          connectorDefinitionId: defId,
          organizationId: orgId,
          name: "Other",
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
      return instId;
    }

    async function seedOtherOrg(): Promise<string> {
      const otherUser = createUser(`auth0|${generateId()}`);
      await (db as ReturnType<typeof drizzle>)
        .insert(schema.users)
        .values(otherUser as never);
      const otherOrg = createOrganization(otherUser.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(schema.organizations)
        .values(otherOrg as never);
      return otherOrg.id;
    }

    it("updates the existing row when the same connector upserts the same key", async () => {
      const first = await repo.upsertByKey(
        makeEntity({ key: "contacts", label: "v1" }),
        db
      );
      const second = await repo.upsertByKey(
        makeEntity({
          key: "contacts",
          label: "v2",
          updated: Date.now(),
          updatedBy: "test-system",
        }),
        db
      );
      expect(second.id).toBe(first.id);
      expect(second.label).toBe("v2");
    });

    it("throws CONNECTOR_ENTITY_KEY_IN_USE_BY_OTHER_CONNECTOR when another connector in the same org owns the key", async () => {
      const otherInstanceId = await seedOtherConnectorInstance();
      await repo.upsertByKey(makeEntity({ key: "shared" }), db);
      await expect(
        repo.upsertByKey(
          makeEntity({
            key: "shared",
            connectorInstanceId: otherInstanceId,
          }),
          db
        )
      ).rejects.toMatchObject({
        status: 400,
        code: ApiCode.CONNECTOR_ENTITY_KEY_IN_USE_BY_OTHER_CONNECTOR,
      });
    });

    it("succeeds when another organization owns the same key", async () => {
      const otherOrgId = await seedOtherOrg();
      // Need a connector instance in the other org.
      const otherConnDefId = generateId();
      await (db as ReturnType<typeof drizzle>)
        .insert(schema.connectorDefinitions)
        .values({
          id: otherConnDefId,
          slug: `other-org-${generateId().slice(0, 8)}`,
          display: "Other Org Connector",
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
      const otherOrgInstanceId = generateId();
      await (db as ReturnType<typeof drizzle>)
        .insert(schema.connectorInstances)
        .values({
          id: otherOrgInstanceId,
          connectorDefinitionId: otherConnDefId,
          organizationId: otherOrgId,
          name: "Other Org Instance",
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

      await repo.upsertByKey(makeEntity({ key: "cross_org" }), db);
      const row = await repo.upsertByKey(
        makeEntity({
          key: "cross_org",
          organizationId: otherOrgId,
          connectorInstanceId: otherOrgInstanceId,
        }),
        db
      );
      expect(row.organizationId).toBe(otherOrgId);
    });

    it("creates a new entity for a key whose prior owner is soft-deleted", async () => {
      const a = await repo.upsertByKey(makeEntity({ key: "reusable" }), db);
      await repo.softDelete(a.id, "test-system", db);
      const otherInstanceId = await seedOtherConnectorInstance();
      const b = await repo.upsertByKey(
        makeEntity({
          key: "reusable",
          connectorInstanceId: otherInstanceId,
        }),
        db
      );
      expect(b.id).not.toBe(a.id);
    });
  });

  // ── FK constraint ──────────────────────────────────────────────

  describe("FK constraint", () => {
    it("should reject invalid connector_instance_id", async () => {
      const data = makeEntity({ connectorInstanceId: "invalid-id" });
      await expect(repo.create(data, db)).rejects.toThrow();
    });
  });

  // ── findMany with include ───────────────────────────────────────

  describe("findMany with include", () => {
    it("should attach connectorInstance when include contains connectorInstance", async () => {
      await repo.create(makeEntity(), db);

      const results = await repo.findMany(
        undefined,
        { include: ["connectorInstance"] },
        db
      );

      expect(results).toHaveLength(1);
      const entity = results[0] as Record<string, unknown>;
      expect(entity.connectorInstance).toBeDefined();
      expect((entity.connectorInstance as { id: string }).id).toBe(
        connectorInstanceId
      );
    });

    it("should attach fieldMappings when include contains fieldMappings", async () => {
      const dbTyped = db as ReturnType<typeof drizzle>;
      const entity = await repo.create(makeEntity(), db);

      const colDefId = generateId();
      await dbTyped.insert(schema.columnDefinitions).values({
        id: colDefId,
        organizationId: orgId,
        key: `col_${generateId().slice(0, 8)}`,
        label: "Test Col",
        type: "string",
        description: null,
        validationPattern: null,
        validationMessage: null,
        canonicalFormat: null,
        created: Date.now(),
        createdBy: "test-system",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);

      await dbTyped.insert(schema.fieldMappings).values({
        id: generateId(),
        organizationId: orgId,
        connectorEntityId: entity.id,
        columnDefinitionId: colDefId,
        sourceField: "name",
        isPrimaryKey: false,
        normalizedKey: "name",
        required: false,
        defaultValue: null,
        format: null,
        enumValues: null,
        refNormalizedKey: null,
        refEntityKey: null,
        created: Date.now(),
        createdBy: "test-system",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);

      const results = await repo.findMany(
        undefined,
        { include: ["fieldMappings"] },
        db
      );

      expect(results).toHaveLength(1);
      const enriched = results[0] as Record<string, unknown>;
      expect(enriched.fieldMappings as unknown[]).toHaveLength(1);
      expect(
        ((enriched.fieldMappings as unknown[])[0] as { sourceField: string })
          .sourceField
      ).toBe("name");
    });

    it("should return empty arrays for includes with no matching data", async () => {
      await repo.create(makeEntity(), db);

      const results = await repo.findMany(
        undefined,
        { include: ["fieldMappings", "tags"] },
        db
      );

      expect(results).toHaveLength(1);
      const enriched = results[0] as Record<string, unknown>;
      expect(enriched.fieldMappings).toEqual([]);
      expect(enriched.tags).toEqual([]);
    });

    it("should return plain rows when include is empty", async () => {
      await repo.create(makeEntity(), db);

      const results = await repo.findMany(undefined, { include: [] }, db);

      expect(results).toHaveLength(1);
      const row = results[0] as Record<string, unknown>;
      expect(row.fieldMappings).toBeUndefined();
      expect(row.connectorInstance).toBeUndefined();
    });
  });
});
