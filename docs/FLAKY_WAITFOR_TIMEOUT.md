# Flaky `waitFor` timeout under suite load — Condensed design (#378)

**Issue:** [EnterpriseBT/portal-ai#378](https://github.com/EnterpriseBT/portal-ai/issues/378) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `use-widget-refresh.util.test.ts`'s "a 422 marks the widget not refreshable instead of erroring (regression)" intermittently fails in a full `apps/web` run (**1280 ms**) and passes in isolation (**91 ms**). The gap is the diagnosis: nothing is broken, an async budget is being exceeded under worker contention. The budget is **not** Jest's — #363 already raised `testTimeout` to 15 s. It is Testing Library's own `asyncUtilTimeout`, which defaults to **1000 ms** and which #363 never touched. So this is the missing half of that fix, and it applies to every `waitFor` in the package, not one test. Single package: `apps/web`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| The flaky case | `apps/web/src/__tests__/use-widget-refresh.util.test.ts:114-123` | `await waitFor(() => expect(result.current.notRefreshable).toBe(true))` after a mocked rejection. No explicit timeout. |
| The hook | `apps/web/src/utils/use-widget-refresh.util.ts:73-99` | `refresh()` awaits one mutate, catches, sets state in a `finally`. Genuinely fast — there is no delay, retry, or timer to blame. |
| Jest budget | `apps/web/jest.config.js:9` | `testTimeout: 15_000` — raised by #363 for exactly this contention. Not the binding constraint here. |
| **RTL budget** | *nowhere* | No `configure()` call exists in the package. `@testing-library/dom@10.4.1` defaults `asyncUtilTimeout` to **1000 ms** (verified against the installed `dist/config.js`). |
| Blast radius | 46 test files use `waitFor` | All of them run on the same 1 s budget today. |
| Setup file | `apps/web/src/__tests__/setup.ts` | `setupFilesAfterEach` target; already holds the jsdom polyfills and observer stubs. The natural home for an RTL `configure()`. |
| Precedent | `docs/FLAKY_WEB_TESTS.md` (#362/#363) | Same family, same cause (contention), same two-layer shape: fix the specific test, then raise the global floor. |

## Decision — raise the RTL async budget in `setup.ts`

Three options were considered:

1. **Per-test `waitFor(..., { timeout })`** on the one failing case. Fixes the symptom where it was observed and leaves 45 other files on a 1 s budget, so the next flake is somebody else's afternoon. Rejected.
2. **Rewrite the test to be event-driven** rather than polled. There is nothing to drive — the hook's state settles from a promise rejection, which is what `waitFor` is *for*. Rejected: the test isn't wrong.
3. **A global `configure({ asyncUtilTimeout })` in `setup.ts`.** Chosen.

**Chosen: option 3, at 5000 ms.** It is the exact analogue of what #363 did for Jest, one layer down: a budget sized for an idle machine is wrong for a 239-suite parallel run, and the fix is to size it for the machine we actually run on. 5 s is generous enough to absorb contention (the observed failure needed only ~1.3 s) while staying well inside the 15 s Jest ceiling — so a genuine hang still fails as a hang, and fails *as the test*, not as a suite-level timeout.

This is a **test-infrastructure change only**. No production code moves, and the assertion in the flaky test is unchanged — the thing being asserted was never in question.

## Plan — 1 slice

**Files**

- Edit: `apps/web/src/__tests__/setup.ts` — import `configure` from `@testing-library/react` and set `asyncUtilTimeout: 5_000`, with a comment naming #378/#362 and why the number is what it is.

**Tests**

- `cd apps/web && npm run test:unit -- use-widget-refresh` — the previously flaky file passes.
- `cd apps/web && npm run test:unit` — full suite green.
- No new test case. A flake fix has nothing to assert: the behaviour under test already had a passing assertion, and "does not flake" is not expressible as a unit test. The verification is the repeated full-suite runs in Smoke below.

## Smoke (manual, against your dev stack)

1. `git checkout fix/flaky-waitfor-timeout && npm install`
2. `cd apps/web && npm run test:unit -- use-widget-refresh` → the 422 case passes, and its reported time is back in the tens of milliseconds.
3. `cd apps/web && npm run test:unit` → full suite green (239 suites).
4. **Run the full suite three more times.** This is the actual test of the fix — a flake that reproduces roughly once in several loaded runs is only disproved by repetition. Watch specifically for `use-widget-refresh` and for any *other* `waitFor` case surfacing.
5. Load it deliberately: run the root `npm run test:unit` (all 11 packages in parallel) and confirm `apps/web` passes. Note that `@portalai/api` may still exit non-zero here — that is **#377**, a separate bug, not this one.
6. Confirm no test got *slower* to fail: pick a test you expect to fail, break it locally (e.g. flip an assertion), and check it still fails in a few seconds rather than hanging for 15.

## Out of scope

- **#377** — the `@portalai/api` worker-teardown exit under the parallel root run. Different package, different cause (a leaked handle, not a timeout); filed separately and cross-referenced.
- Auditing the other 45 `waitFor` files for tests that *should* be event-driven. The global budget fixes the class; individual tests that are slow for a real reason are their own findings.
- Jest `maxWorkers` tuning or any change to how CI parallelises. That would trade wall-clock for stability across the whole repo and deserves its own decision.
- Raising `asyncUtilTimeout` in `packages/core` or elsewhere. Only `apps/web` has the observed problem; copying a number into other packages pre-emptively is speculative.
