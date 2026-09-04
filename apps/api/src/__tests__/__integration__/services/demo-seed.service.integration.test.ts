/**
 * Integration tests for DemoSeedService (#509), against the postgres-test DB.
 *
 * Slice 2: the core provisioning + import pipeline for a single entity
 * (`customers`) — counts, wide-table projection, idempotency, and the
 * missing-column-definition guard.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { ApplicationService } from "../../../services/application.service.js";
import { DemoSeedService } from "../../../services/demo-seed.service.js";
import { DbService } from "../../../services/db.service.js";
import { SeedService } from "../../../services/seed.service.js";
import { COUNTS } from "../../../demo/demo-data.js";
import { SystemUtilities } from "../../../utils/system.util.js";
import { generateId, teardownOrg } from "../utils/application.util.js";

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

  async function customersEntityId(orgId: string): Promise<string> {
    const def =
      await DbService.repository.connectorDefinitions.findBySlug("sandbox");
    const instance =
      await DbService.repository.connectorInstances.findByOrgDefinitionAndName(
        orgId,
        def!.id,
        "Sandbox"
      );
    const entity = await DbService.repository.connectorEntities.findByKey(
      instance!.id,
      "customers"
    );
    return entity!.id;
  }

  it("seeds the customers entity with the fixture row count", async () => {
    const orgId = await provisionOrg();

    const result = await DemoSeedService.seed({ orgId });

    const customers = result.entities.find((e) => e.key === "customers");
    expect(customers).toBeDefined();
    expect(customers!.created).toBe(COUNTS.customers);
    expect(customers!.invalid).toBe(0);

    // Records landed in entity_records AND the wide projection ran.
    const entityId = await customersEntityId(orgId);
    expect(
      await rawCount(
        `SELECT count(*)::int AS count FROM entity_records WHERE connector_entity_id = '${entityId}' AND deleted IS NULL`
      )
    ).toBe(COUNTS.customers);
    expect(
      await rawCount(`SELECT count(*)::int AS count FROM "er__${entityId}"`)
    ).toBe(COUNTS.customers);
  });

  it("is idempotent — a second seed leaves every row unchanged", async () => {
    const orgId = await provisionOrg();
    await DemoSeedService.seed({ orgId });

    const second = await DemoSeedService.seed({ orgId });

    const customers = second.entities.find((e) => e.key === "customers")!;
    expect(customers.created).toBe(0);
    expect(customers.updated).toBe(0);
    expect(customers.unchanged).toBe(COUNTS.customers);
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

    await expect(DemoSeedService.seed({ orgId })).rejects.toThrow(/address/);
  });
});
