# Concurrent sync passes reap each other's records — Plan

**Implements the ownership seam that makes the watermark reap safe, TDD-sequenced.**

Spec: `docs/CONCURRENT_SYNC_REAP.spec.md`. Discovery: `docs/CONCURRENT_SYNC_REAP.discovery.md`. Issue: [#460](https://github.com/EnterpriseBT/portal-ai/issues/460), epic child of [#444](https://github.com/EnterpriseBT/portal-ai/issues/444). Builds on #441 (merged into the epic), whose `mirrorDegraded` field is the precedent for how a run reports something the status cannot.

4 slices, each behind a green suite and each leaving the repo compilable. They land as **commits on `fix/concurrent-sync-reap`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from `apps/api` (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

**Sequencing rationale.** Slice 1 is the primitive with no callers, so it can be proven in isolation — including the release-on-session-death property the whole design rests on. Slice 2 wires it at the only two call sites and is where behaviour visibly changes. Slice 3 is independent of 1–2 (it reduces the *trigger*, not the fault) and is sequenced after so a bisect cannot confuse trigger-reduction with the fix. Slice 4 is the end-to-end regression test, which can only be written once the lock exists.

---

## Slice 1 — the lock primitive

`SyncLockService.withInstanceLock` and the reserved-connection accessor it needs. Nothing calls it yet.

**Files**

- New: `apps/api/src/services/sync-lock.service.ts` — `SYNC_LOCK_NAMESPACE`, `SyncLockOutcome<T>`, `withInstanceLock`.
- Edit: `apps/api/src/db/client.ts` — export `reserveConnection`, with the pool-headroom invariant in its JSDoc.

**Steps**

1. **Tests (spec cases 1–6, unit).** `__tests__/services/sync-lock.service.test.ts` with the reserved connection mocked: acquires and runs `fn`; returns `{acquired:false}` and **never calls `fn`** when the lock is refused; releases lock + reservation on success; releases both and rethrows when `fn` throws; releases the reservation even when `pg_advisory_unlock` itself throws; issues the **namespaced two-int form**. Run; fail.
2. **Tests (spec cases 7–9, integration).** `__tests__/__integration__/services/sync-lock.integration.test.ts` against a real database: two concurrent calls on one id → exactly one runs `fn`; different ids do not block; **the lock releases when the holding session ends**. Case 9 is mocked nowhere on purpose — it is the property that justifies choosing a session lock over a TTL lease.
3. **Implement.** `connection.reserve()`, `SELECT pg_try_advisory_lock($1, hashtext($2))`, `finally` releasing unlock-then-reservation, each guarded so a failure in one still frees the other. Green.
4. Lint + type-check.

**Done when:** all 9 cases pass and nothing in the app references the service yet.

**Risk:** `reserve()` semantics under postgres.js 3.4.9 — case 9 is the check. If a reserved connection turns out not to survive as its own session, the design's liveness claim fails here rather than in production, and Decision 2 reopens.

---

## Slice 2 — wire it at both reapers, and report `superseded`

The behaviour change. A pass that cannot acquire does no work and says so.

**Files**

- Edit: `apps/api/src/queues/processors/connector-sync.processor.ts` — wrap the `adapter.syncInstance` call (`:49`); on refusal return zeroed counts + `superseded: true` (+ `supersededBy` when a sibling running job is found).
- Edit: `apps/api/src/queues/processors/layout-plan-commit.processor.ts` — same wrapper keyed by the metadata's `connectorInstanceId`.
- Edit: `packages/core/src/models/job.model.ts` — declare `superseded` / `supersededBy`, **and close the pre-existing drift**: `geometry` (#316) and `mirrorDegraded` (#441) are returned and persisted but undeclared.
- Edit: `apps/api/src/adapters/adapter.interface.ts` — comment only, recording why `SyncInstanceResult` is deliberately *not* extended (a superseded pass never reaches an adapter).

**Steps**

1. **Tests (spec cases 10–13).** Extend `__tests__/queues/processors/connector-sync.processor.test.ts`: lock acquired → adapter called, result passed through unchanged; lock refused → **adapter never called**, result carries `superseded: true` with zeroed counts; `supersededBy` present when a sibling job exists and omitted when not; the job reports a **non-failed** terminal status (#441's principle — nothing failed). Run; fail.
2. **Implement** the wrapper in both processors and the core schema additions. Green.
3. **Mutation-check the guard**: make `withInstanceLock` always report acquired and confirm cases 11–12 fail. A lock that cannot refuse is the whole bug back.
4. Lint + type-check. `packages/core` changes mean building core before the API type-checks — `project_stale_core_dist_after_branch_switch`.

**Done when:** cases 10–13 pass, `ConnectorSyncResultSchema` declares every field the sync actually returns, and both reapers are wrapped.

**Risk:** the `supersededBy` lookup runs on the refusal path only, so a slow query there delays nothing that matters. If it throws, the field is omitted rather than the pass failing — assert that.

---

## Slice 3 — chunk the reap (trigger reduction, *not* the fix)

`softDeleteBeforeWatermark` issued one `UPDATE … RETURNING id` over 431,960 rows and held the event loop long enough to starve BullMQ's lock renewal — the observed trigger.

**Files**

- Edit: `apps/api/src/db/repositories/entity-records.repository.ts` — internal chunking, exported `REAP_CHUNK_SIZE = 5_000`. **Signature unchanged**, so no caller moves.

**Steps**

1. **Tests (spec cases 14–17).** `__tests__/__integration__/db/repositories/entity-records-reap.integration.test.ts`: chunked reap returns exactly the ids it soft-deleted and matches the unchunked result on the same fixture; never touches rows at or above the watermark; `[]` when there is nothing to reap; a multi-chunk reap returns every id **once** — no duplicates, no gaps. Case 17 needs a fixture larger than one chunk, so it drives the batch size down via the export rather than seeding 5,000 rows. Run; fail.
2. **Implement** the loop. Green.
3. Lint + type-check.

**Done when:** 14–17 pass and all four existing callers are untouched.

**Risk:** the chunk loop is the #442 shape — drive it from a `LIMIT`ed subquery, and terminate on a zero-row chunk, not on a count. The #440 cautionary case was a chunk loop that re-picked already-processed rows and exited early; here the soft-delete guard (`deleted IS NULL`) makes each chunk shrink the candidate set, which is what makes termination sound. Say so in-file.

**Label:** the JSDoc must state this reduces the *trigger* and is not the fix. If it is ever mistaken for one and the lock is dropped, the loss returns under a slower reap.

---

## Slice 4 — the interleaved-passes regression test

The test that would have caught #460, and the only one that exercises the whole seam.

**Files**

- New: `apps/api/src/__tests__/__integration__/adapters/concurrent-sync-reap.integration.test.ts`.

**Steps**

1. **Test (spec case 18).** Stage the observed interleaving directly: pass A writes a subset and is suspended; pass B runs to completion including its reap; pass A resumes and flushes its remaining rows. Without the lock this leaves rows tombstoned that exist in the source; with it, pass B never starts and every source record is live.
2. Assert on **row counts and liveness**, never on plan shape or timing (`CLAUDE.md` → "Don't assert query plans in the test suites", and #442's deleted guard).
3. **Verify the test is non-vacuous by mutation** — bypass the lock and confirm this case, and only this case, fails.
4. Lint + type-check.

**Done when:** case 18 passes with the lock and fails without it.

**Risk:** staging a deterministic interleave without real concurrency. Drive it by invoking the two passes with explicit suspend points rather than racing them on wall-clock timing, which would be flaky — the #440 lesson about a flaky case being a test-design fault, not noise.

---

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| 1 | `SyncLockService` + `reserveConnection` | 9 cases; case 9 proves release-on-session-death against a real DB |
| 2 | Both processors wrapped; `superseded` on the result; core schema drift closed | 4 cases + mutation check that a non-refusing lock fails them |
| 3 | Chunked reap | 4 cases; four existing callers unchanged |
| 4 | Interleaved-passes regression | 1 case; passes with the lock, fails without |

## Cross-slice notes

- **`packages/core` is touched in slice 2**, so core must be rebuilt before the API type-checks — a stale `dist` shows up as errors in files you did not touch (`project_stale_core_dist_after_branch_switch`).
- **No migration.** The lock is advisory and `superseded` rides the existing `jobs.result` JSONB. If a migration appears in a diff here, something has gone wrong.
- **Doc sync (`CLAUDE.md` → "Keeping Documentation in Sync").** Slice 2 changes a documented convention: `CLAUDE.md` → "Async Job State & Data Locking" describes the job-level entity lock, which does **not** cover two passes of the *same* job row. That section, and its `.github/copilot-instructions.md` mirror, need the instance-level sync lock added. `apps/api/README.md` gains the reserved-connection invariant. Fold into slice 2's commit or take a fifth docs commit — not a follow-up.
- **Smoke is a separate artifact.** `/smoke` after implementation; §6 of #441's walk (a killed worker records why) is deferred *behind this ticket* and should be picked up in the same session, since a stable reap is what makes that step meaningful.

## Next step

Implementation begins on `fix/concurrent-sync-reap`, slice 1 first, once discovery + spec + plan are confirmed.
