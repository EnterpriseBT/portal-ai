# Purge soft-deleted entity records — Condensed design (#442)

**Issue:** [EnterpriseBT/portal-ai#442](https://github.com/EnterpriseBT/portal-ai/issues/442) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc). Epic child of [#444](https://github.com/EnterpriseBT/portal-ai/issues/444).

**Why.** `entity_records` rows are only ever soft-deleted and nothing purges them, so the table grows monotonically. The cost is not disk: tombstones count toward `reltuples`, which sets the autoanalyze threshold at `50 + 0.1 × reltuples`, so a large table spends most of a sync on stale statistics — and stale statistics are what made the per-record lookup mis-plan at 36 ms/record before #440 batched it. Tombstones raise the threshold → syncs run mis-planned → longer runs widen the window for the transient failure #435 fixed → a failed retry adds another ~400K tombstones. Single package: `apps/api`.

## Measured on this box (2026-08-25, after the #435/#439/#436/#440 smoke work)

| | Rows | Share |
|---|---|---|
| `entity_records` total | 5,115,688 | — |
| tombstoned (`deleted IS NOT NULL`) | 3,922,620 | **77%** |
| ├─ whose `connector_entity` is *also* deleted | 2,330,780 | 59% of tombstones |
| └─ whose `connector_entity` is still live | 1,591,840 | 41% of tombstones |
| `pg_total_relation_size` | 8,003 MB | — |

The ticket's snapshot was 2.7M / 71% / 4,836 MB; my own smoke runs for #440 are what grew it since. The split in the middle two rows is the finding the design turns on.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Watermark reap — category **(a)** | `entity-records.repository.ts:295` `softDeleteBeforeWatermark` | 4 callers: `rest-api`, `google-sheets`, `microsoft-excel` adapters + `layout-plan-draft.service.ts:541` |
| Entity/instance delete — category **(b)** | `connector-instance.router.ts:1309`, `connector-entity-validation.service.ts:93` `softDeleteByConnectorEntityIds` | Also soft-deletes the parent `connector_entities` (`:1329`) |
| User delete — category **(c)** | `entity-record.router.ts:1354` (one record), `:1477` (all records for an entity) | `:1477` is #451's route |
| Wide table row | `wide-table-reconciler.service.ts:186` | PK `entity_record_id` **`REFERENCES entity_records(id) ON DELETE CASCADE`** |
| Wide-side reap | `wide-table.repository.ts:622` `softDeleteByEntityRecordIds` | Misnamed — it issues `DELETE FROM`, chunked at 500 (#436) |
| Instance delete, wide side | `connector-instance.router.ts:1326` | `dropTable` — drops `er__<id>` outright (#423) |
| Retention precedent | `queues/processors/ledger-retention-purge.processor.ts` | Daily 04:00 UTC scheduler, `PURGE_BATCH_SIZE = 10_000`, batch-drain loop, summary as BullMQ return value |
| Maintenance host | `maintenance.queue.ts`, `maintenance.worker.ts` | Off the user-facing jobs table by design: no job row, no SSE, no entity locks |

### Three findings that change the ticket's shape

**1. Deliverable 3 is already done by the schema, not by application code.** The ticket asks to "cascade the purge to the per-entity wide table". The wide table's PK is an `ON DELETE CASCADE` FK to `entity_records.id`, so a hard `DELETE` reclaims the `er__<id>` row automatically — #423's comment at `connector-instance.router.ts:1315` says so from the other direction, that the cascade "never fires" precisely *because* that path is an `UPDATE`. This needs a **test proving the cascade fires**, not a second code path. It does affect batch sizing: each batch does wide-table work too.

**2. There are effectively no wide-table tombstones to purge.** `softDeleteByEntityRecordIds` hard-deletes despite its name, and instance delete drops the table outright. The entire 3.92M backlog is `entity_records` alone — consistent with the 8 GB being dominated by the `data` JSONB.

**3. The purge predicate has no index, and the drain degrades as it runs.** Every index on `entity_records` is partial `WHERE deleted IS NULL`; the tombstone side is unindexed:

```
WHERE deleted IS NOT NULL AND deleted < <cutoff> LIMIT 10000
  → Seq Scan, 29 ms                    (first batch: matches are dense)
  → Parallel Seq Scan, 1,664 ms        (tail batch: matches exhausted,
     Rows Removed by Filter: 1,705,229   LIMIT never satisfied, full 5.1M scan)
```

A `LIMIT`-batched loop over an unindexed predicate gets *slower* as it drains, because surviving matches thin out and each batch scans further for its 10,000. This is the same shape as #440's per-record lookup: the right predicate with the wrong index is still a scan.

### One thing the ticket assumes that isn't true yet

The ticket keeps category (a) because "the reaper's tombstones are what make a bad sync recoverable." **No restore path exists** — nothing clears `deleted` back to null on an entity record, and since the wide row was hard-deleted at reap time, recovery means hand SQL *plus* re-projection. Not an argument for dropping tombstones (hand recovery is real — the #439 investigation used it), but an argument against a long window justified by a feature that doesn't exist. Recorded so the window is chosen, not inherited.

## Decision 1 — retention rule: per-category, discriminated by the parent entity

The ticket asks whether the rule differs across (a) reap, (b) entity/instance delete, (c) user delete.

- **A — one window for everything.** Simplest. But it makes 2.33M rows that *nothing can ever reference again* wait out a window designed to protect recoverable ones.
- **B — per-category windows, requiring a new `deleted_reason` column.** Precise, but a schema change plus a backfill that cannot be reconstructed for existing rows (nothing recorded why they died).
- **C — two windows, discriminated by whether the parent `connector_entity` is deleted.** ✅ **Chosen.** Category (b) is exactly "parent entity is soft-deleted" — derivable today by a join, no new column, no backfill, correct for the 2.33M rows already on disk.

Categories (a) and (c) are *not* distinguished from each other, and deliberately so: both leave a live parent, both are plausibly recoverable, and the only way to separate them would be option B's uninferable column. The rule:

| Category | Discriminator | Window |
|---|---|---|
| (b) parent entity deleted | `connector_entities.deleted IS NOT NULL` | `ENTITY_RECORD_ORPHAN_RETENTION_DAYS`, default **7** |
| (a) reap + (c) user delete | parent entity live | `ENTITY_RECORD_RETENTION_DAYS`, default **30** |

Both env-configurable, following `LEDGER_RETENTION_MONTHS`. Not per-org and not operator-settable at runtime — that is the surface escalation the ticket's sizing warned about, and no caller wants it.

Neither window is zero. A same-day purge would destroy the evidence trail on the exact failure this epic exists to fix, and 7 days costs nothing but disk.

## Decision 2 — where it runs: the existing maintenance queue

`ledgerRetentionPurgeProcessor` is a direct precedent — daily scheduler, batch-drain loop, summary as the BullMQ return value, visible at `GET /api/admin/maintenance`, deliberately off the jobs table (no job row, no SSE, no entity locks). A second processor on the same queue with `concurrency: 1` adds no surface.

**This is why the sizing stays `condensed`.** The ticket said to escalate to `full` if the answer needed "a scheduled maintenance job rather than a fixed rule, since that adds a surface" — but the surface already exists and is already documented and admin-visible. What would escalate it is per-org configurable retention, which Decision 1 rejects.

The scheduler runs at **04:30 UTC**, half an hour after the ledger purge, so the two never contend for the same worker slot.

## Decision 3 — index the tombstone side

```sql
CREATE INDEX CONCURRENTLY "entity_records_deleted_purge_idx"
  ON "entity_records" USING btree ("deleted") WHERE deleted IS NOT NULL;
```

Partial on the tombstone side — the mirror of every other index here, covering only the 77% the purge reads.

**Risk resolved in slice 1: `CONCURRENTLY` is not available at all.** `PgDialect.migrate` wraps *all* pending migrations in one `session.transaction`, and `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block — so this is a hard block, not an inconvenience. Went with the plain `CREATE INDEX` and measured what the fallback costs: **3.4 s** of `ACCESS EXCLUSIVE` to build over 3.9M tombstones on the 8 GB table. Acceptable at deploy time; recorded in the migration with the revisit condition (another order of magnitude → build it as an operator step outside the migration).

**What the index does and doesn't buy** (measured, both directions stated):

```
tail batch (matches exhausted)   1,664 ms  →  0.089 ms   Index Scan
dense head (77% tombstoned)         29 ms  →     29 ms   still Seq Scan
```

The head is deliberately not improved — with most rows eligible, a seq scan that finds 10,000 matches immediately beats an index scan plus 10,000 heap fetches, and the planner correctly keeps choosing it. The index exists for the tail, which is where the drain spent its time.

## Decision 4 — instance delete keeps tombstoning

The ticket asks whether deleting an instance should hard-delete instead. **No.** A 400K-row `DELETE` inside the instance-delete transaction — which already drops N wide tables in the same `tx` — turns a UI click into a multi-minute lock, and the FK cascade makes it strictly more work than the current `UPDATE`. Decision 1's 7-day orphan window reclaims the same rows off the request path, chunked, with no route change.

## Plan — 3 slices

### Slice 1 — repository seam + the index

**Files**
- Edit `apps/api/src/db/schema/entity-records.table.ts` — add the partial index.
- New `apps/api/drizzle/00XX_entity-records-deleted-purge-index.sql` — `npm run db:generate -- --name entity-records-deleted-purge-index`, then hand-edit for `CONCURRENTLY`.
- Edit `apps/api/src/db/repositories/entity-records.repository.ts` — add `purgeTombstonedBefore(cutoffMs, batchSize, scope: "orphan" | "live", client?): Promise<number>`, modelled on `toolUsageLedger.deleteOlderThan` (select-ids-then-delete, `LIMIT batchSize`, returns the row count). The `scope` arg selects the `EXISTS`/`NOT EXISTS` join on `connector_entities.deleted`.

**Tests** — `apps/api/src/__tests__/__integration__/db/repositories/entity-records-purge.integration.test.ts`
1. `scope: "orphan"` deletes only tombstones whose parent entity is deleted.
2. `scope: "live"` deletes only tombstones whose parent entity is live.
3. Neither scope ever touches a row with `deleted IS NULL` — asserted by before/after counts on a mixed entity (ticket AC 3).
4. Respects `batchSize` — 25 eligible rows, `batchSize: 10` → returns 10.
5. Returns 0 on an empty backlog (the loop's termination condition).
6. **The FK cascade fires**: seed a wide-table row via the reconciler, purge its `entity_records` row, assert the `er__<id>` row is gone (ticket AC 1, finding 1).
7. A row tombstoned *after* the cutoff survives.

### Slice 2 — the processor + scheduler

**Files**
- New `apps/api/src/queues/processors/entity-record-retention-purge.processor.ts` — `PURGE_BATCH_SIZE = 10_000`, `{batchSize?, now?}` test seams, drain loop per scope, summary `{purgedOrphan, purgedLive, batches, orphanCutoff, liveCutoff}`.
- Edit `apps/api/src/queues/maintenance.queue.ts` — export `ENTITY_RECORD_RETENTION_PURGE_JOB`, register at `30 4 * * *`.
- Edit `apps/api/src/queues/maintenance.worker.ts` — dispatch the new job name.
- Edit `apps/api/src/environment.ts` — `ENTITY_RECORD_RETENTION_DAYS` (30), `ENTITY_RECORD_ORPHAN_RETENTION_DAYS` (7).

**Tests** — `apps/api/src/__tests__/queues/processors/entity-record-retention-purge.processor.test.ts` (unit, repo mocked)
1. Drains until the repo returns 0; summary counts match.
2. Two cutoffs computed from the two env windows and the injected `now`.
3. Both scopes run even when one returns 0 immediately.
4. Batch count reflects the loop, not the row count.
5. `maintenance.worker` routes the new job name; an unknown name still throws.

### Slice 3 — document the rule

The ticket's AC 4 requires the rule to live where the next contributor finds it.

**Files**
- Edit `CLAUDE.md` → "Indexing and ordering a table that will grow (#433)" — a short paragraph: tombstones count toward `reltuples` and therefore the autoanalyze threshold, so a soft-deleted table needs a retention policy, and the tombstone side needs its own partial index because every other index excludes it.
- Edit `apps/api/README.md` — the two windows, the discriminator, and the schedule.

**Tests** — none; prose. Covered by the smoke walk below.

## Smoke (manual, against your dev stack)

Preflight: `git checkout chore/purge-soft-deleted-entity-records && npm install && cd apps/api && npm run db:migrate` (one new index migration), then `npm run dev`. **Check the API process actually restarted on this branch** — a stale orphan served pre-branch code twice during #436/#440.

**Preflight result.** The stale-process check earned its place: the API was answering `/api/health` with a worker started at 17:29, before all three code commits (18:30, 19:01, 19:11). It had none of this branch's code. Restarted before step 3.

1. [x] **Baseline.** Measured:

   ```
   total          5,115,688     disk  8,029 MB
   live           1,193,068
   tombstoned     3,922,620
     orphan       2,330,780
     live-parent  1,591,840
   ```

2. [x] **The index is used.** Confirmed on both the synthetic tail case and the statement the purge actually issues:

   ```
   tail case (matches nothing)      Index Scan  0.034 ms   (was 1,664 ms, Parallel Seq Scan)
   real orphan-scope batch, LIMIT 10000
                                    Index Scan  16.9 ms
   ```

   The `connector_entities` side of the `EXISTS` is a seq scan on a 20-row table, which is correct and not worth an index.

3. **Run it out of schedule.** Enqueue the job by name on the maintenance queue (don't wait for 04:30). Watch `pino` for start/finish and read the summary at `GET /api/admin/maintenance` → `recentRuns[].returnvalue`.

4. **Only *eligible* tombstones go, and no live record does.** **Corrected during the walk — the original expectation here was wrong.** It assumed the 2.33M orphans were "far older than 7 days". They are not: they were produced by the #435/#439/#440 smoke runs over the preceding week, and their ages are 0.2–5.8 days. Measured eligibility under the default windows:

   ```
   orphan, deleted < now-7d      12,340
   live-parent, deleted < now-30d     0
   ```

   So a default-window run purges **12,340 rows and nothing else**. That is the correct expectation, and the live count (1,193,068) must not move. Expecting 2.33M would have failed the step for the wrong reason and hidden whether the purge worked at all.

   **What this step therefore does and does not prove.** It proves selection, the cascade, and idempotence against a real 8 GB table. It does *not* exercise the multi-batch drain at volume, because the data isn't old enough. Draining the full 2.33M requires overriding `ENTITY_RECORD_ORPHAN_RETENTION_DAYS` — and that is a deliberate decision, not a step to take casually: those tombstones are the evidence trail for this epic's investigations, and #441, #451 and #456 are still open against it. Recorded as a **conscious gap** rather than silently skipped or silently forced.
5. **Wide tables shrank with it.** For an entity that had orphaned tombstones, confirm the `er__<id>` row count dropped in step with them — the FK cascade, not application code.
6. **Disk is reclaimed as reusable space.** `pg_total_relation_size` will *not* drop much without a `VACUUM FULL`; confirm `n_dead_tup` rose and autovacuum reclaimed it for reuse. State the distinction in the result rather than reporting "disk didn't shrink" as a failure.
7. **A sync afterwards plans correctly.** Re-sync one connector and confirm throughput sits in the fast band (#440 measured 485 rec/s fresh vs 92 stale), which is the second-order effect this ticket exists to buy.
8. **Idempotent.** Run it twice; the second run reports `purged: 0, batches: 0` and changes nothing.

## Out of scope

- Changing soft delete to hard delete on the sync path — the reap tombstone is the recovery trail (ticket's own out-of-scope).
- A restore/undelete feature. The absence of one is recorded above as context for the window, not as work here.
- Per-org or runtime-configurable retention — the surface escalation Decision 1 rejects.
- `VACUUM FULL` / `pg_repack` to return the 8 GB to the filesystem. Autovacuum makes it reusable; returning it needs an exclusive lock and is an operator action, not a scheduled job.
- Synthetic source-id churn, the fastest generator of these volumes — fixed by #439, already shipped.
- #451's delete-all route, which produces category (c) at volume.
