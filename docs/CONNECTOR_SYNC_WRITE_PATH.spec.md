# Connector sync write path — Spec

Pins the contract for batching the REST API sync loop's record writes. Discovery: `docs/CONNECTOR_SYNC_WRITE_PATH.discovery.md`. Issue: [#440](https://github.com/EnterpriseBT/portal-ai/issues/440), child of epic [#444](https://github.com/EnterpriseBT/portal-ai/issues/444).

## Key decisions (flag for review)

1. **Scoped to `rest-api` only.** Sheets and Excel delegate to `LayoutPlanCommitService.commit` → `writeRecords` and are already batched. No shared abstraction; no adapter migration.
2. **The pre-read stays, batched.** One `findBySourceIds` per batch. A 1000-id `= ANY(…)` measured 1.108 ms/1000 with both columns in the `Index Cond`; folding the checksum into `ON CONFLICT` was rejected as risking the counts contract for one round-trip per thousand records.
3. **Modelled on `flushBatch`, not `writeRecords`.** The two differ on resurrection: `writeRecords` passes `includeDeleted: true` (`layout-plan-commit.service.ts:645`) and calls `bulkResurrect` (`:806`); `flushBatch` does not, and neither does today's `upsertRecord`. **Resurrection is not introduced** — that would be a silent behaviour change.
4. **The pre-read projects a narrow column set.** Today's `findBySourceIds` does `.select()`, pulling the whole row including `data` jsonb and geometry — ~1 MB per 1000-row batch to read two fields.
5. **Unchanged rows do no work beyond the watermark bump.** No mirror re-upsert, no geometry re-audit. Missing wide rows are found by one anti-join per batch instead of by blind re-upsert.
6. **Per-batch transaction**, matching `flushBatch`. Not one transaction per run.
7. **Counts are contract.** `created` / `updated` / `unchanged` / `deleted` reach an API response and an SSE consumer; a regression test pins them byte-for-byte against the current path.

## Scope

### In scope

- `adapters/rest-api/rest-api.adapter.ts` — replace the per-record `upsertRecord` call with a batched writer in both the streaming and buffered branches of `syncOneEndpoint`.
- A narrow-projection variant of the pre-read on `entity-records.repository.ts`.
- The anti-join backfill for wide rows missing against live records.

### Out of scope

- Google Sheets / Microsoft Excel adapters — already batched.
- Consolidating `flushBatch` and `writeRecords` into one writer — filed as a follow-up refactor.
- `softDeleteBeforeWatermark`'s unbounded `.returning()` — same shape as #451.
- Progress reporting semantics — #441. `reportPage` keeps ticking per page.
- Resurrection of soft-deleted rows — see Key decision 3.
- Retention / purging — #442.

## Surface

### `adapters/rest-api/rest-api.adapter.ts` — the batched writer

Replaces `upsertRecord` (`:588`). `UpsertContext` (`:537`) is retained unchanged as the writer's constructor input, including `generationKey` (#439) and the `counts` bag.

```ts
/** Records buffered but not yet flushed. Mirrors BULK_CHUNK_SIZE. */
export const SYNC_WRITE_BATCH_SIZE = 1000;

export interface SyncRecordWriter {
  /** Buffer one upstream record. Flushes when the buffer reaches the batch size. */
  add(record: unknown): Promise<void>;
  /** Flush any remainder. MUST be called before the watermark reap. */
  flush(): Promise<void>;
}

export function createSyncRecordWriter(ctx: UpsertContext): SyncRecordWriter;
```

Behaviour contract:

- `add` is non-object-tolerant exactly as `upsertRecord` is today: a `null`/non-object record bumps `ctx.counts.recordIndex` and returns without buffering, so synthetic source ids stay aligned across the array.
- `add` derives `sourceId` via `deriveSourceId(recordObj, idField, ctx.generationKey, ctx.counts.recordIndex)` and `checksum` via `checksumRecord(recordObj)`, both unchanged, at buffer time — not at flush time — so `recordIndex` ordering is identical to today's.
- `flush` is idempotent on an empty buffer.
- Mutates `ctx.counts` in place. No return value. Same as today.

### Per-flush sequence

