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

- [x] Delete one wide row behind the sync's back:
      ```sql
      delete from "er__8bd191fc-8f3c-45ba-bb40-e8595bc763cf"
      where entity_record_id = (
        select entity_record_id from "er__8bd191fc-8f3c-45ba-bb40-e8595bc763cf" limit 1
      ) returning entity_record_id;   -- keep this id
      ```
- [x] Confirm the gap: wide count is now **397,959** while live `entity_records` is **397,960**.
- [x] Re-sync `testing`.
- [x] The deleted row is back: wide count returns to **397,960**, and the id you kept is present again.
- [x] Orphan check still clean:
      `select count(*) from "er__…" w left join entity_records er on er.id = w.entity_record_id and er.deleted is null where er.id is null` → **0**

**Observed (job `5227a0dc`, 82 s).** Deleted wide row `0fe0d15b-7eb0-4f4d-ba4d-9935765db5c9` (`source_id 22203040590000`), then re-synced with unchanged data so every record classified `unchanged` and the old blind re-upsert would not have fired.

```
wide rows        397,960   restored
victim row             1   present again, populated (source_id + synced_at set)
remaining gaps         0
orphans                0
recordCounts     unchanged 397,960 / 0/0/0
```

The anti-join found the single gap among 397,960 unchanged records and mirrored only that row. This is the behaviour the blind re-upsert used to provide by brute force.

**Unrelated observation, recorded because the walk surfaced it.** Every row in this wide table carries `is_valid = f` while every corresponding `entity_records` row carries `is_valid = t`. The backfilled row matches its 397,959 peers, so this is **not** introduced by #440 — `entity_records.is_valid` is hard-coded `true` by the sync writer (as it was by `upsertRecord` before it), whereas the wide row stores whatever `NormalizationService.normalizeWithMappings` computed, and this instance's transform emits upper-case keys that its field mapping does not match. The two columns therefore disagree by construction on every synced entity. Out of scope here; worth its own ticket.

## §4 — A full replacement still works *(spec AC 1, 2)*

`Smoke 3` is keyless, so a sync mints a fresh generation: every record is created and the previous generation is reaped. Exercises the changed-row path and the reap cascade together.

- [x] Sync `Smoke 3` (`8339d086`).
- [x] It completes with `created = 397,960`, `deleted = 397,960`, `unchanged = 0`.
- [x] The `geometry` block **is** present here, reading `repaired: 50` — this path writes rows, so the audit runs and reports. Its absence in §2 is specific to the unchanged path.
- [x] Wall-clock is below the 904 s baseline (job `3ae992c0`).
- [x] Exactly one live generation:
      `select split_part(source_id,':',2), count(*) from entity_records where connector_entity_id = 'dee94e06-…' and deleted is null group by 1` → one row, 397,960.
- [x] Wide parity holds: wide row count equals live `entity_records`, orphan check returns 0.

**Observed (job `f69a9a33`, instance `Smoke 3`, 424 s vs the 904 s baseline — 2.1x).**

```
recordCounts   created 397,960 · deleted 397,960 · updated 0 · unchanged 0
geometry       repaired 50 · rejected 0 · rejectedSample []   <- PRESENT

live er        397,960      wide rows   397,960
orphans              0      gaps              0

generation                              live      reaped
f69a9a33  (this sync)               397,960           0
683869f6  (earlier)                       0     397,960
3ae992c0  (earlier)                       0     397,960
```

The geometry block being **present** here is the direct counter-test to §2's absence: skipped on the unchanged path because nothing is written, reported normally when 397,960 rows are. The explanation in §2 holds.

#436's chunked cascade also handled the 397,960-row reap without incident — zero orphans.

**On the asymmetry between the two speedups**, since it is the honest read of the whole ticket:

```
§1  all-unchanged    867 s -> 106 s    8.2x
§4  full replacement 904 s -> 424 s    2.1x
```

The unchanged path got faster because work was **eliminated** — no mirror, no geometry audit, no per-record read. The full-replacement path got faster only because the same work is now **batched**: it still writes 397,960 rows, mirrors them, audits their geometry and reaps 397,960 wide rows. 2.1x is batching alone; 8.2x is batching plus removing no-op work.

## §5 — The other adapters are untouched *(spec AC 7)*

This branch scoped itself to `rest-api` after finding Sheets and Excel already batch through `LayoutPlanCommitService`. Confirm that reasoning held.

- [x] Sync the **Google Sheets** connector (`32f8b058`) → completes, `unchanged = 19`.
- [x] `git diff epic/connector-sync-at-scale...HEAD --stat` shows **no** change to `google-sheets.adapter.ts`, `microsoft-excel.adapter.ts`, or `layout-plan-commit.service.ts`.
- [~] No Microsoft Excel instance exists on this box — **WAIVED** with that reason, as in #435's §5. Its adapter is untouched by this branch (verified by the diff above) and covered by `microsoft-excel.adapter.test.ts` + `microsoft-excel-sync.integration.test.ts`, both green in CI.

**Observed (job `05555725`).**

