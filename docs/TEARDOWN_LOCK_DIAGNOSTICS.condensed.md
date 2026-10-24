# Integration teardown that waits on a lock — Condensed design (#850)

**Issue:** [EnterpriseBT/portal-ai#850](https://github.com/EnterpriseBT/portal-ai/issues/850) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The `portal-map` router suite's `beforeEach` once ran past Jest's 60s hook timeout in CI (PR #844, run 39814539401), and `demo-seed`'s hook did the same on run 39875141072. Neither log says what the hook was doing. Package: `apps/api` (integration test utilities only).

## What the investigation found

| Check | Result |
|---|---|
| Does `teardownOrg` slow down with data? | No. Locally it deleted **10,002 rows in 36ms** right after the over-cap test (31–40ms for every other test). Even at 10× on a CI runner that's well under a second, so the 60s was a **wait**, not work. |
| A session left active or in a transaction after a test? | None, locally: a `pg_stat_activity` dump after every `portal-map` test showed no active or open-transaction session. |
| Unindexed FKs making the deletes crawl? | Many exist, but `teardownOrg` deletes children before parents, so each FK check scans an already-empty table. |
| `TRUNCATE` instead? | 23–41ms per call locally for the 40 tables, paid by all ~2,600 tests: minutes per shard. Ruled out. |

So the cause was a lock wait, seen once, under a slow runner, and it doesn't reproduce locally. The holder is unknown.

## Decision — fail fast and name the holder

- **A. Raise the hook timeout.** The issue's own "last resort": it hides the next occurrence.
- **B. Guess at the holder and change the tile service.** Nothing local implicates it; that would be a change without evidence.
- **C. Make the wait visible.** My first version ran the whole teardown as one transaction under `SET LOCAL lock_timeout`. The code review showed that held every teardown lock until commit, so teardown could itself become the blocker, or deadlock with leftover work. The final shape:
  - every delete still **autocommits**, so no lock outlives its statement;
  - a **session `lock_timeout`** (10s, set with parameterized `set_config`, clamped, restored afterwards) bounds each wait;
  - a **budget** (40s) bounds the whole teardown, so sub-timeout waits can't add up past the hook;
  - while a delete waits, a timer reads **`pg_blocking_pids()`** for the teardown's session from a separate short-lived connection, so the error names *the* blocker (capped at 5), not every lock holder;
  - the rethrown error names the table it waited on, keeps the original as `cause`, and a failing diagnostic never replaces it;
  - the audit-log purge flag stays scoped to its own two-statement transaction.

  Every suite uses `teardownOrg`, so every suite gets the diagnostic.

**Chosen: C.** It doesn't paper over the flake, since a real wait still fails the test. The next occurrence's CI log names its cause.

## Plan — 1 slice

**Files**
- Edit: `apps/api/src/__tests__/__integration__/utils/application.util.ts` — `teardownOrg(db, { lockTimeoutMs, budgetMs })` over two ordered table lists, plus `isLockTimeout` and `describeBlockers`.
- New: `apps/api/src/__tests__/__integration__/utils/teardown-org.integration.test.ts`:
  - a seeded org, user and membership are cleared;
  - a second connection holds `ACCESS EXCLUSIVE` on `entity_records`, and `teardownOrg` fails in about 1s (not 120s), naming `entity_records`, with the blocker's query and the original error as `cause`;
  - the connection's `lock_timeout` is restored, even on failure;
  - the budget bounds the whole teardown.

**Tests:** `cd apps/api && npm run test:integration -- --testPathPattern utils/teardown-org`, then the full suite locally, since every suite tears down through it.

## Smoke

1. CI on the PR is green, every shard included, so the per-delete lock timeout and budget change nothing for the suites.
2. If the flake recurs, the failing `beforeEach` fails with `teardownOrg waited 10000ms for a lock clearing <table> (#850)` followed by the blocking session, instead of `Exceeded timeout of 60000 ms for a hook`. Re-open #850 with that output.

## Out of scope

- Fixing the holder itself, until a CI log names it.
- The pool-checkout variant: a hook waiting on a connection from the API's shared pool rather than a lock. `teardownOrg` uses the suite's own connection, so the pool can't block it. If a recurrence shows a timeout *outside* teardown, that's the next lead.
