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
 * #630 (slice 3 amendment): a member may delete the data objects they create.
 * The `delete created_by_caller` statements on the non-shareable data types must
 * reach existing orgs via the 0111 backfill (station/pin already came from 0106).
 */
describe("member data-type delete seed + 0111 backfill (#630)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let orgId: string;

  // The six data types 0111 adds delete for (station/pin excluded — from 0106).
  // `curated_view` is the renamed `view` type (#630, 0112); 0111 inserts the raw
  // `view` value which 0112 then renames, so the backfill test runs both.
  const NEW_DELETE_TYPES = [
    "curated_view",
    "portal",
    "entity",
    "entity_record",
    "field_mapping",
    "connector_instance",
  ] as const;

  const memberDeletes = () =>
    (db as ReturnType<typeof drizzle>)
      .select({ resourceType: schema.permissionStatements.resourceType })
      .from(schema.permissionStatements)
      .where(
        and(
          eq(schema.permissionStatements.organizationId, orgId),
          eq(
            schema.permissionStatements.policyId,
            `syspol:${orgId}:MemberAccess`
          ),
          eq(schema.permissionStatements.verb, "delete"),
          inArray(schema.permissionStatements.resourceType, NEW_DELETE_TYPES)
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

  it("a freshly seeded org carries member delete on every non-shareable data type", async () => {
    const rows = await memberDeletes();
    expect(rows.map((r) => r.resourceType).sort()).toEqual(
      [...NEW_DELETE_TYPES].sort()
    );
  });

  it("the 0111 backfill re-inserts them for a pre-existing org (idempotent)", async () => {
    await (db as ReturnType<typeof drizzle>)
      .delete(schema.permissionStatements)
      .where(
        and(
          eq(schema.permissionStatements.organizationId, orgId),
          eq(
            schema.permissionStatements.policyId,
            `syspol:${orgId}:MemberAccess`
          ),
          eq(schema.permissionStatements.verb, "delete"),
          inArray(schema.permissionStatements.resourceType, NEW_DELETE_TYPES)
        )
      );
    expect(await memberDeletes()).toHaveLength(0);

    const sql = readFileSync(
      join(process.cwd(), "drizzle/0111_backfill-member-data-delete.sql"),
      "utf8"
    );
    // 0111 inserts the raw `view` type; 0112 renames it to `curated_view`. Run
    // both, as the real forward migration does.
    const rename = readFileSync(
      join(
        process.cwd(),
        "drizzle/0112_rename-view-resource-to-curated-view.sql"
      ),
      "utf8"
    );
    await connection.unsafe(sql);
    await connection.unsafe(rename);
    expect(await memberDeletes()).toHaveLength(NEW_DELETE_TYPES.length);

    // Idempotent + does not touch station/pin (those come from 0106).
    await connection.unsafe(sql);
    await connection.unsafe(rename);
    expect(await memberDeletes()).toHaveLength(NEW_DELETE_TYPES.length);
  });
});
