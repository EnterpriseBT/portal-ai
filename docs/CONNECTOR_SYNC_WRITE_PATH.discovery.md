# Connector sync write path — Discovery

**Issue:** [EnterpriseBT/portal-ai#440](https://github.com/EnterpriseBT/portal-ai/issues/440) · child of epic [#444](https://github.com/EnterpriseBT/portal-ai/issues/444) — branches from and PRs into `epic/connector-sync-at-scale`.

**Why this exists.** A connector sync writes records one at a time, costing three to four sequential DB round-trips each. On a 397,960-record ArcGIS layer that is a 15–25 minute operation whose duration is almost entirely round-trip latency and a bad query plan, not work. The duration is also the *exposure window* for #435: a transient socket close kills the run, and the chance of hitting one scales with how long the run stays open — three separate runs died at 80%, 60% and 96% before #435 landed.

The survey found the important thing: **the batched write pattern already exists in this codebase, twice.** `record-import.util.ts`'s `importRows` and `layout-plan-commit.service.ts`'s `writeRecords` both do exactly what the sync loop should — one bulk lookup, in-memory classification, one bulk upsert, one bulk mirror. Every primitive they use is batch-capable. So this is not "introduce batching as a pattern" (as the ticket's sizing says) — it is **make the REST sync loop use the pattern already in production next to it**.

And the blast radius is narrower than the ticket assumed: the Google Sheets and Microsoft Excel adapters delegate record writing to `LayoutPlanCommitService.commit` → `writeRecords`, so they are *already* batched and already skip unchanged rows. `rest-api`'s `upsertRecord` is the only per-record write loop in the codebase. This is a single-adapter fix, not a cross-cutting one.

## The current shape

### The per-record loop

| Piece | Location | Round-trips |
|---|---|---|
| `upsertRecord` — the whole per-record body | `adapters/rest-api/rest-api.adapter.ts:588` | 3–4 |
| pre-read for change detection | `findBySourceIds(entityId, [oneSourceId])` | 1 |
| unchanged branch | `bulkUpdateSyncedAt([oneId])` | 1 |
| changed branch | `upsertBySourceId(row)` | 1 |
| wide-table mirror, **both** branches | `mirrorRecordToWideTable` → `wideTable.upsertMany(entityId, [oneRow])` | 1 |
| geometry audit, inside `upsertMany` | `wide-table.repository.ts:453` → `GeometryAuditService.auditBatch` | 1 |

Called once per record from `syncOneEndpoint`'s page loop (`rest-api.adapter.ts:422` streaming branch, `:456` buffered branch).

### Every primitive is already batch-capable

| Primitive | Location | Signature takes | Sync loop passes |
|---|---|---|---|
| `findBySourceIds` | `entity-records.repository.ts:353` | `sourceIds: string[]`, chunks at 1000 | 1 |
| `upsertManyBySourceId` | `entity-records.repository.ts:147` | `data[]`, chunks at 1000, `.returning()` | — (unused by sync) |
| `bulkUpdateSyncedAt` | `entity-records.repository.ts:194` | `ids: string[]`, chunks at 1000 | 1 |
| `wideTable.upsertMany` | `wide-table.repository.ts:209` | `rows[]`, chunks at 500 | 1 |
| `GeometryAuditService.auditBatch` | `geometry-audit.service.ts:56` | `rows: GeometryAuditRow[]` | 1 |

### The two existing batched writers

`record-import.util.ts:97` `flushBatch` is the closest analogue and the reference implementation:

1. `findBySourceIds(entityId, sourceIds)` — **one** query for the whole batch (`:103`)
2. build an in-memory `existingMap` keyed by `sourceId` (`:106`)
3. classify created / updated / unchanged in memory (`:113-121`)
4. **skip unchanged rows entirely** — no upsert, no mirror, no geometry audit
5. write only the changed rows, inside one transaction: `upsertManyBySourceId` (`:145`) + `wideTable.upsertMany` (`:151`)

`layout-plan-commit.service.ts:593` `writeRecords` is the second instance, and `bulkUpdateSyncedAt`'s own JSDoc (`entity-records.repository.ts:189`) is written *about* it — "the unchanged path in `writeRecords` short-circuits the upsert".

### The measured problem

**The pre-read is quadratically mis-planned.** With stale statistics the planner picks the non-covering `entity_records_entity_is_valid_idx` and filters every row already inserted for that entity:

```
Index Cond: (connector_entity_id = '8bd191fc…')
Filter:     ((deleted IS NULL) AND (source_id = '26303000010000'))
Rows Removed by Filter: 31027          <- grows with every insert
Execution Time: 36.015 ms
```

Staleness is structural: autoanalyze fires at `50 + 0.1 × reltuples`, so on a 2.4M-row table it needs ~236,000 modifications and a single 398K-record sync crosses that at most once.

**Batching alone fixes it.** Measured on the same table:

| lookup shape | plan | time |
|---|---|---|
| single id, stale stats | `entity_is_valid_idx` + filter 31,027 rows | 36.015 ms / record |
| single id, fresh stats | `entity_source_unique` | 0.452 ms / record |
| **1000 ids, `= ANY(…)`** | `entity_source_unique`, both columns in `Index Cond` | **1.108 ms / 1000 records** |

The batched form binds `connector_entity_id` *and* `source_id = ANY(…)` in the index condition, so there is no residual `Filter` to degrade. ~0.001 ms/record — roughly 400× the fresh single-id form and ~32,000× the stale one.

**Doing nothing costs 93% of doing everything.** Query mix on a re-sync where every checksum matched (200 samples of `pg_stat_activity`): 38% the pre-read, 29% the wide-table re-upsert, 17% `bulkUpdateSyncedAt`, 15% the geometry audit. No `INSERT entity_records` at all — yet the unchanged path ran at ~485 rec/s against ~452 rec/s peak for the all-inserts path. Every scheduled sync after the first pays this.

**Latency dominance.** Identical code measured 388 rec/s locally vs 59 rec/s on app-dev — Postgres is a container away locally and an RDS hop away there. With ~1.2M sequential round-trips, per-hop latency *is* the runtime.

## The design space

### Decision 1 — where the batching lives

**Corrected after surveying the sibling adapters.** The first draft leaned toward a shared writer across `rest-api`, `google-sheets` and `microsoft-excel` on the assumption that all three had the same per-record loop. They do not:

| Adapter | Record write path | Batched today? |
|---|---|---|
| `rest-api` | `upsertRecord` per record (`rest-api.adapter.ts:588`) | **no** — the defect |
| `google-sheets` | delegates to `LayoutPlanCommitService.commit` (`google-sheets.adapter.ts:136`) → `writeRecords` | **yes** |
| `microsoft-excel` | delegates to `LayoutPlanCommitService.commit` (`microsoft-excel.adapter.ts:154`) → `writeRecords` | **yes** |

Sheets and Excel have no per-record write loop at all. Their only per-record-shaped code was the reap cascade (`google-sheets.adapter.ts:159`), which #436 already fixed. So `rest-api` is the sole consumer that needs this.

**A. Port `flushBatch`'s shape into the REST sync loop.** One consumer, proven shape, no new abstraction.
**B. Extract one writer shared by all three *writers*** — `rest-api`, `record-import.util.ts`, `layout-plan-commit.service.ts`. The real consolidation, since `flushBatch` and `writeRecords` are already near-duplicate logic.
**C. Batch inside `upsertRecord`** — keep the per-record signature, buffer internally.

| | A: REST loop only | B: consolidate all writers | C: buffer inside |
|---|---|---|---|
| Fixes the measured defect | yes | yes | yes |
| Touches a working path | no | **yes** — Sheets/Excel sync + imports | no |
| New abstraction | none | one module, 3 consumers | hidden flush points |
| Reviewability | high — mirrors `flushBatch` | medium | low |
| Removes existing duplication | no | yes | no |

**Lean: A.** Every measurement justifying this ticket (36 ms → 0.001 ms, 93% no-op cost) comes from the REST loop; none argues for touching `writeRecords`. B is the tidier end state and the duplication is real, but doing it inside a bug ticket means risking the live Sheets/Excel sync path to fix a REST-only defect. C hides flush timing from the caller, which worsens error attribution.

**Follow-up to file:** consolidate `flushBatch` and `writeRecords` (and the new REST writer) into one batched record writer. A refactor ticket, not part of this fix.

### Decision 2 — the redundant pre-read

**A. Keep it, batched.** One `findBySourceIds` per batch, exactly as `importRows` does.
**B. Eliminate it — fold the checksum comparison into `upsertBySourceId`'s `ON CONFLICT … DO UPDATE` via `setWhere`** (supported in drizzle 0.45.1).

| | A: batched pre-read | B: fold into ON CONFLICT |
|---|---|---|
| Round-trips per batch | 2 (+mirror) | 1 (+mirror) |
| Mis-plan risk | none measured — 1.108 ms/1000 | none — `ON CONFLICT` is bound to the unique index |
| created/updated/unchanged classification | trivial, in memory | needs `xmax`-style trickery or a returning-count diff |
| Matches existing code | yes — `importRows`, `writeRecords` | no precedent in the repo |

**Lean: A.** B was the ticket's stated direction, but the measurement removed its main justification: the batched pre-read is ~0.001 ms/record and cannot be mis-planned. B would additionally put the created/updated/unchanged contract at risk for one saved round-trip per *thousand* records. Not worth it.

### Decision 3 — the unchanged path's no-op work

**A. Skip the mirror and geometry audit for unchanged rows; batch `bulkUpdateSyncedAt`; find missing wide rows with one anti-join per batch.**
**B. Keep re-upserting the mirror, just batched.**

The blind re-upsert is deliberate (`rest-api.adapter.ts:604-608`): it "backfills rows that exist in entity_records but are missing from the wide table — common right after landing field mappings on an already-synced entity." A real problem, but the current remedy pays ~398,000 speculative upserts plus ~398,000 geometry re-audits every sync to catch a handful of gaps.

**Lean: A.** One `LEFT JOIN … WHERE w.entity_record_id IS NULL` per batch locates the gaps directly. It also removes the per-record `spatial_ref_sys` lookup, which is a static reference table.

### Decision 4 — batch boundary and the streaming path

Page-sized batches (~1000) fall out naturally on the buffered path. The streaming path (`isStreamingEligible` → `pagination: "none"` + no transform, `rest-api.adapter.ts:499`) exists specifically to bound memory, and its `stream.util.ts` back-pressure watermarks are 64/32 records.

**Lean: flush on a record count (`BULK_CHUNK_SIZE = 1000`), not on page boundaries**, so both paths use one rule and the streaming path's memory stays bounded by the batch rather than by a page that could be arbitrarily large.

## Tradeoff comparison

| | D1: shared writer | D2: keep batched pre-read | D3: skip no-op work | D4: count-based flush |
|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes |
| Touches other adapters | Yes | No | Yes | No |
| Changes a public contract | No | No | No | No |
| Needs a new test seam | Yes | No | Yes | No |

## Recommendation

1. Batch the `rest-api` sync loop's record writes, modelled on `record-import.util.ts:97` `flushBatch`. **Scoped to `rest-api` only** — Sheets and Excel already route through the batched `writeRecords` and have no per-record loop.
2. Keep the pre-read and batch it — one `findBySourceIds` per batch of 1000. Do **not** fold the checksum into `ON CONFLICT`; the measurement removed the justification.
3. Classify created / updated / unchanged in memory from the batch's `existingMap`, preserving today's counts exactly.
4. Write changed rows with `upsertManyBySourceId` + one `wideTable.upsertMany`, in one transaction per batch.
5. Advance unchanged rows with one batched `bulkUpdateSyncedAt`, and **skip** their mirror re-upsert and geometry re-audit.
6. Replace the blind backfill with one anti-join per batch that finds live records missing a wide row, and mirror only those.
7. Flush every `BULK_CHUNK_SIZE` records so the streaming and buffered paths share one rule.

## Open questions

1. **Does the batched pre-read stay well-planned when statistics go stale?** Measured at 1.108 ms/1000 with `n_mod_since_analyze = 167`. Both columns are in the `Index Cond`, so there is no residual filter to degrade — but this was not measured against a deliberately stale table. **Lean: verify with an explicit stale-stats measurement in the spec's test plan rather than assuming.**
2. **Per-batch transaction, or per-page?** `importRows` wraps each flush in `DbService.transaction`. A failure mid-run then leaves earlier batches committed. **Lean: per-batch, matching `importRows`** — the watermark reaper already makes a partially-written sync recoverable, and a run-long transaction on 398K rows is worse.
3. **Does progress reporting still work?** The meter currently ticks per page via `reportPage`. Count-based flushing decouples batches from pages. **Lean: keep ticking on pages** — progress is #441's problem and should not be entangled here.
4. ~~**Do the Sheets/Excel adapters have the same unchanged-path waste?**~~ **Resolved during discovery: no.** Both delegate record writing to `LayoutPlanCommitService.commit` → `writeRecords`, which is already batched and already skips unchanged rows. Neither has a per-record loop. This resolved Decision 1 to option A — see the table there.

## Enterprise-scale considerations

- **Concurrency & correctness.** `upsertManyBySourceId`'s `ON CONFLICT (connector_entity_id, source_id) WHERE deleted IS NULL` is already the atomic check-then-act; batching does not weaken it. Two syncs of one entity are prevented upstream by the job lock. **Lean: no new concurrency surface.**
- **Accuracy & auditability.** The created/updated/unchanged counts reach an API response and an SSE consumer, so they are contract. **Lean: pin them with a regression test that drives the same fixture through old and new paths and asserts identical tallies.**
- **Failure modes.** Per-batch transactions mean a mid-run failure leaves a partial sync — already true today, and the watermark reaper plus #439's stable ids make it converge on retry. **Lean: fail-forward, no change.**
- **Scale & unbounded growth.** The point of the ticket. One residual: `softDeleteBeforeWatermark` still `.returning()`s every reaped id into memory (~398K). **Lean: out of scope here, note it — it is the same shape as #451.**
- **Multi-tenancy.** Batches are per connector entity, which is per organization. A large tenant's sync already monopolises a worker slot (`concurrency: 2`); shortening the run *reduces* noisy-neighbour exposure. **Lean: net improvement, no new limit needed.**
- **Contract stability.** No route, schema or payload changes. The adapter-internal writer is a new seam, which is where a future per-tenant write throttle would plug in. **Lean: additive-open.**
- **Data lifecycle.** N/A because this changes how rows are written, not how long they live. Retention is #442.

## What this doesn't decide

- **Whether full replacement per sync is right for a keyless endpoint.** Documented intent (`deriveSourceId`'s JSDoc); #442's question. This ticket makes the writes cheaper, not rarer.
- **`softDeleteBeforeWatermark`'s unbounded `.returning()`** — same shape as #451, deliberately left there.
- **Progress reporting honesty** — #441.
- **Purging soft-deleted rows** — #442. Relevant because tombstones raise the autoanalyze threshold that produced the mis-plan, so #442 makes this ticket's gains more stable.
- **Any change to the streaming primitive itself** (`stream.util.ts`). Its back-pressure watermarks stay as they are; only the consumer's flush rule changes.

## Next step

`docs/CONNECTOR_SYNC_WRITE_PATH.spec.md` fixes the writer's surface — its input shape, the counts contract, and the batch/transaction boundary — then `docs/CONNECTOR_SYNC_WRITE_PATH.plan.md` slices it. The natural slicing is: (1) introduce the batched writer in the REST sync loop with the batched pre-read and in-memory classification, behind a regression test that pins the counts; (2) batch the changed-row write and the mirror; (3) skip the unchanged path's no-op work and add the anti-join backfill. Each slice is independently revertable and each keeps the counts contract intact. There is no adapter-migration slice — Sheets and Excel are already batched.
