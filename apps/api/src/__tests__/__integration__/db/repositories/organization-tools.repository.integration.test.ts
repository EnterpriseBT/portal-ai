/**
 * Integration tests for the OrganizationToolsRepository.
 *
 * Tests run against a real PostgreSQL database spun up by testcontainers.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { OrganizationToolsRepository } from "../../../../db/repositories/organization-tools.repository.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import * as schema from "../../../../db/schema/index.js";
import type { OrganizationToolInsert } from "../../../../db/schema/zod.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";

describe("OrganizationToolsRepository Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let repo: OrganizationToolsRepository;
  let orgId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }

    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    repo = new OrganizationToolsRepository();

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

  function makeTool(
    overrides?: Partial<OrganizationToolInsert>
  ): OrganizationToolInsert {
    const now = Date.now();
    return {
      id: generateId(),
      organizationId: orgId,
      name: `tool-${generateId().slice(0, 8)}`,
      description: null,
      parameterSchema: { type: "object", properties: {} },
      implementation: {
        type: "webhook",
        url: "https://example.com/hook",
      },
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      ...overrides,
    } as OrganizationToolInsert;
  }

  // ── create ───────────────────────────────────────────────────────

  describe("create", () => {
    it("should insert and return the full row with implementation jsonb", async () => {
      const data = makeTool({
        name: "my-tool",
        description: "A test tool",
        parameterSchema: {
          type: "object",
          properties: { query: { type: "string" } },
        },
        implementation: {
          type: "webhook",
          url: "https://example.com/api",
          headers: { Authorization: "Bearer token" },
        },
      });
      const created = await repo.create(data, db);

      expect(created.id).toBe(data.id);
      expect(created.name).toBe("my-tool");
      expect(created.description).toBe("A test tool");
      expect(created.organizationId).toBe(orgId);
      expect(created.parameterSchema).toEqual({
        type: "object",
        properties: { query: { type: "string" } },
      });
      expect(created.implementation).toEqual({
        type: "webhook",
        url: "https://example.com/api",
        headers: { Authorization: "Bearer token" },
      });
    });
  });

  // ── findById ───────────────────────────────────────────────────

  describe("findById", () => {
    it("should return the tool by id", async () => {
      const data = makeTool({ name: "find-me" });
      await repo.create(data, db);

      const found = await repo.findById(data.id, db);
      expect(found).toBeDefined();
      expect(found!.id).toBe(data.id);
      expect(found!.name).toBe("find-me");
    });
  });

  // ── findByOrganizationId ─────────────────────────────────────────

  describe("findByOrganizationId", () => {
    it("should return tools scoped to the organization", async () => {
      await repo.create(makeTool({ name: "alpha" }), db);
      await repo.create(makeTool({ name: "beta" }), db);

      const results = await repo.findByOrganizationId(orgId, {}, db);
      expect(results).toHaveLength(2);
      results.forEach((t) => expect(t.organizationId).toBe(orgId));
    });

    it("should exclude soft-deleted tools", async () => {
      const tool = await repo.create(makeTool(), db);
      await repo.create(makeTool(), db);
      await repo.softDelete(tool.id, "test-system", db);

      const results = await repo.findByOrganizationId(orgId, {}, db);
      expect(results).toHaveLength(1);
      expect(results[0].id).not.toBe(tool.id);
    });

    it("should return empty array for unknown organization", async () => {
      const results = await repo.findByOrganizationId("unknown-org", {}, db);
      expect(results).toHaveLength(0);
    });
  });

  // ── findByName ───────────────────────────────────────────────────

  describe("findByName", () => {
    it("should return the tool on exact name match within org", async () => {
      const data = makeTool({ name: "exact-name" });
      await repo.create(data, db);

      const found = await repo.findByName(orgId, "exact-name", db);
      expect(found).toBeDefined();
      expect(found!.id).toBe(data.id);
    });

    it("should return undefined for a non-existent name", async () => {
      const found = await repo.findByName(orgId, "does-not-exist", db);
      expect(found).toBeUndefined();
    });

    it("should not return soft-deleted tools", async () => {
      const tool = await repo.create(makeTool({ name: "deleted-tool" }), db);
      await repo.softDelete(tool.id, "test-system", db);

      const found = await repo.findByName(orgId, "deleted-tool", db);
      expect(found).toBeUndefined();
    });
  });

  // ── update ───────────────────────────────────────────────────────

  describe("update", () => {
    it("should modify name and return updated row", async () => {
      const tool = await repo.create(makeTool({ name: "original" }), db);

      const updated = await repo.update(tool.id, { name: "renamed" }, db);

      expect(updated?.name).toBe("renamed");
    });
  });

  // ── softDelete ───────────────────────────────────────────────────

  describe("softDelete", () => {
    it("should set deleted timestamp and exclude row from subsequent reads", async () => {
      const tool = await repo.create(makeTool(), db);

      await repo.softDelete(tool.id, "test-system", db);

      const found = await repo.findById(tool.id, db);
      expect(found).toBeUndefined();

      const list = await repo.findByOrganizationId(orgId, {}, db);
      expect(list.find((t) => t.id === tool.id)).toBeUndefined();
    });
  });
});
