/**
 * Integration tests for the StationToolsRepository.
 *
 * Tests run against a real PostgreSQL database spun up by testcontainers.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { StationToolsRepository } from "../../../../db/repositories/station-tools.repository.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import * as schema from "../../../../db/schema/index.js";
import type { StationToolInsert } from "../../../../db/schema/zod.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";

describe("StationToolsRepository Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let repo: StationToolsRepository;
  let orgId: string;
  let stationId: string;
  let orgToolId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }

    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    repo = new StationToolsRepository();

    await teardownOrg(db as ReturnType<typeof drizzle>);

    const now = Date.now();

    // Seed user and organization
    const user = createUser(`auth0|${generateId()}`);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.users)
      .values(user as never);
    const org = createOrganization(user.id);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.organizations)
      .values(org as never);
    orgId = org.id;

    // Seed station
    const station = {
      id: generateId(),
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
    };
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.stations)
      .values(station as never);
    stationId = station.id;

    // Seed organization tool
    const orgTool = {
      id: generateId(),
      organizationId: orgId,
      name: "Webhook Tool",
      description: null,
      parameterSchema: { type: "object" },
      implementation: { type: "webhook", url: "https://example.com/hook" },
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    };
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.organizationTools)
      .values(orgTool as never);
    orgToolId = orgTool.id;
  });

  afterEach(async () => {
    await connection.end();
  });

  // ── Helpers ──────────────────────────────────────────────────────

  function makeStationTool(
    overrides?: Partial<StationToolInsert>
  ): StationToolInsert {
    const now = Date.now();
    return {
      id: generateId(),
      stationId,
      organizationToolId: orgToolId,
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      ...overrides,
    } as StationToolInsert;
  }

  // ── create ─────────────────────────────────────────────────────

  describe("create", () => {
    it("should insert and return the full row", async () => {
      const data = makeStationTool();
      const created = await repo.create(data, db);

      expect(created.id).toBe(data.id);
      expect(created.stationId).toBe(stationId);
      expect(created.organizationToolId).toBe(orgToolId);
    });
  });

  // ── findByStationId ────────────────────────────────────────────

  describe("findByStationId", () => {
    it("should return assignments with organizationTool joined", async () => {
      await repo.create(makeStationTool(), db);

      const results = await repo.findByStationId(stationId, db);

      expect(results).toHaveLength(1);
      expect(results[0].stationId).toBe(stationId);
      expect(results[0].organizationToolId).toBe(orgToolId);
      expect(results[0].organizationTool).toBeDefined();
      expect(results[0].organizationTool.id).toBe(orgToolId);
      expect(results[0].organizationTool.name).toBe("Webhook Tool");
    });

    it("should return empty array for unknown station", async () => {
      const results = await repo.findByStationId("unknown-station-id", db);
      expect(results).toHaveLength(0);
    });
  });

  // ── hardDelete ─────────────────────────────────────────────────

  describe("hardDelete", () => {
    it("should remove the row permanently", async () => {
      const data = makeStationTool();
      const created = await repo.create(data, db);

      await repo.hardDelete(created.id, db);

      const results = await repo.findByStationId(stationId, db);
      expect(results).toHaveLength(0);
    });
  });
});
