# Connector sync write path — Plan

**Batches the REST API sync loop's record writes, TDD-sequenced so the behaviour-preserving change lands before the behaviour change.**

Spec: `docs/CONNECTOR_SYNC_WRITE_PATH.spec.md`. Discovery: `docs/CONNECTOR_SYNC_WRITE_PATH.discovery.md`. Issue: #440 (epic #444). Builds on #439's `generationKey` and #436's chunked wide-table builders, both already on this branch's base.

3 slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `fix/connector-sync-write-path`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from the package (never invoke jest directly):

```bash
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

**Sequencing rationale.** Slice 1 is a leaf repository addition with no consumer yet, so it can be proven in isolation — and it carries the stale-statistics guard that decides whether the spec's central decision (keep the pre-read, batched) survives contact with reality. Slice 2 is deliberately **behaviour-preserving**: it batches the writes and pins the counts contract, changing performance and nothing else, so a reviewer can check "same tallies, fewer statements" without also reasoning about skipped work. Slice 3 is the only behaviour change — the unchanged path stops doing no-op work — and it lands last so a bisect separates "batching broke the counts" from "the anti-join stopped backfilling".

---

## Slice 1 — Narrow pre-read for change detection

Adds `findBySourceIdsForSync`, the projection the writer will use. Nothing calls it yet.

**Files**

- Edit: `apps/api/src/db/repositories/entity-records.repository.ts` — add `findBySourceIdsForSync` beside `findBySourceIds` (`:353`), chunking at `BULK_CHUNK_SIZE` (`:60`). Existing method untouched.
- New: `apps/api/src/__tests__/db/repositories/entity-records-source-id-projection.test.ts`
- Edit: `apps/api/src/__tests__/__integration__/db/repositories/entity-records.repository.integration.test.ts` — the plan guard.

**Steps**

1. **Tests.** Unit, with a fake client capturing the built statement: returns only `id` / `sourceId` / `checksum` / `created` / `createdBy`; excludes soft-deleted rows (no resurrection — spec Key decision 3); chunks a 2,500-id input into 3 statements; returns `[]` for an empty input without querying. Integration (spec test-plan case 4, "stale-statistics guard"): insert N rows **without** `ANALYZE`, then `EXPLAIN` the projection's query shape and assert the plan uses `entity_records_entity_source_unique` with **no residual `Filter` on `source_id`**. Run; fail.
2. **Implement** the method. Green.
3. Lint + type-check.

**Done when:** the projection returns the five columns, excludes soft-deleted rows, chunks correctly, and the stale-stats integration case proves the batched shape does not degrade. Nothing in the adapter references it yet.

**Risk:** the stale-stats guard is the one test that can invalidate the spec. If the plan *does* show a residual `Filter`, stop — discovery decision 2 was wrong and folding the checksum into `ON CONFLICT` returns to the table. Do not proceed to slice 2 on a red guard.

---

## Slice 2 — Batched writer, behaviour-preserving

Replaces the per-record `upsertRecord` call with a buffering writer. Same tallies, same wide-table writes, fewer statements. The unchanged path still re-upserts its mirror exactly as today — that comes off in slice 3.

**Files**

- Edit: `apps/api/src/adapters/rest-api/rest-api.adapter.ts` — add `SYNC_WRITE_BATCH_SIZE`, `SyncRecordWriter`, `createSyncRecordWriter(ctx)`; call it from both branches of `syncOneEndpoint` (streaming `:422`, buffered `:456`); `flush()` before the watermark reap. Keep `upsertRecord` exported for the counts-contract comparison test.
- New: `apps/api/src/__tests__/adapters/rest-api/sync-record-writer.test.ts`
- Edit: `apps/api/src/__tests__/adapters/rest-api/rest-api.adapter.test.ts` — counts contract.
- Edit: `apps/api/src/__tests__/__integration__/connectors/rest-api.paginated.integration.test.ts` — statement-count assertion.

**Steps**

1. **Tests (spec unit cases 1–10 + counts contract).** Buffers below the batch size and issues no query until `flush`; auto-flushes at `SYNC_WRITE_BATCH_SIZE`; `flush` on an empty buffer issues nothing; a `null`/non-object record bumps `recordIndex` without buffering; classification produces unchanged/updated/created from one `existingMap`; changed rows go through one transaction — `upsertManyBySourceId` then `wideTable.upsertMany`; `deriveSourceId` receives `ctx.generationKey` (guards #439); a wide-table failure is logged and does not throw. **Counts contract:** a fixture of created + updated + unchanged records yields `recordCounts` and geometry tallies byte-identical to driving the same fixture through `upsertRecord`, with the rejected sample still capped at 20. Integration: a sync of N records issues O(pages) statements, not O(records). Run; fail.
2. **Implement** the writer and wire both branches. Green.
3. Lint + type-check.

**Done when:** all sync integration suites pass unchanged, `recordCounts` match the per-record path exactly, and the statement count is O(pages). Behaviour is identical; only statement volume changed.

**Risk:** the streaming branch's memory bound. `stream.util.ts`'s back-pressure watermarks are 64/32 records while the writer buffers 1,000 — so the buffer, not the stream, becomes the high-water mark. Re-run `apps/api/src/scripts/rest-api-stream-memory-smoke.ts` under `--max-old-space-size=256` at this boundary; if it regresses, lower `SYNC_WRITE_BATCH_SIZE` for the streaming branch rather than reverting the slice.

---

## Slice 3 — Unchanged path stops doing no-op work

The only behaviour change. Unchanged rows get their watermark bumped and nothing else; missing wide rows are located by an anti-join instead of a blind re-upsert.

**Files**

- Edit: `apps/api/src/db/repositories/wide-table.repository.ts` — add `selectMissingWideRowIds`, chunked at `WIDE_TABLE_CHUNK_SIZE` (`:61`).
- Edit: `apps/api/src/adapters/rest-api/rest-api.adapter.ts` — in the writer's flush, skip the mirror + geometry audit for unchanged rows; call the anti-join and mirror only what it reports.
- Edit: `apps/api/src/__tests__/adapters/rest-api/sync-record-writer.test.ts`
- Edit: `apps/api/src/__tests__/__integration__/connectors/rest-api.paginated.integration.test.ts`

**Steps**

1. **Tests (spec unit cases 6–7 + integration cases 2–3).** Unit: unchanged rows get `bulkUpdateSyncedAt` and **no** `upsertManyBySourceId`; unchanged rows get **no** `wideTable.upsertMany` when the anti-join reports nothing missing; unchanged rows **do** get mirrored when the anti-join reports them missing; `selectMissingWideRowIds` chunks and returns only ids absent from `er__<id>`. Integration: a re-sync of unchanged data reports `unchanged = N` with `created = updated = 0` and leaves wide-row parity with zero orphans; **delete a wide row, re-sync, and assert exactly that row is backfilled** — the case that proves the anti-join replaced the blind upsert without losing the backfill. Run; fail.
2. **Implement** the anti-join and the short-circuit. Green.
3. Lint + type-check.

**Done when:** a re-sync where nothing changed performs no wide-table writes and no geometry audits, yet a deliberately deleted wide row is still backfilled.

**Risk:** this removes a deliberate behaviour (`rest-api.adapter.ts:604-608` documents the blind re-upsert as the backfill mechanism). The delete-a-wide-row integration case is the guard; if it can't be made to pass, keep the blind re-upsert and descope the slice rather than shipping a silent backfill regression.

---

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| 1 | `findBySourceIdsForSync` — narrow projection, no consumer | projection columns + soft-delete exclusion + chunking; **stale-stats plan guard** |
| 2 | batched writer wired into both `syncOneEndpoint` branches | counts byte-identical to `upsertRecord`; O(pages) statements; stream memory smoke |
| 3 | unchanged-path short-circuit + anti-join backfill | no writes on an all-unchanged re-sync; deleted wide row still backfilled |

## Cross-slice notes

- **`upsertRecord` stays exported through slice 2** — the counts-contract test drives both paths over one fixture. Removing it is a slice-3 tidy-up, not a separate slice.
- **Geometry tallies span slices.** `ctx.counts.geometryRepaired` / `geometryRejected` / `geometryRejectedSample` accumulate inside `wideTable.upsertMany`'s result. Slice 2 must keep the `GEOMETRY_REJECTED_SAMPLE_CAP = 20` behaviour; slice 3 changes *how often* the audit runs, so the tally assertions move with it.
- **The mirror's log line changes shape in slice 2.** `rest-api.sync.wide-table-mirror-failed` currently carries a single `sourceId`; batched it should carry the batch's `sourceId` range or count. Update the log assertion in the same slice rather than leaving a stale field.
- **Doc sync (`CLAUDE.md` → "Indexing and ordering a table that will grow (#433)").** That section covers indexing and deep pagination but not this ticket's finding: *a per-record lookup in a hot loop degrades quadratically once statistics go stale, and batching it into a single `= ANY(…)` removes the failure mode because both columns land in the index condition*. Add it there with the measured numbers (36.015 ms → 1.108 ms/1000). **`.github/copilot-instructions.md` needs no change** — it is a 101-line condensed summary and does not carry that section. Land the doc edit with slice 3.
- **No migration, no seed** — nothing in the schema changes.

## Next step

Implementation begins on this branch once discovery, spec and plan are confirmed: slice 1 first, tests before implementation, one commit per slice. Slice 1's stale-statistics guard is the gate — a red result there sends the contract back to the spec rather than forward to slice 2.
