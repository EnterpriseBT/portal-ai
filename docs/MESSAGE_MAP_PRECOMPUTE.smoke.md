# message-map-precompute — Smoke Suite

Manual smoke test for [#542](https://github.com/EnterpriseBT/portal-ai/issues/542) — un-pinned **message-block** polygon maps now serve the same precompute-backed never-drop tiles as pins (keyed by `message_id`+`block_index`), enqueued eagerly at message-create and retained on an age window. **Branch under test:** `feat/message-map-precompute` (PR [#544](https://github.com/EnterpriseBT/portal-ai/pull/544)).

## Preflight

### Environment

- [ ] `git checkout feat/message-map-precompute && git pull --ff-only`
- [ ] `npm install`
- [ ] `npm run db:migrate` from `apps/api` — applies **`0093_generalize_dissolve_ownership`** (nullable `portal_result_id` + `message_id`/`block_index` + the hand-added exactly-one-owner CHECK + FK cascade). Confirm it applies clean.
- [ ] Rebuild `@portalai/core` (`AGG_TILE_VERSION` → 9 lives there): `npm run build --workspace @portalai/core`, then restart `npm run dev`.
- [ ] `npm run dev` boots cleanly (API :3001, web :3000).

### Fixtures

- [ ] Your local admin org (`admin@portalsai.io`, unlimited tier).
- [ ] The **CA census block groups (~22k)** ArcGIS connector from the #532/#541 smokes.
- [ ] A portal session in which you can ask the agent to map that layer (produces a `geo` **message block**, not a pin).

### Reset between runs

- [ ] Re-asking the agent creates a fresh message (new `message_id`). To force the degraded state for §1, delete a message's merged rows: `DELETE FROM map_dissolve_geometries WHERE message_id = '<id>' AND merged = true;`.

## §1 — A message-block map serves precomputed coverage (slice 1)

- [ ] In a portal, ask: **"map the CA census block groups as polygons"** — the agent returns a **map in the message feed** (an un-pinned `geo` block). *(agent-walkable)*
- [ ] Wait for its dissolve job to finish (`jobs` table, `type = dissolve_precompute`, metadata carries `messageId`+`blockIndex`, status `completed`). Confirm `map_dissolve_geometries` has rows with that `message_id` (both `merged=false` and `merged=true`). *(manual — DB)*
- [ ] Zoom the feed map out to where a tile holds > 10k block groups. **Expected:** a filled merged coverage (no empty swathes, no `504`) — matching a pinned map, **without pinning**. *(agent-walkable: the message tile serves `/tiles/message/<id>/<blockIndex>/…`; `— manual` visual)*
- [ ] Zoom in past the cap. **Expected:** individual polygons. *(agent-walkable)*

## §2 — Eager, size-gated enqueue at message-create (slice 2)

- [ ] Generating the map above (a >10k polygon layer) enqueues **one** `dissolve_precompute` job for its message block at create time (see the `jobs` table right after the message appears). *(manual — DB/job dashboard)*
- [ ] Ask for a **small** polygon map (≤ 10k features). **Expected:** **no** dissolve job is enqueued — it serves raw via the fast path. *(manual — DB)*
- [ ] Ask for a **points** or **table** result. **Expected:** no dissolve job. *(manual — DB)*

## §3 — Deletion cascade + age retention (slice 3)

- [ ] Delete the message's portal (or the message row). **Expected:** its `map_dissolve_geometries` rows are gone (FK cascade), and any **pin** coverage is untouched. *(manual — DB: `DELETE FROM portal_messages WHERE id='<id>'` then count rows by `message_id`)*
- [ ] Run the retention purge against a message aged past the window (set `MESSAGE_DISSOLVE_RETENTION_DAYS` low, or backdate a message's `created`), trigger the `message-dissolve-retention-purge` maintenance job. **Expected:** aged message coverage purged; in-window message + all pin coverage kept; the run summary shows the purged count in `GET /api/admin/maintenance`. *(manual — maintenance queue + DB)*

## §4 — Error & edge cases

- [ ] **Degraded/mid-build:** with a message's `merged` rows deleted, an over-cap message tile serves **area-ranked individuals** (the #541 fallback), never a blank tile, with the "Partial at this zoom" notice. *(agent-walkable: fetch the message tile after deleting merged rows; `— manual` visual)*
- [ ] **Empty-but-covered envelope:** panning a covered message map to an empty area serves an empty tile, not the fallback. *(manual — visual/network)*
- [ ] **Points/lines message blocks** are unchanged (count-driven raw, no precompute). *(manual — scope boundary)*
- [ ] **200k+ layer** inherits #541's stress-case behavior (bounded union may degrade → the §4 fallback). *(manual — recorded, beefier env)*

## Sign-off

- [ ] Every section above verified
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/portal/message/job ids):

---

### Acceptance-criteria → section map

| Spec acceptance criterion | Section |
|---|---|
| Large message-feed polygon map shows filled coverage, resolves to individuals — matching a pin | §1 |
| Message coverage absent → over-cap message tile serves area-ranked individuals, never blank | §4 |
| Deleting a portal/message removes its coverage (FK cascade); pins untouched | §3 |
| Message-owned coverage past the window is purged; pins never purged | §3 |
| Small message polygon layers still serve raw (no needless precompute) | §2 |
