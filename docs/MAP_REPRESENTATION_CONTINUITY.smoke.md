# Continuous map representation — Smoke

**Issue:** [EnterpriseBT/portal-ai#532](https://github.com/EnterpriseBT/portal-ai/issues/532) · **Spec:** `docs/MAP_REPRESENTATION_CONTINUITY.spec.md` · **Plan:** `docs/MAP_REPRESENTATION_CONTINUITY.plan.md`

Manual walkthrough against **your own running dev stack** (web :3000, api :3001), signed in to the seeded org. Every box starts unchecked; check it only after you've observed the stated result. Bugs found go through the bug-filing template at the bottom, not ad-hoc fixes.

> **Interim smoke (slices 1–2).** As of this writing the branch carries slice 1 (count-driven decision + layer coexistence + ETag salt — the filed #532 fix) and slice 2 (nested grid — the wander fix). Steps tagged **[1–2]** are testable now. Steps tagged **[3]/[4]/[5]/[6]** cover the over-cap never-drop guarantee, the line hybrid, **polygons-dissolve-never-bin**, and dissolve continuity — **not yet on the branch**; leave them unchecked until those slices land.
>
> **Slices-1–2 walk recorded below** ("Smoke findings"): points passed; large no-colorBy polygons surfaced a real defect (centroid-binning polygons → low-zoom `504` + no extent) that **added slice 5** (see the discovery "Smoke findings" amendment). `/smoke` re-tags everything when the feature is complete.

## Test data — public ArcGIS REST endpoints

No token required (Esri sample server). Base: `https://sampleserver6.arcgisonline.com/arcgis/rest/services`.

> ⚠️ **The bare layer path returns HTML metadata, not data.** `…/USA/MapServer/0` is the layer's *description* page. Actual features come from the layer's **`/query`** sub-endpoint with **`f=geojson`**. The URLs below already include it — use them verbatim (each is `Base` + the path shown).

**Small — under the ~10k tile cap → renders as itself (dots / lines / real polygons) at every zoom:**

| Geometry | Layer | Data URL (append to Base) | Count |
|---|---|---|---|
| Points | USA Cities | `/USA/MapServer/0/query?where=1=1&outFields=*&f=geojson` | 3,557 |
| Lines | USA Highways | `/USA/MapServer/1/query?where=1=1&outFields=*&f=geojson` | 679 |
| Polygons | USA Counties | `/USA/MapServer/3/query?where=1=1&outFields=*&f=geojson` | 3,141 |
| Polygons | USA States | `/USA/MapServer/2/query?where=1=1&outFields=*&f=geojson` | 51 |

**Large — over the cap → aggregates into nested-grid bins:**

| Geometry | Layer | Data URL (append to Base) | Count |
|---|---|---|---|
| Points | Census Block Points | `/Census/MapServer/0/query?where=1=1&outFields=*&f=geojson` | 8,205,099 |
| Polygons | Census Block Groups | `/Census/MapServer/1/query?where=1=1&outFields=*&f=geojson` | 211,136 |

**Mid-size subsets (ingestible, still over-cap at low zoom) — a `WHERE` clause narrows it:**

- CA block groups (22,132) — `/Census/MapServer/1/query?where=STATE_FIPS='06'&outFields=*&f=geojson`
- RI block points (21,014) — `/Census/MapServer/0/query?where=STATE_FIPS='44'&outFields=*&f=geojson`
- RI block groups (820, small) — `/Census/MapServer/1/query?where=STATE_FIPS='44'&outFields=*&f=geojson`

**Full example (paste in a browser to see the GeoJSON):**
`https://sampleserver6.arcgisonline.com/arcgis/rest/services/USA/MapServer/0/query?where=1=1&outFields=*&f=geojson`

**Notes:** `f=geojson` returns a GeoJSON `FeatureCollection` (`f=json` = Esri JSON, `f=html`/none = the metadata page). Count only: swap the tail for `&returnCountOnly=true&f=json`. **Page size is capped at `maxRecordCount=1000` per request** — page with `&resultRecordCount=1000&resultOffset=N` (N = 0, 1000, 2000, …); the response's top-level **`exceededTransferLimit: true`** means more pages remain (stop when it's `false`). A whole 8.2M-point layer is impractical to pull — use a `WHERE` subset.

**For the aggregation / wander check specifically:** you need **>10k features in a low-zoom tile**, so pull a paginating mid-size subset. **RI block points** (21,014 points in a tiny area — the whole state sits in ~one low-zoom tile) is the sharpest wander test; **CA block groups** (22,132 polygons) also works. A single 1000-feature page stays under the cap and renders as dots, so pagination must be on for these.

## Smoke checklist (from the spec's acceptance criteria)

**Small layers render as themselves (#532 filed fix) — [1–2], agent-walkable**

- [x] Map **USA Cities** (3,557 pts). At z3–z5 (national view) the features render as **individual dots**, not grid squares. *(Was squares below z14.)*
- [x] Map **USA Highways**. Lines render at every zoom.
- [x] Map **USA Counties** (3,141). Real polygons render at every zoom (no bins).
- [x] No "Dense areas are summarized…" notice appears on any of the three small layers.

**Aggregate continuity — point bins nest, never wander/blink — [1–2], agent-walkable**

*(Use a **point** layer — RI block points, 21k. Polygons no longer centroid-bin; they dissolve — see slice 5.)*

- [ ] Map **RI block points** (21k). At a low zoom where a tile exceeds the cap, bins ("Dense areas are summarized — zoom in for detail." notice) appear.
- [ ] Zoom in one step at a time and watch a specific bin: it **subdivides into up to four smaller bins in place**. It never disappears and reappears somewhere else, and a previously-seen bin does not vanish then return on the way back out. *(This is the core behavior #532 reported.)*
- [ ] Zoom out one step: four bins **merge into their parent** cleanly.

**ETag / caching — [1–2], manual (devtools)**

- [ ] With the Network tab open, pan back to a tile you already viewed: it serves **304 Not Modified**, and the "summarized" notice state is still correct (no fl?icker to the wrong notice).

**Over-cap never-drop for points & lines — [3]/[4], PENDING (leave unchecked until slices 3–4 land)**

- [ ] A dense point layer zoomed past z14 shows **every point** covered (as dots where the tile is under cap, or bins where over) — none silently dropped.
- [ ] A dense line layer over cap shows the **major lines as real lines** plus **bins covering the crossed cells** of the rest — no line unrepresented.
- [ ] No `X-Portal-Tile-Truncated` header on any response (truncation retired).

**Advisory override — [3], PENDING**

- [ ] A layer authored with aggregation off still aggregates when a tile is genuinely over the cap (the invariant wins; no feature stranded).

**Polygons dissolve, never centroid-bin — [5], slice 5 implemented (re-walk to confirm in the live app)**

- [ ] A **large no-colorBy polygon** layer (census block groups) renders **real polygon geometry** (the largest-in-view) at low zoom — never centroid squares — and a big polygon's extent is visible.
- [ ] The lowest-zoom polygon tile returns a **non-empty MVT** (no `504 MAP_TILE_TIMEOUT` blank) — the tile that timed out on the slices-1–2 walk.
- [ ] A polygon **choropleth** (colorBy) behaves **identically** to a no-colorBy polygon as far as when it aggregates (unified area-ranked, re-smoke 3): under the cap it shows individual colored polygons, over the cap the largest-by-area colored by value. It does **not** aggregate when only a handful are in view, and does not flip-flop between aggregate and raw across zooms (that was a partial precompute).

**Recorded measurements (slice 5, against the live 211k census-block-groups layer, 2026-09-09):**

| What | Before (union / live) | After (area-ranked) |
|---|---|---|
| Precompute / band | 130–153s (union) — over budget | **~27s** (simplify, no `ST_Union`/`ST_MakeValid`) |
| z2/1/1 tile serve (the tile that 504'd) | 10s → `504 MAP_TILE_TIMEOUT` | **525ms**, 405 KB MVT, 10,000 features (largest-in-view, area-capped) |

`ST_MakeValid` was the precompute killer (~66s of the 76s attempt); dropped it — `ST_SimplifyPreserveTopology` preserves validity and `ST_AsMVTGeom` tolerates the rest.

> **⚠️ Re-smoke correction (211k layer is a stress case).** The ~27s/band above was a *raw-table `CREATE TABLE`* measurement. The **real processor path** — buildSessionViews + inserting ~213k rows/band into the **GiST-indexed, FK'd** `map_dissolve_geometries` — is slower, and on a resource-constrained dev container the **fine bands (rep 9/12) exceeded the 180s per-band statement timeout**: a live re-smoke landed **only band 2** of 5, so low-zoom tiles (which need band 0) still fell to raw and 504'd. Two real findings: (1) the area-ranked no-colorBy path trades union-time for **insert volume** (~1M rows for a 211k layer) with real GiST-insert cost, and (2) the per-band statement timeout can strand fine bands on a huge layer. **Follow-up: bound the huge-polygon precompute** (cap rows/band by area, and/or fewer bands, and/or adapt the timeout). For a reliable smoke here, use a mid-size layer (CA block groups, 22k) — it precomputes all bands in seconds.

> **To re-smoke slice 5 in the live app:** the precompute is **pin-only**, so **pin the census map** (the census layer was delivered as a transient *message block*, which has no precompute) and rebuild the running app (new code + `AGG_TILE_VERSION` bump). Pinning enqueues the precompute (~2–3 min for 5 bands over 211k); low-zoom tiles then serve from the index. An un-pinned message map of a huge polygon layer stays on the slow raw path by design (spec → Out of scope).

> **⚙️ Re-smoke 4 — count-driven merged coverage, the never-drop fix (spec amendment 3).** Reproduced via Playwright + tile-density measurement: on the CA pin (22k, complete precompute) a z5 tile holds **21,957 polygons > the 10k cap**, so the area-ranked serve kept the largest 10k and **dropped ~12k of the smallest** → whole swathes of dense/urban block groups vanished at low zoom and returned on zoom-in. Area-ranked *drops*; that violates the never-drop invariant. Fixed: the precompute now stores **two representations** (`merged` boolean) — individuals (per polygon) AND a merged coverage (union per value per band). The serve is **count-driven**: a tile **≤ 10k → individuals** (each polygon as itself), **> 10k → the merged coverage** (every polygon represented, nothing dropped); zooming in, individuals emerge from the merge. **Re-smoke: restart the app (`AGG_TILE_VERSION=6` + migration `0091`), then re-pin the CA layer** (the stored rows must be rebuilt to include the merged coverage — an old pin has only individuals and its over-cap tiles fall back to the drop). Zoom slowly from state level in: at low zoom the dense areas should be a filled merged coverage (not empty), and it should resolve into individual polygons as you zoom, with **no swathe ever blanking**.

> **⚙️ Re-smoke 3 — unified area-ranked colorBy (spec amendment 2).** The live walk surfaced two more things: (1) a **colorBy choropleth aggregated even with ~50 polygons in view** (it merged instead of showing individuals), and (2) **flip-flop** across zooms (aggregate → raw → aggregate) — which turned out to be a **partially-built precompute** (only some bands landed on the constrained container; the missing bands fell to raw). The fix folds colorBy into the **same area-ranked path** as no-colorBy: one row per polygon per band, tagged with its value, **no union**; the serve always area-ranks (`ORDER BY ST_Area DESC LIMIT cap`), so under the cap it shows **individual** polygons (colored by value for a choropleth) and over it the largest — identical decision for both flavors, pipeline-free. `DISSOLVE_CARDINALITY_CEILING` retired. **Re-smoke on the CA block groups (22k) layer** — it precomputes all 5 bands in seconds so there is no partial-build flip-flop; map it **with** a real categorical colorBy AND **without** one and confirm both behave the same as you zoom. The 211k US layer stays the documented stress case (partial precompute on this container; follow-up: bound the huge-polygon precompute).

## Smoke findings — slices-1–2 walk (recorded)

Walked against the dev stack; **points passed, polygons found a real defect** → added **slice 5** (spec/discovery/plan amended).

- **PASS — small layers:** USA Cities render as dots at national zoom (not squares), Highways as lines, Counties as real polygons. *(#532 filed fix confirmed.)*
- **PASS — large points (RI block points, 21k):** bins appear at low zoom and **subdivide in place** as you zoom, no wander/blink, no vanish-and-reappear. *(Nested grid confirmed.)*
- **BUG → slice 5 — large no-colorBy polygons (169k census block groups):** three symptoms, one root (centroid-binning polygons is wrong):
  1. **Blank low-zoom tiles that "appear suddenly."** Aggregates absent across a continent view; they pop in only once one state fills the view. Root: the live per-tile `ST_Centroid(ST_Transform(ST_Simplify(geom)))` over 169k rows exceeds `TILE_STATEMENT_TIMEOUT_MS` → `504 MAP_TILE_TIMEOUT` → blank; higher zoom = fewer polygons/tile = completes. (Observed 504: `…/tiles/message/a03dbb96…/7/2/1/1.mvt`, z2.) They don't re-vanish because a succeeded tile is ETag-cached — so it's tiles *erroring*, not the wander bug.
  2. **Bin square smaller than the polygon.** A centroid bin is a fixed square at the centroid; a large rural block group collapses to a tiny square.
  3. **Un-viewable zoom gap.** Zoomed out → tiny square (can't see the polygon); zoomed in enough for raw (z14) → polygon bigger than the viewport. No zoom shows a big polygon whole.
  - **Resolution (slice 5):** polygons never centroid-bin — they **dissolve** to real geometry served from the GiST-indexed precompute (no per-tile scan → no timeout; real extent → fixes 2 & 3). No-colorBy uses precomputed area-ranked simplified geometry (no union — union measured 130-153s/band, prohibitive). *Interim workaround while smoking: re-map with a `colorBy` to hit the existing dissolve path.*

## Large-dataset performance (measured, not asserted) — [3]/[5], PENDING

Per the spec's Risks and discovery Q2/Q4, these are recorded measurements against a production-sized layer (e.g. Census Block Points / Block Groups, or a real ~400k-parcel layer), **not** unit assertions:

- [ ] **Over-cap probe** (`LIMIT cap+1`) tile latency on a huge point layer is acceptable at low zoom; if it plans poorly, fall back to `count(*)`. Record the measurement.
- [ ] **Dissolve finest-union** precompute time on a ~400k-polygon choropleth is acceptable on the maintenance queue; if prohibitive, fall back to simplify-on-read. Record the measurement.

## Bug-filing template

If a step fails, file a bug (don't fix inline):

```
## Repro
<layer + URL, zoom/pan sequence>. **Expected:** <checklist step>. **Got:** <observed>.
## Impact
<which invariant broke — dropped feature / wander / clip / perf>
## Evidence
<screenshot(s), tile request/response, X-Portal-Tile-* headers, timing>
## References
#532, docs/MAP_REPRESENTATION_CONTINUITY.spec.md
```

## Merge gate

The PR merges only when CI is green **and** you have walked and checked the applicable boxes above. At full completion, `/smoke` re-tags the PENDING sections and `/smoke-walk` can drive the agent-walkable steps in a real browser for evidence — but checking boxes and confirming the merge remain your act.
