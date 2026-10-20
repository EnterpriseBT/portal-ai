import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { SeedService } from "../../../services/seed.service.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../utils/application.util.js";

/**
 * #832: members read the platform-seeded column-definition catalog. New orgs
 * get `read column_definition created_by_system` from the MemberAccess seed;
 * existing orgs get it from the 0129 backfill.
 */
describe("member column-definition read seed + 0129 backfill (#832)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let orgId: string;

  const statement = () =>
    (db as ReturnType<typeof drizzle>)
      .select()
      .from(schema.permissionStatements)
      .where(
        and(
          eq(schema.permissionStatements.organizationId, orgId),
          eq(
            schema.permissionStatements.policyId,
            `syspol:${orgId}:MemberAccess`
          ),
          eq(schema.permissionStatements.verb, "read"),
          eq(schema.permissionStatements.resourceType, "column_definition")
        )
      );

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db as ReturnType<typeof drizzle>);
    const owner = createUser(`auth0|${generateId()}`);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.users)
      .values(owner as never);
    const org = createOrganization(owner.id);
    orgId = org.id;
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.organizations)
      .values(org as never);
    await new SeedService().seedRbacSystemPolicies(orgId, db);
  });

  afterEach(async () => {
    await connection.end();
  });

  it("a freshly seeded org's MemberAccess reads system column definitions", async () => {
    const rows = await statement();
    expect(rows.map((r) => [r.id, r.condition, r.effect])).toEqual([
      [
        `sysstmt:${orgId}:MemberAccess:allow:read:column_definition:created_by_system`,
        "created_by_system",
        "allow",
      ],
    ]);
  });

  it("the 0129 backfill re-inserts it for a pre-existing org (idempotent)", async () => {
    await (db as ReturnType<typeof drizzle>)
      .delete(schema.permissionStatements)
      .where(
        eq(
          schema.permissionStatements.id,
          `sysstmt:${orgId}:MemberAccess:allow:read:column_definition:created_by_system`
        )
      );
    expect(await statement()).toHaveLength(0);

    const sql = readFileSync(
      join(
        process.cwd(),
        "drizzle/0129_backfill-member-column-definition-read.sql"
      ),
      "utf8"
    );
    await connection.unsafe(sql);
    expect(await statement()).toHaveLength(1);

    await connection.unsafe(sql);
    expect(await statement()).toHaveLength(1);
  });
});
