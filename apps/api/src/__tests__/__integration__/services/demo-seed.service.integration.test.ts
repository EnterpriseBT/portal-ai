/**
 * Integration tests for DemoSeedService (#509), against the postgres-test DB.
 *
 * Slices 2–3: the provisioning + import pipeline for every base entity across
 * the File Upload (CSV + XLSX) and REST instances — counts, wide-table
 * projection, instance creation, idempotency, and the missing-column guard.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";

import { BUILTIN_TOOLPACKS } from "@portalai/core/registries";
import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { ApplicationService } from "../../../services/application.service.js";
import { DemoSeedService } from "../../../services/demo-seed.service.js";
import { DbService } from "../../../services/db.service.js";
import { SeedService } from "../../../services/seed.service.js";
import { ToolpackRegistrationService } from "../../../services/toolpack-registration.service.js";
import { COUNTS } from "../../../demo/demo-data.js";
import { SystemUtilities } from "../../../utils/system.util.js";
import { generateId, teardownOrg } from "../utils/application.util.js";

/** Expected imported row count per entity key. */
const EXPECTED: Record<string, number> = {
  customers: COUNTS.customers,
  products: COUNTS.products,
  sites: COUNTS.sites,
  shipments: COUNTS.shipments,
  notes: COUNTS.notes,
  orders: COUNTS.orders,
  cash_flows: COUNTS.cashFlowMonths,
  loan_schedule: COUNTS.loanMonths,
  portfolio: COUNTS.portfolioHoldings,
  inventory: COUNTS.inventory,
};

describe("DemoSeedService (integration)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db as ReturnType<typeof drizzle>);
    await new SeedService().seedConnectorDefinitions(db);
  });

  afterEach(async () => {
    await connection.end();
  });

  async function provisionOrg(): Promise<string> {
    const { organizationId } = await ApplicationService.seedOrganization({
      name: `Demo Seed ${generateId()}`,
    });
    return organizationId;
  }

  async function rawCount(query: string): Promise<number> {
    const rows = (await db.execute(sql.raw(query))) as unknown as Array<{
      count: number;
    }>;
    return rows[0].count;
  }

  async function entityIdByKey(orgId: string, key: string): Promise<string> {
    const rows = (await db.execute(
      sql.raw(
        `SELECT id FROM connector_entities WHERE organization_id = '${orgId}' AND key = '${key}' AND deleted IS NULL LIMIT 1`
      )
    )) as unknown as Array<{ id: string }>;
    return rows[0].id;
  }

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

    const first = await DemoSeedService.seed({ orgId, rows: 5000 });
    expect(first.rows).toBe(5000);
    const txns = first.entities.find((e) => e.key === "transactions")!;
    expect(txns.created).toBe(5000);

    const txnId = await entityIdByKey(orgId, "transactions");
    expect(
      await rawCount(`SELECT count(*)::int AS count FROM "er__${txnId}"`)
    ).toBe(5000);

    // Deterministic: a second seed with the same count changes nothing.
    const second = await DemoSeedService.seed({ orgId, rows: 5000 });
    const txns2 = second.entities.find((e) => e.key === "transactions")!;
    expect(txns2.created).toBe(0);
    expect(txns2.unchanged).toBe(5000);
  }, 30000);

  it("enables all built-in toolpacks; skips custom when no URL is set", async () => {
    delete process.env.DEMO_TOOLPACK_URL;
    const orgId = await provisionOrg();

    const result = await DemoSeedService.seed({ orgId, rows: 0 });

    expect(result.toolpacks.builtins.sort()).toEqual(
      BUILTIN_TOOLPACKS.map((p) => p.slug).sort()
    );
    expect(result.toolpacks.builtins).toHaveLength(BUILTIN_TOOLPACKS.length);
    expect(result.toolpacks.custom).toBeNull();
    expect(
      await rawCount(
        `SELECT count(*)::int AS count FROM organization_toolpacks WHERE organization_id = '${orgId}' AND deleted IS NULL`
      )
    ).toBe(0);
  });

  it("registers the custom toolpack when DEMO_TOOLPACK_URL is set", async () => {
    const orgId = await provisionOrg();
    process.env.DEMO_TOOLPACK_URL = "https://demo-toolpack.test";
    const schemaSpy = jest
      .spyOn(ToolpackRegistrationService, "fetchSchema")
      .mockResolvedValue([
        {
          name: "quote_shipping_rate",
          description: "Quote a shipping rate.",
          parameterSchema: { type: "object", properties: {} },
        },
      ] as never);
    const metadataSpy = jest
      .spyOn(ToolpackRegistrationService, "fetchMetadata")
      .mockResolvedValue(null as never);

    try {
      const result = await DemoSeedService.seed({ orgId, rows: 0 });
      expect(result.toolpacks.custom).toBeTruthy();
      expect(schemaSpy).toHaveBeenCalledWith(
        "https://demo-toolpack.test/schema",
        undefined,
        expect.any(String)
      );
      expect(
        await rawCount(
          `SELECT count(*)::int AS count FROM organization_toolpacks WHERE organization_id = '${orgId}' AND deleted IS NULL`
        )
      ).toBe(1);
    } finally {
      schemaSpy.mockRestore();
      metadataSpy.mockRestore();
      delete process.env.DEMO_TOOLPACK_URL;
    }
  });

  it("throws when a required system column definition is missing", async () => {
    const orgId = await provisionOrg();
    const address = await DbService.repository.columnDefinitions.findByKey(
      orgId,
      "address"
    );
    await DbService.repository.columnDefinitions.softDelete(
      address!.id,
      SystemUtilities.id.system
    );

    await expect(DemoSeedService.seed({ orgId, rows: 0 })).rejects.toThrow(
      /address/
    );
  });
});
