import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  seedUserAndOrg,
  teardownOrg,
} from "../utils/application.util.js";

/**
 * #1064: station delete didn't detach its tool pack rows, so every pack row
 * outlived its station. 0135 retires the live rows under a deleted station,
 * stamped with the station's own deleted / deleted_by, which is what the
 * fixed delete writes. Rows of live stations and rows already deleted are
 * left alone.
 */
describe("0135 retire-deleted-station-toolpacks (#1064)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let orgId: string;

  const migration = readFileSync(
    join(process.cwd(), "drizzle/0135_retire-deleted-station-toolpacks.sql"),
    "utf8"
  );
  const runMigration = async () => {
    for (const statement of migration.split("--> statement-breakpoint")) {
      await connection.unsafe(statement);
    }
  };

  async function station(deleted: { at: number; by: string | null } | null) {
    const id = generateId();
    await db.insert(schema.stations).values({
      id,
      organizationId: orgId,
      name: `Station ${id.slice(0, 8)}`,
      description: null,
      created: Date.now(),
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: deleted?.at ?? null,
      deletedBy: deleted?.by ?? null,
    } as never);
    return id;
  }

  async function customPack() {
    const id = generateId();
    await db.insert(schema.organizationToolpacks).values({
      id,
      organizationId: orgId,
      name: `Custom ${id.slice(0, 8)}`,
      endpoints: [],
      signingSecret: "secret",
      tools: [],
      schemaFetchedAt: Date.now(),
      created: Date.now(),
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    return id;
  }

  /** A built-in slug, or `org:<id>` for a custom pack's row. */
  async function pack(
    stationId: string,
    ref: string,
    deleted: { at: number; by: string } | null = null
  ) {
    const custom = ref.startsWith("org:");
    const id = generateId();
    await db.insert(schema.stationToolpacks).values({
      id,
      stationId,
      builtinSlug: custom ? null : ref,
      organizationToolpackId: custom ? ref.slice("org:".length) : null,
      created: Date.now(),
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: deleted?.at ?? null,
      deletedBy: deleted?.by ?? null,
    } as never);
    return async () => {
      const [row] = await db
        .select()
        .from(schema.stationToolpacks)
        .where(eq(schema.stationToolpacks.id, id));
      return { deleted: row.deleted, deletedBy: row.deletedBy };
    };
  }

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);
    ({ organizationId: orgId } = await seedUserAndOrg(
      db,
      "auth0|retire-station-toolpacks"
    ));
  });

  afterEach(async () => {
    await connection.end();
  });

  it("retires live pack rows under a deleted station with the station's stamp", async () => {
    const stationDeleted = { at: 1_700_000_000_000, by: "user-who-deleted" };
    const gone = await station(stationDeleted);
    const live = await station(null);
    const earlier = { at: 1_600_000_000_000, by: "user-who-detached" };

    const orphanA = await pack(gone, "data_query");
    const orphanB = await pack(gone, "statistics");
    const alreadyDetached = await pack(gone, "web_search", earlier);
    const liveRow = await pack(live, "data_query");
    const customOrphan = await pack(gone, `org:${await customPack()}`);

    await runMigration();
    // Idempotent: nothing is left for a second run to match.
    await runMigration();

    expect(await orphanA()).toEqual({
      deleted: stationDeleted.at,
      deletedBy: stationDeleted.by,
    });
    expect(await orphanB()).toEqual({
      deleted: stationDeleted.at,
      deletedBy: stationDeleted.by,
    });
    expect(await alreadyDetached()).toEqual({
      deleted: earlier.at,
      deletedBy: earlier.by,
    });
    expect(await liveRow()).toEqual({ deleted: null, deletedBy: null });
    // A custom pack's row is retired the same way as a built-in's.
    expect(await customOrphan()).toEqual({
      deleted: stationDeleted.at,
      deletedBy: stationDeleted.by,
    });
  });

  // deleted_by is copied as it is, so a station deleted without one passes
  // the NULL on: the row is still retired, by deleted, which is what every
  // live-row read checks.
  it("retires the rows of a station deleted with no deleted_by", async () => {
    const at = 1_700_000_000_000;
    const gone = await station({ at, by: null });
    const orphan = await pack(gone, "data_query");

    await runMigration();

    expect(await orphan()).toEqual({ deleted: at, deletedBy: null });
  });
});
