# Agent-turn gate case 8: freeze the clock — Condensed design (#849)

**Issue:** [EnterpriseBT/portal-ai#849](https://github.com/EnterpriseBT/portal-ai/issues/849) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `agent-turn-gate.integration.test.ts` case 8 posts two messages and expects the second to be refused by a 1-turn-per-minute ceiling. The ceiling counts in fixed UTC minute windows. When the first send lands at `:59.x` and the second at `:00.x` (easy on a loaded CI runner), they fall into different windows, both are allowed, and a required `Integration Tests` check goes red on unrelated PRs (PR #844, run 39814539401). The gate itself is correct; the test depends on the wall clock. This changes `apps/api` tests only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Ceiling | `apps/api/src/services/agent-turn-ceiling.service.ts:39-63` | `checkAdmission(orgId, now = Date.now())`; minute window `MINUTE_MS = 60_000` (`:8`) |
| Window key | `apps/api/src/utils/rate-limit.util.ts:81-94` `incrementFixedWindow` | key `usage:rate:<key>:<floor(now / windowMs)>`; the Redis TTL is relative, so `now` alone picks the window |
| Call site | `apps/api/src/routes/portal.router.ts:826` | `checkAdmission(organizationId)` (real clock) |
| Flaky test | `apps/api/src/__tests__/__integration__/routes/agent-turn-gate.integration.test.ts:136-162` | two real sends, real clock, `expect(second.status).toBe(429)` at `:151` |
| Window maths | `apps/api/src/__tests__/services/agent-turn-ceiling.service.test.ts:77,99` | unit tests already pin `retryAfter` to the minute boundary and UTC midnight |

**Reproduced locally:** a copy of case 8 with only `Date` faked, set to 100 ms before a minute boundary for the first send and 100 ms after it for the second, fails with `Expected: 429, Received: 200`, the CI failure exactly. The same run shows that faking only `Date` works through the whole supertest → Postgres → Redis path: the first send still returns 200.

## Decision: hold `Date.now()` still for case 8 with a spy

The gate reads the clock only through `Date.now()` (`checkAdmission`'s default and `incrementFixedWindow`). Case 8 therefore runs `jest.spyOn(Date, "now").mockReturnValue(instant)`, where `instant` is the real time at the start of the test, so both sends share one window whatever the runner's speed.

- **Why a spy, not `useFakeTimers` (changed in code review).** The first version faked only `Date` through a hand-copied `doNotFake` list of every timer API. A Jest upgrade that added a new fakeable API would silently fake it inside the real supertest, Postgres and Redis path. The spy touches nothing else: timers and `new Date()` stay real.
- **Why the real instant, not :30 of the minute.** A fixed :30 could sit up to 30 s *before* the rows seeded in `beforeAll`, so time on the request path would run backwards. The test computes `Retry-After` from `instant` (`ceil((60 000 − instant mod 60 000) / 1000)`) and asserts that exact value, which is stricter than the old (0, 60] range.
- **Restored in `afterEach` (`jest.restoreAllMocks()`).** A Jest timeout abandons the test body, so a `finally` wouldn't run, and the mocked clock would follow into teardown.
- *Rejected:* waiting until the minute has N seconds left (it shrinks the flake, it doesn't remove it); asserting on the day window (it stops testing case 8, and the flake moves to midnight); an injected clock in the service (a production seam for a test-only need).

## Plan: 1 slice

- **Files:** edit `agent-turn-gate.integration.test.ts`: `Date.now` spy at the test's start instant, `Retry-After` asserted exactly, `afterEach` restore, and a comment naming #849.
- **Tests:** `npm run test:integration --workspace @portalai/api -- --testPathPattern agent-turn-gate` passes. Proof that it no longer depends on the wall clock: temporarily set `instant` to 100 ms before a minute boundary, the instant that failed in the repro, and confirm it still passes with `Retry-After` 1; then revert.

## Smoke (manual, against your dev stack)

1. `npm run test:integration --workspace @portalai/api -- --testPathPattern agent-turn-gate` passes three times in a row, including one run started in the last 5 seconds of a UTC minute (`date -u +%S` ≥ 55 when you press Enter).
2. CI's `Integration Tests` check is green on this PR.

## Out of scope

- The `portal-map.router` hook timeout seen in the same CI run: a separate ticket.
- Sliding windows or other changes to the gate's fixed-window semantics: the gate behaves as designed.
