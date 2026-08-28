# Low-zoom polygon choropleth treatment — Plan

**Implements #472 TDD-sequenced: a `"dissolve"` `AggTreatment` — contract first, then the server tile SQL that produces dissolved choropleth tiles, then the client handoff, then doc-sync.**

Spec: `docs/POLYGON_CHOROPLETH_LOWZOOM.spec.md`. Discovery: `docs/POLYGON_CHOROPLETH_LOWZOOM.discovery.md`. Issue: #472 (child of epic #470, `epic/map-tiles-at-scale`; builds on #450's fast tiles + #316/#330/#337).

4 slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `fix/polygon-choropleth-lowzoom`**, whose PR targets `epic/map-tiles-at-scale` — one ticket, one child PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api      && npm run test:unit
cd apps/web      && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — Slice 1 adds the enum + colorBy-aware resolver but is **behaviorally inert** (callers still invoke `resolveAggTreatment` 2-arg → polygons resolve `"bins"`), so the tree is green before anything routes to dissolve. Slice 2 activates dissolve on the server; the client's *existing* colorBy `-agg` fill is geometry-agnostic, so it paints the server's dissolved geometry correctly even before Slice 3 — no broken intermediate. Slice 3 makes the client resolve `"dissolve"` explicitly and extends the gate. Slice 4 is doc-sync.

---

## Slice 1 — Contract: `"dissolve"` enum + colorBy-aware `resolveAggTreatment`

Add the treatment value and the routing rule; no consumer passes colorBy info yet, so behavior is unchanged.

**Files**
- Edit: `packages/core/src/contracts/map-spec.contract.ts` — `treatment` enum `["bins","none","dissolve"]` (`:120`); export the `scale` enum type (`MapColorScale`); `resolveAggTreatment(kind, treatment?, opts?: { hasColorBy?; colorByScale? })` with the D3 rule; update doc comments.

**Steps**
1. **Tests (spec: core cases).** In `map-spec.contract.test.ts`: enum accepts `"dissolve"`; `resolveAggTreatment` — polygons+categorical(colorBy, no/`categorical` scale)→`"dissolve"`; polygons+`step`/`interpolate`→`"bins"`; polygons+no-colorBy→`"bins"`; explicit override; `lines`→`"none"`; **2-arg call → `"bins"` (back-compat)**; points/heatmap/cluster→`"bins"`. Run; fail.
2. **Implement** the enum + resolver signature/logic. Green.
3. Lint + type-check.

**Done when:** core tests pass; `resolveAggTreatment` called 2-arg is unchanged, so `aggregationFromSpec`/`layerToMapLibre` behavior is identical (still `"bins"` for polygons). Nothing renders dissolve yet.

**Risk:** the enum widening must not break the `rejects an unknown treatment` negative test — update it to a still-invalid value.

---

## Slice 2 — Server: produce dissolve tiles

`aggregationFromSpec` routes a categorical-colorBy polygon layer to dissolve; a new `buildDissolveTileSql` emits collected geometry per colorBy value.

**Files**
- Edit: `apps/api/src/services/portal-map-tile.service.ts` — `TileAggregation.treatment: AggTreatment`; `aggregationFromSpec` passes the rep layer's colorBy `{hasColorBy, colorByScale}` to `resolveAggTreatment` and sets `treatment`; new `buildDissolveTileSql(...)` (`GROUP BY <colorByColumn>`, `ST_Collect(ST_SimplifyPreserveTopology(geom, tileSimplifyTolerance(z)))`, `ST_AsMVTGeom`, emits the colorBy value as a property, `LIMIT cap`, `n_limited`); `defaultRunTileQuery` branches `agg.treatment === "dissolve"` → dissolve SQL; `X-Portal-Tile-Aggregated` + `truncated` for dissolve.

**Steps**
1. **Tests (spec: api cases).** `aggregationFromSpec`: categorical-colorBy polygons → `treatment:"dissolve"`, `enabled:true`, `colorByColumn`; `step` colorBy → `"bins"`; no colorBy → `"bins"`. `buildDissolveTileSql` string assertions: `GROUP BY`, `ST_Collect`, `ST_SimplifyPreserveTopology`, `ST_AsMVTGeom`, quoted `colorByColumn` as group key + emitted prop, `LIMIT <cap>`. `defaultRunTileQuery` routes dissolve → dissolve SQL. Run; fail.
2. **Implement** the interface field, resolution, builder, branch, header. Green.
3. Lint + type-check.

