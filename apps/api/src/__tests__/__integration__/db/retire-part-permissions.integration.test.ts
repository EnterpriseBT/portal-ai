import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

import { generateId, teardownOrg } from "../utils/application.util.js";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../../../db/schema/index.js";
import {
  seedPopulatedOrg,
  type PopulatedOrg,
} from "../utils/seed-populated-org.util.js";

/**
 * #829: 0128 retires `entity_record` and `field_mapping` as permission types.
 * Records and field mappings are parts of their entity, so every statement
 * and grant on them (seeded, custom, and every curated-view share's composed
 * `in_curated_view` field grant) is deleted. Everything else stays.
 *
 * The rows are inserted with raw SQL: the app's types no longer admit these
 * values, which is the point.
 */
describe("0128 retire-part-permissions (#829)", () => {
  let connection!: ReturnType<typeof postgres>;
  let org!: PopulatedOrg;
  let policyId!: string;

  const migration = readFileSync(
    join(process.cwd(), "drizzle/0128_retire-part-permissions.sql"),
    "utf8"
  );
  const runMigration = async () => {
    for (const statement of migration.split("--> statement-breakpoint")) {
      await connection.unsafe(statement);
    }
  };

  const insertStatement = (resourceType: string, effect = "allow") =>
    connection`
      INSERT INTO permission_statements
        (id, organization_id, policy_id, effect, verb, resource_type,
         resource_id, condition, condition_param, created, created_by)
      VALUES (${generateId()}, ${org.orgId}, ${policyId}, ${effect}, 'read',
              ${resourceType}, NULL, NULL, NULL, ${Date.now()}, 'RETIRE_PARTS_TEST')`;
  const insertGrant = (
    resourceType: string,
    condition: string | null = null,
    conditionParam: string | null = null
  ) =>
    connection`
      INSERT INTO permission_grants
        (id, organization_id, principal_type, principal_id, effect, verb,
         resource_type, resource_id, condition, condition_param, created,
         created_by)
      VALUES (${generateId()}, ${org.orgId}, 'user', ${org.memberUserId},
              'allow', 'read', ${resourceType}, NULL, ${condition},
              ${conditionParam}, ${Date.now()}, 'RETIRE_PARTS_TEST')`;
  const typesIn = async (
    table: "permission_statements" | "permission_grants"
  ) =>
    (
      await connection.unsafe(
        `SELECT resource_type, condition FROM ${table} WHERE organization_id = $1 AND created_by = 'RETIRE_PARTS_TEST' ORDER BY resource_type`,
        [org.orgId]
      )
    ).map((r) => `${r.resource_type}${r.condition ? `:${r.condition}` : ""}`);

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    const db = drizzle(connection, { schema });
    await teardownOrg(db);
    org = await seedPopulatedOrg(db, "retire-parts");
    policyId = generateId();
    await connection`
      INSERT INTO permission_policies
        (id, organization_id, name, kind, description, created, created_by)
      VALUES (${policyId}, ${org.orgId}, 'Custom', 'custom', NULL,
              ${Date.now()}, 'RETIRE_PARTS_TEST')`;
    await insertStatement("entity_record");
    await insertStatement("field_mapping", "deny");
    await insertStatement("entity");
    await insertGrant("entity_record");
    await insertGrant("field_mapping", "in_curated_view", org.curatedViewId);
    await insertGrant("curated_view");
  });

  afterEach(async () => {
    await connection.end();
  });

  it("deletes every statement and grant on records and field mappings, and nothing else", async () => {
    await runMigration();
    expect(await typesIn("permission_statements")).toEqual(["entity"]);
    expect(await typesIn("permission_grants")).toEqual(["curated_view"]);
  });

  it("is a no-op the second time", async () => {
    await runMigration();
    await runMigration();
    expect(await typesIn("permission_statements")).toEqual(["entity"]);
    expect(await typesIn("permission_grants")).toEqual(["curated_view"]);
  });
});
