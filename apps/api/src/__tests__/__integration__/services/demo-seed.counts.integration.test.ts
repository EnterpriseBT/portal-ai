/**
 * Integration tests for DemoSeedService (#509), against the postgres-test DB:
 * seeding: every entity at its count on the passed station (#1035), the wide
 * tables, idempotency, the bounded `--rows` stream, and the missing-column guard.
 *
 * One of two files split by concern from the original suite (#857; the reset
 * suite went with `demo reset` in #1035), so the
 * sharded CI run can place them independently. Each test still wipes the DB
 * and seeds a full demo org, so a single file stays the heaviest unit.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";

import { DemoSeedService } from "../../../services/demo-seed.service.js";
import { DbService } from "../../../services/db.service.js";
import { COUNTS } from "../../../demo/demo-data.js";
import { SystemUtilities } from "../../../utils/system.util.js";
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

  const {
    provisionOrgWithStation,
    linkedInstanceIds,
    rawCount,
    entityIdByKey,
  } = demoSeedHelpers(() => db);

  it("creates the File Upload + REST instances and seeds every entity at its count", async () => {
    const { orgId, stationId } = await provisionOrgWithStation();

    const result = await DemoSeedService.seed({ orgId, stationId, rows: 0 });

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

    // Every created instance is linked to the station the caller passed
    // (#1035) — and none to the provisioned Administrate / Playground, which
    // the seed must leave as a normal new org has them.
    expect(result.stationId).toBe(stationId);
    const linkedIds = await linkedInstanceIds(stationId);
    const provisioned = (
      await DbService.repository.stations.findByOrganizationId(orgId)
    ).filter((s) => s.id !== stationId);
    expect(provisioned.map((s) => s.name).sort()).toEqual([
      "Administrate",
      "Playground",
    ]);
    const seededInstanceIds = new Set<string>();
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
      seededInstanceIds.add(inst!.id);
    }
    for (const station of provisioned) {
      const theirs = await linkedInstanceIds(station.id);
      for (const id of seededInstanceIds) expect(theirs.has(id)).toBe(false);
    }
  });

  it("lands XLSX (orders) and JSON (inventory) rows in the wide tables", async () => {
    const { orgId, stationId } = await provisionOrgWithStation();
    await DemoSeedService.seed({ orgId, stationId, rows: 0 });

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
    const { orgId, stationId } = await provisionOrgWithStation();
    await DemoSeedService.seed({ orgId, stationId, rows: 0 });

    const second = await DemoSeedService.seed({ orgId, stationId, rows: 0 });

    expect(second.instances.every((i) => i.action === "existing")).toBe(true);
    for (const [key, count] of Object.entries(EXPECTED)) {
      const entity = second.entities.find((e) => e.key === key)!;
      expect(entity.created).toBe(0);
      expect(entity.updated).toBe(0);
      expect(entity.unchanged).toBe(count);
    }
  });

  it("streams a bounded transactions table (--rows) deterministically", async () => {
    const { orgId, stationId } = await provisionOrgWithStation();

    const first = await DemoSeedService.seed({ orgId, stationId, rows: 2000 });
    expect(first.rows).toBe(2000);
    const txns = first.entities.find((e) => e.key === "transactions")!;
    expect(txns.created).toBe(2000);

    const txnId = await entityIdByKey(orgId, "transactions");
    expect(
      await rawCount(`SELECT count(*)::int AS count FROM "er__${txnId}"`)
    ).toBe(2000);

    // Deterministic: a second seed with the same count changes nothing.
    const second = await DemoSeedService.seed({ orgId, stationId, rows: 2000 });
    const txns2 = second.entities.find((e) => e.key === "transactions")!;
    expect(txns2.created).toBe(0);
    expect(txns2.unchanged).toBe(2000);
  }, 90000);

  it("attaches one unrestricted view per demo entity to the demo station, so its data is queryable there (#1035 smoke)", async () => {
    // Since #674 a station reaches entity data only through attached curated
    // views; connector links alone leave a portal with nothing to query.
    const { orgId, stationId } = await provisionOrgWithStation();

    const result = await DemoSeedService.seed({ orgId, stationId, rows: 50 });

    const expectedKeys = [...Object.keys(EXPECTED), "transactions"].sort();
    expect(result.views).toBe(expectedKeys.length);
    const views =
      await DbService.repository.curatedViews.findByOrganizationId(orgId);
    expect(views.map((v) => v.key).sort()).toEqual(expectedKeys);
    for (const view of views) {
      // Unrestricted: every column, every row.
      expect(view.filter).toBeNull();
      expect(view.filterSql).toBeNull();
      const entity = result.entities.find((e) => e.key === view.key)!;
      expect(view.connectorEntityId).toBe(entity.connectorEntityId);
    }
    const attached = (
      await DbService.repository.stationViews.findByStationId(stationId)
    ).map((sv) => sv.curatedViewId);
    expect(attached.sort()).toEqual(views.map((v) => v.id).sort());

    // The provisioned stations stay as a normal new org has them.
    const others = (
      await DbService.repository.stations.findByOrganizationId(orgId)
    ).filter((s) => s.id !== stationId);
    for (const station of others) {
      expect(
        await DbService.repository.stationViews.findByStationId(station.id)
      ).toHaveLength(0);
    }

    // A re-seed converges: no duplicate views or attachments.
    const again = await DemoSeedService.seed({ orgId, stationId, rows: 50 });
    expect(again.views).toBe(expectedKeys.length);
    expect(
      await DbService.repository.curatedViews.findByOrganizationId(orgId)
    ).toHaveLength(expectedKeys.length);
    expect(
      await DbService.repository.stationViews.findByStationId(stationId)
    ).toHaveLength(expectedKeys.length);
  }, 90000);

  it("throws when a required system column definition is missing", async () => {
    const { orgId, stationId } = await provisionOrgWithStation();
    const address = await DbService.repository.columnDefinitions.findByKey(
      orgId,
      "address"
    );
    await DbService.repository.columnDefinitions.softDelete(
      address!.id,
      SystemUtilities.id.system
    );

    await expect(
      DemoSeedService.seed({ orgId, stationId, rows: 0 })
    ).rejects.toThrow(/address/);
  });
});
