/**
 * Integration tests for the StationsRepository.
 *
 * Tests run against a real PostgreSQL database spun up by testcontainers.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { StationsRepository } from "../../../../db/repositories/stations.repository.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import * as schema from "../../../../db/schema/index.js";
import type { StationInsert } from "../../../../db/schema/zod.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";

describe("StationsRepository Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let repo: StationsRepository;
  let orgId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }

    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    repo = new StationsRepository();

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

  function makeStation(overrides?: Partial<StationInsert>): StationInsert {
    const now = Date.now();
    return {
      id: generateId(),
      organizationId: orgId,
      name: `station-${generateId().slice(0, 8)}`,
      description: null,
      toolPacks: ["data_query"],
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      ...overrides,
    } as StationInsert;
  }

  // ── create ───────────────────────────────────────────────────────

  describe("create", () => {
    it("should insert and return the full row", async () => {
      const data = makeStation({
        name: "my-station",
        description: "A test station",
      });
      const created = await repo.create(data, db);

      expect(created.id).toBe(data.id);
      expect(created.name).toBe("my-station");
      expect(created.description).toBe("A test station");
      expect(created.organizationId).toBe(orgId);
    });
  });

  // ── findById ───────────────────────────────────────────────────

  describe("findById", () => {
    it("should return the station by id", async () => {
      const data = makeStation({ name: "find-me" });
      await repo.create(data, db);

      const found = await repo.findById(data.id, db);
      expect(found).toBeDefined();
      expect(found!.id).toBe(data.id);
      expect(found!.name).toBe("find-me");
    });

    it("should exclude soft-deleted stations", async () => {
      const data = makeStation();
      await repo.create(data, db);
      await repo.softDelete(data.id, "test-system", db);

      const found = await repo.findById(data.id, db);
      expect(found).toBeUndefined();
    });
  });

  // ── findByOrganizationId ─────────────────────────────────────────

  describe("findByOrganizationId", () => {
    it("should return stations scoped to the organization", async () => {
      await repo.create(makeStation({ name: "alpha" }), db);
      await repo.create(makeStation({ name: "beta" }), db);

      const results = await repo.findByOrganizationId(orgId, {}, db);
      expect(results).toHaveLength(2);
      results.forEach((s) => expect(s.organizationId).toBe(orgId));
    });

    it("should exclude soft-deleted stations", async () => {
      const station = await repo.create(makeStation(), db);
      await repo.create(makeStation(), db);
      await repo.softDelete(station.id, "test-system", db);

      const results = await repo.findByOrganizationId(orgId, {}, db);
      expect(results).toHaveLength(1);
      expect(results[0].id).not.toBe(station.id);
    });

    it("should return empty array for unknown organization", async () => {
      const results = await repo.findByOrganizationId("unknown-org", {}, db);
      expect(results).toHaveLength(0);
    });
  });

  // ── update ───────────────────────────────────────────────────────

  describe("update", () => {
    it("should modify fields and return updated row", async () => {
      const station = await repo.create(
        makeStation({ name: "original", description: null }),
        db
      );

      const updated = await repo.update(
        station.id,
        { name: "renamed", description: "new description" },
        db
      );

      expect(updated?.name).toBe("renamed");
      expect(updated?.description).toBe("new description");
    });
  });

  // ── softDelete ───────────────────────────────────────────────────

  describe("softDelete", () => {
    it("should set deleted timestamp and exclude row from subsequent reads", async () => {
      const station = await repo.create(makeStation(), db);

      await repo.softDelete(station.id, "test-system", db);

      const found = await repo.findById(station.id, db);
      expect(found).toBeUndefined();

      const list = await repo.findByOrganizationId(orgId, {}, db);
      expect(list.find((s) => s.id === station.id)).toBeUndefined();
    });
  });
});
