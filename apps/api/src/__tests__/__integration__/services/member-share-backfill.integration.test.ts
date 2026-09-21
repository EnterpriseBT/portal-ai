import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, inArray } from "drizzle-orm";

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
 * #621: the member own-object `delete`/`share` statements must reach both new
 * orgs (via the seed) and existing orgs (via the 0106 backfill) — or wiring
 * enforcement (slice 3) locks existing members out of deleting/sharing their
 * own station/pin.
 */
describe("member share/delete seed + 0106 backfill (#621)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let orgId: string;

  const shareDeleteStatements = () =>
    (db as ReturnType<typeof drizzle>)
      .select({
        verb: schema.permissionStatements.verb,
        resourceType: schema.permissionStatements.resourceType,
      })
      .from(schema.permissionStatements)
      .where(
        and(
          eq(schema.permissionStatements.organizationId, orgId),
          eq(
            schema.permissionStatements.policyId,
            `syspol:${orgId}:MemberAccess`
          ),
          inArray(schema.permissionStatements.verb, ["delete", "share"]),
          inArray(schema.permissionStatements.resourceType, ["station", "pin"])
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
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.organizations)
      .values(org as never);
    orgId = org.id;
    await new SeedService().seedRbacSystemPolicies(orgId, db);
  });

  afterEach(async () => {
    await connection.end();
  });

  it("a freshly seeded org carries delete + share on station + pin", async () => {
    const rows = await shareDeleteStatements();
    expect(rows).toHaveLength(4);
    const keys = rows.map((r) => `${r.verb}:${r.resourceType}`).sort();
    expect(keys).toEqual([
      "delete:pin",
      "delete:station",
      "share:pin",
      "share:station",
    ]);
  });

  it("the 0106 backfill re-inserts them for a pre-existing org (idempotent)", async () => {
    // Simulate a pre-#621 org: drop the four statements the seed added.
    await (db as ReturnType<typeof drizzle>)
      .delete(schema.permissionStatements)
      .where(
        and(
          eq(schema.permissionStatements.organizationId, orgId),
          eq(
            schema.permissionStatements.policyId,
            `syspol:${orgId}:MemberAccess`
          ),
          inArray(schema.permissionStatements.verb, ["delete", "share"])
        )
      );
    expect(await shareDeleteStatements()).toHaveLength(0);

    const sql = readFileSync(
      join(process.cwd(), "drizzle/0106_backfill-member-share-delete.sql"),
      "utf8"
    );
    await connection.unsafe(sql);
    expect(await shareDeleteStatements()).toHaveLength(4);

    // Idempotent: a second run changes nothing.
    await connection.unsafe(sql);
    expect(await shareDeleteStatements()).toHaveLength(4);
  });
});
