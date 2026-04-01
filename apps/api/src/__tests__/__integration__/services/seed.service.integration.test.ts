/**
 * Integration tests for SeedService.
 *
 * Runs against the real postgres-test database spun up by docker-compose.
 * Verifies that connector definitions are seeded correctly via upsert,
 * including transaction commit/rollback behaviour.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { Repository } from "../../../db/repositories/base.repository.js";
import { SeedService } from "../../../services/seed.service.js";

const { connectorDefinitions } = schema;

describe("SeedService Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let seedService: SeedService;
  let connectorDefsRepo: Repository<
    typeof connectorDefinitions,
    schema.ConnectorDefinitionSelect,
    schema.ConnectorDefinitionInsert
  >;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }

    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    seedService = new SeedService();
    connectorDefsRepo = new Repository(connectorDefinitions);

    // Clean connector_definitions table
    await db.delete(connectorDefinitions);
  });

  afterEach(async () => {
    await connection.end();
  });

  describe("seed", () => {
    it("should insert connector definitions into the database", async () => {
      await seedService.seed();

      const rows = await connectorDefsRepo.findMany(undefined, {}, db);

      expect(rows.length).toBeGreaterThanOrEqual(1);
    });

    it("should create a CSV connector definition with correct fields", async () => {
      await seedService.seed();

      const rows = await connectorDefsRepo.findMany(undefined, {}, db);
      const csv = rows.find((r) => r.slug === "csv");

      expect(csv).toBeDefined();
      expect(csv?.display).toBe("CSV Connector");
      expect(csv?.category).toBe("File-based");
      expect(csv?.isActive).toBe(true);
      expect(csv?.version).toBe("1.0.0");
      expect(csv?.configSchema).toEqual({});
      expect(csv?.capabilityFlags).toEqual({
        sync: false,
        query: true,
        write: true,
      });
    });

    it("should be idempotent — running seed twice should not duplicate rows", async () => {
      await seedService.seed();
      await seedService.seed();

      const rows = await connectorDefsRepo.findMany(undefined, {}, db);
      const csvRows = rows.filter((r) => r.slug === "csv");

      expect(csvRows).toHaveLength(1);
    });

    it("should update existing connector definitions on re-seed (upsert)", async () => {
      await seedService.seed();

      const before = await connectorDefsRepo.findMany(undefined, {}, db);
      const csvBefore = before.find((r) => r.slug === "csv");
      expect(csvBefore).toBeDefined();

      // Seed again — the upsert should update, not create a duplicate
      await seedService.seed();

      const after = await connectorDefsRepo.findMany(undefined, {}, db);
      const csvAfter = after.find((r) => r.slug === "csv");

      expect(csvAfter).toBeDefined();
      expect(csvAfter?.id).toBe(csvBefore?.id);
    });
  });

  describe("seedConnectorDefinitions", () => {
    it("should insert connectors using the provided db client", async () => {
      await seedService.seedConnectorDefinitions(db);

      const rows = await connectorDefsRepo.findMany(undefined, {}, db);

      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows.find((r) => r.slug === "csv")).toBeDefined();
    });

    it("should work within a transaction that can be rolled back", async () => {
      const { tx, rollback } = await Repository.createTransactionClient();

      await seedService.seedConnectorDefinitions(tx);
      await rollback();

      const rows = await connectorDefsRepo.findMany(undefined, {}, db);

      expect(rows).toHaveLength(0);
    });

    it("should work within a transaction that can be committed", async () => {
      const { tx, commit } = await Repository.createTransactionClient();

      await seedService.seedConnectorDefinitions(tx);
      await commit();

      const rows = await connectorDefsRepo.findMany(undefined, {}, db);

      expect(rows.length).toBeGreaterThanOrEqual(1);
    });
  });
});
