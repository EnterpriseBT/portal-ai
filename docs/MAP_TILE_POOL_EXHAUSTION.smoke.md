# MAP_TILE_POOL_EXHAUSTION — Smoke Suite

Manual smoke test for [#698](https://github.com/EnterpriseBT/portal-ai/issues/698). With this fix, a heavy map layer degrades only itself:
- line and point tiles simplify cheaply;
- tile queries run behind a per-process admission gate (`503 MAP_TILE_BUSY` + `Retry-After`);
- DB work whose client has gone is cancelled;
- a request's first query can wait at most 30s for a connection;
- the map shows a busy notice and backs off.

**Branch under test:** `fix/698-map-tile-pool-exhaustion` (PR [#703](https://github.com/EnterpriseBT/portal-ai/pull/703)).

Run **§Preflight** once. After it, each section is independent. Step tags:
- **untagged:** agent-walkable via `/smoke-walk` (browser).
- **`— backend`:** verified with `curl` / `psql` / the API log.
- **`— manual`:** needs a human, or app-dev after merge.

Filing bugs: use the template at the bottom.

---

## Preflight

### Environment

- [ ] `git checkout fix/698-map-tile-pool-exhaustion && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core`. There's no migration and no core model change, but the core dist must match this branch (see the stale-dist note in the plan).
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`). The API log shows no errors at startup, so the SQL instrumentation loads with the pool.
- [ ] `npm run --workspace @portalai/e2e e2e:auth` has refreshed the Playwright session (for the agent walk).

### Fixtures

The local DB has no geometry entities, so the walk needs one heavy **lines** layer and, for §7, one **polygon** layer.

- [ ] **contours** — manual. Upload the same topography file that backs the app-dev Topography entity (6,452 contour linestrings, ~1.3M vertices) into a local station through the File Upload connector. Map its geometry column with the **Geometry** type. Any high-vertex line layer works, but this one is the original repro.
- [ ] **polygons** — manual. Any polygon layer (e.g. parcels or zip boundaries) in the same station.
- [ ] Ask the station's agent: **"Map the topography contours"**. The answer must render a `geo` block with a `lines` layer. Note the portal id, and from the browser network tab the tile URL template: `/api/portal-map/tiles/message/<messageId>/<blockIndex>/{z}/{x}/{y}.mvt`.
- [ ] A Bearer token for curl steps: copy the `Authorization` header of any `/api/…` request in devtools (`export TOKEN=…`).
- [ ] A psql shell on the local DB, kept open for the `pg_stat_activity` checks: `npx portalops db psql --env local`.

### Reset between runs

- [ ] No data reset needed. Tiles are read-only. §8 deletes a portal, so re-create it by re-asking the agent before re-running §8.
- [ ] Between runs, wait ~10s for tile queries to drain (the `pg_stat_activity` check in §2 should show 0).

---

## §1 — The contour map renders (slice 1 · AC: renders at z2–z10, no `MAP_TILE_TIMEOUT`)

- [ ] Open the contours portal. At the initial view (zoom 2), contour lines draw within a few seconds, and no "A map tile timed out" notice appears.
- [ ] Zoom in step by step to ~z10 over the densest area. Lines keep rendering at every zoom, and `map-widget-tile-timeout` never appears.
- [ ] The API log has no `MAP_TILE_TIMEOUT` for this message id during the walk — backend: `grep MAP_TILE_TIMEOUT` the dev log.
- [ ] A warm z3 tile serves in < 1s — backend. Request one tile twice:

  ```bash
  curl -s -o /dev/null -w "%{http_code} %{time_total}\n" -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/portal-map/tiles/message/<messageId>/<blockIndex>/3/1/3.mvt
  ```

  The second run is `200` (or `204`) and well under 1s. Add `-H 'If-None-Match: <etag>'` to see the `304` path.
- [ ] Post-merge, on **app-dev** — manual. Open the contour portal `a57a7db1-f5bb-4d08-a835-c8ed084a86dc`. It renders at z2–z10 with no timeout notice, and CloudWatch `/ecs/portalai-api-dev` shows no `MAP_TILE_TIMEOUT` for message `80744079…`.

## §2 — Tiles can't take the pool; the app stays responsive (slices 2, 5 · AC: ≤ 4 tile connections per task, other endpoints normal)

- [ ] With the contours map open, zoom out to z2–z3 and pan quickly across the layer several times.
- [ ] While panning, run this in psql — backend:

  ```sql
  SELECT count(*) FROM pg_stat_activity WHERE state <> 'idle' AND query LIKE '%ST_AsMVT%';
  ```

  The count never exceeds **4** (one dev API process).
- [ ] While panning, in a second tab open the station list, then another portal's page. Both load at normal speed (sub-second), and no request in the network tab stays `(pending)`.
- [ ] Stop panning. Within ~10s the psql count returns to **0**.

## §3 — A saturated gate answers fast with `503 MAP_TILE_BUSY` (slice 5 · AC: 503 + readable `Retry-After`)

- [ ] Burst 16 distinct uncached tiles at once from one org. With the per-org share at 2 and the queue at 8, about 6 of them should be turned away — backend:

  ```bash
  for x in 0 1 2 3 4 5 6 7; do for y in 2 3; do curl -s -o /dev/null -D - -H "Authorization: Bearer $TOKEN" -H "Origin: http://localhost:3000" "http://localhost:3001/api/portal-map/tiles/message/<messageId>/<blockIndex>/4/$x/$y.mvt" | grep -iE "^HTTP|retry-after|access-control-expose" & done; done; wait
  ```

  At least one response is `HTTP/1.1 503` and carries `Retry-After: 2`. `Access-Control-Expose-Headers` includes `Retry-After`. Change `z` (e.g. 5) to re-run uncached.
- [ ] The 503 body is `{"…","code":"MAP_TILE_BUSY"}`, and it arrives in well under 5s, not after a long wait — backend.
- [ ] The API log has a `warn` "Map tile rejected by the admission gate" with `gate: "map-tile"`, `reason`, `organizationId`, `active`, `queued`, `activeByKey` — backend.
- [ ] OpenAPI: `http://localhost:3001/api/docs` → both `/api/portal-map/tiles/…` routes list a **503** response with a `Retry-After` header.

## §4 — The map shows busy and backs off (slice 6 · AC: busy notice + tab pause)

- [ ] Saturate the gate from a terminal (the §3 loop at a fresh zoom) while the contours map is open, then pan the map — manual for the timing. The notice **"Map server is busy — tiles will load when you pan or zoom."** (`map-widget-tile-busy`) appears. It isn't styled as an error, and "A map tile failed to load" does **not** appear.
- [ ] In the network tab, after a `503`, no tile request from the tab starts for ~2s (the `Retry-After` window). Tiles that were already queued wait too, then resume.
- [ ] Pan or zoom after the pause. Tiles load and the busy notice clears.

## §5 — Abandoned tiles stop consuming the DB (slice 5 · AC: an aborted tile frees its connection within ~1s)

- [ ] Open the contours map at z3 and immediately pan away hard, or close the tab, so in-flight tiles are superseded.
- [ ] The API log shows `info` "DB query cancelled: client disconnected" with `dbCancel: "client_gone"` and `policy: "always"` — backend.
- [ ] The §2 psql count drops to 0 within ~1s of closing the tab, not after the 10s statement timeout — backend.
- [ ] No `MAP_TILE_TIMEOUT` is logged for the aborted tiles. Their requests log `REQUEST_ABANDONED` at info level (status 499), not as errors — backend.
- [ ] No backend is left in a transaction afterwards — backend. This is the code-review leak fix:

  ```sql
  SELECT count(*) FROM pg_stat_activity WHERE state LIKE 'idle in transaction%';
  ```

  The result is `0`.

## §6 — A request can't write after its client gave up (slice 4 · AC: 30s admission deadline, no write; disconnect before start never executes)

- [ ] backend. This can't be reproduced on the dev stack without saturating the pool for 30s. It's verified by the real-Postgres suite on this branch:

  ```bash
  cd apps/api && npm run test:integration -- --testPathPattern request-cancellation.integration
  ```

  All 7 cases pass, including:
  - "a first query still queued at the admission deadline is cancelled, maps to DB_ADMISSION_TIMEOUT, and never writes";
  - "a queued write cancelled by a client disconnect never executes";
  - "a transaction whose BEGIN is still queued at the deadline rejects with no partial writes".
- [ ] The original repro: with the contours map open and panning (as §2), delete a different portal from the station's portal list. The delete completes promptly, it does **not** hang `(pending)`, and the portal disappears once.

## §7 — Unchanged behaviour (AC: workers unaffected; polygon tiles unchanged)

- [ ] Workers outside a request: re-sync or re-import the contours entity (File Upload → re-upload, or the connector's Sync), and wait for the job to reach `completed` in **Jobs**. It finishes normally; the instrumentation doesn't touch jobs.
- [ ] Polygons — manual. Open a map of the polygon fixture. Shapes render as before, with the "Simplified at this zoom" notice at low zoom.
- [ ] Polygons — backend. A polygon tile still simplifies with topology preservation. With `log_statement` or `pg_stat_activity` sampled during a polygon pan, the tile SQL contains `ST_SimplifyPreserveTopology`; a contours tile's contains `ST_Simplify(`.

## Sign-off

- [ ] Every section above verified (agent evidence reviewed for the walkable steps; backend and manual steps walked by hand)
- [ ] §1's app-dev step confirmed after merge + deploy
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org / station / portal / message id, tile z/x/y, request id from `x-request-id`):