**Done when:** api tests pass; a categorical-colorBy polygon tile below threshold is dissolved. Existing bins/raw/line tests still green (partial `toMatchObject` tolerates the new field).

**Risk:** `aggregationFromSpec` resolves treatment from the **representative** layer's colorBy (the one with the `aggregation` block, else first) — assert the rep-layer colorBy is what's read, matching how `colorByColumn` is scanned.

---

## Slice 3 — Client: render dissolve below threshold

Make the client resolve `"dissolve"` and extend the aggregation gate so it draws the real dissolved fill (colorBy), not a centroid-square/density layer.

**Files**
- Edit: `apps/web/src/modules/MapWidget/utils/map-config.util.ts` — `resolveAggTreatment(layer.kind, agg?.treatment, {hasColorBy: !!style.colorBy?.column, colorByScale: style.colorBy?.scale})`; gate `treatment === "bins" || treatment === "dissolve"`; dissolve uses the existing colorBy `-agg` fill branch (always has colorBy → no density branch), no low-zoom outline.

**Steps**
1. **Tests (spec: web cases).** In `map-config.util.test.ts`: a tiled categorical-colorBy polygons layer → raw fill/outline `minzoom = threshold`; a `-agg` **fill** at `maxzoom = threshold` painted by the colorBy expression; **no** `_count` density layer. `step`/`interpolate` colorBy → bins handoff (regression). `treatment:"none"`/lines unchanged (regression). Run; fail.
2. **Implement** the resolver call + gate extension. Green.
3. Lint + type-check.

**Done when:** web tests pass; server + client both resolve `"dissolve"` for a categorical-colorBy polygon; the below-threshold layer is a colorBy fill over the dissolved geometry.

**Risk:** must pass the *same* colorBy inputs the server used, or the two disagree (client gates for bins while the server sent dissolved geometry — still renders via the colorBy fill, but the semantics/notice would drift). The shared resolver + identical inputs prevent it.

---

## Slice 4 — Doc-sync

**Files**
- Check + update any user-facing map docs (`glossary.util.ts` / `faq.util.ts` / help) if "aggregated overview"/map treatments are documented; otherwise record "no user-facing doc surface for map aggregation treatments" in the commit. No CLAUDE.md convention change.

**Steps**
1. Grep the doc surfaces (`packages/core/src/content/*`, help) for map aggregation/overview copy; update if the low-zoom behavior is described. No test (doc-only).
2. Lint.

**Done when:** no user-facing doc describes the old centroid-square-only low-zoom behavior; or it's confirmed none exists.

**Risk:** none.

---

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| 1 | `"dissolve"` enum + colorBy-aware resolver (inert) | core tests; 2-arg back-compat green |
| 2 | server dissolve tiles (`TileAggregation`/`aggregationFromSpec`/`buildDissolveTileSql`/branch) | api tests; bins/raw/line regressions green |
| 3 | client dissolve handoff | web tests; bins/none regressions green |
| 4 | doc-sync | docs match behavior |

## Cross-slice notes

- **No broken intermediate.** After Slice 2 the server sends dissolved geometry; the client's existing colorBy `-agg` fill (Slice 1 leaves it on the "bins" gate) paints it correctly because the fill is geometry-agnostic. Slice 3 only tightens the semantics (client resolves `"dissolve"`, gate includes it).
- **One shared resolver.** The whole design rests on server + client calling `resolveAggTreatment` with the *same* colorBy inputs; Slices 2 and 3 must pass identical `{hasColorBy, colorByScale}` derived from the same layer.
- **No migration / no `resolveColorBy` change** — the color expression already reads any tile property.
- **Continuous colorBy stays bins** (spec Out of scope) — a follow-up owns the value-aggregating low-zoom treatment.

## Next step

After discovery + spec + plan are confirmed, implementation begins on `fix/polygon-choropleth-lowzoom`, Slice 1 first, tests-first, one commit per slice; the child PR targets `epic/map-tiles-at-scale`.
