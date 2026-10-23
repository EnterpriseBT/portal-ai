/**
 * Integration tests for DemoSeedService (#509), against the postgres-test DB:
 * seeding: every entity at its count, the wide tables, idempotency, and the bounded `--rows` stream.
 *
 * One of three files split by concern from the original suite (#857), so the
 * sharded CI run can place them independently. Each test still wipes the DB
 * and seeds a full demo org, so a single file stays the heaviest unit.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";

import { DemoSeedService } from "../../../services/demo-seed.service.js";
import { DbService } from "../../../services/db.service.js";
import { COUNTS } from "../../../demo/demo-data.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import {
  EXPECTED,
  demoSeedHelpers,
  openDemoSeedDb,
  type DemoSeedConnection,
} from "../utils/demo-seed.util.js";

describe("DemoSeedService (integration): counts", () => {
  let connection!: DemoSeedConnection;
  let db!: DbClient;

  beforeEach(async () => {
    ({ connection, db } = await openDemoSeedDb());
  });

  afterEach(async () => {
    await connection.end();
  });

  const { provisionOrg, rawCount, entityIdByKey } = demoSeedHelpers(() => db);

  it("creates the File Upload + REST instances and seeds every entity at its count", async () => {
    const orgId = await provisionOrg();

    const result = await DemoSeedService.seed({ orgId, rows: 0 });

    // Instances created (Sandbox is not used until the transactions slice).
    expect(result.instances.map((i) => i.name).sort()).toEqual([
      "Demo REST API",
      "File Upload — CSV",
      "File Upload — XLSX",
    ]);
    expect(result.instances.every((i) => i.action === "created")).toBe(true);

    // Every entity imported at its expected row count.
    for (const [key, count] of Object.entries(EXPECTED)) {
      const entity = result.entities.find((e) => e.key === key);
      expect(entity).toBeDefined();
      expect(entity!.created).toBe(count);
    }
    // A no-reference entity has zero validation errors.
    expect(result.entities.find((e) => e.key === "customers")!.invalid).toBe(0);

    // Every created instance is linked to the org's station — without this the
    // portal exposes only the auto-provisioned Sandbox and entity-specific
    // prompts / the map find no data (regression guard for the station-link fix).
    const [station] =
      await DbService.repository.stations.findByOrganizationId(orgId);
    const linkedIds = new Set(
      (
        await DbService.repository.stationInstances.findByStationId(station.id)
      ).map((s) => s.connectorInstanceId)
    );
    const instanceRows =
      await DbService.repository.connectorInstances.findByOrganizationId(orgId);
    for (const name of [
      "File Upload — CSV",
      "File Upload — XLSX",
      "Demo REST API",
    ]) {
      const inst = instanceRows.find((i) => i.name === name);
      expect(inst).toBeDefined();
      expect(linkedIds.has(inst!.id)).toBe(true);
    }
  });

  it("lands XLSX (orders) and JSON (inventory) rows in the wide tables", async () => {
    const orgId = await provisionOrg();
    await DemoSeedService.seed({ orgId, rows: 0 });

    const ordersId = await entityIdByKey(orgId, "orders");
    expect(
      await rawCount(`SELECT count(*)::int AS count FROM "er__${ordersId}"`)
    ).toBe(COUNTS.orders);

    const inventoryId = await entityIdByKey(orgId, "inventory");
    expect(
      await rawCount(`SELECT count(*)::int AS count FROM "er__${inventoryId}"`)
    ).toBe(COUNTS.inventory);
  });

  it("is idempotent — a second seed leaves every entity unchanged", async () => {
    const orgId = await provisionOrg();
    await DemoSeedService.seed({ orgId, rows: 0 });

    const second = await DemoSeedService.seed({ orgId, rows: 0 });

    expect(second.instances.every((i) => i.action === "existing")).toBe(true);
    for (const [key, count] of Object.entries(EXPECTED)) {
      const entity = second.entities.find((e) => e.key === key)!;
      expect(entity.created).toBe(0);
      expect(entity.updated).toBe(0);
      expect(entity.unchanged).toBe(count);
    }
  });

  it("streams a bounded transactions table (--rows) deterministically", async () => {
    const orgId = await provisionOrg();

    const first = await DemoSeedService.seed({ orgId, rows: 2000 });
    expect(first.rows).toBe(2000);
    const txns = first.entities.find((e) => e.key === "transactions")!;
    expect(txns.created).toBe(2000);

    const txnId = await entityIdByKey(orgId, "transactions");
    expect(
      await rawCount(`SELECT count(*)::int AS count FROM "er__${txnId}"`)
    ).toBe(2000);

    // Deterministic: a second seed with the same count changes nothing.
    const second = await DemoSeedService.seed({ orgId, rows: 2000 });
    const txns2 = second.entities.find((e) => e.key === "transactions")!;
    expect(txns2.created).toBe(0);
    expect(txns2.unchanged).toBe(2000);
  }, 90000);
});
