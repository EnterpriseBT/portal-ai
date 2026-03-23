/**
 * Integration tests for the EntityTagsRepository.
 *
 * Tests run against a real PostgreSQL database spun up by testcontainers.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { EntityTagsRepository } from "../../../../db/repositories/entity-tags.repository.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import * as schema from "../../../../db/schema/index.js";
import type { EntityTagInsert } from "../../../../db/schema/zod.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";

describe("EntityTagsRepository Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let repo: EntityTagsRepository;
  let orgId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }

    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    repo = new EntityTagsRepository();

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

  // ── create ───────────────────────────────────────────────────────

  describe("create", () => {
    it("should insert and return the full row", async () => {
      const data = makeTag({ name: "my-tag", color: "#ff0000", description: "A test tag" });
      const created = await repo.create(data, db);

      expect(created.id).toBe(data.id);
      expect(created.name).toBe("my-tag");
      expect(created.color).toBe("#ff0000");
      expect(created.description).toBe("A test tag");
      expect(created.organizationId).toBe(orgId);
    });
  });

  // ── findByOrganizationId ─────────────────────────────────────────

  describe("findByOrganizationId", () => {
    it("should return tags scoped to the organization", async () => {
      await repo.create(makeTag({ name: "alpha" }), db);
      await repo.create(makeTag({ name: "beta" }), db);

      const results = await repo.findByOrganizationId(orgId, {}, db);
      expect(results).toHaveLength(2);
      results.forEach((t) => expect(t.organizationId).toBe(orgId));
    });

    it("should exclude soft-deleted tags", async () => {
      const tag = await repo.create(makeTag(), db);
      await repo.create(makeTag(), db);
      await repo.softDelete(tag.id, "test-system", db);

      const results = await repo.findByOrganizationId(orgId, {}, db);
      expect(results).toHaveLength(1);
      expect(results[0].id).not.toBe(tag.id);
    });

    it("should return empty array for unknown organization", async () => {
      const results = await repo.findByOrganizationId("unknown-org", {}, db);
      expect(results).toHaveLength(0);
    });
  });

  // ── findByName ───────────────────────────────────────────────────

  describe("findByName", () => {
    it("should return the tag on exact name match within org", async () => {
      const data = makeTag({ name: "exact-name" });
      await repo.create(data, db);

      const found = await repo.findByName(orgId, "exact-name", db);
      expect(found).toBeDefined();
      expect(found!.id).toBe(data.id);
    });

    it("should return undefined for a non-existent name", async () => {
      const found = await repo.findByName(orgId, "does-not-exist", db);
      expect(found).toBeUndefined();
    });

    it("should not return soft-deleted tags", async () => {
      const tag = await repo.create(makeTag({ name: "deleted-tag" }), db);
      await repo.softDelete(tag.id, "test-system", db);

      const found = await repo.findByName(orgId, "deleted-tag", db);
      expect(found).toBeUndefined();
    });
  });

  // ── update ───────────────────────────────────────────────────────

  describe("update", () => {
    it("should modify fields and return updated row", async () => {
      const tag = await repo.create(makeTag({ name: "original", color: null }), db);

      const updated = await repo.update(
        tag.id,
        { name: "renamed", color: "#00ff00" },
        db
      );

      expect(updated?.name).toBe("renamed");
      expect(updated?.color).toBe("#00ff00");
    });
  });

  // ── softDelete ───────────────────────────────────────────────────

  describe("softDelete", () => {
    it("should set deleted timestamp and exclude row from subsequent reads", async () => {
      const tag = await repo.create(makeTag(), db);

      await repo.softDelete(tag.id, "test-system", db);

      const found = await repo.findById(tag.id, db);
      expect(found).toBeUndefined();

      const list = await repo.findByOrganizationId(orgId, {}, db);
      expect(list.find((t) => t.id === tag.id)).toBeUndefined();
    });
  });
});
