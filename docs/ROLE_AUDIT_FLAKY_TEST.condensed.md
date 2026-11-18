# Role-create audit assertion races the audit write — Condensed design (#1048)

**Issue:** [EnterpriseBT/portal-ai#1048](https://github.com/EnterpriseBT/portal-ai/issues/1048) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `AuditService.record` is fail-open and most callers fire it with `void` after the action commits, so the response returns before the audit row exists. Integration tests that read `audit_log` straight after the request race that insert; one lost the race in CI on PR #1047 and turned the required `Integration Tests` check red on an unrelated diff. The fix is in the tests (`apps/api` only): wait for the row instead of assuming it is there.

## Current shape

Paths are under `apps/api/src/`; test paths under `__tests__/__integration__/`.

| Piece | Location | Note |
|---|---|---|
| Audit write | `services/audit.service.ts:46` | `async record()`, never throws; the doc comment says to call it after the commit so it can't block the action |
| Unawaited callers | `services/role.service.ts:267` and 36 more | 37 of 40 call sites are `void`; only `station.router`, station attachments and org update `await` |
| **Reads with no wait** | `routes/role.router.integration.test.ts:194`, `routes/policy.router.integration.test.ts:175` | the failing test, and the same shape for `policy.create` |
| Reads after a fixed sleep | `routes/organization.router.member-role…:157` (75 ms), `services/seat.service…:144,204,228,466,559` (60 ms), `tools/rbac-tools…:175` (80 ms), `services/audit-emission…:114` (50 ms), `services/ensure-provisioned…:199,592,624,652` (75 ms) | the same race with a head start |
| Sleeps before "no new row" | `services/ensure-provisioned…:221,639,685` | a no-op call, a deduped login, six concurrent logins: the wait is there to let an unwanted row show up |
| Existing poll helpers | `routes/organization.router.rename…:64` (`eventually`, 5 s deadline, 50 ms step), `routes/station.router…:807` | two local copies of the right answer (#907, #935) |
| Safe as written | `routes/station-attachments.router…:191`, `tools/curated-view-tools…:760` | their service awaits the audit write |

## Decision — how the tests wait

1. **Poll for the row, from one shared helper.** Move `eventually` to `__tests__/__integration__/utils/eventually.util.ts` with an optional `done` predicate (default: truthy) and return the last value on timeout, so a missing row still fails on the test's own `expect` with its real message.
2. Await the audit write in the services. Rejected: 37 call sites deliberately don't hold the response for the audit store, and the ticket excludes it.
3. A drain hook on `AuditService` (track in-flight writes, `await AuditService.settled()`). Deterministic, and it would make the "no new row" checks sound too, but it adds production state that only tests would read. Not for a flaky-test fix.

**Chosen: 1.** Applied to:

- the two reads with no wait (role, policy): the bug;
- the sleep-then-expect-a-row sites listed above: the sleep becomes the poll. Same assertion, no fixed delay, and no 50–80 ms bet on a loaded runner;
- `organization.router.rename` imports the shared helper in place of its local copy.

Left alone: the three "no new row" sleeps (a poll can't prove absence, so a settle wait is the honest tool), `station.router`'s helper (it filters on metadata and has its own no-op branch), and the `afterEach` sleeps that let stragglers land before teardown.

## Plan — one slice

**Files**
- New: `apps/api/src/__tests__/__integration__/utils/eventually.util.ts` — `eventually<T>(read, done = Boolean, timeoutMs = 5_000)` and `atLeast(n)`, a `done` for row reads.
- Edit: `routes/role.router.integration.test.ts`, `routes/policy.router.integration.test.ts` — wrap the audit select: `await eventually(readAudits, atLeast(1))`.
- Edit: `routes/organization.router.member-role…`, `services/seat.service…`, `tools/rbac-tools…`, `services/audit-emission…`, `services/ensure-provisioned…` — replace each sleep-then-read with the poll.
- Edit: `routes/organization.router.rename.integration.test.ts` — drop the local `eventually`, import the shared one.

No new test file, so `durations.json` and the shard plan are unchanged. Test names are untouched; diff them before committing.

**Tests**
- `npm run test:integration` in `apps/api`, limited to the eight touched files.
- `npm run lint`, `npm run type-check`, `npm run format:check`.

## Smoke (against a local Postgres + Redis; no UI)

1. Add a temporary 100 ms delay at the top of `AuditService.record` (under the suites' 150 ms teardown wait, so no row lands after its org is torn down) and run `main`'s versions of the touched suites: the role and policy audit tests fail with `Expected length: 1, Received length: 0`, the CI failure, and so does every sleep-then-read test.
2. This branch's versions with the same delay: all eight suites pass. Remove the delay.
3. On this branch without it: the eight suites pass three runs in a row.
4. CI: `Integration Tests` green on the PR.

## Out of scope

- Awaiting or draining audit writes in production code (options 2 and 3).
- Whether an in-flight audit write survives a shutdown (`utils/shutdown.util.ts`). Not checked here; worth its own ticket if it matters.
- Fixed sleeps in integration tests that wait on something other than an audit row.
