# transform.util perf smoke flakes on wall-clock — Condensed design (#462)

**Issue:** [EnterpriseBT/portal-ai#462](https://github.com/EnterpriseBT/portal-ai/issues/462) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `applyTransform — performance smoke` asserts a wall-clock budget (`expect(elapsed).toBeLessThan(2000)`) over 10,000 records. Elapsed time measures the *machine*, not the code, so the test fails on a loaded box and passes on a bare re-run with no change — a red full-suite run that means nothing and trains people to re-run reds. The comment above the assertion records it was already loosened 250ms → 2000ms once, which is the ratchet tell. Touches one file in `apps/api` (test only, no production code).

## Current shape

| Piece | Location | Note |
|---|---|---|
| The flaky assertion | `apps/api/src/__tests__/adapters/rest-api/transform.util.test.ts:186` | `expect(elapsed).toBeLessThan(2000)` — the only load-dependent line |
| Timing scaffolding | `transform.util.test.ts:175,180` | `const start = Date.now()` / `const elapsed = Date.now() - start` — dead once the assertion goes |
| Correctness assertions (keep) | `transform.util.test.ts:181-182` | `result.error` is null and 5,000 of 10,000 records come back — the part that can actually regress |
| The rule this generalizes | `CLAUDE.md` → "Indexing and ordering a table that will grow (#433)" | "Don't assert query plans in the test suites" — same class; a #433 plan guard was deleted for it |

## Decision — delete the timing assertion, keep the correctness case (option 1)

The issue lays out three options: (1) drop the timing assertion and keep the correctness one; (2) assert a load-independent algorithmic invariant (10× input ≠ ~100× time, two runs same machine/run); (3) keep it but mark it a benchmark excluded from the default suite.

**Chosen: option 1.** The `describe`/`it` block stays and still pushes 10,000 records through the transform, asserting no error and that the `active = true` filter returns exactly 5,000 — which is the behavior that can break. The wall-clock budget told us nothing a passing threshold couldn't, and CLAUDE.md's existing guidance points the same way: assert correctness in the suite, keep performance evidence as a recorded measurement against production-sized data, not a fixture. Option 2 measures the code rather than the box but is still a timing comparison (both runs can be perturbed unevenly under load) for a transform path with no current complexity concern — not worth the added surface here. Option 3 keeps a test nothing runs. The `it` title drops "in under 2000ms" so it no longer advertises a budget it doesn't enforce.

## Plan — 1 slice

**Slice 1 — remove the wall-clock assertion.**

- **Files:** edit `apps/api/src/__tests__/adapters/rest-api/transform.util.test.ts` — delete `start`/`elapsed` lines and the `expect(elapsed)...` line plus its 3-line loosening comment; retitle the `it` to drop the duration claim (e.g. "handles 10 000 records (project + filter)"). Keep the `error`/`toHaveLength(5_000)` assertions.
- **Tests:** the edited file *is* the test. Run `npm run test:unit -- --testPathPattern transform.util` from `apps/api/` and confirm the `applyTransform — performance smoke` block still passes with the correctness assertions intact.

## Smoke (manual, against your dev stack)

1. From `apps/api/`, run `npm run test:unit -- --testPathPattern transform.util` → the suite passes; the `applyTransform — performance smoke` case runs and asserts 5,000 records returned with no error.
2. Confirm no `Date.now()` / `elapsed` / `toBeLessThan` remains in `transform.util.test.ts` (`grep -nE "Date.now|elapsed|toBeLessThan" apps/api/src/__tests__/adapters/rest-api/transform.util.test.ts` → no output).
3. Sanity: the file's other 13 cases still pass (whole file green in the run from step 1).

## Out of scope

- Any load-independent performance guard (issue option 2) — deferred; add only if a real complexity regression concern appears, and as a recorded measurement per CLAUDE.md, not a suite assertion.
- Auditing other suites for wall-clock assertions — this ticket fixes the one flake it was filed for; a broader sweep is its own task.
