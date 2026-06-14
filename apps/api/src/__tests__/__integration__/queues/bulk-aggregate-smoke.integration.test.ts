/**
 * Smoke — bulk_aggregate real-SQL integration test (#100).
 *
 * Unlike the bulk_transform smoke tests (which mock the SQL seam), this
 * exercises the ACTUAL aggregate SQL against a real `er__*` wide table:
 *
 *  1. Seed an org + user.
 *  2. Create a real `er__<sourceId>` wide table + rows (some belonging
 *     to a different org, to prove the org-scope guard).
 *  3. Call BulkAggregateService.runAggregate and assert the computed
 *     SUM / AVG / COUNT match hand-computed values, recordsProcessed
 *     reflects only the org's rows, and whereSqlFragment scopes the set.
 *  4. Assert explainExpression rejects invalid SQL against real PG.
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  teardownOrg,
  seedUserAndOrg,
} from "../utils/application.util.js";

const { BulkAggregateService } = await import(
  "../../../services/bulk-aggregate.service.js"
);
const { ApiCode } = await import("../../../constants/api-codes.constants.js");

describe("Smoke — bulk_aggregate real SQL (#100)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let orgId: string;
  let sourceId: string;
  let table: string;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);
    const seeded = await seedUserAndOrg(
      db,
      `auth0|bulk-agg-${generateId()}`
    );
    orgId = seeded.organizationId;

    sourceId = generateId();
    table = `er__${sourceId}`;
    await connection.unsafe(
      `CREATE TABLE "${table}" (
        "entity_record_id" text PRIMARY KEY,
        "organization_id" text NOT NULL,
        "c_area" numeric,
        "c_age" numeric
      )`
    );
    // 3 rows for our org: areas 10/20/30, ages 30/40/50.
    // 1 row for a different org — must be excluded by the org guard.
    await connection.unsafe(
      `INSERT INTO "${table}" ("entity_record_id","organization_id","c_area","c_age") VALUES
        ('r1', $1, 10, 30),
        ('r2', $1, 20, 40),
        ('r3', $1, 30, 50),
        ('r4', 'other-org', 999, 999)`,
      [orgId]
    );
  });

  afterAll(async () => {
    await connection.unsafe(`DROP TABLE IF EXISTS "${table}"`);
    await teardownOrg(db);
    await connection.end();
  });

  it("computes SUM / AVG with an org-scoped COUNT(*)", async () => {
    const { result, recordsProcessed } =
      await BulkAggregateService.runAggregate({
        sourceConnectorEntityId: sourceId,
        organizationId: orgId,
        expression: "SUM(c_area) AS total, AVG(c_age) AS avg_age",
      });

    const row = result as { total: string | number; avg_age: string | number };
    expect(Number(row.total)).toBe(60); // 10+20+30, excludes other-org 999
    expect(Number(row.avg_age)).toBe(40); // mean(30,40,50)
    expect(recordsProcessed).toBe(3); // org-scoped, excludes other-org row
  });

  it("scopes the aggregate with a whereSqlFragment", async () => {
    const { result, recordsProcessed } =
      await BulkAggregateService.runAggregate({
        sourceConnectorEntityId: sourceId,
        organizationId: orgId,
        expression: "SUM(c_area) AS total",
        whereSqlFragment: "c_age > 35",
      });

    expect(Number((result as { total: string | number }).total)).toBe(50); // ages 40,50 → areas 20+30
    expect(recordsProcessed).toBe(2);
  });

  it("returns a scalar COUNT(*) aggregate", async () => {
    const { result } = await BulkAggregateService.runAggregate({
      sourceConnectorEntityId: sourceId,
      organizationId: orgId,
      expression: "COUNT(*) AS n",
    });
    expect(Number((result as { n: string | number }).n)).toBe(3);
  });

  it("rejects an invalid expression via EXPLAIN", async () => {
    await expect(
      BulkAggregateService.explainExpression({
        sourceConnectorEntityId: sourceId,
        organizationId: orgId,
        expression: "SUM(c_does_not_exist) AS total",
      })
    ).rejects.toMatchObject({
      code: ApiCode.BULK_AGGREGATE_EXPRESSION_INVALID,
    });
  });
});
