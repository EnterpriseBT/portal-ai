# connector-sync-write-path — Smoke Suite

Manual smoke test for [#440](https://github.com/EnterpriseBT/portal-ai/issues/440) — the REST sync loop now writes records in batches of 1000 instead of one at a time, and unchanged records stop re-mirroring their wide row. **Branch under test:** `fix/connector-sync-write-path` (child of epic [#444](https://github.com/EnterpriseBT/portal-ai/issues/444), PRs into `epic/connector-sync-at-scale`).

Unlike the other tickets on this epic, this one has a **measured before/after**: the same instances were synced on this box before the change, so §1 and §2 are comparisons against recorded numbers, not "does it still work".

## Preflight

### Environment

- [x] `git checkout fix/connector-sync-write-path && git pull --ff-only`
- [x] `npm install` — **no migration on this branch** (no schema change)
- [x] Start the API **without nodemon**, so an editor save can't kill a 15-minute run:
      `cd apps/api && npx dotenv -e .env -- npx tsx src/index.ts`
- [x] Confirm it is running **this branch's** code — a stale process is the single easiest way to get a meaningless result. `ps -eo pid,lstart,cmd | grep '[s]rc/index.ts'` should show a start time later than the last commit.

### Fixtures — already on the dev box

| Instance | Entity | Records | `idField` | Role |
|---|---|---|---|---|
| `testing` (`b59fbe29`) | `8bd191fc` | 397,960 | `PARCEL_ID` | §1, §2 — the all-unchanged re-sync |
| `Smoke 3` (`8339d086`) | `dee94e06` | 397,960 | *(none)* | §4 — full replacement |
| `Google Sheets (…)` (`32f8b058`) | `98e9c95f` | 19 | — | §5 — untouched adapter |

### Recorded baselines (pre-change, measured on this box)

```
job 39d862f6  testing   all-unchanged re-sync     867 s   unchanged 397,960
job 447acf47  testing   all-unchanged re-sync   1,288 s   (ran concurrently with another sync)
job 3ae992c0  Smoke 3   full replacement          904 s   created 397,960 / deleted 397,960
```

### Reset between runs

- [x] No reset needed. Every section is idempotent — a re-sync of an unchanged dataset leaves the data as it found it.

---

## §1 — The all-unchanged re-sync is dramatically cheaper *(spec AC 1, 3)*

The headline. `testing` holds 397,960 keyed records; re-syncing it changes nothing, so every record takes the unchanged path.

- [x] Sync `testing` (`b59fbe29`). **Run it alone** — a concurrent sync contends for the same worker and invalidates the timing (that is why the 1,288 s baseline exists alongside the 867 s one).
- [x] It reaches `status = completed`, `progress = 100`.
- [x] **Wall-clock is a large fraction below the 867 s baseline.** Read it from
      `select round((completed_at - started_at)/1000.0) as secs from jobs where id = '<job>'`.
      A result in the same ballpark as 867 s means the batching is not taking effect — treat that as a failure and file it, not as noise.
- [x] Statement volume dropped: while it runs, sample
      `select count(*) from pg_stat_activity where datname = current_database() and state = 'active'`
      a few times. Before, the mix was dominated by a per-record `SELECT … FROM entity_records`; that should now be rare, with the visible statements being batched writes.

## §2 — The counts contract is unchanged *(spec AC 2)*

Batching must not alter a single tally — these numbers reach an API response and an SSE consumer.

- [x] The §1 job's `result` reads exactly `{"recordCounts":{"created":0,"deleted":0,"updated":0,"unchanged":397960}}`, matching baseline job `39d862f6` byte for byte.
- [x] Its `geometry` block is **absent** — and this is the intended change, not a regression.

  The pre-change baseline reported `{"repaired":50,...}` on *every* all-unchanged re-sync. `repaired` is defined as "rows whose geometry was invalid-but-repairable (**ST_MakeValid fixed it on write**)" (`wide-table.repository.ts:32-38`), and the block is emitted only when `repaired > 0 || rejected > 0` (`rest-api.adapter.ts:325`).

  The old path re-mirrored every unchanged record, so those same 50 geometries were re-repaired and re-reported on every run — even though the wide table already held the repaired geometry from the first write. It described work that was pure waste. Nothing is written on the unchanged path now, so nothing is repaired and the block is correctly omitted.

  **This is user-visible**: the geometry summary disappears from re-sync results. A geometry-bearing sync that actually *writes* rows still reports it — see §4, where a full replacement must still show `repaired: 50`.
- [x] Row counts are untouched:
      `select count(*) from entity_records where connector_entity_id = '8bd191fc-8f3c-45ba-bb40-e8595bc763cf' and deleted is null` → **397,960**
- [x] Nothing was reaped: the same query with `deleted is not null` → **0**.

**Observed (job `e2d3914a`, instance `testing`).**

```
                        BEFORE (job 39d862f6)      NOW (job e2d3914a)
wall clock                        867 s                  106 s     8.2x faster
recordCounts        unchanged 397,960 / 0/0/0   unchanged 397,960 / 0/0/0
live entity_records             397,960                397,960
soft-deleted                          0                      0
wide rows                       397,960                397,960
orphans                               0                      0
synced_at generations           one                    one (23:14:45)
geometry block            repaired: 50              ABSENT (see above)
```

**Query mix, sampled 120x over the run** — the two largest pre-change consumers are gone outright:

```
                                  BEFORE      NOW
per-record SELECT entity_records     38%     ZERO
wide-table upsert                    29%     ZERO
geometry audit                       15%     ZERO
batched UPDATE synced_at             17%     dominant
batched pre-read           (new)       -     present
anti-join probe            (new)       -     present
```

*Caveat on the comparison.* A stray monitoring script of mine had been running `count(*)` against `entity_records` (2.7M rows) every 15 s since 18:31, and was live during the 867 s baseline as well as this run's first ~40 s before being killed. It penalises the baseline more than this run — but a periodic full scan cannot account for 761 s, so the 8.2x stands.

## §3 — A missing wide row is still backfilled *(spec AC 5)*

The one behaviour this branch removes is the blind mirror re-upsert. It was also the accidental backfill mechanism, so this is the section that matters most.

- [ ] Delete one wide row behind the sync's back:
      ```sql
      delete from "er__8bd191fc-8f3c-45ba-bb40-e8595bc763cf"
      where entity_record_id = (
        select entity_record_id from "er__8bd191fc-8f3c-45ba-bb40-e8595bc763cf" limit 1
      ) returning entity_record_id;   -- keep this id
      ```
- [ ] Confirm the gap: wide count is now **397,959** while live `entity_records` is **397,960**.
- [ ] Re-sync `testing`.
- [ ] The deleted row is back: wide count returns to **397,960**, and the id you kept is present again.
- [ ] Orphan check still clean:
      `select count(*) from "er__…" w left join entity_records er on er.id = w.entity_record_id and er.deleted is null where er.id is null` → **0**

## §4 — A full replacement still works *(spec AC 1, 2)*

`Smoke 3` is keyless, so a sync mints a fresh generation: every record is created and the previous generation is reaped. Exercises the changed-row path and the reap cascade together.

- [ ] Sync `Smoke 3` (`8339d086`).
- [ ] It completes with `created = 397,960`, `deleted = 397,960`, `unchanged = 0`.
- [ ] The `geometry` block **is** present here, reading `repaired: 50` — this path writes rows, so the audit runs and reports. Its absence in §2 is specific to the unchanged path.
- [ ] Wall-clock is below the 904 s baseline (job `3ae992c0`).
- [ ] Exactly one live generation:
      `select split_part(source_id,':',2), count(*) from entity_records where connector_entity_id = 'dee94e06-…' and deleted is null group by 1` → one row, 397,960.
- [ ] Wide parity holds: wide row count equals live `entity_records`, orphan check returns 0.

## §5 — The other adapters are untouched *(spec AC 7)*

This branch scoped itself to `rest-api` after finding Sheets and Excel already batch through `LayoutPlanCommitService`. Confirm that reasoning held.

- [ ] Sync the **Google Sheets** connector (`32f8b058`) → completes, `unchanged = 19`.
- [ ] `git diff epic/connector-sync-at-scale...HEAD --stat` shows **no** change to `google-sheets.adapter.ts`, `microsoft-excel.adapter.ts`, or `layout-plan-commit.service.ts`.
- [ ] No Microsoft Excel instance exists on this box — waive that half with that reason, as in #435's §5.

## §6 — Error & edge cases *(spec AC 6, and the Risks table)*

- [ ] **A wide-table failure must not fail the sync.** Simulate by renaming the wide table mid-run:
      `alter table "er__dee94e06-…" rename to "er__dee94e06-…_hidden";` then sync `Smoke 3`.
      Expect: the job still reaches `completed`, `entity_records` still receives its rows, and the API log carries
      `rest-api.sync.wide-table-mirror-failed` with a `batchSize` and a `sourceIdRange`.
      Rename it back afterwards.
- [ ] **Batch failure granularity.** Note in the log that the failure names a *batch*, not a single `sourceId` — that is the accepted widening recorded in the spec's Risks table, not a defect.
- [ ] **Streaming path memory.** Sync any `pagination: none` + `recordsPath` endpoint and watch the API's RSS. The writer buffers 1000 records where the stream back-pressures at 64, so the buffer is the high-water mark. Bounded by *count*, not bytes — an endpoint serving very large records is the case to watch.

### Not manually verifiable

- **Spec AC 4** — *"no plan for the sync's hot path contains a `Filter` on `source_id`"*. Deliberately not a step, and deliberately not a test: plan choice is a function of table size and statistics, and asserting it in a fixture three orders of magnitude smaller than production fails permanently while proving nothing (slice 1's deleted guard). The supporting evidence is a production-scale measurement recorded in `entity-records.repository.integration.test.ts`: 36.015 ms per record for the single-id form on stale statistics versus 1.108 ms for a 1000-id batch. Its known limit — taken with reasonably fresh statistics — is stated there too.

## Sign-off

- [ ] Every section above verified (or explicitly waived with a reason)
- [ ] ______ (date) — ______ (name) — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (job id / instance id / entity id):
