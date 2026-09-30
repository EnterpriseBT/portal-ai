# Integration Tests docs-only skip base — Condensed design (#663)

**Issue:** [EnterpriseBT/portal-ai#663](https://github.com/EnterpriseBT/portal-ai/issues/663) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The required **Integration Tests** check skips the suite on a docs-only push, deciding "docs-only" by diffing `github.event.before..github.sha`, i.e. against the *previous push*. That's only sound if the previous push's run **passed with the suite**. Two ordinary sequences break it:
1. **Cancelled.** A code push's run is cancelled by the next push (`cancel-in-progress`), and that push is docs-only. The docs run skips and goes green. The code was never integration-tested (PR #662: three code runs cancelled, head green).
2. **Failed.** A code push's run **fails**, then a docs-only push follows. The docs run skips and goes green on head. Branch protection reads head, so a red suite is masked.

Scope: CI only (`.github/workflows/integration-test.yml` plus a small script and its self-test). No app code.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Triggers | `integration-test.yml:3–7` | `push` (non-main) + `workflow_call` (deploy-dev dispatch) |
| Concurrency | `integration-test.yml:39–41` | per-branch group, `cancel-in-progress: true`: the source of case 1 |
| Checkout | `integration-test.yml:53` | `fetch-depth: 0` (full history available to diff) |
| Skip decision | `integration-test.yml:66–87` | base = `github.event.before`; fail-safe `run_tests` on no/zero/missing base, diff failure, empty diff; skip iff every changed path matches `^docs/\|\.md$` |
| Filter-inside-the-job rationale | `integration-test.yml:55–63`, `CLAUDE.md:43` | a required check must always report, so no `paths-ignore` (#427) |
| CI-wiring guard (house pattern) | `scripts/check-ci-cache.mjs` (`lint:ci-cache`, run in `unit-test.yml:79`) | self-tests its rules against embedded fixtures before checking the tree |
| Workflow permissions | none declared in `integration-test.yml` | a run-history lookup needs `actions: read` |

## Decision — what "docs-only since when" means

- **A. Merge base with `main`.** Skip only if the whole branch is docs-only relative to `main`. Simple and sound, but it drops the optimization for the common case: a docs push onto a branch that already has code (every phase-doc commit) would always run the suite.
- **B. The last *successful* Integration Tests run on this branch.** Base = the head SHA of the newest `success` run of this workflow on this branch whose commit is an ancestor of `HEAD`. Skip iff that base..HEAD is docs-only. Cancelled and failed runs are never a base, which closes both cases. It's sound by induction: a successful *skip* at Y was justified by an earlier real pass at X with X..Y docs-only, so Y..HEAD docs-only implies X..HEAD docs-only. Needs `actions: read` and a `gh api` call.
- **C. Turn off `cancel-in-progress`.** Fixes neither: the check on *head* is still the docs run's skip, and case 2 is untouched.

**Decision: B,** with the same fail-safe as today: any doubt runs the suite. That covers no successful run on the branch, an API error, no ancestor among the candidates, a non-`push` event, a diff failure or an empty diff. It keeps the saving where it's legitimate (docs pushes after a green run) and removes it exactly where it lies.

The decision logic lives in `scripts/integration-skip-base.mjs`, a pure `decideIntegrationRun({ event, head, successfulShas, isAncestor, changedFiles })` → `{ run, reason, base }`. It carries an embedded self-test (the `check-ci-cache.mjs` pattern) run in Unit Tests. The workflow step only gathers inputs (`gh api …/actions/workflows/integration-test.yml/runs?branch=<ref>&status=success&per_page=30`, `git merge-base --is-ancestor`, `git diff --name-only`) and calls it.

## Plan — one slice

**Files**
- New: `scripts/integration-skip-base.mjs`:
  - `decideIntegrationRun` (pure);
  - a CLI mode for the workflow: it reads the candidates from `gh`, does the ancestry and diff checks through `git`, and writes `run=` / `reason=` / `base=` to `$GITHUB_OUTPUT`;
  - `--self-test`, with fixtures covering:
    1. last green then docs-only → skip;
    2. green → **cancelled code** → docs → run (base is the green, code in range);
    3. green → **failed code** → docs → run;
    4. no successful run → run;
    5. candidate not an ancestor (force-push) → run;
    6. `workflow_call` → run;
    7. green then code → run;
    8. API error → run.
- Edit: `.github/workflows/integration-test.yml`:
  - `permissions: { contents: read, actions: read }` on the job;
  - the "Does anything outside docs/ change?" step calls the script with `GH_TOKEN: ${{ github.token }}`;
  - the comments explain the new base, and the step logs the base it used.
- Edit: `package.json`: `"lint:integration-skip": "node scripts/integration-skip-base.mjs --self-test"`.
- Edit: `.github/workflows/unit-test.yml`: run `npm run lint:integration-skip` beside `lint:ci-cache`.
- Edit: `CLAUDE.md:43` + `.github/copilot-instructions.md` (its mirror): "a docs-only push **since the branch's last green Integration Tests run** skips the suite".

**Tests**
- `npm run lint:integration-skip`: the 8 fixtures must fail before the logic exists (no module), then pass.
- `npm run lint:ci-cache`: still clean (required-check name and concurrency literals unchanged).
- The Smoke below is the real proof: it runs on GitHub.

## Smoke (against GitHub Actions, on this branch)

1. Push a docs-only commit on top of this branch's own green run. The run log reads `docs-only since <sha> (last green run) — skipping`, and the check is green.
2. **Case 1:** push a trivial code change (e.g. a comment in `apps/api/src/index.ts`), then **immediately** push a docs-only commit, so the first run is cancelled. The second run logs `code changed since <last green sha> — running the suite` and runs 166 suites.
3. **Case 2 (manual, then reverted):** push a commit that makes one integration test fail, let it go red, then push a docs-only commit. The docs run runs the suite and is **red**, not green. Revert both.
4. `gh run view <id> --log` for each shows the chosen base SHA and reason. Unit Tests shows `lint:integration-skip` passing.
5. The PR's required checks report on head in every case: never a missing context.

## Out of scope

- Unit Tests / Static Checks: they never skip, so they're unaffected.
- Changing the concurrency or cancellation policy. `cancel-in-progress` is fine once the base is sound.
- Re-running old PRs' skipped checks. Nothing merged is known to be untested beyond PR #662, whose final code ran (166/166) before merge.