1. `findBySourceIdsForSync(entityId, sourceIds)` — one query, narrow projection.
2. Build `Map<sourceId, {id, checksum, created, createdBy}>`.
3. Classify in memory: `prior && prior.checksum === checksum` → **unchanged**; `prior` → **updated**; else → **created**.
4. If any changed rows: one `DbService.transaction` containing
   `upsertManyBySourceId(rows, tx)` then `wideTable.upsertMany(entityId, projectedRows, tx)`.
5. If any unchanged rows: `bulkUpdateSyncedAt(unchangedIds, ctx.runStartedAt)`.
6. If any unchanged rows **and** `ctx.wideProjection`: `selectMissingWideRowIds(entityId, unchangedIds)` (anti-join) and mirror only those.

### `db/repositories/entity-records.repository.ts` — narrow pre-read

Added alongside `findBySourceIds` (`:353`), which keeps its current `.select()` signature for existing callers.

```ts
/**
 * Change-detection projection for the sync writer. Returns only the columns
 * the writer needs, so a 1000-row batch does not drag the `data` jsonb (and
 * any geometry) across the wire to read two fields.
 *
 * Soft-deleted rows are excluded — the REST sync path does not resurrect
 * (see the spec's Key decision 3).
 */
async findBySourceIdsForSync(
  connectorEntityId: string,
  sourceIds: string[],
  client?: DbClient
): Promise<Array<Pick<EntityRecordSelect, "id" | "sourceId" | "checksum" | "created" | "createdBy">>>
```

Chunks at `BULK_CHUNK_SIZE` (`:60`) like its sibling.

### `db/repositories/wide-table.repository.ts` — anti-join backfill

```ts
/**
 * Of the given live `entity_records` ids, which have no row in `er__<id>`.
 * Replaces the sync loop's blind per-record re-upsert, which paid ~398,000
 * speculative upserts per sync to catch a handful of gaps.
 */
async selectMissingWideRowIds(
  connectorEntityId: string,
  entityRecordIds: ReadonlyArray<string>,
  client?: DbClient
): Promise<string[]>
```

Chunked at `WIDE_TABLE_CHUNK_SIZE` (`:61`) — same reason as #436.

### Unchanged contracts

- `wideTable.upsertMany` return shape `{ repaired: number; rejected: Array<{sourceId, reason}> }` (`:40-42`) is consumed as today; geometry tallies accumulate into `ctx.counts` with the existing `GEOMETRY_REJECTED_SAMPLE_CAP = 20` (`:575`).

### Changed contract — the `geometry` block on an all-unchanged sync

`SyncInstanceResult.geometry` is emitted only when `repaired > 0 || rejected > 0` (`rest-api.adapter.ts:325`). Because the unchanged path no longer writes wide rows, it no longer audits their geometry, so **an all-unchanged re-sync now returns no `geometry` block at all.**

This is intended. `repaired` counts rows whose invalid geometry `ST_MakeValid` fixed **on write** (`wide-table.repository.ts:32-38`). The pre-change path re-mirrored every unchanged record, so the same geometries were re-repaired and re-reported on every run despite the wide table already holding the repaired value — a number describing work that was pure waste. Writing nothing means repairing nothing.

**It is nonetheless user-visible**: the geometry summary disappears from re-sync results reaching the API response and the SSE consumer. `recordCounts` is unaffected and stays byte-identical, which is what AC 2 pins. A sync that actually writes rows — a full replacement, or any run with real changes — still reports the block normally.

Found during the #440 smoke walk, where the walkthrough had predicted the old value; the prediction was wrong, not the behaviour.
- The mirror stays **best-effort**: a failed wide-table write logs `rest-api.sync.wide-table-mirror-failed` and does not fail the sync (`:787-799`). Batching widens the granularity from one record to one batch — stated explicitly, and the log gains the batch's `sourceId` range instead of a single `sourceId`.
- `syncOneEndpoint`'s watermark reap and `reportPage` calls are untouched.

## Migration

**None.** No schema change — no new table, column, index or constraint. No seed change.

## TDD test plan

### `apps/api` unit — `__tests__/adapters/rest-api/sync-record-writer.test.ts` (new)

