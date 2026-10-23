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

## Decision: freeze only `Date`, mid-minute, for case 8

- **Freeze `Date` (chosen).** `jest.useFakeTimers({ now, doNotFake: [every timer API] })` makes `Date.now()` constant. Postgres, Redis and supertest keep their real `setTimeout`, `setImmediate` and `nextTick`. Freeze at 30 s into the current minute so both sends share one window, whatever the runner's speed. Restore with `jest.useRealTimers()` in a `finally`, so a failed assertion can't leak a frozen clock into later tests in the file.
- *Wait until the minute has N seconds left (rejected).* It adds up to N seconds per run, and a slow enough runner still crosses the boundary: it shrinks the flake rather than removing it.
- *Assert on the day window instead (rejected).* That stops testing case 8's per-minute denial, and the same flake moves to UTC midnight.
- *An injected clock in the service (rejected).* It adds a production seam for a test-only need. `checkAdmission` already takes `now`, and the route not passing it is correct.

The assertion stays as strict as it was: the second send must be `429 AGENT_TURN_LIMITED` with `Retry-After` in (0, 60] and nothing written. Frozen at `:30`, `Retry-After` is exactly 30.

## Plan: 1 slice

- **Files:** edit `agent-turn-gate.integration.test.ts`: add a date-only fake-timer config, freeze at the current minute + 30 s inside case 8, restore in `finally`, and add a comment naming #849. Assert `Retry-After === 30` (deterministic now) in place of the (0, 60] range.
- **Tests:** `npm run test:integration --workspace @portalai/api -- --testPathPattern agent-turn-gate` passes. Proof that it no longer depends on the wall clock: temporarily move the freeze to `minute − 100 ms`, the instant that failed in the repro, and confirm it still passes (both sends share the frozen instant); then revert.

## Smoke (manual, against your dev stack)

1. `npm run test:integration --workspace @portalai/api -- --testPathPattern agent-turn-gate` passes three times in a row, including one run started in the last 5 seconds of a UTC minute (`date -u +%S` ≥ 55 when you press Enter).
2. CI's `Integration Tests` check is green on this PR.

## Out of scope

- The `portal-map.router` hook timeout seen in the same CI run: a separate ticket.
- Sliding windows or other changes to the gate's fixed-window semantics: the gate behaves as designed.
