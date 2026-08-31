# apps/api unit suite leaks a Redis handle → worker can't exit — Condensed design (#377)

**Issue:** [EnterpriseBT/portal-ai#377](https://github.com/EnterpriseBT/portal-ai/issues/377) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** A full-repo `npm run test:unit` intermittently exits 1 with `A worker process has failed to exit gracefully`, naming no failing test — training people to re-run reds. Root-caused to unit tests that open a real Redis connection nothing closes: one at the original scan, plus a second instance of the same class (#425's cascade guard) that landed while this ticket was in flight. Single-package (`apps/api`), test-only change.

## Root cause (found, not guessed)

`revalidation.processor.test.ts` mocks `db.service`, `normalization.service`, and `db/schema`, but **not** `entity-record-count.cache.js`. It imports the real `revalidation.processor.js`, which on completion calls `EntityRecordCountCache.invalidate()` → `getRedisClient()`, eagerly opening an **ioredis** socket to `REDIS_URL` (default `redis://localhost:6380`). No unit test calls `closeRedis()`, so the socket (plus its reconnect timer when Redis is unreachable) stays open and the jest **worker that ran this file cannot exit**.

Why it hid so well:
- Under **default parallel workers** the stuck worker is force-exited with the generic warning — intermittent, because it depends on which worker drew the file and the shutdown-grace timing. Reproduced 2/2 at full-suite scale.
- Under **`--detectOpenHandles`** (which forces `--runInBand`) the process **hangs forever** on the un-attributable native socket instead of printing an "open handles" section — which is exactly why the issue's suggested command never surfaced it.
- Running the file **alone** in default mode hangs deterministically (`timeout` → exit 124) — the signal used to localize it out of 193 files.

| Piece | Location | Note |
|---|---|---|
| The leaking test | `apps/api/src/__tests__/queues/processors/revalidation.processor.test.ts` | mocks 3 deps, misses `entity-record-count.cache` |
| A second leaker, same class | `apps/api/src/__tests__/db/repositories/cascade-count-no-returning.test.ts` | landed via #425 (`fd38c5c7`) after the original per-file scan; imports the real `EntityRecordsRepository`, whose `softDeleteByConnectorEntityId(s)` call `invalidateCounts` → `EntityRecordCountCache.invalidate` → `getRedisClient()`. Localized by re-running the per-directory/per-file hang scan when the warning persisted post-fix |
| The real Redis call | `apps/api/src/queues/processors/revalidation.processor.ts:128` | `await EntityRecordCountCache.invalidate(connectorEntityId)` (the repository path: `entity-records.repository.ts:797`) |
| Lazy-but-eager client | `apps/api/src/services/entity-record-count.cache.ts:78,100,126,153` | each method calls `getRedisClient()` |
| Connection factory | `apps/api/src/utils/redis.util.ts:10-21` | `new Redis(REDIS_URL, …)` — connects immediately; `closeRedis()` (`:23`) is the only teardown |
| Default URL | `apps/api/src/environment.ts:94` | `redis://localhost:6380` |

## Decision — mock the cache in the unit test (not a blanket teardown net)

Two directions: (a) mock `entity-record-count.cache.js` in this one test so it stays a pure unit test — matching how its sibling processor tests already mock their service deps; (b) add a global `afterAll(closeRedis)` net (via `setupFilesAfterEach`) that closes the shared client after every file.

**Chosen: (a).** The per-file-alone scan localizes leaking files deterministically (a leaker hangs when run alone), and a unit test has no business touching real Redis — the mock set was simply incomplete. (b) was rejected as the primary fix: a blanket `closeRedis` after every file **masks** the next occurrence of this class instead of surfacing it (same objection as `--forceExit`), and it wouldn't cover connections other than the main singleton anyway. The honest fix is to complete each test's mocks. That "next occurrence" was not hypothetical — #425 added one mid-ticket (slice 2), which also validates the rejection of (b): the net would have hidden it.

## Plan — 2 slices

**Slice 1 — mock `entity-record-count.cache.js` in the revalidation test.**
- **Files:** `apps/api/src/__tests__/queues/processors/revalidation.processor.test.ts` — add a `jest.unstable_mockModule("../../../services/entity-record-count.cache.js", …)` returning `{ EntityRecordCountCache: { invalidate: jest.fn().mockResolvedValue(undefined) } }`, alongside the existing mocks. (No production code changes.)
- **Tests:** the file is its own test. Verify:
  - `npm run test:unit -- --testPathPattern revalidation.processor` from `apps/api/` → passes and the process exits cleanly (no hang).

**Slice 2 — same mock in the #425 cascade guard.**
- **Files:** `apps/api/src/__tests__/db/repositories/cascade-count-no-returning.test.ts` — same `jest.unstable_mockModule` for `entity-record-count.cache.js`; the five repository imports become top-level-`await` dynamic imports so the mock is registered first (the standard ESM-mock shape here). (No production code changes.)
- **Tests:** the file is its own test. Verify:
  - `npm run test:unit -- --testPathPattern cascade-count-no-returning` from `apps/api/` → 18 tests pass, exits cleanly (previously hung, exit 124).
  - Full `npm run test:unit` from `apps/api/` (default parallel), 3 runs → no `failed to exit gracefully` line in any.

## Smoke (manual, against your dev stack)

1. From `apps/api/`, `timeout 45 npm run test:unit -- --testPathPattern revalidation.processor` → exits within seconds (exit 0), 5 tests pass. Before the fix this hung until the timeout (exit 124).
2. From `apps/api/`, `timeout 45 npm run test:unit -- --testPathPattern cascade-count-no-returning` → exits within seconds (exit 0), 18 tests pass. Before the fix this hung until the timeout (exit 124).
3. From `apps/api/`, run the full suite a few times: `for i in 1 2 3; do npm run test:unit >/tmp/r$i.log 2>&1; grep -c "failed to exit gracefully" /tmp/r$i.log; done` → prints `0` each run.
4. From the repo root, `npm run test:unit` → `@portalai/api#test:unit` passes, exit 0. Note: on a loaded machine the full-parallel root run can still *print* the force-exit warning (for api, core, and web alike) — that is contention-slowed worker shutdown, not a leak, and it does not fail the run. The leak signature is the warning **when a package's suite runs alone**, or a file that hangs when run by itself.

## Out of scope

- **A guard that fails when any unit test opens a real Redis/DB socket** — would prevent recurrence of the whole class, but is its own design (async-hooks or a `getRedisClient` test-env assertion) and larger than this bug. Noted for a follow-up.
- **`--forceExit` on the test script** — rejected; it hides real leaks rather than fixing them.
- **The sibling `use-widget-refresh.util.test.ts` timeout flake** — filed separately, different cause.
- **The `transform.util.test.ts` performance-smoke flake** — its 2000ms wall-clock budget (`applyTransform` over 10K records) can lose to CPU contention under the full-parallel root run (measured 2784ms once, passing on re-run). Different cause: a real-time budget vs. machine load, not a handle leak.
