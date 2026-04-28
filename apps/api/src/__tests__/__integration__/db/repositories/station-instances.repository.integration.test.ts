/**
 * Integration tests for the StationInstancesRepository.
 *
 * Tests run against a real PostgreSQL database spun up by testcontainers.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { StationInstancesRepository } from "../../../../db/repositories/station-instances.repository.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import * as schema from "../../../../db/schema/index.js";
import type { StationInstanceInsert } from "../../../../db/schema/zod.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";

describe("StationInstancesRepository Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let repo: StationInstancesRepository;
  let orgId: string;
  let stationId: string;
  let connectorInstanceId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }

    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    repo = new StationInstancesRepository();

    await teardownOrg(db as ReturnType<typeof drizzle>);

    const now = Date.now();

    // Create user and organization
    const user = createUser(`auth0|${generateId()}`);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.users)
      .values(user as never);
    const org = createOrganization(user.id);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.organizations)
      .values(org as never);
    orgId = org.id;

    // Create a station
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

    // Create a connector definition
    const connDefId = generateId();
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.connectorDefinitions)
      .values({
        id: connDefId,
        slug: "test-def",
        display: "Test Def",
        category: "test",
        authType: "none",
        configSchema: null,
        capabilityFlags: { sync: true },
        isActive: true,
        version: "1.0.0",
        iconUrl: null,
        created: now,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);

    // Create a connector instance
    connectorInstanceId = generateId();
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.connectorInstances)
      .values({
        id: connectorInstanceId,
        connectorDefinitionId: connDefId,
        organizationId: orgId,
        name: "Test Instance",
        status: "active",
        config: null,
        credentials: null,
        lastSyncAt: null,
        lastErrorMessage: null,
        enabledCapabilityFlags: null,
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

  function makeInstance(
    overrides?: Partial<StationInstanceInsert>
  ): StationInstanceInsert {
    const now = Date.now();
    return {
      id: generateId(),
      stationId,
      connectorInstanceId,
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      ...overrides,
    } as StationInstanceInsert;
  }

  // ── create ─────────────────────────────────────────────────────

  describe("create", () => {
    it("should insert and return the full row", async () => {
      const data = makeInstance();
      const created = await repo.create(data, db);

      expect(created.id).toBe(data.id);
      expect(created.stationId).toBe(stationId);
      expect(created.connectorInstanceId).toBe(connectorInstanceId);
    });
  });

  // ── findByStationId ────────────────────────────────────────────

  describe("findByStationId", () => {
    it("should return instances linked to the station", async () => {
      await repo.create(makeInstance(), db);

      const results = await repo.findByStationId(stationId, {}, db);
      expect(results).toHaveLength(1);
      expect(results[0].stationId).toBe(stationId);
      expect(results[0].connectorInstanceId).toBe(connectorInstanceId);
    });

    it("should return empty array for unknown station", async () => {
      const results = await repo.findByStationId("unknown-station-id", {}, db);
      expect(results).toHaveLength(0);
    });
  });

  // ── hardDelete ─────────────────────────────────────────────────

  describe("hardDelete", () => {
    it("should remove the row permanently", async () => {
      const data = makeInstance();
      const created = await repo.create(data, db);

      await repo.hardDelete(created.id, db);

      const results = await repo.findByStationId(stationId, {}, db);
      expect(results).toHaveLength(0);
    });
  });
});
