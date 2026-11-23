/**
 * #1071: migration 0140 attaches the Tags pack to every live org's
 * Administrate station. Administrate is the system-created station carrying
 * both rbac_management and member_management, so a rename doesn't hide it.
 *
 * The global setup has already applied 0140 (an empty test DB has nothing to
 * attach), so each case seeds stations and re-runs the migration's SQL in a
 * transaction with the setting set, the way db-migrate runs it.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../../../db/schema/index.js";
import {
  createOrganization,
  createUser,
  generateId,
  teardownOrg,
} from "../utils/application.util.js";

const PRINCIPAL = process.env.SYSTEM_ID!;

const MIGRATION = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../drizzle/0140_attach-tags-pack-to-administrate.sql"
  ),
  "utf8"
);
const STATEMENTS = MIGRATION.split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

describe("0140 attach-tags-pack-to-administrate (#1071)", () => {
  let connection!: ReturnType<typeof postgres>;
  let d!: ReturnType<typeof drizzle>;
  let ownerId!: string;

  async function runMigration() {
    await connection.begin(async (tx) => {
      await tx`SELECT set_config('portalai.system_id', ${PRINCIPAL}, true)`;
      for (const stmt of STATEMENTS) await tx.unsafe(stmt);
    });
  }

  async function seedOrg(opts: { deleted?: boolean } = {}): Promise<string> {
    const org = createOrganization(ownerId, {
      ...(opts.deleted ? { deleted: Date.now(), deletedBy: ownerId } : {}),
    });
    await d.insert(schema.organizations).values(org as never);
    return org.id as string;
  }

  /** A station in `orgId` created by `createdBy`, carrying `slugs`. */
  async function seedStation(
    orgId: string,
    name: string,
    createdBy: string,
    slugs: string[]
  ): Promise<string> {
    const id = generateId();
    const base = {
      created: Date.now(),
      createdBy,
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    };
    await d.insert(schema.stations).values({
      id,
      organizationId: orgId,
      name,
      description: null,
      ...base,
    } as never);
    for (const builtinSlug of slugs) {
      await d.insert(schema.stationToolpacks).values({
        id: generateId(),
        stationId: id,
        builtinSlug,
        organizationToolpackId: null,
        ...base,
      } as never);
    }
    return id;
  }

  /** The live built-in slugs on a station. */
  async function slugsOn(stationId: string): Promise<string[]> {
    const rows = await connection`
      SELECT builtin_slug FROM station_toolpacks
      WHERE station_id = ${stationId} AND deleted IS NULL
      ORDER BY builtin_slug`;
    return rows.map((r) => r.builtin_slug as string);
  }

  const ADMINISTRATE = ["rbac_management", "member_management", "help"];
  const PLAYGROUND = ["data_query", "entity_management", "view_management"];

  beforeEach(async () => {
    connection = postgres(process.env.DATABASE_URL!, { max: 1 });
    d = drizzle(connection, { schema });
    await teardownOrg(d);
    const owner = createUser(`auth0|m0140-${generateId()}`);
    await d.insert(schema.users).values(owner as never);
    ownerId = owner.id as string;
  });

  afterEach(async () => {
    await teardownOrg(d);
    await connection.end();
  });

  it("attaches the pack to Administrate, renamed or not, as the system principal", async () => {
    const orgId = await seedOrg();
    const admin = await seedStation(orgId, "Admin HQ", PRINCIPAL, ADMINISTRATE);

    await runMigration();

    expect(await slugsOn(admin)).toEqual(
      [...ADMINISTRATE, "tag_management"].sort()
    );
    const [row] = await connection`
      SELECT created_by FROM station_toolpacks
      WHERE station_id = ${admin} AND builtin_slug = 'tag_management'`;
    expect(row.created_by).toBe(PRINCIPAL);
  });

  it("leaves Playground and a user-built look-alike alone", async () => {
    const orgId = await seedOrg();
    const playground = await seedStation(
      orgId,
      "Playground",
      PRINCIPAL,
      PLAYGROUND
    );
    const lookalike = await seedStation(
      orgId,
      "Administrate",
      ownerId,
      ADMINISTRATE
    );

    await runMigration();

    expect(await slugsOn(playground)).toEqual([...PLAYGROUND].sort());
    expect(await slugsOn(lookalike)).toEqual([...ADMINISTRATE].sort());
  });

  it("is a no-op where the pack is already attached, and on a second run", async () => {
    const orgId = await seedOrg();
    const already = await seedStation(orgId, "Administrate", PRINCIPAL, [
      ...ADMINISTRATE,
      "tag_management",
    ]);
    const fresh = await seedStation(
      (await seedOrg()) as string,
      "Administrate",
      PRINCIPAL,
      ADMINISTRATE
    );

    await runMigration();
    await runMigration();

    for (const station of [already, fresh]) {
      expect(await slugsOn(station)).toEqual(
        [...ADMINISTRATE, "tag_management"].sort()
      );
    }
  });

  it("skips a soft-deleted org and a soft-deleted station", async () => {
    const deletedOrg = await seedOrg({ deleted: true });
    const inDeletedOrg = await seedStation(
      deletedOrg,
      "Administrate",
      PRINCIPAL,
      ADMINISTRATE
    );
    const orgId = await seedOrg();
    const deletedStation = await seedStation(
      orgId,
      "Administrate",
      PRINCIPAL,
      ADMINISTRATE
    );
    await connection`
      UPDATE stations SET deleted = ${Date.now()}, deleted_by = ${ownerId}
      WHERE id = ${deletedStation}`;

    await runMigration();

    expect(await slugsOn(inDeletedOrg)).toEqual([...ADMINISTRATE].sort());
    expect(await slugsOn(deletedStation)).toEqual([...ADMINISTRATE].sort());
  });
});
