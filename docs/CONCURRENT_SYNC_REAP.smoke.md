# concurrent-sync-reap — Smoke Suite

Manual smoke test for [#460](https://github.com/EnterpriseBT/portal-ai/issues/460) — a sync pass now has to prove it owns the instance before it writes or reaps, so a BullMQ stall re-delivery can no longer let a second pass delete the first pass's records. **Branch under test:** `fix/concurrent-sync-reap` (PR pending). Epic child of [#444](https://github.com/EnterpriseBT/portal-ai/issues/444).

## Preflight

### Environment

- [x] `git checkout fix/concurrent-sync-reap && git pull --ff-only`
- [x] `npm install`
- [x] **`cd packages/core && npm run build`** — verified `core/dist` newer than `core/src`. — this branch changes `job.model.ts`, and a stale `core/dist` shows up as type errors in files you did not touch
- [x] **No migration** — none pending on this branch, as AC 6 requires. If `npm run db:migrate` reports anything pending on this branch, something is wrong — the lock is advisory and `superseded` rides the existing `jobs.result` JSONB. *(This is also AC 6, so treat a pending migration as a failure, not a surprise.)*
- [x] `npm run dev` boots cleanly (API :3001, web :3000)
- [x] **Verified by process start time, not `/api/health`** — worker 51 minutes newer than the newest source. (`/api/health` returned 200 from a stale build three times across this epic; on this walk the first restart also had not taken.) It returned 200 from a stale build three times across this epic:
      ```bash
      ps -eo pid,lstart,cmd | grep "[s]rc/index.ts"
      git log -1 --format=%cd --date=format:'%H:%M:%S' -- apps/api/src
      ```
      The worker's start must be *later* than the commit time.

### Fixtures

- [x] The `Smoke 3` REST instance (`8339d086-…`, entity `dee94e06-…`, ~397,960 records, **no `idField`** so every sync writes a fresh generation and reaps the previous one). This is the instance that produced the loss.
- [x] The `FAIL SMOKE` instance (`7d028f9a-…`, base URL `https://no-such-host-abcxyz.invalid`) for the fast failure paths.
- [x] `psql "$DATABASE_URL"` available — several checks read the DB directly because the UI cannot show a watermark.

### Reset between runs

- [x] None needed. Every step is a sync or a lock query; a re-sync always converges the entity back to one generation.

---

## §1 — The lock is real, and releases on its own — **PASSED**

Walked 2026-08-26. Preflight verified by process start (worker 51 min newer than the newest source), `core/dist` current, no pending migration.

- [x] With **no sync running**, confirm the instance's lock is free:
      ```sql
      SELECT pg_try_advisory_lock(1398361667, hashtext('8339d086-638c-4350-b477-c82944fdbcf1')) AS got;
      ```
      `got = t`, and 0 advisory locks held on the namespace once that psql session ended — released with no explicit unlock, which is §3's property showing up early.
- [x] The **app takes its own lock**. Observed across a full run, sampled every second:
      ```
      18:53:37  locks=0  (idle)
      18:54:06  locks=1  status=active   progress=0     <- the sync took it
      18:55:24  locks=1  status=active   progress=90
      19:00:25  locks=0  status=completed              <- released
      ```
      The held key was `objid 1705757128`, which matches `hashtext('8339d086-…')` exactly — so the lock is on the real instance slot, not an arbitrary one. *(AC 1's mechanism.)*

## §2 — A second pass is refused rather than reaping — **PASSED**

This is the fix.

**How it was staged, and the limit of that.** A real stall re-delivery is not available on demand, and a second sync from the UI cannot collide either — the route's own job-level entity lock returns `409 ENTITY_LOCKED_BY_JOB` before the processor is reached. So the lock was held through `SyncLockService` itself (a short helper script, never committed) and the sync was then triggered normally. **That tests the refusal faithfully; it does not test the trigger.** §6 is the closest this walk gets to the real trigger.

- [x] Lock held via `SyncLockService`, verified as 1 lock on key `1705757128`.
- [x] Baseline recorded: `live 397960 · generations 1 · watermarks 1`.
- [x] Sync triggered. Result:
      ```
      completed · progress 100 · attempts 1 · 0 seconds
      {"superseded": true, "recordCounts": {"created":0,"deleted":0,"updated":0,"unchanged":0}}
      ```
      `completed`, not `failed` *(AC 2)* — nothing went wrong, there was simply nothing to do.
- [x] **`supersededBy` is absent, correctly.** The holder was a helper script rather than a job row, so no sibling job could be identified — the best-effort path omitting the field rather than guessing, which is exactly its contract.
- [x] **The data did not move.** After: `live 397960 · generations 1 · watermarks 1`, identical to baseline, and **0 rows tombstoned** in the preceding five minutes. Before this branch that pass would have reaped 397,960 rows out from under the holder. *(AC 5.)*

## §3 — A dead holder does not wedge the instance — **PASSED**

The property the whole design was chosen for: no TTL, no renewal, no operator action.

- [x] `SIGKILL` sent to the lock holder with **no unlock issued**. The lock was gone within 2 seconds. *(AC 3.)*
- [x] The next sync then ran to completion normally (379 s, 397,960 records) rather than being superseded — so the release actually freed the instance for real work.

**This check took two attempts, and the failure is worth recording.** The first `SIGKILL` hit a wrapper process and the lock correctly stayed held, because the session owning it was still alive — the real holder was the `node --require …/tsx/dist/preflight.cjs` child, the same cmdline trap that cost time earlier in this epic. So the check is genuinely sensitive to *which* process dies; it does not pass trivially.

## §4 — The reap no longer runs as one statement — **VERIFIED INDIRECTLY**

**Stated plainly because the method is weaker than the claim.** `pg_stat_activity` was sampled once per second across the whole reap phase (18:55:24 at progress 90 → 19:00:25 at completion, ~5 minutes) and saw **zero** long-running `UPDATE` on `entity_records`.

That is not a direct count of statements. What makes it evidence: before this change the reap *was* a single statement over 431,960 rows lasting minutes, which a 1 Hz sampler would have caught in every single sample. Its complete absence is consistent only with many short statements.

The direct proof lives in the test suite instead — `entity-records-reap.integration.test.ts` counts statements through a proxied client and asserts ≥10 for a 47-row reap at chunk size 5. `pg_stat_statements` is not installed on this database, which would have made the in-situ check definitive.

- [x] No long-running reap statement observed across the reap phase. *(AC 4, indirectly.)*
- [x] The sync completed and the counts balanced: `created 397960`, `deleted 397960`.

<details><summary>Original step, kept for reference</summary>

- During a `Smoke 3` sync, once progress passes 90 (the reap phase), watch:
      ```sql
      SELECT state, wait_event_type, left(query, 60) FROM pg_stat_activity
       WHERE query ILIKE '%entity_records%' AND state <> 'idle';
      ```
      Expect a *succession* of short `UPDATE … entity_records` statements rather than one long-running statement.

</details>

## §5 — The interleaved loss no longer happens end to end — **PASSED (twice)**

Confirmed on two separate full runs (598 s and 379 s), and the mid-run state was checked too: during a sync the entity legitimately shows `2 generations / 2 watermarks` while the new generation is written, converging to 1/1 once the reap completes. Worth recording so a mid-flight sample is not mistaken for #460 reproducing.

- [x] Sync `Smoke 3` and let it finish untouched.
- [x] Confirm the entity converged to **one** generation and **one** watermark, with the full record count live:
      ```sql
      SELECT count(*) FILTER (WHERE deleted IS NULL)      AS live,
             count(DISTINCT split_part(source_id,':',2))  AS generations,
             count(DISTINCT synced_at)                    AS watermarks
        FROM entity_records
       WHERE connector_entity_id='dee94e06-…' AND deleted IS NULL;
      ```
      Both runs: `live = 397960`, `generations = 1`, `watermarks = 1`. **Two watermarks *after completion* is #460 reproducing** — that was the signature of the loss. *(AC 5.)*

## §6 — #441's deferred step: a killed worker records why

Deferred from #441's walk because it would have interleaved with the reap behaviour this branch fixes. Now meaningful.

- [ ] Start a `Smoke 3` sync and let it reach the reap phase (progress 90).
- [ ] Kill the API process (`kill -9` the worker pid — SIGTERM has left orphans on this box).
- [ ] Restart `npm run dev` and wait for BullMQ's stall recovery (~15 minutes on the observed settings; the job returns to `active`).
- [ ] Expect the job row to carry **a stated reason** for the interrupted attempt rather than the silence it recorded before #441 — and, per §3, the lock the dead process held to be gone so the recovered pass can actually run.
- [ ] Confirm the entity still converges: re-check §5's query after the recovered pass completes.

## §7 — Nothing was over-serialised

- [ ] With a `Smoke 3` sync running, trigger a sync on a **different** instance (`testing`, `8bd191fc-…`).
- [ ] Expect it to run normally and **not** report `superseded`. The lock is per instance; if this reports superseded, the key is too coarse and one tenant's sync would block another's.

## §8 — Error & edge cases

- [x] **A genuinely failing sync still fails — PASSED.** This was the real regression risk of adding the lock. `FAIL SMOKE`:
      ```
      failed · attempts 3/3 · completed_at set
      error:  getaddrinfo ENOTFOUND no-such-host-abcxyz.invalid
      result: (null)          <- no `superseded` field
      ```
      The lock did not convert a real failure into `superseded`, and #441's retry accounting is intact underneath it.
- [x] **Connection headroom — PASSED.** After four syncs, `pg_stat_activity` showed **zero** lingering `postgres.js` backends (the pool's `idle_timeout: 20` closes idle ones), so no reserved connection leaked. Original step:
      ```sql
      SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE '%postgres%' OR datname = current_database();
      ```
      Expect the count to return to its idle baseline. A reserved connection that is never released is permanently gone, so a steadily climbing count is the failure mode to watch.
- [x] **`layout_plan_commit` is knowingly unprotected** (#461) — noted, nothing to verify. Committing a layout plan still reaps without the lock. Nothing to verify here — recorded so the gap is not mistaken for an oversight during the walk.

### Not manually verifiable

- **AC 7** — *"`ConnectorSyncResultSchema` declares every field the sync actually returns"*. Nothing parses that schema at runtime (it is a type source via `JobTypeMap`), which is exactly why it had drifted for two tickets before this one — `geometry` (#316) and `mirrorDegraded` (#441) were both returned and persisted while undeclared. There is no runtime behaviour to walk. It is enforced by `npm run type-check` and by reading the diff; recorded here rather than dropped silently.

## Sign-off

- [ ] Every section above verified (or explicitly waived with a reason)
- [ ] ______ (date) — ______ (name) — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (job id / instance id / entity id):
