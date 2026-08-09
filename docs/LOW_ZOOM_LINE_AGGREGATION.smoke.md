# low-zoom-line-aggregation — Smoke Suite

Manual smoke test for [#337](https://github.com/EnterpriseBT/portal-ai/issues/337) — per-`kind` low-zoom map treatment: line layers render as importance-ranked raw lines (not square bins), points/polygons keep bins, choice is agent-driven via `aggregation.treatment` with per-kind defaults. **Branch under test:** `chore/low-zoom-line-aggregation` (PR [#339](https://github.com/EnterpriseBT/portal-ai/pull/339), base `epic/gis-toolpack`).

## Preflight

### Environment

- [ ] `git checkout chore/low-zoom-line-aggregation && git pull --ff-only`
- [ ] `npm install`
- [ ] **No migration** — the only schema-ish change is an additive optional contract field (`aggregation.treatment`). Nothing to run.
- [ ] Rebuild core so the app sees the new `resolveAggTreatment` export: `npm run build --workspace @portalai/core` (or a full `npm run build`) — per the stale-core-dist gotcha, `apps/*` resolve `@portalai/core` from its `dist/`.
- [ ] `npm run dev` boots cleanly (API :3001, web :3000).

### Fixtures

- [ ] **A line-geometry layer.** The ArcGIS Roads/Cities smoke instances were removed during cleanup this session — recreate one: add a REST/ArcGIS connector whose result has `LINESTRING`/`MultiLineString` geometry (a road network is ideal), sync it, and attach it to a station. A denser layer (many segments) is better — it exercises the cap + ranking.
- [ ] **A polygon layer** — the Salt Lake County LIR parcels (polygon) are still attached; use them for the "unchanged bins" checks.
- [ ] *(Optional)* **A point layer** — any lat/lng dataset, for the point-still-bins check.

### Reset between runs

- [ ] No reset needed — rendering is read-only. Re-run a check by re-prompting the agent (each `visualize_map` call authors a fresh spec) and panning/zooming the widget.

## §1 — Line layer at low zoom renders a ranked network (AC1, AC6)

- [ ] Prompt: **"Map the road network."** → a map of actual lines renders (a `visualize_map` widget), not points or bins.
- [ ] Zoom **out** past the aggregation threshold (below ~z14; zoom to the whole region). Expected: the layer stays **real lines** — a legible major-road skeleton — **not** a grid of colored squares, and **not** a random scatter of disconnected fragments. Connected roads still read as connected.
- [ ] If the low-zoom tile is capped (dense layer), the notice under the map reads **"Showing the most prominent features — zoom in for the rest."** (not "Partial at this zoom — zoom in for all features.").
- [ ] Zoom **in**: more/smaller roads fill in progressively; at high zoom the full network is present.

## §2 — Points & polygons still bin (AC2, AC4)

- [ ] Prompt: **"Map the parcels colored by property class."** (LIR polygon layer). Zoom out below ~z14. Expected: **square grid bins** (the #330 dominant-category choropleth) — visibly unchanged from `main`'s behavior; the "Aggregated overview — zoom in for detail." notice shows.
- [ ] *(If a point layer is attached)* Map the point layer, zoom out. Expected: **grid bins** (count-density), same as before — points are **not** affected by this change.
- [ ] Confirm the default is per-kind and needs no prompt hint: neither prompt above mentioned aggregation, yet lines came out raw (§1) and polygons/points came out binned.

## §3 — `treatment` overrides the per-kind default (AC3)

- [ ] Force **bins on a line**: prompt something like **"Map the road network as aggregated grid bins."** Expected: below the threshold the line layer now shows **square bins** (the agent set `aggregation.treatment: "bins"`).
- [ ] Force **raw on a polygon**: prompt **"Map the parcels but keep them as raw shapes at every zoom, don't aggregate."** Expected: below the threshold the parcels render as **raw polygons** (no bins; the agent set `treatment: "none"`). (At extreme low zoom a very dense polygon layer may show the truncation notice — that's expected for forced-raw.)

## §4 — Prompt intent steers the treatment (AC5)

- [ ] Contrast two prompts on the **same line layer** and confirm they render differently:
  - [ ] **"Map the road network"** → ranked-raw lines at low zoom (the network).
  - [ ] **"Give me an aggregated overview of where the roads are"** → grid bins at low zoom (`treatment:"bins"`).
- [ ] The difference is driven by the agent-authored spec, not a code default — omitting any such intent falls back to §1/§2 defaults.

## §5 — Back-compatibility: specs without `treatment` (AC4, AC7)

- [ ] A map authored/pinned **before** this change (no `treatment` field) still renders — open an existing pinned map widget, or re-run a prior map prompt. Expected: no validation error; polygons bin, lines now render raw (the new per-kind default) — nothing regresses to an error or blank.
- [ ] **Refresh path:** on a pinned map widget, trigger a refresh (the widget's refresh control). Expected: it refreshes without error (the `WidgetRefreshResponse` contract is untouched by the additive field).

## §6 — Scale & edge cases (Risks)

- [ ] **Statewide scale:** if you can attach a large line layer (e.g. a full state's roads, 10⁵+ segments), map it and zoom to z6–z8 (much/all of it in one tile). Expected: the tile **completes quickly** (no spinner-hang, no timeout/504), shows the **major roads** (longest-first), with the "most prominent features" notice — never a blank tile or an arbitrary scatter. *(If no statewide layer is available, note that the county roads at low zoom exercise the same ranked-raw path.)*
- [ ] **Timeout posture:** confirm a slow/large low-zoom line tile degrades to the notice (or a 504 → the existing timeout notice), not a frozen UI.

## Sign-off

- [ ] Every section above verified
- [ ] ______________ (date + name) — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/station/entity ids · zoom level · layer kind):
