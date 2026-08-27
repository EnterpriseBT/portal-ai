# Aggregate map tile performance — Spec

Pins the contract for #450 cause 1: carry soft-delete state on the wide table so the session view drops the `entity_records` join (~93% of tile-query cost). Builds on [`MAP_TILE_PERFORMANCE.discovery.md`](./MAP_TILE_PERFORMANCE.discovery.md). Child of epic [#470](https://github.com/EnterpriseBT/portal-ai/issues/470); branches off / PRs into `epic/map-tiles-at-scale`.

## Key decisions (flag for review)

1. **`deleted` column on the wide table, atomic (Decision 1A).** A `deleted bigint` metadata column on every `er__<id>` table, set in the **same transaction** as the `entity_records` soft-delete, mirroring `entity_records.deleted`. The session view + `fetchProjectedRows` then filter `w.deleted IS NULL` locally — no join.
2. **The mark is self-healing on the reap path; atomic on the small paths (refined during slice 2).** The sync reap can soft-delete 100Ks of rows, and #440/#441/#456 deliberately split that from the cascade to avoid a giant transaction — so the reap does **not** wrap the wide mark in the soft-delete tx. Instead the reap runs a **server-side, chunked, self-healing** UPDATE: `UPDATE er__<id> w SET deleted = er.deleted FROM entity_records er WHERE er.id = w.entity_record_id AND er.deleted IS NOT NULL AND w.deleted IS NULL`. It marks *every* unmarked orphan each run (not just this pass's ids), so a failure converges on the next reap; no ids marshal through Node. Residual window: sub-second within the reap flow (vs. today's "until next reconcile"). The **small, bounded delete paths** (UI delete, layout) do wrap record-soft-delete + wide mark in one transaction (truly atomic — zero window). Either way the #441/#456 orphan class is gone: a present wide row whose record is deleted is always reconciled to `deleted` set.
3. **Cause 2 stays conditional; cause 3 is split (#472).** Measure per-zoom after cause 1; add a work-bound only if a zoom is still red. Choropleth low-zoom treatment is #472.
4. **Wide tombstones join the #442 retention purge.** Soft-deleted wide rows now persist, so the entity-record retention purge must also drain wide `deleted` rows.

## Scope

### In scope
- `deleted bigint` (nullable) column on every wide table; maintained by the reconciler and every soft-delete path.
- Every wide-row-removal path becomes an atomic `deleted` mark (UI delete, sync reap, layout commit/draft).
- Drop the `entity_records` join from `buildSessionViews` and `fetchProjectedRows`; filter `w.deleted IS NULL`.
- `upsertMany` clears `deleted` (resurrection) on a live upsert.
- Migration: ALTER every existing `er__*` table + backfill from `entity_records.deleted`.
- Extend the entity-record retention purge to wide tombstones.

### Out of scope
- Cause 2 work-bound (conditional; only if the smoke measurement shows a red zoom).
- Cause 3 choropleth treatment (#472).
- Any change to the raw (z ≥ 14) tile path.

## Surface

### Wide-table schema — `deleted` column
- **`apps/api/src/services/wide-table-reconciler.service.ts:185-193`** (`ensureTable`): add `"deleted" bigint` to the `CREATE TABLE IF NOT EXISTS`, and add an idempotent `ALTER TABLE <t> ADD COLUMN IF NOT EXISTS "deleted" bigint` after it (self-heals existing tables on next reconcile). Add a partial index `(<table>) WHERE deleted IS NOT NULL` **only if** the retention purge (below) needs it — decide at that slice, per #442.
- **`apps/api/src/services/wide-table-statement.cache.ts:90-96`** (`WIDE_TABLE_METADATA_COLUMNS`): append `"deleted"`. (This drives which columns are treated as metadata vs data by the reconciler diff — `deleted` must be metadata so it is never retired as a stray data column.)

### Soft-delete paths → atomic `deleted` mark
- **`apps/api/src/db/repositories/wide-table.repository.ts`**:
  - `deleteByEntityRecordIds` (`:677`) → `markDeletedByEntityRecordIds(connectorEntityId, ids, deletedAt, client)`: chunked `UPDATE <t> SET "deleted" = <deletedAt> WHERE "entity_record_id" IN (<chunk>) AND "deleted" IS NULL`. Throws on failure (request paths). Used by the small, bounded delete paths inside their tx.
  - New `markDeletedFromRecords(connectorEntityId, client)` — the **self-healing** reap mark: a chunked server-side `UPDATE <t> w SET deleted = er.deleted FROM entity_records er WHERE er.id = w.entity_record_id AND er.deleted IS NOT NULL AND w.deleted IS NULL` (loop until 0 rows), returning the marked count. Ids never leave Postgres; re-marks any prior orphan.
  - `markDeletedFromRecordsBestEffort` — wraps the above, returns `{ degraded }` (the reap must not fail the sync; #441/#456 posture kept).
  - `upsertMany` (`:217`) / `updatePartial` (`:504`): a live write sets `"deleted" = NULL` in the `ON CONFLICT DO UPDATE SET` (resurrection of a previously-marked `source_id`). Since `deleted` is not an inserted column, the SET is a literal `"deleted" = NULL`, added in the statement-cache builders (`wide-table-statement.cache.ts` `build` `:365` + `buildBulkInsertSql` `:282`).
- **Callers:**
  - Reap (best-effort, self-healing): `rest-api.adapter.ts:514`, `google-sheets.adapter.ts:165`, `microsoft-excel.adapter.ts:168` — replace `deleteByEntityRecordIdsBestEffort(entityId, reaped)` with `markDeletedFromRecordsBestEffort(entityId)`.
  - UI delete (atomic, in the record-soft-delete tx): `entity-record.router.ts:1360,:1482` — `markDeletedByEntityRecordIds`.
  - Layout: `layout-plan-draft.service.ts:551`, `layout-plan-commit.service.ts:845`.

### Session view + read path — drop the join
- **`apps/api/src/services/portal-sql.service.ts:212-218`** (`buildSessionViews`): remove `JOIN entity_records er …`; the view becomes `FROM "er__<id>" w WHERE w."organization_id" = '<org>' AND w."deleted" IS NULL`. Projection/hidden-column set unchanged.
- **`apps/api/src/db/repositories/wide-table.repository.ts:158-166`** (`fetchProjectedRows`): same — drop the join, filter `w."deleted" IS NULL`.

### Retention
- Extend the entity-record retention purge (`entity-record-retention-purge.processor.ts`, per #442) to hard-delete wide rows where `deleted IS NOT NULL` past the window — by `IN (<subquery>)`, ids server-side.

## Migration
`apps/api/drizzle/00NN_wide-table-deleted-column.sql` — **hand-written** (wide tables are dynamic, not in the drizzle schema, so `db:generate` cannot emit this). A `DO $$` loop over `information_schema.tables WHERE table_name LIKE 'er\_\_%' ESCAPE '\'`:
1. `ALTER TABLE <t> ADD COLUMN IF NOT EXISTS "deleted" bigint;`
2. Backfill: `UPDATE <t> w SET deleted = er.deleted FROM entity_records er WHERE er.id = w.entity_record_id AND er.deleted IS NOT NULL;` (closes any pre-existing best-effort-cascade orphan window — mostly a no-op since live rows dominate).

No seed.

## TDD test plan

### `apps/api` unit
- `wide-table-reconciler` (`__tests__/services/wide-table-reconciler.*.test.ts`): `ensureTable` emits `deleted bigint` + the `ADD COLUMN IF NOT EXISTS`; `deleted` is treated as metadata (not diffed/retired).
- `portal-map-tile.service.test.ts`: unchanged behavior (the aggregate/raw SQL builders don't change) — a regression guard that the tile SQL still consumes the view name.

### `apps/api` integration (real DB — the correctness core)
- `portal-sql.service.integration.test.ts`: a soft-deleted record is **excluded** from the session view **without** the join; a live record is included; projected columns identical to pre-change (minus deleted rows).
- `wide-table.repository.integration.test.ts`: `deleteByEntityRecordIds*` now leaves the row present with `deleted` set (not gone); `fetchProjectedRows` excludes it; `upsertMany` of the same `source_id` clears `deleted`.
- Reap integration (`entity-records-reap.integration.test.ts` / adapter smoke): after a watermark reap, wide rows for reaped records have `deleted` set in the same tx — **no orphan with `deleted IS NULL`** even if a chunk fails (the atomic-tx guarantee).
- Retention integration: a wide row with `deleted` older than the window is purged; a live row is not.

### Migration
Integration assertion that after the migration an existing `er__*` table has the `deleted` column and backfilled values match `entity_records.deleted`. (No standalone migration unit test — additive dynamic DDL.)

**Totals ≈ 12 cases** (3 unit + ~9 integration).

## Acceptance criteria
- [ ] The session view and `fetchProjectedRows` contain **no** `JOIN entity_records`; a soft-deleted record never appears in either.
- [ ] A soft-deleted record's wide row has `deleted` set (not physically removed) and shares the record's `deleted` timestamp.
- [ ] No code path can leave a wide row with `deleted IS NULL` whose record is soft-deleted (atomic mark) — the #441/#456 orphan class is gone.
- [ ] A re-synced (resurrected) `source_id` reads `deleted IS NULL` again.
- [ ] Every existing `er__*` table has a backfilled `deleted` column after migration.
- [ ] Wide tombstones are drained by the retention purge past the window.
- [ ] Per-zoom tile latency on the 283K layer is under the 10s budget at z8–z11 (smoke measurement); a cause-2 bound is added only if not.
- [ ] `build`, `type-check`, `lint` green; integration suite green.

## Risks & rollback
- **Fail mode is fail-safe on visibility:** the local filter `w.deleted IS NULL` plus the same-tx mark means a soft-deleted row is never shown; a bug that failed to set `deleted` would *hide* nothing wrongly (it would show a live row, which it is). Rollback: revert the branch; the additive `deleted` column can stay (unused) — the join-removal is the only behavioral revert.
- **Migration on many/large `er__*` tables:** the ALTER is metadata-only (fast); the backfill touches only soft-deleted rows (`er.deleted IS NOT NULL`), a small fraction. Runs in the standard migration step.
- **Deploy ordering:** the join-removal code must not ship before every wide table has the column. The migration (all existing tables) + `ensureTable` ADD IF NOT EXISTS (new tables) cover this; they deploy together with `db:migrate` ahead of traffic.

## Files touched
- `apps/api/src/services/wide-table-reconciler.service.ts` — column in `ensureTable`
- `apps/api/src/services/wide-table-statement.cache.ts` — metadata column list
- `apps/api/src/db/repositories/wide-table.repository.ts` — mark-deleted paths, `upsertMany`/`updatePartial`, `fetchProjectedRows`
- `apps/api/src/services/portal-sql.service.ts` — drop the view join
- `apps/api/src/adapters/{rest-api,google-sheets,microsoft-excel}/*.adapter.ts` — reap → atomic mark
- `apps/api/src/routes/entity-record.router.ts` — UI delete → mark
- `apps/api/src/services/layout-plan-{draft,commit}.service.ts` — mark
- `apps/api/src/queues/processors/entity-record-retention-purge.processor.ts` (+ repo) — drain wide tombstones
- `apps/api/drizzle/00NN_wide-table-deleted-column.sql` — migration + backfill
- Tests as above

## Next step
`docs/MAP_TILE_PERFORMANCE.plan.md` (`/plan 450`). ~5 slices: (1) column + reconciler + migration/backfill (no behavior change); (2) soft-delete paths → atomic mark + `upsertMany` resurrection; (3) drop the join in view + read path; (4) retention purge extension; (5) measure + conditional cause-2 bound. Each an independently testable commit; child PR targets `epic/map-tiles-at-scale`.
