/**
 * Integration tests for the PortalsRepository.
 *
 * Tests run against a real PostgreSQL database spun up by testcontainers.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { PortalsRepository } from "../../../../db/repositories/portals.repository.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import * as schema from "../../../../db/schema/index.js";
import type { PortalInsert } from "../../../../db/schema/zod.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";

describe("PortalsRepository Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let repo: PortalsRepository;
  let orgId: string;
  let stationId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }

    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    repo = new PortalsRepository();

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

    // Seed a station for portal tests
    const now = Date.now();
    stationId = generateId();
    await (db as ReturnType<typeof drizzle>).insert(schema.stations).values({
      id: stationId,
      organizationId: orgId,
      name: "Test Station",
      description: null,
      toolPacks: ["data_query"],
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

  function makePortal(overrides?: Partial<PortalInsert>): PortalInsert {
    const now = Date.now();
    return {
      id: generateId(),
      organizationId: orgId,
      stationId,
      name: `portal-${generateId().slice(0, 8)}`,
      lastOpened: null,
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      ...overrides,
    } as PortalInsert;
  }

  // ── create ───────────────────────────────────────────────────────

  describe("create", () => {
    it("should insert and return the full row", async () => {
      const data = makePortal({ name: "my-portal" });
      const created = await repo.create(data, db);

      expect(created.id).toBe(data.id);
      expect(created.name).toBe("my-portal");
      expect(created.stationId).toBe(stationId);
      expect(created.organizationId).toBe(orgId);
    });
  });

  // ── findById ───────────────────────────────────────────────────

  describe("findById", () => {
    it("should return a portal by id", async () => {
      const data = makePortal({ name: "find-me" });
      await repo.create(data, db);

      const found = await repo.findById(data.id, db);
      expect(found).toBeDefined();
      expect(found!.id).toBe(data.id);
      expect(found!.name).toBe("find-me");
    });

    it("should exclude soft-deleted portals", async () => {
      const portal = await repo.create(makePortal(), db);
      await repo.softDelete(portal.id, "test-system", db);

      const found = await repo.findById(portal.id, db);
      expect(found).toBeUndefined();
    });
  });

  // ── findByStation ──────────────────────────────────────────────

  describe("findByStation", () => {
    it("should return portals for a station", async () => {
      await repo.create(makePortal({ name: "alpha" }), db);
      await repo.create(makePortal({ name: "beta" }), db);

      const results = await repo.findByStation(stationId, {}, db);
      expect(results).toHaveLength(2);
      results.forEach((p) => expect(p.stationId).toBe(stationId));
    });

    it("should exclude soft-deleted portals", async () => {
      const portal = await repo.create(makePortal(), db);
      await repo.create(makePortal(), db);
      await repo.softDelete(portal.id, "test-system", db);

      const results = await repo.findByStation(stationId, {}, db);
      expect(results).toHaveLength(1);
      expect(results[0].id).not.toBe(portal.id);
    });

    it("should return empty array for unknown station", async () => {
      const results = await repo.findByStation("unknown-station", {}, db);
      expect(results).toHaveLength(0);
    });
  });

  // ── findRecentByOrg ────────────────────────────────────────────

  describe("findRecentByOrg", () => {
    it("should return portals ordered by lastOpened desc", async () => {
      const now = Date.now();
      await repo.create(
        makePortal({ name: "oldest", created: now, lastOpened: now - 2000 }),
        db
      );
      await repo.create(
        makePortal({ name: "middle", created: now, lastOpened: now - 1000 }),
        db
      );
      await repo.create(
        makePortal({ name: "newest", created: now, lastOpened: now }),
        db
      );

      const results = await repo.findRecentByOrg(orgId, 10, db);
      expect(results).toHaveLength(3);
      expect(results[0].name).toBe("newest");
      expect(results[1].name).toBe("middle");
      expect(results[2].name).toBe("oldest");
    });

    it("should order by lastOpened independent of created", async () => {
      const now = Date.now();
      // Portal created first but opened most recently
      await repo.create(
        makePortal({
          name: "old-but-recent",
          created: now - 5000,
          lastOpened: now,
        }),
        db
      );
      // Portal created last but opened earlier
      await repo.create(
        makePortal({
          name: "new-but-stale",
          created: now,
          lastOpened: now - 3000,
        }),
        db
      );

      const results = await repo.findRecentByOrg(orgId, 10, db);
      expect(results[0].name).toBe("old-but-recent");
      expect(results[1].name).toBe("new-but-stale");
    });

    it("should respect the limit parameter", async () => {
      const now = Date.now();
      await repo.create(makePortal({ lastOpened: now - 2000 }), db);
      await repo.create(makePortal({ lastOpened: now - 1000 }), db);
      await repo.create(makePortal({ lastOpened: now }), db);

      const results = await repo.findRecentByOrg(orgId, 2, db);
      expect(results).toHaveLength(2);
    });

    it("should exclude soft-deleted portals", async () => {
      const now = Date.now();
      const portal = await repo.create(makePortal({ lastOpened: now }), db);
      await repo.create(makePortal({ lastOpened: now - 1000 }), db);
      await repo.softDelete(portal.id, "test-system", db);

      const results = await repo.findRecentByOrg(orgId, 10, db);
      expect(results).toHaveLength(1);
      expect(results[0].id).not.toBe(portal.id);
    });
  });

  // ── update ─────────────────────────────────────────────────────

  describe("update", () => {
    it("should modify fields and return updated row", async () => {
      const portal = await repo.create(makePortal({ name: "original" }), db);

      const updated = await repo.update(portal.id, { name: "renamed" }, db);

      expect(updated?.name).toBe("renamed");
    });
  });

  // ── softDelete ─────────────────────────────────────────────────

  describe("softDelete", () => {
    it("should set deleted timestamp and exclude row from subsequent reads", async () => {
      const portal = await repo.create(makePortal(), db);

      await repo.softDelete(portal.id, "test-system", db);

      const found = await repo.findById(portal.id, db);
      expect(found).toBeUndefined();

      const list = await repo.findByStation(stationId, {}, db);
      expect(list.find((p) => p.id === portal.id)).toBeUndefined();
    });
  });
});
