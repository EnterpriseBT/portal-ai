/**
 * PostGIS foundation benchmark (#316, slice 7).
 *
 * Backs the child's central claim — that the spatial substrate belongs in the
 * database, not in Node over turf — with measured numbers rather than argument.
 * Compares, on synthetic parcel-like polygons at a given scale:
 *
 *   1. an indexed PostGIS spatial filter (GiST `&&` + ST_Intersects), against
 *   2. the pre-PostGIS approach: materialise every geometry as GeoJSON to Node
 *      and bbox-filter in JS (O(n) scan + parse of every row, no index), and
 *   3. tile-render latency (ST_AsMVT) at z8 / z12 / z16.
 *
 * Usage:  DATABASE_URL=… tsx src/scripts/postgis-benchmark.ts [rowCount]
 * Numbers are recorded in docs/POSTGIS_FOUNDATION.benchmark.md.
 */

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const rowCount = Number(process.argv[2] ?? 500_000);
const sql = postgres(DATABASE_URL, { max: 1 });

/** A fixed ~10°×10° query window near the equator. */
const QUERY_ENVELOPE = "ST_MakeEnvelope(0, 0, 10, 10, 4326)";

function ms(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

async function main() {
  console.log(
    `\n=== PostGIS benchmark — ${rowCount.toLocaleString()} rows ===\n`
  );

  await sql.unsafe(`DROP TABLE IF EXISTS bench_geo`);
  // Small (~0.05°) polygons randomly placed within a bounded 40°×40° region
  // (lng 0..40, lat 0..40) — dense enough that the query window and the sample
  // tiles both hit data. Randomness is computed per row in a subquery (a
  // LATERAL that doesn't reference the series is evaluated once).
  await sql.unsafe(`
    CREATE TABLE bench_geo AS
    SELECT
      id,
      ST_MakeValid(ST_MakeEnvelope(rx, ry, rx + 0.05, ry + 0.05, 4326)) AS geom,
      ST_AsGeoJSON(ST_MakeEnvelope(rx, ry, rx + 0.05, ry + 0.05, 4326))::jsonb AS geojson
    FROM (
      SELECT g AS id, (random() * 40) AS rx, (random() * 40) AS ry
      FROM generate_series(1, ${rowCount}) g
    ) s
  `);

  // Index build time (part of the "with PostGIS" cost, but one-time).
  let t = process.hrtime.bigint();
  await sql.unsafe(
    `CREATE INDEX bench_geo_gist ON bench_geo USING GIST (geom)`
  );
  await sql.unsafe(`ANALYZE bench_geo`);
  const indexBuildMs = ms(t);

  // 1. Indexed PostGIS spatial filter.
  t = process.hrtime.bigint();
  const pg = (await sql.unsafe(
    `SELECT count(*)::int AS n FROM bench_geo
     WHERE geom && ${QUERY_ENVELOPE} AND ST_Intersects(geom, ${QUERY_ENVELOPE})`
  )) as unknown as Array<{ n: number }>;
  const pgMs = ms(t);
  const matched = pg[0].n;

  // 2. Node-over-JSONB: fetch every geometry as GeoJSON and bbox-filter in JS.
  //    This is the pre-PostGIS shape — no index can help; every row is parsed.
  t = process.hrtime.bigint();
  const all = (await sql.unsafe(
    `SELECT geojson FROM bench_geo`
  )) as unknown as Array<{ geojson: { coordinates: number[][][] } }>;
  let nodeMatched = 0;
  for (const row of all) {
    const ring = row.geojson.coordinates[0];
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const [px, py] of ring) {
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    // bbox overlap with [0,0,10,10]
    if (minX <= 10 && maxX >= 0 && minY <= 10 && maxY >= 0) nodeMatched++;
  }
  const nodeMs = ms(t);

  // 3. Tile latency at a few zooms. Pick tiles that cover the populated window.
  // Tiles covering ~lng10/lat10, well inside the populated 40°×40° region.
  const tileZooms: Array<{ z: number; x: number; y: number }> = [
    { z: 8, x: 135, y: 120 },
    { z: 12, x: 2161, y: 1933 },
    { z: 16, x: 34592, y: 30933 },
  ];
  const tileResults: Array<{ z: number; ms: number; bytes: number }> = [];
  for (const { z, x, y } of tileZooms) {
    const env = `ST_TileEnvelope(${z}, ${x}, ${y})`;
    t = process.hrtime.bigint();
    const tile = (await sql.unsafe(
      `SELECT ST_AsMVT(q, 'default', 4096, 'geom') AS mvt FROM (
         SELECT ST_AsMVTGeom(ST_Transform(geom, 3857), ${env}, 4096, 64, true) AS geom
         FROM bench_geo
         WHERE geom && ST_Transform(${env}, 4326)
         LIMIT 50000
       ) q WHERE q.geom IS NOT NULL`
    )) as unknown as Array<{ mvt: Uint8Array | null }>;
    tileResults.push({
      z,
      ms: ms(t),
      bytes: tile[0]?.mvt ? tile[0].mvt.length : 0,
    });
  }

  await sql.unsafe(`DROP TABLE IF EXISTS bench_geo`);

  console.log(
    `index build (GiST) : ${indexBuildMs.toFixed(0)} ms (one-time)\n`
  );
  console.log(
    `spatial filter over the ~10°×10° window (matched ${matched} / ${nodeMatched}):`
  );
  console.log(`  PostGIS (indexed) : ${pgMs.toFixed(1)} ms`);
  console.log(
    `  Node over JSONB   : ${nodeMs.toFixed(1)} ms   (fetch + parse + scan all ${rowCount.toLocaleString()})`
  );
  console.log(`  speedup           : ${(nodeMs / pgMs).toFixed(0)}×\n`);
  console.log(`tile render (ST_AsMVT):`);
  for (const r of tileResults) {
    console.log(`  z${r.z} : ${r.ms.toFixed(1)} ms  (${r.bytes} bytes)`);
  }
  console.log("");

  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
