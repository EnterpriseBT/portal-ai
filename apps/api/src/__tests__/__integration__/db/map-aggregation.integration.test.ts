/**
 * Integration tests for the low-zoom grid-aggregation tile SQL (#330).
 *
 * Seeds a small geometry fixture in two well-separated clusters and runs the
 * real `buildAggregateTileSql` / `buildRawTileSql` output against it, asserting:
 * the aggregate path bins features into cells (one bin per cluster), the raw
 * path returns every feature, and the per-cell `mode()`/`count(*)` math is
 * correct. Verifies the SQL the tile renderer builds, not a re-derivation.
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

import { PortalMapTileService } from "../../../services/portal-map-tile.service.js";
import type { TileAggregation } from "../../../services/portal-map-tile.service.js";

const TABLE = "agg_it_test";
// Tile covering the fixture (SLC-ish) at a low zoom, below the default z<12.
const Z = 8;
const X = 48;
const Y = 96;
const ENVELOPE = `ST_TileEnvelope(${Z}, ${X}, ${Y})`;
// Must mirror buildAggregateTileSql's cell-size math for the direct check.
const WORLD = 40075016.685578488;
const CELLS_PER_AXIS = Math.round(512 / 24); // 21
const CELL_SIZE = WORLD / 2 ** Z / CELLS_PER_AXIS;

const catAgg: TileAggregation = {
  enabled: true,
  zoomThreshold: 12,
  gridSizePx: 24,
  colorByColumn: "cat",
};
const densityAgg: TileAggregation = { ...catAgg, colorByColumn: null };

describe("Low-zoom grid aggregation tile SQL (#330)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection);
    await db.execute(sql.raw(`DROP TABLE IF EXISTS "${TABLE}"`));
    await db.execute(
      sql.raw(
        `CREATE TABLE "${TABLE}" (geom geometry(Geometry,4326), cat text)`
      )
    );
    // Cluster A ≈ (-111.90, 40.760): 3× alpha + 1× beta → mode alpha, count 4.
    // Cluster B ≈ (-111.70, 40.760): 2× gamma → mode gamma, count 2.
    // The clusters are ~17 km apart (> one ~7.5 km cell at z8) so they bin
    // separately; jitter within a cluster is ~85 m so each stays in one cell.
    const pts: Array<[number, number, string]> = [
      [-111.9, 40.76, "alpha"],
      [-111.901, 40.7605, "alpha"],
      [-111.899, 40.7595, "alpha"],
      [-111.9, 40.7602, "beta"],
      [-111.7, 40.76, "gamma"],
      [-111.701, 40.7605, "gamma"],
    ];
    for (const [lng, lat, cat] of pts) {
      await db.execute(
        sql.raw(
          `INSERT INTO "${TABLE}" (geom, cat) VALUES (ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), '${cat}')`
        )
      );
    }
  });

  afterAll(async () => {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS "${TABLE}"`));
    await connection.end();
  });

  const pipeline = `SELECT geom, cat FROM "${TABLE}"`;

  it("bins into one cell per cluster (aggregate path)", async () => {
    const q = PortalMapTileService.buildAggregateTileSql(
      pipeline,
      Z,
      ENVELOPE,
      catAgg,
      10_000
    );
    const rows = (await db.execute(sql.raw(q))) as unknown as Array<{
      mvt: Buffer | null;
      n: number;
      n_limited: number;
    }>;
    expect(Number(rows[0].n)).toBe(2); // two cells
    expect(rows[0].mvt).toBeTruthy(); // MVT bytes emitted
    expect(Number(rows[0].n_limited)).toBe(0); // aggregate never truncates
  });

  it("computes per-cell mode() + count() correctly", async () => {
    const rows = (await db.execute(
      sql.raw(
        `SELECT mode() WITHIN GROUP (ORDER BY src.cat) AS m, count(*)::int AS c ` +
          `FROM (${pipeline}) src ` +
          `WHERE src.geom && ST_Transform(ST_Expand(${ENVELOPE}, ${CELL_SIZE}), 4326) ` +
          `GROUP BY ST_SnapToGrid(ST_Centroid(ST_Transform(src.geom, 3857)), ${CELL_SIZE}) ` +
          `ORDER BY c DESC`
      )
    )) as unknown as Array<{ m: string; c: number }>;
    expect(rows.map((r) => [r.m, Number(r.c)])).toEqual([
      ["alpha", 4],
      ["gamma", 2],
    ]);
  });

  it("raw path returns every feature (no binning)", async () => {
    const q = PortalMapTileService.buildRawTileSql(
      pipeline,
      ENVELOPE,
      ["cat"],
      0,
      10_000
    );
    const rows = (await db.execute(sql.raw(q))) as unknown as Array<{
      n: number;
    }>;
    expect(Number(rows[0].n)).toBe(6); // all six points
  });

  it("density mode (no colorBy) still bins, carrying no category", async () => {
    const q = PortalMapTileService.buildAggregateTileSql(
      pipeline,
      Z,
      ENVELOPE,
      densityAgg,
      10_000
    );
    expect(q).not.toContain('"cat"'); // no category property emitted
    expect(q).toContain("_count");
    const rows = (await db.execute(sql.raw(q))) as unknown as Array<{
      mvt: Buffer | null;
      n: number;
    }>;
    expect(Number(rows[0].n)).toBe(2);
    expect(rows[0].mvt).toBeTruthy();
  });
});
