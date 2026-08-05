/**
 * Integration tests for the PostGIS substrate (#316, slice 1).
 *
 * These assert the extension the rest of the GIS epic stands on:
 *   - `postgis_version()` resolves, so the extension is installed on the
 *     base image the test container runs.
 *   - `ST_SetSRID` / `ST_SRID` round-trip a spatial reference id, so the
 *     `ST_*` surface is callable through a normal connection.
 *   - the `enable-postgis` migration is idempotent — re-running
 *     `CREATE EXTENSION IF NOT EXISTS` is a no-op, not an error.
 *
 * The extension itself is enabled by migration `0075_enable-postgis` and by
 * swapping the compose base image to `postgis/postgis`. Without both, every
 * assertion here throws (`function postgis_version() does not exist`), which
 * is the intended red state before slice 1 lands.
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

describe("PostGIS substrate", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;

  beforeAll(() => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection);
  });

  afterAll(async () => {
    await connection.end();
  });

  it("has the postgis extension installed", async () => {
    const rows = (await db.execute(
      sql`SELECT postgis_version() AS version`
    )) as unknown as Array<{ version: string }>;
    expect(rows).toHaveLength(1);
    // e.g. "3.5 USE_GEOS=1 USE_PROJ=1 USE_STATS=1"
    expect(rows[0].version).toMatch(/^\d+\.\d+/);
  });

  it("exposes the ST_* surface and round-trips an SRID", async () => {
    const rows = (await db.execute(
      sql`SELECT ST_SRID(ST_SetSRID(ST_MakePoint(0, 0), 4326)) AS srid`
    )) as unknown as Array<{ srid: number }>;
    expect(Number(rows[0].srid)).toBe(4326);
  });

  it("populates spatial_ref_sys so reprojection is available", async () => {
    // The extension ships ~8500 SRID definitions in public.spatial_ref_sys.
    // If the integration setup's TRUNCATE loop wiped this table (it lives in
    // `public`), ST_Transform would silently lose its projection catalog.
    const rows = (await db.execute(
      sql`SELECT count(*)::int AS n FROM spatial_ref_sys WHERE srid = 4326`
    )) as unknown as Array<{ n: number }>;
    expect(rows[0].n).toBe(1);
  });

  it("has an idempotent enable-postgis migration", async () => {
    // Re-running the extension creation is a no-op: the migration uses
    // `CREATE EXTENSION IF NOT EXISTS`, so a second application never errors.
    await expect(
      db.execute(sql`CREATE EXTENSION IF NOT EXISTS postgis`)
    ).resolves.toBeDefined();
  });
});
