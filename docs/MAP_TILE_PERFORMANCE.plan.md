# Aggregate map tile performance — Plan

**Implements #450 cause 1 TDD-sequenced: add an atomic `deleted` column to the wide table, mark instead of delete on every soft-delete path, then drop the `entity_records` join — schema first, write-path next, the join-drop only once both are in place.**

Spec: `docs/MAP_TILE_PERFORMANCE.spec.md`. Discovery: `docs/MAP_TILE_PERFORMANCE.discovery.md`. Issue: #450 (child of epic #470, `epic/map-tiles-at-scale`). Builds on #449 (tile observability, already merged into the epic) and #440's wide-table write path.

5 slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `fix/map-tile-performance`**, whose PR targets `epic/map-tiles-at-scale` — one ticket, one child PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — Slice 1 adds the column with **no behavior change** (join stays, deletes still delete), so the tree is green before anything depends on it. Slice 2 converts every removal path to an atomic mark while the join still hides marked rows, so correctness holds mid-flight. Slice 3 drops the join — safe only once the column (1) exists and every path marks it (2). Slice 4 governs the tombstones slice 2 starts producing. Slice 5 is the measurement gate that decides whether cause 2 is needed at all.

---

## Slice 1 — `deleted` column on the wide table (no behavior change)

Add the column to new tables (`ensureTable`), self-heal existing ones (`ADD COLUMN IF NOT EXISTS`), register it as metadata, and migrate + backfill every existing `er__*` table. Nothing reads or writes it yet.

**Files**
- Edit: `apps/api/src/services/wide-table-reconciler.service.ts:185-193` — `"deleted" bigint` in the `CREATE`, plus `ALTER TABLE <t> ADD COLUMN IF NOT EXISTS "deleted" bigint`.
- Edit: `apps/api/src/services/wide-table-statement.cache.ts:90-96` — append `"deleted"` to `WIDE_TABLE_METADATA_COLUMNS`.
- New: `apps/api/drizzle/0084_wide-table-deleted-column.sql` — scaffold via `npm run db:generate -- --custom --name wide-table-deleted-column` (custom migration → file + journal entry), then hand-fill the `DO $$` loop over `er\_\_%` tables: `ADD COLUMN IF NOT EXISTS` + backfill `SET deleted = er.deleted FROM entity_records er WHERE er.id = w.entity_record_id AND er.deleted IS NOT NULL`.

**Steps**
1. **Tests (spec: reconciler unit + migration integration).** Reconciler unit: `ensureTable` DDL includes `deleted bigint` and the `ADD COLUMN IF NOT EXISTS`; `deleted` is treated as metadata (not returned by the data-column diff, never retired). Migration integration: after migrate, an existing `er__*` table has `deleted` and backfilled values equal `entity_records.deleted`. Run; fail.
2. **Implement** the reconciler edits + metadata list + migration. Green.
3. Lint + type-check.

**Done when:** the column exists on new + existing tables, backfill matches, and **no read/write path references it yet** — the join and the physical deletes are untouched, all existing tests still green.

**Risk:** the metadata-list change must land with the reconciler so `deleted` isn't diffed as a stray data column and retired — same commit.

---

## Slice 2 — soft-delete paths mark instead of delete (atomic)

Every wide-row removal becomes `SET deleted = <recordDeletedAt>` in the same transaction as the `entity_records` soft-delete; a live upsert clears `deleted`. The join still hides marked rows, so the view stays correct through this slice.

