/**
 * Integration test for the #599 slice-1 cutover backfill (migration
 * `0113_curated-views-and-station-views`).
 *
 * The migration runs against empty tables during test setup (no-op), so
 * this test seeds a station → connector-instance → entity chain, then
 * executes the migration's OWN backfill statements (read from the `.sql`
 * so the test can never drift from the shipped SQL) and asserts:
 *   - one default (unrestricted) curated view per attached entity,
 *   - one station_views attachment per (station, entity),
 *   - the views carry a null where_clause and NO projection rows,
 *   - NO permission grants are created (default-deny),
 *   - `station_instances` is untouched (additive cutover),
 *   - re-running is idempotent.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, isNull, sql } from "drizzle-orm";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../utils/application.util.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = join(
  __dirname,
  "../../../../drizzle/0113_curated-views-and-station-views.sql"
);

/** Pull the two `-- backfill:` INSERT statements out of the shipped migration. */
function backfillStatements(): string[] {
  const raw = readFileSync(MIGRATION_PATH, "utf8");
  return raw
    .split("--> statement-breakpoint")
    .map((s) =>
      s
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter(
      (s) =>
        /^INSERT INTO "curated_views"/.test(s) ||
        /^INSERT INTO "station_views"/.test(s)
    );
}

function base(userId: string) {
  return {
    id: generateId(),
    created: Date.now(),
    createdBy: userId,
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

describe("#599 slice 1 — default-view cutover backfill (0113)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let userId: string;
  let orgId: string;
  let stationId: string;
  let entityIds: string[];

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 2 });
    db = drizzle(connection, { schema });
    const client = db as ReturnType<typeof drizzle>;
    await teardownOrg(client);

    const user = createUser(`auth0|${generateId()}`);
    await client.insert(schema.users).values(user as never);
    userId = user.id;
    const org = createOrganization(userId);
    await client.insert(schema.organizations).values(org as never);
    orgId = org.id;

    const def = {
      ...base(userId),
      slug: `test-conn-${generateId()}`,
      display: "Test Connector",
      category: "crm",
      authType: "none",
      configSchema: {},
      capabilityFlags: {},
      isActive: true,
      version: "1.0.0",
      iconUrl: null,
    };
    await client.insert(schema.connectorDefinitions).values(def as never);

    const instance = {
      ...base(userId),
      connectorDefinitionId: def.id,
      organizationId: orgId,
      name: "Test Instance",
      status: "active",
      config: {},
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: {},
    };
    await client.insert(schema.connectorInstances).values(instance as never);

    const entities = ["accounts", "contacts"].map((key) => ({
      ...base(userId),
      organizationId: orgId,
      connectorInstanceId: instance.id,
      key,
      label: key.toUpperCase(),
    }));
    await client.insert(schema.connectorEntities).values(entities as never);
    entityIds = entities.map((e) => e.id);

    const station = {
      ...base(userId),
      organizationId: orgId,
      name: "S",
      description: null,
    };
    await client.insert(schema.stations).values(station as never);
    stationId = station.id;

    await client.insert(schema.stationInstances).values({
      ...base(userId),
      stationId,
      connectorInstanceId: instance.id,
    } as never);
  });

  afterEach(async () => {
    await teardownOrg(db as ReturnType<typeof drizzle>);
    await connection.end();
  });

  async function runBackfill() {
    for (const stmt of backfillStatements()) {
      await (db as ReturnType<typeof drizzle>).execute(sql.raw(stmt));
    }
  }

  async function orgViews() {
    return (db as ReturnType<typeof drizzle>)
      .select()
      .from(schema.curatedViews)
      .where(
        and(
          eq(schema.curatedViews.organizationId, orgId),
          isNull(schema.curatedViews.deleted)
        )
      );
  }

  it("extracts exactly the two backfill INSERT statements", () => {
    expect(backfillStatements()).toHaveLength(2);
  });

  it("generates one default view + attachment per attached entity", async () => {
    await runBackfill();

    const views = await orgViews();
    expect(views).toHaveLength(2);
    expect(views.map((v) => v.key).sort()).toEqual(["accounts", "contacts"]);
    for (const v of views) {
      expect(v.whereClause).toBeNull(); // unrestricted (all rows)
      expect(entityIds).toContain(v.connectorEntityId);
      expect(v.createdBy).toBe(userId); // owned by the entity's creator, not system
    }

    // No projection rows == all columns.
    const projection = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(schema.curatedViewFieldMappings)
      .where(eq(schema.curatedViewFieldMappings.organizationId, orgId));
    expect(projection).toHaveLength(0);

    // One attachment per (station, entity).
    const attachments = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(schema.stationViews)
      .where(eq(schema.stationViews.stationId, stationId));
    expect(attachments).toHaveLength(2);
    expect(attachments.map((a) => a.curatedViewId).sort()).toEqual(
      views.map((v) => v.id).sort()
    );
  });

  it("creates NO permission grants (default-deny)", async () => {
    await runBackfill();
    const grants = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(schema.permissionGrants)
      .where(eq(schema.permissionGrants.organizationId, orgId));
    expect(grants).toHaveLength(0);
  });

  it("leaves station_instances untouched", async () => {
    await runBackfill();
    const links = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(schema.stationInstances)
      .where(eq(schema.stationInstances.stationId, stationId));
    expect(links).toHaveLength(1);
  });

  it("is idempotent — re-running creates no duplicates", async () => {
    await runBackfill();
    await runBackfill();
    expect(await orgViews()).toHaveLength(2);
    const attachments = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(schema.stationViews)
      .where(eq(schema.stationViews.stationId, stationId));
    expect(attachments).toHaveLength(2);
  });
});
