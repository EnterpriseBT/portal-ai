# Low-zoom map aggregation — Plan

**Implements the grid-bins + dominant-category low-zoom overview, TDD-sequenced: contract first, then the server grid query, then the web rendering.**

Spec: `docs/LOW_ZOOM_MAP_AGGREGATION.spec.md`. Discovery: `docs/LOW_ZOOM_MAP_AGGREGATION.discovery.md`. Issue: #330 (epic #84). Builds on the #314 tile path (already merged into `epic/gis-toolpack`).

3 slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/low-zoom-map-aggregation`** — one feature, one PR ([#331](https://github.com/EnterpriseBT/portal-ai/pull/331)), per `CLAUDE.md` → "Phase = commit, not PR".

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — Slice 1 is the leaf contract everything else imports (the `aggregation` field + shared constants), so it's first. Slice 2 (server) produces the aggregated tiles + the `X-Portal-Tile-Aggregated` header the client consumes. Slice 3 (web) depends only on Slice 1's contract/constants (its unit tests parse a header + build layers without a live server), so it sits last where it can render what Slice 2 emits.

---

## Slice 1 — Contract field + shared constants

The optional per-layer `aggregation` block and the shared defaults both server and web read.

**Files**

- Edit: `packages/core/src/contracts/map-spec.contract.ts` — add `aggregation` to the **inner object** of `MapLayerSchema` (before `.superRefine`); export `MapLayerAggregation`.
- Edit: `packages/core/src/constants/large-data-ops.constants.ts` — `AGG_ZOOM_THRESHOLD=12`, `AGG_GRID_PX=24`, `AGG_DENSITY_MAX=5000`.

**Steps**

1. **Tests (spec: core ≈4 cases)** in `packages/core/src/__tests__/contracts/map-spec.contract.test.ts` — `aggregation` omitted parses; partial fields parse; `zoomThreshold` outside 0–22 rejects; the `.superRefine` polygon/lat-lng rule still fires with `aggregation` present. Run; fail.
2. **Implement** the optional schema block + the three constants. Green.
3. Lint + type-check (rebuild core dist so api/web type-check sees it — `project_stale_core_dist_after_branch_switch`).

**Done when:** core unit suite green; `MapLayerAggregation` + the constants are exported and nothing else references them yet.

**Risk:** `MapLayerSchema` is a `ZodEffects` (`.superRefine`) — the field must go in the wrapped `.object({…})`, not chained after.

---

## Slice 2 — Server grid aggregation + header

The `z < threshold` grid branch in the tile query, the aggregation descriptor, the `aggregated` flag, and the response header.

**Files**

- Edit: `apps/api/src/services/portal-map-tile.service.ts` — `resolvePipeline` returns `{ enabled, zoomThreshold, gridSizePx, colorByColumn }`; `defaultRunTileQuery` grid branch (`ST_SnapToGrid(ST_Centroid(…))` → `GROUP BY` cell → `mode() WITHIN GROUP` + `count(*) AS _count` → `ST_MakeEnvelope` cell → `ST_AsMVT`); `aggregated` on `TileQueryResult`/`TileRenderResult`; `renderTile` forces `truncatedCap=null` when aggregated.
- Edit: `apps/api/src/routes/portal-map.router.ts` — `sendTile` sets `X-Portal-Tile-Aggregated` when `result.aggregated`.
- Edit: `scripts/postgis-benchmark.ts` — time the grid query at z6/z9/z12.

**Steps**

1. **Tests first.**
   - **Unit (spec: api ≈3)** in `portal-map-tile.service.test.ts`: a mocked `runTileQuery` returning `aggregated:true` → `renderTile` nulls `truncatedCap` + carries `aggregated`; `aggregated:false` unchanged; a raw truncated tile still flags `truncatedCap`.
   - **Integration (spec: api ≈4)** — new `apps/api/src/__tests__/__integration__/db/map-aggregation.integration.test.ts`: seed a small multi-category geometry fixture; below threshold → cell polygons, each cell's `colorByColumn` = `mode()` of its members, `_count` = member count; at/above threshold → raw features + `aggregated:false`; no-`colorBy` descriptor → cells carry `_count`, no category property.
   - Run; fail.
2. **Implement** the descriptor + grid branch + flag + header. Green.
3. Lint + type-check; run the benchmark once to confirm z6/z9/z12 land under `TILE_STATEMENT_TIMEOUT_MS`.

**Done when:** api unit + integration green; aggregated tiles carry the header and never `truncatedCap`; benchmark under budget.

**Risk:** cell-size math (envelope width in EPSG:3857 ÷ `TILE_EXTENT/gridSizePx`); `mode()` is an ordered-set aggregate (`WITHIN GROUP`); `ST_MakeEnvelope` must be stamped SRID 3857 before `ST_AsMVTGeom`. The integration test builds its own fixture (mirror `wide-table-geometry.integration.test.ts` setup).

---

## Slice 3 — Web dual-layer rendering + density + notice

Aggregate fill below the threshold, raw layers above, the density paint for no-`colorBy`, and the aggregated-overview notice.

**Files**

- Edit: `apps/web/src/modules/MapWidget/utils/tile-source.util.ts` — `TileStatus.aggregated`, `EMPTY_TILE_STATUS`, `readTileStatus` reads `X-Portal-Tile-Aggregated`.
- Edit: `apps/web/src/modules/MapWidget/utils/map-config.util.ts` — `MapLibreLayer` gains `minzoom?`/`maxzoom?`; `layerToMapLibre` emits raw layer(s) `minzoom=threshold` + a `${source}-agg` fill `maxzoom=threshold` (colorBy `match`, or a `_count` log-interpolate density).
- Edit: `apps/web/src/modules/MapWidget/MapWidget.component.tsx` — aggregated notice, suppressing the truncated one.

**Steps**

1. **Tests first.**
   - **map-config (spec: web ≈4)** in `map-config.util.test.ts`: tiled category layer → raw layer(s) `minzoom=threshold` + one `-agg` fill `maxzoom=threshold` colored by the colorBy `match`; no-`colorBy` → agg fill uses the `_count` interpolate; `aggregation.enabled===false` → no agg layer.
   - **tile-source + MapWidget (spec: web ≈3)**: `readTileStatus` sets `aggregated` from the header; the aggregated notice renders and suppresses the truncated notice.
   - Run; fail.
2. **Implement** the status field, the dual zoom-gated layers + density paint, the notice. Green.
3. Lint + type-check.

**Done when:** web unit suite green; a tiled layer yields two zoom-gated layers with a clean handoff at `z = threshold`.

**Risk:** MapLibre zoom bounds — `minzoom` is inclusive, `maxzoom` exclusive, so raw (`minzoom=t`) and agg (`maxzoom=t`) hand off at exactly `z=t` with no overlap; assert this in the test.

---

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| 1 | `aggregation` contract field + shared constants | `packages/core` unit green |
| 2 | Server grid query + `aggregated` flag + header + benchmark | `apps/api` unit + integration green, benchmark under timeout |
| 3 | Web dual-layer rendering + density + notice | `apps/web` unit green |

## Cross-slice notes

- **Core dist rebuild** between Slice 1 and Slices 2/3 — api/web type-check against `@portalai/core` dist (`project_stale_core_dist_after_branch_switch`).
- **Colour continuity** needs no new sync: the aggregate fill reuses the **persisted** `colorBy.stops`, so `mode()` (aliased as the colorBy column) flows through the same `resolveColorBy` `match`. The pre-existing `categoryColor` (api tool) / `DEFAULT_PALETTE` (web) duplication is untouched.
- **Header name** `X-Portal-Tile-Aggregated` is a string literal in both the router and `readTileStatus`, matching the existing `X-Portal-Tile-Simplified/Truncated` convention (no shared constant).
- **Doc sync:** `/smoke 330` (phase 5) refreshes `docs/LOW_ZOOM_MAP_AGGREGATION` smoke steps against the 397k parcels after implementation — not a plan slice. No user-facing help/glossary/tool-description surface changes (this is a render behavior).

## Next step

Once discovery + spec + plan are confirmed, implementation starts on `feat/low-zoom-map-aggregation` — Slice 1 first, tests-first, one commit per slice into PR #331.
