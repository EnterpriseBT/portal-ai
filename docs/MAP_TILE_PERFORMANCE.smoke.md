# map-tile-performance — Smoke Suite

Manual smoke test for [#450](https://github.com/EnterpriseBT/portal-ai/issues/450) — aggregate map tiles meet their 10s budget below zoom 12 by dropping the `entity_records` join (cause 1). **Branch under test:** `fix/map-tile-performance` (PR [#473](https://github.com/EnterpriseBT/portal-ai/pull/473) → `epic/map-tiles-at-scale`).

The headline is §1 — the per-zoom latency measurement, which is this ticket's merge gate and the deciding input for whether a cause-2 work-bound is needed. The correctness sections (§2–§5) confirm the join-drop didn't change which rows are visible.

## Preflight

### Environment

- [ ] `git checkout fix/map-tile-performance && git pull --ff-only`
- [ ] `npm install`
- [ ] **Apply migration 0084** — `cd apps/api && npm run db:migrate` (adds `deleted bigint` to every `er__*` table + backfills). Confirm `0084_wide-table-deleted-column` in the output.
- [ ] `npm run dev` boots cleanly (API :3001, web :3000). For the DB-level measurements you also need `DATABASE_URL` exported for `psql`/`db:studio`.

### Fixtures

- [ ] A **large polygon layer** (~283K rows, `colorBy` = zip, authored `initialView.zoom: 8`). The local `Smoke 3` instance (`8339d086…`, entity `dee94e06…`) has 397,960 rows and is ideal; app-dev has the original. §1's DB measurements run against whichever you point `psql` at.
- [ ] A connector instance you can trigger a sync on and delete a record from (for §3/§4).

### Reset between runs

- [ ] Read-only for §1–§2. §3 soft-deletes a record (re-syncable in §4). No global reset needed.

## §1 — Per-zoom tile latency under the 10s budget (AC 7 — the merge gate)

- [ ] With the map block open on the large polygon layer at its authored **zoom 8**, confirm the map **renders** (bins appear) rather than showing #449's "A map tile timed out" notice or a blank basemap. Pan/zoom across **z8–z11**; every tile lands.
- [ ] DB-level, run the aggregate tile query the service builds at a center tile for **each of z8, z9, z10, z11** (e.g. via `db:studio` or `psql`, `EXPLAIN (ANALYZE, BUFFERS)`), and record `Execution Time`:

  | map zoom | before (#450 baseline, with join) | after (this branch) | vs 10s |
  |---|---|---|---|
  | 8 | 55,864 ms (ticket) | ______ | ______ |
  | 9 | 69,090 ms | ______ | ______ |
  | 10 | 28,713 ms | ______ | ______ |
  | 11 | 10,083 ms | ______ | ______ |

- [ ] **Expected:** every z8–z11 tile is **under 10,000 ms**. Confirm the plan shows **no `entity_records` nested loop** — the join is gone.
- [ ] **Decision:** if any zoom is still ≥ 10s, cause 2 (bound the work) is needed → file/land the follow-up bound. If all are green, record here that cause 2 is **closed as unnecessary** (the join-drop sufficed).

**Recorded evidence (developer measurement, not a substitute for your app-dev walk).** Against the local **397,960-row** `Smoke 3` layer, the `cells` CTE (density variant — the local layer has no `colorBy` column), `EXPLAIN ANALYZE`, SLC center tile:

| map zoom | with join (baseline) | local filter (this branch) | speedup |
|---|---|---|---|
| 8 | 23,363 ms ✗ | **951 ms** ✓ | 24.6× |
| 9 | 13,368 ms ✗ | **964 ms** ✓ | 13.9× |
| 10 | 1,631 ms ✓ | **466 ms** ✓ | 3.5× |
| 11 | 1,169 ms ✓ | **340 ms** ✓ | 3.4× |

Every zoom lands well under the 10s budget with the join dropped → **cause 2 is closed as unnecessary** (no work-bound added). Numbers are machine-specific to the dev container and omit `colorBy mode()`; the join was the ~93% cost the ticket identified, and it is gone. Confirm on app-dev with the real zip choropleth layer.

## §2 — The join is gone; visible rows unchanged (AC 1)

- [ ] The large polygon map renders the same features it did at z12+ before, now also at z8–z11. No rows appeared or vanished versus a z14 raw view of the same area.
- [ ] (Optional, DB) Inspect a session view's definition or `EXPLAIN` for a portal-SQL query over the entity — confirm it reads `FROM "er__…" w WHERE … w."deleted" IS NULL` with **no** `JOIN entity_records`.

## §3 — Soft-delete marks the wide row (not physical delete) and hides it (AC 2, 3)

- [ ] Delete one record from the entity (UI delete, or a sync that reaps it). It disappears from the map and from any portal-SQL query over the entity.
- [ ] In `db:studio` on `er__<entityId>`, the deleted record's row is **still present** with **`deleted` set** (a timestamp, not gone). Its `entity_records` row also has `deleted` set.
- [ ] No `er__<entityId>` row exists with `deleted IS NULL` whose `entity_records` row is soft-deleted (the orphan class #441/#456; the reap self-heals it). Spot-check with:
  `SELECT count(*) FROM "er__<id>" w JOIN entity_records er ON er.id = w.entity_record_id WHERE er.deleted IS NOT NULL AND w.deleted IS NULL;` → **0** (after the reap/mark completes).

## §4 — Resurrection clears the tombstone (AC 4)

- [ ] Re-sync so a previously-deleted `source_id` returns (or re-add the same source row). The record reappears on the map.
- [ ] In `db:studio`, that row's `er__<id>."deleted"` is back to **NULL** (the upsert cleared it), and its `entity_records.deleted` is NULL.

## §5 — Migration backfilled every wide table (AC 5)

- [ ] `SELECT tablename FROM pg_tables WHERE tablename LIKE 'er\_\_%';` then confirm each has a `deleted` column: e.g. `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '<one er__ table>' AND column_name = 'deleted';` → `deleted | bigint`.
- [ ] For an entity that had soft-deleted records before this branch, `er__<id>."deleted"` now matches `entity_records.deleted` for those rows (backfill).

## §6 — Recorded (not manually smoke-tested)

- [ ] **Retention cascade (AC 6)** — wide tombstones are drained when the #442 purge hard-deletes their parent `entity_records` row (FK `ON DELETE CASCADE`). Verified by integration (`wide-table.repository.integration.test.ts` → "retention purge cascade-drains wide tombstones"); not manually walked (needs the retention window to elapse).
- [ ] **Build / type-check / lint + integration suite (AC 8)** — verified by CI on the PR; no local step.

## Sign-off

- [ ] Every section above verified
- [ ] ______ (date + name) — confirmed against my own running stack, with the §1 measurement recorded

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/entity/record ids):