```
git diff epic/connector-sync-at-scale...HEAD --stat -- adapters/google-sheets/ \
    adapters/microsoft-excel/ services/layout-plan-commit.service.ts \
    services/record-import.util.ts
  (empty — untouched)

source files changed by this branch, in full:
  adapters/rest-api/rest-api.adapter.ts        +257
  db/repositories/entity-records.repository.ts  +71
  db/repositories/wide-table.repository.ts      +56
```

The discovery claim that this is a single-adapter change holds: three files, none of them another adapter.

Sync result: `completed`, `unchanged: 19`, 19 live records — unchanged from before the branch.

**The run also caught a genuine transient, worth recording.** Attempt 1 hit a real Google 503 (`spreadsheets.get`); BullMQ retried 3 s later and attempt 2 succeeded:

```
01:37:11  attempt 1  -> Sheets API 503  -> job failed
01:37:14  attempt 2  (BullMQ retry)
01:37:15  completed, unchanged 19
```

Two notes. This is BullMQ's **job-level** retry, not #435's `withRetry` — a different mechanism on a different adapter, and evidence the queue absorbs upstream outages when the attempt budget is not voided. And the job row shows `status: completed` while still carrying attempt 1's `error` text: another live instance of #441's stale-error-on-a-succeeded-job, already filed.

## §6 — Error & edge cases *(spec AC 6, and the Risks table)*

**AC 6's real claim** is narrow and worth quoting: *"a record whose wide-table **write** fails still lands in `entity_records`, and the sync completes."* The wide table is a best-effort mirror; nothing in it may fail a run whose `entity_records` writes succeeded.

The first version of this section renamed the whole wide table away, which is a **harsher** fault than AC 6 describes — it breaks the reap cascade too, and that path fails loudly by pre-existing design (#456). Rewritten below to test the mirror contract, with the reap behaviour recorded separately rather than conflated with it.

- [x] **Per-batch mirror writes degrade, they do not throw.** With the wide table renamed away, sync `Smoke 3`. The log fills with `rest-api.sync.wide-table-mirror-failed`, each carrying a `batchSize` and a `sourceIdRange`, and **all 397,960 records still land in `entity_records`** under a fresh generation.
- [x] **The missing-row backfill probe also degrades.** Same run: `rest-api.sync.wide-table-backfill-probe-failed` appears per batch rather than throwing.
- [x] **Batch failure granularity.** Both log lines name a *batch* (`batchSize`, `sourceIdRange`), not a single `sourceId` — the accepted widening recorded in the spec's Risks table, not a defect.
- [x] **Restore the table** afterwards: `alter table "er__<entity>_hidden" rename to "er__<entity>";` — verify the row count is unchanged.
- [ ] **Streaming path memory.** Sync any `pagination: none` + `recordsPath` endpoint and watch the API's RSS. The writer buffers 1000 records where the stream back-pressures at 64, so the buffer is the high-water mark. Bounded by *count*, not bytes — an endpoint serving very large records is the case to watch.

**Observed — and this section found a regression, which is why it exists.**

*First run (job `d22d08cf`)*: `failed` at **progress 0**, 0 s. The throw was `selectMissingWideRowIds` — the anti-join added in slice 3, which sat **outside** the try/catch that makes the mirror best-effort. Every per-batch mirror degraded gracefully and then this read killed a sync whose `entity_records` writes had all succeeded. A direct violation of AC 6, introduced by this branch.

*Fixed*: the probe moved inside the same guard, with a `rest-api.sync.wide-table-backfill-probe-failed` log. The regression test was verified non-vacuous by mutation — removing the guard makes exactly that one case fail.

*Second run (job `e0b7dfac`)*: `failed` at **progress 90**, 482 s. Both guarded degradations observed working; all 397,960 records written; previous generation reaped from `entity_records`. The remaining throw is `softDeleteByEntityRecordIds` at `rest-api.adapter.ts:502` — the **reap cascade**, which `git show epic/connector-sync-at-scale:…` confirms is unguarded on the base branch too.

So AC 6's mirror contract **holds**; the whole-table-missing scenario still cannot complete, for a pre-existing reason outside this branch's scope. **Filed as #456** rather than fixed here, because it carries a genuine design question — failing loudly when the cascade cannot run is defensible (silence would hide the drift #327 exists to prevent), and the answer should cover all four call sites, not just the REST one.

### Not manually verifiable

- **Spec AC 4** — *"no plan for the sync's hot path contains a `Filter` on `source_id`"*. Deliberately not a step, and deliberately not a test: plan choice is a function of table size and statistics, and asserting it in a fixture three orders of magnitude smaller than production fails permanently while proving nothing (slice 1's deleted guard). The supporting evidence is a production-scale measurement recorded in `entity-records.repository.integration.test.ts`: 36.015 ms per record for the single-id form on stale statistics versus 1.108 ms for a 1000-id batch. Its known limit — taken with reasonably fresh statistics — is stated there too.

## Sign-off

- [ ] Every section above verified (or explicitly waived with a reason)
- [ ] ______ (date) — ______ (name) — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (job id / instance id / entity id):
