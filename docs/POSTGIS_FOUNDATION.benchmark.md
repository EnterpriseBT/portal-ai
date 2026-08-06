# PostGIS foundation — benchmark

**Issue:** [#316](https://github.com/EnterpriseBT/portal-ai/issues/316) · **Epic:** [#84](https://github.com/EnterpriseBT/portal-ai/issues/84)

Backs the child's central claim — the spatial substrate belongs in the database, not in Node over turf — with measurements rather than argument. Reproduce with:

```bash
cd apps/api && npx dotenv -e .env -- tsx src/scripts/postgis-benchmark.ts [rowCount]
```

The script (`src/scripts/postgis-benchmark.ts`) builds a table of small (~0.05°) polygons randomly placed in a bounded 40°×40° region, GiST-indexes it, and compares:

1. **PostGIS (indexed):** `WHERE geom && env AND ST_Intersects(geom, env)` over a ~10°×10° query window.
2. **Node over JSONB (the pre-PostGIS shape):** `SELECT geojson FROM …` for **every** row, then bbox-filter in JS. No index can help; every row is fetched and parsed.
3. **Tile render (`ST_AsMVT`)** at z8 / z12 / z16.

## Environment

Local devcontainer, `imresamu/postgis:17-3.5-alpine` (PostGIS 3.5, PG17), arm64, warm cache. Absolute milliseconds are machine-relative; the **ratio** is the signal.

## Results

### Spatial filter — 500,000 rows

| Approach | Time | Notes |
|---|---|---|
| PostGIS, GiST-indexed | **121 ms** | matched 31,149 rows (a large ~6% window) |
| Node over JSONB | **717 ms** | fetch + parse + scan all 500,000 rows |
| **Speedup** | **~6×** | and PostGIS never leaves the DB |

GiST index build: 662 ms (one-time).

### Spatial filter — 50,000 rows

| Approach | Time |
|---|---|
| PostGIS, GiST-indexed | 4.7 ms (matched 3,076) |
| Node over JSONB | 93.7 ms (all 50,000) |
| **Speedup** | **~20×** |

The speedup narrows as the query window's *result set* grows (the 6% window returns 31k geometries for `ST_Intersects` to evaluate); for a **typical map viewport** — a small, selective window — the index advantage is larger, as the 50k selective run shows. The Node side always pays the full O(n) fetch+parse regardless of selectivity.

### Tile render latency (`ST_AsMVT`, 500,000 rows)

| Zoom | Time | Tile bytes |
|---|---|---|
| z8 | 21.7 ms | 13,997 |
| z12 | 0.3 ms | 82 |
| z16 | 0.2 ms | 0 (empty) |

A z8 tile (~1.4° across) captures a dense slice and renders a real ~14 KB tile in ~22 ms. High-zoom tiles cover a tiny area (z16 ≈ 0.005°) that is empty at this synthetic density — the sub-millisecond time is the index rejecting everything outside the envelope. Latency is the metric; an empty tile is a fast 204.

## Why this justifies the substrate

Speed is only half of it. The Node-over-JSONB column shares four defects the numbers can't fully show, each a *correctness* gap the PostGIS substrate closes:

- **O(n), unbounded.** Every query fetches and parses **all** rows into Node — memory and latency grow without bound; there is no index to prune. PostGIS prunes with the GiST index and never materialises the non-matching rows.
- **bbox, not geometry.** Without turf, the Node comparison can only test bounding-box overlap — `ST_Intersects` / `ST_Contains` / `ST_DWithin` are not available. PostGIS evaluates true topology.
- **No SRID, approximate measures.** Node has no projection catalog; distance/area are planar approximations. PostGIS reprojects (`ST_Transform`) and measures on the spheroid (`::geography`).
- **Cannot tile.** Rendering 350k features to a map requires `ST_AsMVT` in the database; Node cannot produce vector tiles at all.

This is why #316 deletes the hand-rolled turf tools rather than optimising them: a fixed-signature Node wrapper is strictly *less* expressive than the `ST_*` SQL the agent now composes directly.