- buffers below the batch size and issues no query until `flush`
- flushes automatically at `SYNC_WRITE_BATCH_SIZE`
- `flush` on an empty buffer issues nothing
- non-object record bumps `recordIndex` without buffering (source-id alignment preserved)
- classification: unchanged / updated / created from one `existingMap`
- unchanged rows get `bulkUpdateSyncedAt` and **no** `upsertManyBySourceId`
- unchanged rows get **no** `wideTable.upsertMany` unless the anti-join reports them missing
- changed rows go through one transaction: `upsertManyBySourceId` then `wideTable.upsertMany`
- `deriveSourceId` receives `ctx.generationKey` (guards #439 from regressing)
- a wide-table failure is logged and does not throw (best-effort preserved)

### `apps/api` unit — counts-contract regression (same file or `rest-api.adapter.test.ts`)

- a fixture of created + updated + unchanged records produces **identical** `recordCounts` through the batched writer as through the current per-record path
- geometry `repaired` / `rejected` / `rejectedSample` tallies match, and the sample stays capped at 20

### `apps/api` integration — `__tests__/__integration__/connectors/rest-api.paginated.integration.test.ts` (extend)

- a sync of N records issues O(pages) statements, not O(records) — assert via `pg_stat_statements` calls or a statement counter
- a re-sync of unchanged data reports `unchanged = N`, `created = updated = 0`, and leaves wide-row parity with zero orphans
- deleting a wide row then re-syncing backfills exactly that row (proves the anti-join replaced the blind upsert without losing the backfill)
- **stale-statistics guard (discovery open question 1):** after inserting N rows without `ANALYZE`, the batched pre-read still plans on `entity_records_entity_source_unique` — assert the plan has no residual `Filter` on `source_id`

### Commands

`npm run test:unit` and `npm run test:integration` from `apps/api`; `npm run type-check`, `npm run lint`, `npm run build` from the root. Never invoke jest directly.

**Totals ≈ 18 cases** (12 unit, 2 counts-contract, 4 integration).

## Acceptance criteria

- A full sync of a ~400K-record paginated endpoint issues O(pages) DB statements, not O(records).
- `recordCounts` for any fixture is byte-identical to the pre-change path.
- A re-sync where nothing changed is materially cheaper than the initial load — measurably, not incidentally.
- No plan for the sync's hot path contains a `Filter` on `source_id` with a growing `Rows Removed by Filter`.
- Wide rows missing for live `entity_records` are still backfilled — verified by deleting wide rows and re-syncing.
- A record whose wide-table write fails still lands in `entity_records`, and the sync completes.
- Sheets and Excel syncs are untouched and still pass their integration suites.

## Risks & rollback

| Risk | Detection | Mitigation |
|---|---|---|
| Counts drift from the current contract | the counts-contract regression test | pins tallies before the writer lands |
| The anti-join stops backfilling missing wide rows | dedicated integration case (delete a wide row, re-sync) | the one behaviour being removed gets its own test |
| Mirror failure granularity widens from record to batch | log assertion in the unit suite | accepted and documented; the mirror was already best-effort and the next reconcile backfills |
| Batch buffering breaks the streaming path's memory bound | `rest-api-stream-memory-smoke` script under `--max-old-space-size=256` | flush is count-based (1000), so the buffer is bounded independent of page size |
| A mid-run failure leaves partial batches committed | already true today | watermark reaper + #439's stable ids converge on retry |

**Rollback:** the writer is additive — `upsertRecord` can be retained and the call sites reverted in one commit. No schema change to unwind.

**Fail mode:** fail-forward. A batch that throws fails the sync, exactly as a record that throws does today; nothing is silently skipped.

## Files touched

- edit `apps/api/src/adapters/rest-api/rest-api.adapter.ts` — writer, both `syncOneEndpoint` branches
- edit `apps/api/src/db/repositories/entity-records.repository.ts` — `findBySourceIdsForSync`
- edit `apps/api/src/db/repositories/wide-table.repository.ts` — `selectMissingWideRowIds`
- new `apps/api/src/__tests__/adapters/rest-api/sync-record-writer.test.ts`
- edit `apps/api/src/__tests__/adapters/rest-api/rest-api.adapter.test.ts` — counts contract
- edit `apps/api/src/__tests__/__integration__/connectors/rest-api.paginated.integration.test.ts`

## Next step

`docs/CONNECTOR_SYNC_WRITE_PATH.plan.md` slices this into three TDD commits on this branch: (1) the writer with the batched pre-read + in-memory classification, behind the counts-contract test; (2) the batched changed-row write and mirror; (3) the unchanged-path short-circuit plus the anti-join backfill. Each is independently revertable and each keeps the counts contract intact.
