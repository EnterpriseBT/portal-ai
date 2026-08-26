# concurrent-sync-reap — Smoke Suite

Manual smoke test for [#460](https://github.com/EnterpriseBT/portal-ai/issues/460) — a sync pass now has to prove it owns the instance before it writes or reaps, so a BullMQ stall re-delivery can no longer let a second pass delete the first pass's records. **Branch under test:** `fix/concurrent-sync-reap` (PR pending). Epic child of [#444](https://github.com/EnterpriseBT/portal-ai/issues/444).

## Preflight

### Environment

- [ ] `git checkout fix/concurrent-sync-reap && git pull --ff-only`
- [ ] `npm install`
- [ ] **`cd packages/core && npm run build`** — this branch changes `job.model.ts`, and a stale `core/dist` shows up as type errors in files you did not touch
- [ ] **No migration.** If `npm run db:migrate` reports anything pending on this branch, something is wrong — the lock is advisory and `superseded` rides the existing `jobs.result` JSONB. *(This is also AC 6, so treat a pending migration as a failure, not a surprise.)*
- [ ] `npm run dev` boots cleanly (API :3001, web :3000)
- [ ] **Verify the API is on this branch by process start time, not by `/api/health`.** It returned 200 from a stale build three times across this epic:
      ```bash
      ps -eo pid,lstart,cmd | grep "[s]rc/index.ts"
      git log -1 --format=%cd --date=format:'%H:%M:%S' -- apps/api/src
      ```
      The worker's start must be *later* than the commit time.

### Fixtures

- [ ] The `Smoke 3` REST instance (`8339d086-…`, entity `dee94e06-…`, ~397,960 records, **no `idField`** so every sync writes a fresh generation and reaps the previous one). This is the instance that produced the loss.
- [ ] The `FAIL SMOKE` instance (`7d028f9a-…`, base URL `https://no-such-host-abcxyz.invalid`) for the fast failure paths.
- [ ] `psql "$DATABASE_URL"` available — several checks read the DB directly because the UI cannot show a watermark.

### Reset between runs

- [ ] None needed. Every step is a sync or a lock query; a re-sync always converges the entity back to one generation.

---

## §1 — The lock is real, and releases on its own

- [ ] With **no sync running**, confirm the instance's lock is free:
      ```sql
      SELECT pg_try_advisory_lock(1398361667, hashtext('8339d086-638c-4350-b477-c82944fdbcf1')) AS got;
      ```
      Expect `got = t`. **Then release it** — `SELECT pg_advisory_unlock(1398361667, hashtext('8339d086-…'));` — or the next step will be refused for the wrong reason.
- [ ] Start a `Smoke 3` sync. While it runs, from a **separate** psql session run the same `pg_try_advisory_lock`. Expect **`got = f`** — the running pass holds it.
- [ ] Let the sync finish, then try again. Expect `got = t` (release it again afterwards). *Covers AC 1's mechanism.*

## §2 — A second pass is refused rather than reaping

This is the fix. The natural trigger (a stall re-delivery) is not on demand, so the second pass is induced by holding the lock from outside.

- [ ] Take the lock and **hold the session open**:
      ```sql
      SELECT pg_try_advisory_lock(1398361667, hashtext('8339d086-638c-4350-b477-c82944fdbcf1'));
      -- leave this psql session running
      ```
- [ ] Record the entity's live count first: `SELECT count(*) FROM entity_records WHERE connector_entity_id='dee94e06-…' AND deleted IS NULL;`
- [ ] Trigger a `Smoke 3` sync from the UI.
- [ ] Expect it to finish **almost immediately** (seconds, not minutes) and report `completed` — **not** `failed`. *(AC 2.)*
- [ ] Its `result` carries `superseded: true` with zeroed counts, and `supersededBy` naming the other job when one is running:
      ```sql
      SELECT status, progress, result FROM jobs WHERE type='connector_sync'
      ORDER BY created DESC LIMIT 1;
      ```
      *(AC 1.)*
- [ ] **The live count has not moved**, and no rows were tombstoned by that job. This is the whole point — before this branch a second pass would have reaped. *(AC 5.)*
- [ ] Look for `sync-lock.refused` and `connector-sync.superseded` in the API log.
- [ ] Release the held lock (or just `\q` the session — see §3).

## §3 — A dead holder does not wedge the instance

The property the whole design was chosen for: no TTL, no renewal, no operator action.

- [ ] Take the lock in a psql session as in §2, then **kill that session without unlocking** — `\q`, or `kill` the psql process.
- [ ] Immediately trigger a `Smoke 3` sync.
- [ ] Expect a **normal full sync** (minutes, ~397,960 records), not a superseded one — the lock died with the session. *(AC 3.)*

## §4 — The reap no longer runs as one statement

- [ ] During a `Smoke 3` sync, once progress passes 90 (the reap phase), watch:
      ```sql
      SELECT state, wait_event_type, left(query, 60) FROM pg_stat_activity
       WHERE query ILIKE '%entity_records%' AND state <> 'idle';
      ```
      Expect a *succession* of short `UPDATE … entity_records` statements rather than one long-running statement. *(AC 4.)*
- [ ] The whole sync still completes and the counts still balance: `created + unchanged` equals the source's record count.

## §5 — The interleaved loss no longer happens end to end

- [ ] Sync `Smoke 3` and let it finish untouched.
- [ ] Confirm the entity converged to **one** generation and **one** watermark, with the full record count live:
      ```sql
      SELECT count(*) FILTER (WHERE deleted IS NULL)      AS live,
             count(DISTINCT split_part(source_id,':',2))  AS generations,
             count(DISTINCT synced_at)                    AS watermarks
        FROM entity_records
       WHERE connector_entity_id='dee94e06-…' AND deleted IS NULL;
      ```
      Expect `live = 397960`, `generations = 1`, `watermarks = 1`. **Two watermarks is #460 reproducing** — that was the signature of the loss. *(AC 5.)*

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

- [ ] **A genuinely failing sync still fails.** Sync `FAIL SMOKE`. Expect the #441 behaviour intact: `pending` between attempts, `failed` after the third, `attempts = 3`. The lock must not convert a real failure into `superseded`.
- [ ] **Connection headroom.** After several syncs, confirm the pool is not leaking reserved connections:
      ```sql
      SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE '%postgres%' OR datname = current_database();
      ```
      Expect the count to return to its idle baseline. A reserved connection that is never released is permanently gone, so a steadily climbing count is the failure mode to watch.
- [ ] **`layout_plan_commit` is knowingly unprotected** (#461). Committing a layout plan still reaps without the lock. Nothing to verify here — recorded so the gap is not mistaken for an oversight during the walk.

### Not manually verifiable

- **AC 7** — *"`ConnectorSyncResultSchema` declares every field the sync actually returns"*. Nothing parses that schema at runtime (it is a type source via `JobTypeMap`), which is exactly why it had drifted for two tickets before this one — `geometry` (#316) and `mirrorDegraded` (#441) were both returned and persisted while undeclared. There is no runtime behaviour to walk. It is enforced by `npm run type-check` and by reading the diff; recorded here rather than dropped silently.

## Sign-off

- [ ] Every section above verified (or explicitly waived with a reason)
- [ ] ______ (date) — ______ (name) — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (job id / instance id / entity id):
