/**
 * Integration tests for the PortalResultsRepository.
 *
 * Tests run against a real PostgreSQL database spun up by testcontainers.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { PortalResultsRepository } from "../../../../db/repositories/portal-results.repository.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import * as schema from "../../../../db/schema/index.js";
import type { PortalResultInsert } from "../../../../db/schema/zod.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";

describe("PortalResultsRepository Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let repo: PortalResultsRepository;
  let orgId: string;
  let stationId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }

    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    repo = new PortalResultsRepository();

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

    const now = Date.now();
    stationId = generateId();
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.stations)
      .values({
        id: stationId,
        organizationId: orgId,
        name: "Test Station",
        description: null,
        created: now,
        createdBy: "SYSTEM_TEST",
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

  function makeResult(
    overrides?: Partial<PortalResultInsert>
  ): PortalResultInsert {
    const now = Date.now();
    return {
      id: generateId(),
      organizationId: orgId,
      stationId,
      portalId: null,
      name: `result-${generateId().slice(0, 8)}`,
      type: "text",
      content: {},
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      ...overrides,
    } as PortalResultInsert;
  }

  // ── create ───────────────────────────────────────────────────────

  describe("create", () => {
    it("should insert and return the full row", async () => {
      const vegaContent = {
        $schema: "https://vega.github.io/schema/vega-lite/v5.json",
        mark: "bar",
        encoding: { x: { field: "a" }, y: { field: "b" } },
      };
      const data = makeResult({
        name: "Sales Chart",
        type: "vega-lite",
        content: vegaContent,
      });
      const created = await repo.create(data, db);

      expect(created.id).toBe(data.id);
      expect(created.name).toBe("Sales Chart");
      expect(created.type).toBe("vega-lite");
      expect(created.content).toEqual(vegaContent);
      expect(created.organizationId).toBe(orgId);
      expect(created.stationId).toBe(stationId);
    });
  });

  // ── findById ───────────────────────────────────────────────────

  describe("findById", () => {
    it("should return the result by id", async () => {
      const data = makeResult({ name: "find-me" });
      await repo.create(data, db);

      const found = await repo.findById(data.id, db);
      expect(found).toBeDefined();
      expect(found!.id).toBe(data.id);
      expect(found!.name).toBe("find-me");
    });

    it("should exclude soft-deleted results", async () => {
      const data = makeResult();
      await repo.create(data, db);
      await repo.softDelete(data.id, "test-system", db);

      const found = await repo.findById(data.id, db);
      expect(found).toBeUndefined();
    });
  });

  // ── findByStation ──────────────────────────────────────────────

  describe("findByStation", () => {
    it("should return results for the given station", async () => {
      await repo.create(makeResult({ name: "alpha" }), db);
      await repo.create(makeResult({ name: "beta" }), db);

      const results = await repo.findByStation(stationId, {}, db);
      expect(results).toHaveLength(2);
      results.forEach((r) => expect(r.stationId).toBe(stationId));
    });

    it("should exclude soft-deleted results", async () => {
      const result = await repo.create(makeResult(), db);
      await repo.create(makeResult(), db);
      await repo.softDelete(result.id, "test-system", db);

      const results = await repo.findByStation(stationId, {}, db);
      expect(results).toHaveLength(1);
      expect(results[0].id).not.toBe(result.id);
    });

    it("should return empty array for unknown station", async () => {
      const results = await repo.findByStation("unknown-station", {}, db);
      expect(results).toHaveLength(0);
    });
  });

  // ── update ─────────────────────────────────────────────────────

  describe("update", () => {
    it("should modify name and return updated row", async () => {
      const result = await repo.create(
        makeResult({ name: "original" }),
        db
      );

      const updated = await repo.update(
        result.id,
        { name: "renamed" },
        db
      );

      expect(updated?.name).toBe("renamed");
    });
  });

  // ── softDelete ─────────────────────────────────────────────────

  describe("softDelete", () => {
    it("should set deleted timestamp and exclude row from subsequent reads", async () => {
      const result = await repo.create(makeResult(), db);

      await repo.softDelete(result.id, "test-system", db);

      const found = await repo.findById(result.id, db);
      expect(found).toBeUndefined();

      const list = await repo.findByStation(stationId, {}, db);
      expect(list.find((r) => r.id === result.id)).toBeUndefined();
    });
  });
});
