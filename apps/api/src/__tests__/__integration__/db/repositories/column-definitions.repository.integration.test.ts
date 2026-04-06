/**
 * Integration tests for the ColumnDefinitionsRepository.
 *
 * Tests run against a real PostgreSQL database spun up by testcontainers.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { ColumnDefinitionsRepository } from "../../../../db/repositories/column-definitions.repository.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import * as schema from "../../../../db/schema/index.js";
import type { ColumnDefinitionInsert } from "../../../../db/schema/zod.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";

describe("ColumnDefinitionsRepository Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let repo: ColumnDefinitionsRepository;
  let orgId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }

    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    repo = new ColumnDefinitionsRepository();

    await teardownOrg(db as ReturnType<typeof drizzle>);

    // Seed a user + organization for FK references
    const user = createUser(`auth0|${generateId()}`);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.users)
      .values(user as never);
    const org = createOrganization(user.id);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.organizations)
      .values(org as never);
    orgId = org.id;
  });

  afterEach(async () => {
    await connection.end();
  });

  // ── Helpers ──────────────────────────────────────────────────────

  function makeColumnDef(
    overrides?: Partial<ColumnDefinitionInsert>
  ): ColumnDefinitionInsert {
    const now = Date.now();
    return {
      id: generateId(),
      organizationId: orgId,
      key: `col_${generateId().replace(/-/g, "").slice(0, 8)}`,
      label: "Test Column",
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
      ...overrides,
    } as ColumnDefinitionInsert;
  }

  // ── CRUD lifecycle ──────────────────────────────────────────────

  describe("CRUD lifecycle", () => {
    it("should create, read, update, and soft-delete a column definition", async () => {
      const data = makeColumnDef();
      const created = await repo.create(data, db);
      expect(created.id).toBe(data.id);
      expect(created.key).toBe(data.key);

      const found = await repo.findById(created.id, db);
      expect(found).toBeDefined();
      expect(found?.label).toBe("Test Column");

      const updated = await repo.update(
        created.id,
        { label: "Updated Column" },
        db
      );
      expect(updated?.label).toBe("Updated Column");

      await repo.softDelete(created.id, "test-system", db);
      const afterDelete = await repo.findById(created.id, db);
      expect(afterDelete).toBeUndefined();
    });
  });

  // ── findByOrganizationId ────────────────────────────────────────

  describe("findByOrganizationId", () => {
    it("should return only column definitions for the given org", async () => {
      await repo.create(makeColumnDef(), db);
      await repo.create(makeColumnDef(), db);

      const results = await repo.findByOrganizationId(orgId, db);
      expect(results).toHaveLength(2);
      results.forEach((r) => expect(r.organizationId).toBe(orgId));
    });

    it("should exclude soft-deleted rows", async () => {
      const col = await repo.create(makeColumnDef(), db);
      await repo.create(makeColumnDef(), db);
      await repo.softDelete(col.id, "test-system", db);

      const results = await repo.findByOrganizationId(orgId, db);
      expect(results).toHaveLength(1);
    });

    it("should return empty array for unknown org", async () => {
      const results = await repo.findByOrganizationId("unknown-org", db);
      expect(results).toHaveLength(0);
    });
  });

  // ── findByKey ──────────────────────────────────────────────────

  describe("findByKey", () => {
    it("should return the column definition matching org + key", async () => {
      const data = makeColumnDef({ key: "email" });
      await repo.create(data, db);

      const found = await repo.findByKey(orgId, "email", db);
      expect(found).toBeDefined();
      expect(found?.id).toBe(data.id);
    });

    it("should return undefined for non-existent key", async () => {
      const found = await repo.findByKey(orgId, "nope", db);
      expect(found).toBeUndefined();
    });

    it("should not return soft-deleted rows", async () => {
      const data = makeColumnDef({ key: "phone" });
      const col = await repo.create(data, db);
      await repo.softDelete(col.id, "test-system", db);

      const found = await repo.findByKey(orgId, "phone", db);
      expect(found).toBeUndefined();
    });
  });

  // ── upsertByKey ────────────────────────────────────────────────

  describe("upsertByKey", () => {
    it("should insert on first call", async () => {
      const data = makeColumnDef({ key: "name", label: "Name" });
      const result = await repo.upsertByKey(data, db);

      expect(result.key).toBe("name");
      expect(result.label).toBe("Name");

      const count = await repo.count(undefined, db);
      expect(count).toBe(1);
    });

    it("should update on second call with same org + key", async () => {
      const data = makeColumnDef({ key: "name", label: "Name" });
      await repo.upsertByKey(data, db);

      const updated = await repo.upsertByKey(
        { ...data, id: generateId(), label: "Full Name", type: "string" },
        db
      );

      expect(updated.label).toBe("Full Name");

      const count = await repo.count(undefined, db);
      expect(count).toBe(1);
    });
  });

  // ── Unique constraint ──────────────────────────────────────────

  describe("unique constraint", () => {
    it("should reject duplicate org_id + key via create", async () => {
      const data = makeColumnDef({ key: "email" });
      await repo.create(data, db);

      const duplicate = makeColumnDef({ key: "email" });
      await expect(repo.create(duplicate, db)).rejects.toThrow();
    });
  });

  // ── FK constraint ──────────────────────────────────────────────

  describe("FK constraint", () => {
    it("should reject invalid organization_id", async () => {
      const data = makeColumnDef({ organizationId: "invalid-org-id" });
      await expect(repo.create(data, db)).rejects.toThrow();
    });
  });

});
