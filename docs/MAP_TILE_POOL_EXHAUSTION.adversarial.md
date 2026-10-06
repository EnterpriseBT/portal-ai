# MAP_TILE_POOL_EXHAUSTION — Adversarial Review

Adversarial probes for [#698](https://github.com/EnterpriseBT/portal-ai/issues/698). The change being probed:
- per-kind tile simplify;
- a per-process tile admission gate with per-org share (`503 MAP_TILE_BUSY` + `Retry-After`);
- request-scoped DB cancellation (disconnect, plus a 30s admission deadline), wired into the shared pool;
- client busy backoff.

**Branch under test:** `fix/698-map-tile-pool-exhaustion` (PR [#703](https://github.com/EnterpriseBT/portal-ai/pull/703)).

The change's new surfaces drive the selection:
- **the gate:** a shared resource with a per-org share (§3, §5);
- **the cancellation instrumentation:** it touches **every** DB query a request makes (§3, §6, §7);
- **ordering against authorization:** whether the new 503 and cancel paths sit before or after auth (§4);
- **the client's `Retry-After` handling:** a server-supplied value the client parses (§1, §2).

Probe tags:
- **untagged:** browser-drivable via `/smoke-walk`.
- **`— backend`:** curl / psql / API log.
- **`— manual`:** needs a human-forced timing or a second account.

## Preflight

### Environment

- [ ] `git checkout fix/698-map-tile-pool-exhaustion && git pull --ff-only && npm install && npm run build --workspace=packages/core`
- [ ] `npm run dev` (web :3000, API :3001). Tail the API log in a terminal; several probes read it.
- [ ] A psql shell: `npx portalops db psql --env local`
- [ ] Playwright MCP is available; `npm run --workspace @portalai/e2e e2e:auth` is fresh.

### Fixtures

- [ ] Everything in the smoke doc's §Preflight → Fixtures: the **contours** lines layer, the **polygons** layer, the contours portal's tile URL template, and `$TOKEN`.
- [ ] **Org B** — manual. A second org with its own user and token (`$TOKEN_B`) and its own map portal (any geometry layer), plus its tile URL template. Org A's user must not be a member of org B.
- [ ] **A portal the caller can't read** — manual. In org A, a second user's portal (portals are per-user, #685) with a map block. Note its tile URL.

### Reset between runs

- [ ] Wait ~10s between probes for tile queries to drain. `SELECT count(*) FROM pg_stat_activity WHERE state <> 'idle' AND query LIKE '%ST_AsMVT%'` should read `0`.
- [ ] §6's delete probes consume a portal; re-create it by re-asking the agent.

---

## §1 — Boundary & limit inputs

- [ ] Fire **exactly** `per-org share + queue` = 2 + 8 = 10 concurrent uncached contour tiles from one org (the smoke §3 loop, trimmed to 10 URLs). Expected SAFE: **no** `503`. Every request is admitted or waits under 5s, and all return `200`/`204`. — backend
- [ ] Fire 11. Expected SAFE: exactly the overflow (≥ 1) gets `503 MAP_TILE_BUSY` immediately, and the other 10 complete normally. No `500` appears, and the API keeps serving `/api/health`. — backend
- [ ] Hold one tile request waiting past the 5s gate wait: fire 20 tiles at z3 so the queue fills with slow tiles. Expected SAFE: queued tiles that aren't admitted in 5s get `503 MAP_TILE_BUSY` with `Retry-After: 2` at ~5s, not a hang and not a `504`. — backend
- [ ] Tile coordinates at the edges: `z=0, x=0, y=0`; `z=22` with max `x`/`y`; `x = 2^z` (one past the edge). Expected SAFE: valid ones render or return `204`. The out-of-range one gets `400 MAP_TILE_NOT_FOUND` **before** taking a gate slot, so a burst of invalid coordinates never produces `MAP_TILE_BUSY` for others. — backend

## §2 — Malformed & injection input

- [ ] The client's `Retry-After` parsing. In the browser console, run `fetch` on a tile with devtools "Override content" (or a local proxy) so a 503 returns `Retry-After` set to each of: `-5`, `0`, `99999`, `abc`, an HTTP-date `Wed, 21 Oct 2026 07:28:00 GMT`, and empty. Expected SAFE: the tab pauses **1–30s** in every case (2s for non-numeric or the date form), never 0, never negative, never hours, and tiles resume. — manual
- [ ] Malformed tile path: `/api/portal-map/tiles/message/<id>/abc/3/1/3.mvt` (bad block index), `/3.5/1/3.mvt` (non-integer zoom), and a 10 KB junk `messageId`. Expected SAFE: `400`/`404` typed errors. No SQL error, no `500`, no gate slot consumed (the gate's `active` in a concurrent rejection log stays ≤ 4). — backend
- [ ] SQL reach. The new SQL fragment is `tileSimplifyExpr(geomExpr, tolerance, kind)`. Check that nothing user-supplied reaches it: a layer spec with `"kind": "lines); DROP TABLE x; --"` stored via a hand-edited message block in `db:studio`. Expected SAFE: the spec fails `MapSpecSchema`, so the tile is `404`, or the kind is treated as unknown and gets SPT. The literal never appears in the executed SQL (check the API log / `pg_stat_activity`). — backend

## §3 — Concurrency & races

- [ ] **Abort storm, then normal traffic.** Open the contours map at z3, then pan hard back and forth for 30s so hundreds of tiles are superseded mid-query. Expected SAFE:
  - afterwards `SELECT count(*) FROM pg_stat_activity WHERE state LIKE 'idle in transaction%'` is **0** (the code-review leak fix);
  - the station list and a portal page load at normal speed;
  - within ~10s the API holds no tile queries.

  — backend
- [ ] **Abort a polygon (dissolve) tile mid-`COMMIT`.** Open the polygon map at a dissolve zoom (z ≤ 11) and close the tab ~200ms after load. Repeat 10×. Expected SAFE: no `idle in transaction` backends; the next polygon map load works. — manual (timing)
- [ ] **The same tile requested 10× at once** (identical URL). Expected SAFE: each request completes or is gated independently. There are no duplicate-key or shared-state errors in the log, and responses carry the same `ETag`. — backend
- [ ] **A job races a tile storm.** Start a contours re-sync/re-import, then immediately run the abort storm. Expected SAFE: the job reaches `completed`. Its queries run outside any request context, so they are never cancelled, and no `dbCancel` log line names it. — backend
- [ ] **Two tabs, one org.** Open the contours map in two tabs and pan both. Expected SAFE: org A never holds more than 2 tile queries at once (`activeByKey` in any rejection log shows `≤ 2` for org A), and both maps eventually render. — manual

## §4 — Auth & permission boundaries

- [ ] **Busy must not leak existence.** While org A's share is saturated (an 11-tile burst in flight), request a tile from **the portal the caller can't read**. Expected SAFE: `404 MAP_TILE_NOT_FOUND`, not `503 MAP_TILE_BUSY`. Authorization (`resolvePipeline`) runs before the gate, so a busy 503 never confirms an unreadable portal exists. — backend
- [ ] **No auth, gate saturated.** Request a tile with no `Authorization` header during a burst. Expected SAFE: `401 AUTH_UNAUTHORIZED`, never `503`. — backend
- [ ] **The 503 body reveals nothing.** Inspect a `MAP_TILE_BUSY` body. Expected SAFE: a fixed message and the code, with no other org's id, no gate `activeByKey`, and no SQL or stack. The gate stats appear **only** in the server log. — backend

## §5 — Multi-tenant isolation

- [ ] **Noisy neighbour.** Saturate org A (a 20-tile burst at z3 on the contours layer, repeated for 15s) while org B's user loads org B's map with `$TOKEN_B`. Expected SAFE: org B's tiles are admitted. Org B gets no `MAP_TILE_BUSY` until the global 4 slots are genuinely full, at which point it gets at most a short `503` + retry, never a hang. Org B's map renders. — backend + manual
- [ ] **Cross-org tile id.** With `$TOKEN_B`, request org A's contours tile URL. Expected SAFE: `404 MAP_TILE_NOT_FOUND`, whether or not the gate is saturated. — backend
- [ ] **One tenant's cancel never touches another's query.** Start org B's tile requests (`$TOKEN_B`, curl in a loop), then open and immediately close org A's map tab repeatedly. Expected SAFE: none of org B's requests fail with `57014` / `REQUEST_ABANDONED`; every `dbCancel` log line carries org A's request id. — backend

## §6 — State & lifecycle abuse

- [ ] **Delete the portal while its tiles are in flight.** Open the contours map at z3, and from a second tab delete that portal mid-render. Expected SAFE: the delete completes promptly (it isn't behind the tile queries). In-flight tiles finish or fail cleanly (`404` once the message is gone, or a cancel when the tab closes). No `500` and no `idle in transaction` backends. — manual
- [ ] **Long request, late first query.** Send a long agent turn that streams for > 30s before its first write (e.g. a multi-step analysis prompt). Expected SAFE: the turn's DB writes at the end succeed. The admission deadline measures a query's *wait for a connection*, not request age, so no `DB_ADMISSION_TIMEOUT` appears. — manual
- [ ] **Disconnect mid-mutation.** Start a portal delete (or a record save), then kill the request with `curl --max-time 0.05` against a slow DB path, or close the tab right after clicking. Expected SAFE: either the mutation never started (the entity is unchanged) or it completed fully. Never half-applied: for a portal delete, the messages are never gone while the portal row is still live. Check in `db:studio`. — backend
- [ ] **A running SSE stream outliving its client.** Open a portal (its SSE events stream), then close the tab. Expected SAFE: the stream's queries stop and the API logs no errors. No `REQUEST_ABANDONED` is logged at `error` level (it's `info`). — backend

## §7 — Misuse sequences

- [ ] **Retry storm on a stalled delete.** With the map panning, click Delete on a portal 3 times quickly. Expected SAFE: the portal is deleted once, the later attempts return `404` (already gone), and none of them runs minutes later. This is the original incident's sequence; mutation idempotency itself is out of scope (#698 "What this doesn't decide"). — manual
- [ ] **Refresh during the busy pause.** Trigger a `503` (the smoke §4 setup), then reload the page repeatedly. Expected SAFE: each reload starts a fresh tab state (the pause is per-tab memory), the server keeps turning away overflow with fast `503`s, and the map renders once load drops. There's no error page and no stuck "Rendering…". — manual
- [ ] **Many maps in one portal.** Ask the agent for three maps of the contours layer in one portal, then scroll so all three load at once. Expected SAFE: they share the tab's 6-fetch cap and the server gate. All three render (possibly after a busy notice), and the API stays responsive. — manual

## Findings

| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | low / med / high | fixed-in-PR / waived: <reason> |

## Sign-off

- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org / portal / message id, tile z/x/y, `x-request-id`):
