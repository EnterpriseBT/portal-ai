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
 * #630: the member nav-view (`view page:{stations,pinned,jobs}`) + unconditional
 * `read job` statements must reach both new orgs (via the seed) and existing orgs
 * (via the 0110 backfill) — or wiring nav/enforcement (slices 2/4) hands existing
 * members an empty nav and an empty Jobs list.
 */
describe("nav-view + read-job seed + 0110 backfill (#630)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let orgId: string;

  // The four statements this ticket adds to MemberAccess.
  const navGrants = () =>
    (db as ReturnType<typeof drizzle>)
      .select({
        verb: schema.permissionStatements.verb,
        resourceType: schema.permissionStatements.resourceType,
        resourceId: schema.permissionStatements.resourceId,
      })
      .from(schema.permissionStatements)
      .where(
        and(
          eq(schema.permissionStatements.organizationId, orgId),
          eq(
            schema.permissionStatements.policyId,
            `syspol:${orgId}:MemberAccess`
          ),
          inArray(schema.permissionStatements.resourceType, ["page", "job"])
        )
      );

  const key = (r: {
    verb: string;
    resourceType: string;
    resourceId: string | null;
  }) => `${r.verb}:${r.resourceType}:${r.resourceId ?? "-"}`;

  const EXPECTED = [
    "read:job:-",
    "view:page:jobs",
    "view:page:pinned",
    "view:page:stations",
  ];

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

  it("a freshly seeded org carries read:job + view page:{stations,pinned,jobs}", async () => {
    const rows = await navGrants();
    expect(rows.map(key).sort()).toEqual(EXPECTED);
  });

  it("the 0110 backfill re-inserts them for a pre-existing org (idempotent)", async () => {
    // Simulate a pre-#630 org: drop the four statements the seed added.
    await (db as ReturnType<typeof drizzle>)
      .delete(schema.permissionStatements)
      .where(
        and(
          eq(schema.permissionStatements.organizationId, orgId),
          eq(
            schema.permissionStatements.policyId,
            `syspol:${orgId}:MemberAccess`
          ),
          inArray(schema.permissionStatements.resourceType, ["page", "job"])
        )
      );
    expect(await navGrants()).toHaveLength(0);

    const sql = readFileSync(
      join(process.cwd(), "drizzle/0110_backfill-nav-permission-grants.sql"),
      "utf8"
    );
    await connection.unsafe(sql);
    expect((await navGrants()).map(key).sort()).toEqual(EXPECTED);

    // Idempotent: a second run changes nothing (ids match the seed exactly).
    await connection.unsafe(sql);
    expect((await navGrants()).map(key).sort()).toEqual(EXPECTED);
  });

  it("the backfill ids are byte-identical to the seed's (no duplicate rows)", async () => {
    // Drop, backfill, and confirm the ids equal what a fresh seed produced —
    // proving a new org and a backfilled org never diverge / double-insert.
    const seeded = await (db as ReturnType<typeof drizzle>)
      .select({ id: schema.permissionStatements.id })
      .from(schema.permissionStatements)
      .where(
        and(
          eq(schema.permissionStatements.organizationId, orgId),
          inArray(schema.permissionStatements.resourceType, ["page", "job"])
        )
      );
    const seededIds = seeded.map((r) => r.id).sort();

    await (db as ReturnType<typeof drizzle>)
      .delete(schema.permissionStatements)
      .where(
        and(
          eq(schema.permissionStatements.organizationId, orgId),
          inArray(schema.permissionStatements.resourceType, ["page", "job"])
        )
      );
    const sql = readFileSync(
      join(process.cwd(), "drizzle/0110_backfill-nav-permission-grants.sql"),
      "utf8"
    );
    await connection.unsafe(sql);

    const backfilled = await (db as ReturnType<typeof drizzle>)
      .select({ id: schema.permissionStatements.id })
      .from(schema.permissionStatements)
      .where(
        and(
          eq(schema.permissionStatements.organizationId, orgId),
          inArray(schema.permissionStatements.resourceType, ["page", "job"])
        )
      );
    expect(backfilled.map((r) => r.id).sort()).toEqual(seededIds);
  });
});