**Files**
- Edit: `apps/api/src/db/repositories/wide-table.repository.ts` — `deleteByEntityRecordIds` (`:677`) + `deleteByEntityRecordIdsBestEffort` (`:646`) become chunked `UPDATE … SET deleted = ? WHERE entity_record_id = ANY(?) AND deleted IS NULL` (gain a `deletedAt` param); new `markDeletedByRecordSubquery(...)` (server-side UPDATE by record-id subquery, #442 pattern); `upsertMany` (`:217`) / `updatePartial` (`:504`) set `deleted = NULL` on a live write.
- Edit: reap callers `apps/api/src/adapters/{rest-api:514,google-sheets:165,microsoft-excel:168}/*.adapter.ts` — fold the wide mark into the watermark soft-delete transaction via `markDeletedByRecordSubquery`.
- Edit: `apps/api/src/routes/entity-record.router.ts:1360,:1482` (UI delete) and `apps/api/src/services/layout-plan-{draft:551,commit:845}.service.ts` — mark in the record-soft-delete tx.

**Steps**
1. **Tests (spec: repo + reap integration).** Update existing assertions that expect the row *gone* after delete/reap to expect it *present with `deleted` set*. New: `deleteByEntityRecordIds*` leaves the row with `deleted = <ts>`; `upsertMany` of the same `source_id` clears `deleted`; a reap marks wide rows in the **same tx** as the record soft-delete — no wide row with `deleted IS NULL` whose record is soft-deleted, even on a failing chunk. Run; fail.
2. **Implement** the repo mark methods + resurrection + caller conversions. Green.
3. Lint + type-check.

**Done when:** every path leaves a soft-deleted record's wide row present with `deleted` set atomically; the #441/#456 orphan class cannot occur; the session view still excludes them (via the still-present join).

**Risk:** the reap atomicity is the load-bearing change — the wide mark must share the watermark soft-delete's transaction. If a path genuinely can't be same-tx, that row's marking is best-effort and Slice 3's local filter would expose it on failure; verify each caller is same-tx before Slice 3.

---

## Slice 3 — drop the `entity_records` join

Replace the join with the local `w.deleted IS NULL` filter in both the session view and the repository read path. This is the performance win.

**Files**
- Edit: `apps/api/src/services/portal-sql.service.ts:212-218` — remove `JOIN entity_records er …`; `WHERE w.organization_id = '<org>' AND w.deleted IS NULL`.
- Edit: `apps/api/src/db/repositories/wide-table.repository.ts:158-166` (`fetchProjectedRows`) — same.

**Steps**
1. **Tests (spec: portal-sql integration).** A soft-deleted record is excluded from the session view **with no join present**; a live record is included; projected columns identical to pre-change. `fetchProjectedRows` excludes soft-deleted rows. Assert the generated view SQL contains no `entity_records` join. Run; fail (the view still joins).
2. **Implement** the join removal in both sites. Green.
3. Lint + type-check.

**Done when:** neither the view DDL nor `fetchProjectedRows` references `entity_records`; soft-deleted rows are excluded by the local filter; correctness rests on Slice 2's atomic mark.

**Risk:** none beyond Slice 2's atomicity (already gated). Correctness is asserted, not assumed.

---

## Slice 4 — retention purge for wide tombstones

Marked wide rows now persist; extend the entity-record retention purge to drain them past the window.

**Files**
- Edit: `apps/api/src/queues/processors/entity-record-retention-purge.processor.ts` (+ the wide-table repo) — hard-delete wide rows `WHERE deleted IS NOT NULL` older than the window, by `IN (<subquery>)` (ids server-side). Add the partial index `(<t>) WHERE deleted IS NOT NULL` in `ensureTable` **iff** the purge scan needs it (per #442's "index the tombstone side" rule).

**Steps**
1. **Tests (spec: retention integration).** A wide row with `deleted` older than the window is purged; a live (`deleted IS NULL`) row and a recently-marked one are not. Run; fail.
2. **Implement** the purge extension (+ index if the plan/#442 pattern calls for it). Green.
3. Lint + type-check.

**Done when:** wide tombstones are governed by the same retention window as `entity_records` tombstones.

**Risk:** if the index is added, it must go in `ensureTable` (dynamic tables) + the migration for existing tables — mirror Slice 1's dual-path.

---

## Slice 5 — measure, and bound the work only if needed (cause 2)

The join is gone; measure per-zoom on the 283K layer. Add a cause-2 work-bound **only if** a zoom is still over budget.

**Files**
- Edit (conditional): `apps/api/src/services/portal-map-tile.service.ts:362-396` (`buildAggregateTileSql`) — a work-bound (e.g. sample/aggregate-by-colorBy) **only if** measurement shows red.
- Edit: `docs/MAP_TILE_PERFORMANCE.smoke.md` — record the per-zoom measurement (the acceptance evidence).

**Steps**
1. **Measure** per-zoom z8–z11 on the 283K layer (smoke, against app-dev/prod-sized data — plan guards aren't asserted in tests per `CLAUDE.md` → #442). Record numbers.
2. **If any zoom > 10s:** write failing tests for the chosen bound (`portal-map-tile.service.test.ts`), implement the smallest bound, green. **If all green:** no code — the measurement is the deliverable and cause 2 is closed as unnecessary (recorded).
3. Lint + type-check (if code changed).

**Done when:** every z8–z11 tile is under budget on the 283K layer, with the measurement recorded — a bound added only if the join-drop alone didn't suffice.

**Risk:** don't assert plan choice in tests (fixtures are ~2K rows; #442's recorded lesson). Correctness in tests, latency as a recorded measurement.

---

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| 1 | `deleted` column (reconciler + metadata + migration/backfill), no behavior change | reconciler unit + migration integration green; existing tests untouched |
| 2 | every removal path → atomic mark; upsert resurrection | repo + reap integration green (row present with `deleted`, no orphan) |
| 3 | drop the join in view + `fetchProjectedRows` | portal-sql integration green (excluded, no join in SQL) |
| 4 | retention purge drains wide tombstones | retention integration green |
| 5 | measure; conditional cause-2 bound | z8–z11 under budget (recorded); tests only if a bound lands |

## Cross-slice notes

- **Migration ordering & deploy safety.** The join-drop (Slice 3) must not reach traffic before every wide table has the column — Slice 1's migration (existing tables) + `ensureTable` ADD IF NOT EXISTS (new tables) guarantee this, and all slices ship in one PR/deploy behind `db:migrate`.
- **Tombstones exist between Slice 2 and Slice 4.** Within the PR that's fine (undeployed); the PR must not be split such that Slice 2 merges without Slice 4.
- **The reap rework touches #460/#463/#464 territory.** Slice 2 folds the wide mark into the watermark soft-delete tx; re-run the sync-lock/reap integration tests to confirm no regression to those guarantees.
- **No frontend/doc-capability change** in #450 — the choropleth client work is #472. No user-facing copy or CLAUDE.md convention changes here.

## Next step

After discovery + spec + plan are confirmed, implementation begins on `fix/map-tile-performance`, Slice 1 first, tests-first, one commit per slice; the child PR targets `epic/map-tiles-at-scale`.
