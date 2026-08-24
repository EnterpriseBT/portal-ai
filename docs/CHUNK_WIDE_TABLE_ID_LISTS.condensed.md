# Chunk the wide-table id lists — Condensed design (#436)

**Issue:** [#436](https://github.com/EnterpriseBT/portal-ai/issues/436) · `Bug` · **small / condensed** (discovery + spec + plan + smoke in one doc). Child of epic [#444](https://github.com/EnterpriseBT/portal-ai/issues/444) — branches from and PRs into `epic/connector-sync-at-scale`, **not** `main`.

**Why.** `sql.join(ids.map(id => sql`${id}`), sql`, `)` builds one SQL AST node per element and Drizzle flattens it recursively, so AST depth scales with array length and overflows the V8 stack long before Postgres' parameter limit binds. A 317,000-id call crashed a sync with `RangeError: Maximum call stack size exceeded` after the `entity_records` reap had already committed, leaving 317,000 wide rows pointing at soft-deleted records — the exact unbounded growth #327 exists to prevent. `apps/api` only.

## Current shape

The failure mode is **already documented in the same file**, on `upsertMany` (`wide-table.repository.ts:186-198`):

> A single 13k-row INSERT builds a `sql` AST whose join chain is deep enough to overflow the V8 call stack when Drizzle recursively flattens the template chunks; chunking keeps each statement's AST shallow and round-trip-cheap.

So ~13k is a known threshold and `WIDE_TABLE_UPSERT_CHUNK_SIZE = 500` is the established remedy. Three sibling builders never got it.

| Unbounded builder | Location | Note |
|---|---|---|
| `softDeleteByEntityRecordIds` | `wide-table.repository.ts:549-563` | **the one that crashed** — 317k observed |
| `selectByEntityRecordIds` | `wide-table.repository.ts:167-183` | same shape; **no production caller** (only `wide-table.repository.integration.test.ts:549`) |
| `unchangedIds` `synced_at` bump | `layout-plan-commit.service.ts:834-846` | same shape, grows with entity size |
| (bounded, for contrast) | `jobs.repository.ts:183` | `connectorEntityIds` — bounded by entities per org |

**Callers of `softDeleteByEntityRecordIds` — six, not one:**

| Caller | Array | Client | Bound |
|---|---|---|---|
| `adapters/rest-api/rest-api.adapter.ts:496` | watermark `reaped` | default (autocommit) | **none** |
| `adapters/google-sheets/google-sheets.adapter.ts:159` | watermark `reaped` | default | **none** |
| `adapters/microsoft-excel/microsoft-excel.adapter.ts:162` | watermark `reaped` | default | **none** |
| `services/layout-plan-draft.service.ts:547` | watermark `reaped` | default | **none** |
| `routes/entity-record.router.ts:1482` | **every live id for the entity** | `tx` | **none** |
| `routes/entity-record.router.ts:1360` | `[recordId]` | `tx` | 1 — safe |

Two things the ticket did not record:

- **All three sync adapters share the crash**, plus the layout-plan draft path. The ticket predicted this; the call sites confirm it.
- **`entity-record.router.ts:1482` is a user-facing "delete all records for this entity" route** whose `liveIds` is an unfiltered `SELECT id … WHERE connector_entity_id = ? AND deleted IS NULL`. On the 397,960-record entities sitting on the dev box right now, that button crashes. This is the most reachable instance of the bug and it has nothing to do with connector syncs.

## Decision — chunk in the repository, not at the call sites

Chunk inside `softDeleteByEntityRecordIds` itself. One change fixes all six callers, including the delete-all route, and any future caller inherits it. Patching call sites would fix five places and leave the trap armed.

Chunk size: reuse **`WIDE_TABLE_UPSERT_CHUNK_SIZE = 500`**, already in this file and already the proven remedy for this exact overflow. Not a new constant — `entity-records.repository.ts` has its own `BULK_CHUNK_SIZE = 1000` and a third parallel convention is worse than reusing either.

### Transaction scope — no new transaction

Chunking turns one statement into N. Each existing client is respected as passed: the router's calls stay inside its `tx` (atomic), the adapters stay on autocommit (N separate statements, so a failure at chunk 200 leaves a partial cascade).

**Deliberately not wrapping the adapter path in a new transaction.** `softDeleteBeforeWatermark` has *already committed* the `entity_records` reap by the time the cascade runs, so atomicity across the two was never available — adding a transaction around only the mirror half buys the appearance of safety, not safety. A partial cascade leaves orphans that the next reap re-attempts, which matches the existing posture: `rest-api.adapter.ts` documents the wide-table write as best-effort. Long-held locks on a 400K-row delete are a real cost against no real gain.

The same reasoning applies to `selectByEntityRecordIds` (reads, so partial results would be wrong) — there, accumulate all chunks before returning, so the caller still sees one complete result set.

## Plan — 1 slice

**Chunk the three builders.**
Files: `db/repositories/wide-table.repository.ts` — chunk `softDeleteByEntityRecordIds` (loop, respect the passed client) and `selectByEntityRecordIds` (loop, concatenate results before returning); `services/layout-plan-commit.service.ts:834-846` — chunk the `synced_at` `UPDATE` the same way. Refresh each JSDoc to name the overflow it now avoids.
Tests: new `__tests__/db/repositories/wide-table-id-chunking.test.ts` — the overflow is **client-side in Drizzle's SQL builder**, so a unit test with a fake client that captures statements proves it without a database: 50,000 ids does not throw and issues `ceil(50000/500)` statements; 500 issues exactly 1; 0 issues none and returns early; `selectByEntityRecordIds` concatenates every chunk's rows. Pin the current single-statement behaviour for a small array so the change is visibly scoped.

`npm run test:unit` (apps/api), `npm run type-check`, `npm run lint`.

## Smoke (manual, against your dev stack)

Every box starts unchecked.

### Preflight

- [x] `git checkout fix/chunk-wide-table-id-lists && git pull --ff-only` — branched off `epic/connector-sync-at-scale`
- [x] `npm install` — **no migration** (no schema change)
- [x] Start the API **without nodemon**: `cd apps/api && npx dotenv -e .env -- npx tsx src/index.ts`

**Fixtures — already present on the dev box.** `Smoke 3` (instance `8339d086`) is a keyless REST instance holding 397,960 records with synthetic source ids, so its next sync reaps all 397,960 straight into the cascade. `testing` and `smoke 2` each hold 397,960 keyed records for the delete-all case.

### §1 — The reap cascade survives a full-dataset generation

- [x] Re-sync `Smoke 3`. Because it has no `idField`, a new sync mints a new generation and reaps all 397,960 prior rows.
- [x] The job reaches `status = completed` — **on `main` today this raises `RangeError: Maximum call stack size exceeded`**.
- [x] `select count(*) from "er__dee94e06-7f24-4861-8b72-825fc86b3731"` equals the live `entity_records` count for that entity.
- [x] Orphan check returns 0: `select count(*) from "er__<entity>" w left join entity_records er on er.id = w.entity_record_id and er.deleted is null where er.id is null`

**Observed (job `3ae992c0`, instance `Smoke 3`, 904 s):**

```
recordCounts   created 397,960 · deleted 397,960 · updated 0 · unchanged 0
geometry       repaired 50 · rejected 0

live entity_records   397,960     wide rows          397,960
soft-deleted          397,960     ORPHANED wide            0
                                  live missing wide        0
RangeError occurrences       0

generation                              live      reaped
3ae992c0-...  (this sync)            397,960           0
683869f6-...  (previous)                   0     397,960
```

The chunked cascade was caught landing in real time. Two consecutive samples while the job was still `active`:

```
19:11:26   live=793,099   gens=2   wide=794,777   <- peak
19:12:04   live=795,920   gens=2   wide=752,420   <- wide falling mid-reap
```

`live` peaked at exactly 795,920 = 397,960 x 2 (both generations fully present) while `wide` was already dropping from its peak — the ~796 chunked DELETEs executing. On the epic base this is the moment that raises `RangeError`.

**Against the same operation pre-fix (Aug 22):** `RangeError: Maximum call stack size exceeded`, job `failed` after the data had landed, 317,000 orphaned wide rows requiring manual repair. Now: completes, `deleted: 397,960`, zero orphans.

### §2 — The delete-all route no longer crashes

The route's id materialisation is **out of scope** here — split to #451. Chunking the builder still fixes its crash, so verify that much:

- [ ] Delete all records for a ~400K-record entity (`smoke 2`, entity `0e416ba5`) through the UI or its route.
- [ ] It succeeds rather than 500-ing with a `RangeError`. (It will issue ~800 chunked statements inside one transaction — slow, and #451's problem, not this ticket's.)
- [ ] Both `entity_records` (live) and the `er__<entity>` table end at 0 rows for that entity.

### §3 — Nothing regressed on the small path

- [ ] Delete a **single** record from an entity → still works, wide row goes with it (this path passed one id and was never affected).
- [ ] Sync `testing` (keyed, `idField = PARCEL_ID`) → `unchanged = 397,960`, reap set 0, wide parity intact — same result as #435/#439's §4.

### Sign-off

- [ ] Every section verified (or explicitly waived with a reason)
- [ ] ______ (date) — ______ (name) — confirmed against my own running stack

### Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (job / instance / entity ids):

## Out of scope

- **Making the reap set smaller.** A keyless endpoint fully replacing its dataset every sync is documented intent; whether that semantic is right is #442's question. This ticket makes the existing behaviour survivable, not rarer.
- **`softDeleteBeforeWatermark` returning an unbounded id array.** Chunking the consumer fixes the crash; the producer materialising ~400K ids into memory is a scalability question that belongs with #440's write-path work.
- **The delete-all route's id materialisation** — split to #451. Chunking here stops it crashing; it still reads ~400K ids into memory to build a list a join could avoid.
- **A shared chunking helper across repositories.** Two constants already exist (`BULK_CHUNK_SIZE`, `WIDE_TABLE_UPSERT_CHUNK_SIZE`); consolidating them is a refactor with a wider blast radius than this bug warrants.
- `jobs.repository.ts:183` — same shape but bounded by entities-per-org; left alone deliberately rather than swept in.
