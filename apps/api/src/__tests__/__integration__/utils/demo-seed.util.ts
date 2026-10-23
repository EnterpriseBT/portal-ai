/**
 * Shared setup for the DemoSeedService integration suites (#509), split by
 * concern into three files (#857): counts, toolpacks, reset.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { ApplicationService } from "../../../services/application.service.js";
import { SeedService } from "../../../services/seed.service.js";
import { COUNTS } from "../../../demo/demo-data.js";
import { generateId, teardownOrg } from "./application.util.js";

export type DemoSeedConnection = ReturnType<typeof postgres>;

/** Expected imported row count per entity key. */
export const EXPECTED: Record<string, number> = {
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

/**
 * Each test's starting state: a fresh connection, every org torn down, and
 * the connector definitions seeded. The caller ends `connection` afterEach.
 */
export async function openDemoSeedDb(): Promise<{
  connection: DemoSeedConnection;
  db: DbClient;
}> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL not set - setup.ts should have set this");
  }
  const connection = postgres(process.env.DATABASE_URL, { max: 1 });
  const db = drizzle(connection, { schema });
  await teardownOrg(db as ReturnType<typeof drizzle>);
  await new SeedService().seedConnectorDefinitions(db);
  return { connection, db };
}

/** Helpers over the current test's `db`, read through `getDb` so they always
 *  see the connection the latest `beforeEach` opened. */
export function demoSeedHelpers(getDb: () => DbClient) {
  async function provisionOrg(): Promise<string> {
    const { organizationId } = await ApplicationService.seedOrganization({
      name: `Demo Seed ${generateId()}`,
    });
    return organizationId;
  }

  async function rawCount(query: string): Promise<number> {
    const rows = (await getDb().execute(sql.raw(query))) as unknown as Array<{
      count: number;
    }>;
    return rows[0].count;
  }

  async function entityIdByKey(orgId: string, key: string): Promise<string> {
    const rows = (await getDb().execute(
      sql.raw(
        `SELECT id FROM connector_entities WHERE organization_id = '${orgId}' AND key = '${key}' AND deleted IS NULL LIMIT 1`
      )
    )) as unknown as Array<{ id: string }>;
    return rows[0].id;
  }

  return { provisionOrg, rawCount, entityIdByKey };
}
