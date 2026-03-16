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
    it("should reject duplicate connector_instance_id + key via create", async () => {
      const data = makeEntity({ key: "accounts" });
      await repo.create(data, db);

      const duplicate = makeEntity({ key: "accounts" });
      await expect(repo.create(duplicate, db)).rejects.toThrow();
    });
  });

  // ── FK constraint ──────────────────────────────────────────────

  describe("FK constraint", () => {
    it("should reject invalid connector_instance_id", async () => {
      const data = makeEntity({ connectorInstanceId: "invalid-id" });
      await expect(repo.create(data, db)).rejects.toThrow();
    });
  });
});
