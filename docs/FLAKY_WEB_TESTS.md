# Flaky web userEvent-timeout tests — Condensed design (#362)

**Issue:** [EnterpriseBT/portal-ai#362](https://github.com/EnterpriseBT/portal-ai/issues/362) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `userEvent`-heavy `apps/web` unit tests intermittently exceed the **5000 ms** per-test timeout under full-suite / CI contention (they pass in isolation). One flake **skips the whole app-dev deploy** — `unit-test` is a `needs` gate on `deploy-dev.yml` — and it already failed the #358 deploy. Single package: `apps/web`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Flake #1 | `apps/web/src/workflows/RestApiConnector/__tests__/ApiEndpointForm.test.tsx:546` ("clears the validation warning when the user edits the transform textarea") | Uses the **top-level `userEvent.*` API** (26 such calls in the file), which keeps the per-keystroke delay. Ends in `userEvent.type(…, "_edited")`. |
| Flake #2 | `apps/web/src/workflows/FileUploadConnector/__tests__/FileUploadConnectorWorkflow.test.tsx:393` ("Apply in the popover fires onUpdateBinding…") | Uses `userEvent.setup()` **without** `{ delay: null }` (`:394`). |
| Existing precedent | same `ApiEndpointForm.test.tsx:328` | Other tests in the *same file* already use `userEvent.setup({ delay: null })` — "removes the inter-event event-loop yields". The flaky one just wasn't migrated. |
| Timeout | `apps/web/jest.config.js` | **No `testTimeout`** → the Jest default 5000 ms, which is tight for a loaded 238-suite parallel run doing async RTL work. |

The `setState`-in-render warning seen near the failure in CI logs comes from a *different* file (`Toast.provider.test.tsx`'s `Probe`) bleeding through the parallel run — **not** the cause here.

## Decision — remove the per-keystroke delay + a global timeout floor

Two layers, both behaviour-preserving:

1. **Root cause — `userEvent.setup({ delay: null })` on the two flaky tests.** `delay: null` drops the artificial inter-event event-loop yields (the file already uses this idiom), so the interactions run promptly instead of accumulating wall-clock under contention.
   - ApiEndpointForm flaky test: pass `{ delay: null }` to the slow `userEvent.type(…, "_edited")` call (the clicks are fast; the typing carried the delay).
   - FileUpload flaky test: add `{ delay: null }` to its `userEvent.setup()`.
2. **Safety net — `testTimeout: 15_000` in `jest.config.js`.** These tests do milliseconds of real work; the 5 s default trips only because a contended CI worker inflates wall-clock. A 15 s floor absorbs that for the whole suite without masking a genuine hang, and the repo currently has none.

Scoped to the two named tests (the reported flakes) plus the one-line config; a full-file migration of every `userEvent.*` call is out of scope (the safety net covers the rest).

## Plan — 1 slice

**Files**
- Edit `apps/web/src/workflows/RestApiConnector/__tests__/ApiEndpointForm.test.tsx` — flaky test uses `userEvent.setup({ delay: null })`.
- Edit `apps/web/src/workflows/FileUploadConnector/__tests__/FileUploadConnectorWorkflow.test.tsx` — flaky test's `setup()` gains `{ delay: null }`.
- Edit `apps/web/jest.config.js` — add `testTimeout: 15_000`.

**Tests** (`cd apps/web && npm run test:unit`)
- The two named tests still pass (behaviour unchanged). No new case — this is a reliability fix; verification is running the suite (below).

## Smoke (manual, against your dev stack)

This is a test-reliability fix, so the "smoke" is a repeated test run rather than a UI walkthrough:

1. `cd apps/web && npm run test:unit -- "ApiEndpointForm|FileUploadConnectorWorkflow"` — both suites green, and the two named tests complete well under the timeout.
2. Run the **full** suite `npm run test:unit` (the loaded/parallel path that provokes the flake) a couple of times — **no timeout failures**; total suite green.
3. CI on the PR (the real contended environment) is green across unit + integration — the true confirmation.

## Out of scope

- Migrating every `userEvent.*` call in these files to the setup pattern — the safety-net timeout covers untouched tests; a broader sweep can follow if flakes recur elsewhere.
- The `Toast.provider` `Probe` `setState`-in-render warning — cosmetic console noise from a different file; not this flake.
