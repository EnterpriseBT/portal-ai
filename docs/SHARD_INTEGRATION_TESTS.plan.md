# Shard the integration test suite — Plan

**This plan implements the sharded `Integration Tests` check test-first: a duration-balanced Jest sequencer, the shard env contract with turbo, the demo-seed split, a durations file with its ceiling and refresh, the planner, the rewritten workflow behind one summary check, and the weekly refresh PR.**

Spec: `docs/SHARD_INTEGRATION_TESTS.spec.md`. Discovery: `docs/SHARD_INTEGRATION_TESTS.discovery.md`. Issue: #857. It builds on #454 (turbo remote cache and `lint:ci-cache`) and #663 (docs-only skip).

There are eight slices. Each sits behind a green test suite and leaves the repo green. They land as **commits on `chore/857-shard-integration-tests`**: one ticket, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run checks with the npm scripts; never invoke jest directly (`feedback_use_npm_test_scripts`):

```bash
npm run lint:integration-shards      # root; self-test of scripts/integration-shards.mjs (from slice 1)
npm run lint:ci-cache                # root; self-test + real tree
cd apps/api && npm run test:integration -- --testPathPattern <file>
```

Each slice follows the same loop:

1. Write the failing self-test cases or fixtures.
2. Make the smallest change that turns them green.
3. Run the focused checks.
4. Run `npm run lint && npm run type-check && npm run format:check` at the boundary.
5. Move to the next slice.

## Sequencing rationale

The pure pieces land first and the workflow last, so every slice is green on today's single-job workflow until slice 6 switches it.

- **Slice 1:** the packer and sequencer. Leaf logic, and the property the whole design rests on: every file runs exactly once.
- **Slice 2:** the `INTEGRATION_SHARD` contract (npm script, turbo hash and outputs) plus rule 6. It's inert until a workflow sets the variable.
- **Slice 3:** the demo-seed split. Independent; it shrinks the largest unit before durations are recorded.
- **Slice 4:** the durations writer, the initial file and the ceiling lint. It needs slice 3, so the recorded biggest file is the split one.
- **Slice 5:** the planner. It reads slice 4's file.
- **Slice 6:** the workflow, the summary and the tightened rule 3. It uses 1, 2, 4 and 5; this is where CI changes shape.
- **Slice 7:** the scheduled refresh PR and the `workflow_dispatch` triggers. It needs slice 6's shard reports to exist.
- **Slice 8:** docs. They describe the finished shape.

---

## Slice 1 — The packer, the sequencer, and the shard library

`assignShards` and `IntegrationSequencer` land in `apps/api`, plus the root `scripts/integration-shards.mjs` with its self-test harness and the `assignShards` cases.

**Files**

- New: `apps/api/jest.integration.sequencer.mjs` — `assignShards(files, durations, shardCount)`, `DURATIONS_PATH`, and the default `IntegrationSequencer` with `shard()`.
- Edit: `apps/api/jest.integration.config.js` — `testSequencer: "<rootDir>/jest.integration.sequencer.mjs"`.
- New: `scripts/integration-shards.mjs` — the exported constants and the `--self-test` harness, with the `assignShards` cases imported from the sequencer.
- Edit: root `package.json` — `"lint:integration-shards": "node scripts/integration-shards.mjs --self-test"`.
- Edit: `.github/workflows/unit-test.yml` — a step running `npm run lint:integration-shards`, after `lint:integration-skip`.

**Steps**

1. **Tests (spec → self-test, `assignShards` cases).** Write these cases:
   - every file lands exactly once, for sizes 0, 1, N−1, N and 198;
   - the result is deterministic;
   - an unknown file gets the median weight;
   - the heaviest shard is at most ideal + the largest file;
   - `shardCount = 1` returns every file.

   Run `npm run lint:integration-shards`; it fails.
2. **Implement** `assignShards` (sort by weight desc, then path asc; place each file on the lightest shard, ties to the lowest index) and `shard()`. Green.
3. **Check that local runs are unchanged.** `cd apps/api && npm run test:integration -- --listTests` lists the same 198 files as before, and the sequencer's `shard()` isn't called.
4. **Check the real shard path by hand.** `INTEGRATION_SHARD` isn't wired yet, so pass the flag through the npm script: `npm run test:integration -- --listTests --shard=1/5` through `--shard=5/5`. The five lists' union is the full list, with no overlap.
5. Lint and format check.

**Done when:** the self-test passes, the five `--listTests` shards partition the 198 files, and unsharded local runs are unchanged.

**Risk:** loading the ESM sequencer from Jest 29's CJS runner. Under ESM interop `@jest/test-sequencer`'s class is at `.default.default`, and the spec's `BaseSequencer.default ?? BaseSequencer` covers both forms. Step 4 proves it in Jest itself.

---

## Slice 2 — The `INTEGRATION_SHARD` contract + rule 6

The shard reaches Jest through the npm script and reaches turbo's hash through `env`. The report becomes a cached output. Rule 6 guards the contract.

**Files**

- Edit: `apps/api/package.json` — `test:integration` gains `${INTEGRATION_SHARD:+ --shard=$INTEGRATION_SHARD --json --outputFile=jest-integration-report.json}`.
- Edit: `turbo.json` — `test:integration.env` += `"INTEGRATION_SHARD"`, `outputs: ["jest-integration-report.json"]`, plus comments.
- Edit: root `.gitignore` — `jest-integration-report.json`.
- Edit: `scripts/check-ci-cache.mjs` — load the root `turbo.json` with `parseJsonc` as `rootTurbo`, add rule 6, and add three fixtures: shard var in `env` → clean; missing from `env` → rule 6; in `passThroughEnv` → rule 6.

**Steps**

1. **Fixtures (spec → `check-ci-cache` rule 6 fixtures).** Run `npm run lint:ci-cache`; the new fixtures fail.
2. **Implement** rule 6 and the `turbo.json` edits. The self-test passes, and the real tree is clean (no workflow sets the variable yet, so rule 6 is satisfied).
3. **Check the npm script both ways.**
   - Unset: `cd apps/api && npm run test:integration -- --testPathPattern health` produces no report file.
   - Set: `INTEGRATION_SHARD=1/198 npm run test:integration -- --listTests` lists one file. A run with `INTEGRATION_SHARD=1/5` restricted by `--testPathPattern` writes `jest-integration-report.json`.
4. **Check the hash.** `turbo run test:integration --dry=json --filter @portalai/api` with `INTEGRATION_SHARD=1/5` and with `2/5` gives two different task hashes, and the env shows the variable as hashed.

**Done when:** rule 6's fixtures pass, the real tree is clean, the hash differs per shard, and unsharded runs write no report.

**Risk:** `${VAR:+…}` needs a POSIX shell. npm runs scripts with `sh` on Linux and macOS, which covers CI and the devcontainer. Windows isn't a supported dev platform.

---

## Slice 3 — Split demo-seed by concern

**Files**

- New: `apps/api/src/__tests__/__integration__/utils/demo-seed.util.ts` — the shared `beforeEach`/`afterEach` setup, `provisionOrg`, `rawCount`, `entityIdByKey` and `EXPECTED`, moved verbatim.
- New: `services/demo-seed.counts.integration.test.ts` (tests 1–4), `services/demo-seed.toolpacks.integration.test.ts` (5–7), `services/demo-seed.reset.integration.test.ts` (8–9).
- Delete: `services/demo-seed.service.integration.test.ts`.

**Steps**

1. **Tests.** This is a move, so the tests are the existing nine. Run `npm run test:integration -- --testPathPattern demo-seed` before the move and record nine tests passing.
2. **Move** the tests and helpers, keeping every assertion and timeout (the two 90s timeouts stay on tests 4 and 8).
3. Re-run with the same pattern: 3 suites, 9 tests, all passing. Then lint, type-check and format check for `apps/api`.

**Done when:** the same nine tests pass across three files, and no assertion was edited (`git diff -M` shows moves plus helper extraction only).

**Risk:** a helper that closes over a per-file `db`/`connection`. The util exports a setup that takes and returns them, rather than holding module state.

---

## Slice 4 — Durations: writer, initial file, ceiling lint

**Files**

- Edit: `scripts/integration-shards.mjs` — `mergeReports`, `durationsChanged`, `ceilingViolations`, `CEILING_ALLOWLIST = []`, and the `update-durations` and `check-durations` subcommands.
- New: `apps/api/src/__tests__/__integration__/durations.json`.
- Edit: root `package.json` — `"lint:integration-durations": "node scripts/integration-shards.mjs check-durations"`.
- Edit: `.github/workflows/unit-test.yml` — a step running `npm run lint:integration-durations`.

**Steps**

1. **Tests (spec → `mergeReports`, `durationsChanged`, `ceilingViolations` cases).**
   - `mergeReports` makes paths relative and drops a file no longer present.
   - `durationsChanged`: added, removed, small move (false), big move (true).
   - `ceilingViolations`: an entry over 120s is listed; an allowlisted one isn't.

   They fail.
2. **Implement.** Green.
3. **Record the initial file.** Run one full serial pass with a report: `cd apps/api && npm run test:integration -- --json --outputFile=/tmp/…/full.json`. Export STRIPE_* first (`project_integration_suite_needs_stripe_env`). Then run `node scripts/integration-shards.mjs update-durations --reports <dir>`.
4. **Check the ceiling.** `npm run lint:integration-durations` passes on the new file, with demo-seed now three entries under 120s. Bump one entry to 121 locally and confirm it fails, then revert.

**Done when:** the self-test passes, `durations.json` lists all 200 files (198 − 1 + 3), and the ceiling lint passes on it.

**Risk:** a full local run can be cut short by the devcontainer suspending (`project_local_env_unsuitable_for_long_jobs`). Fallback: commit the file from the first sharded CI run's artifacts in slice 6. Until then the planner uses `FALLBACK_SHARDS` (5), which is correct, just balanced by count.

---

## Slice 5 — The planner

**Files**

- Edit: `scripts/integration-shards.mjs` — `planShards(durations)` and the `plan` subcommand (writes `count` + `matrix` to `$GITHUB_OUTPUT`, or prints them when unset).

**Steps**

1. **Tests (spec → `planShards` cases).** Total 0 → 5; a small total → 2; 988s → 5; 2,100s → 10; 5,000s → 10 with `capped`. They fail.
2. **Implement.** Green.
3. `node scripts/integration-shards.mjs plan` on the real file prints a sensible `count` (≈5) and a matrix with `index` `[1..count]`.

**Done when:** the planner cases pass and the CLI's output parses as `fromJSON`-ready JSON.

**Risk:** none.

---

## Slice 6 — The workflow: changes → plan → shards → `Integration Tests`

This is where CI changes shape.

**Files**

- Edit: `scripts/integration-shards.mjs` — `summaryVerdict` and the `summarize` subcommand (`::error::`/`::warning::` lines, a `$GITHUB_STEP_SUMMARY` table, exit 1 on failure).
- Edit: `.github/workflows/integration-test.yml` — rewrite to the spec's four jobs, and add `workflow_dispatch`.
- Edit: `scripts/check-ci-cache.mjs` — tighten rule 3, with four fixtures (correct aggregator → clean; no `always()`; shard missing from `needs`; the matrix job named `Integration Tests`).

**Steps**

1. **Tests.**
   - `summaryVerdict` cases (spec): docs-only skip → ok/skipped; `changes` failure, a cancelled shard, a missing report, a count mismatch, a failed suite → fail; all green → ok; drift or capped → ok with a warning.
   - Rule 3 fixtures.

   Both fail.
2. **Implement** `summaryVerdict`, rule 3 and the workflow. `npm run lint:ci-cache` is clean on the real tree: rule 1 sees the TURBO_* env at workflow level, rule 3 the aggregator, rule 6 the hashed var.
3. **Push. The CI run on this branch is the proof:**
   - every shard named `Integration Tests (shard i/N)` runs;
   - `Integration Tests` is green;
   - the summary table shows Σ suites = 200;
   - wall time ≤ 6 min.
4. If slice 4's local recording fell back, download this run's `integration-jest-*` artifacts, run `update-durations`, and commit `durations.json` here.

**Done when:** the self-test and `lint:ci-cache` pass, and a real run on the branch reports `Integration Tests` green within the time target. The forced-failure, docs-only and cache-hit checks are in the smoke.

**Risk:** a reusable workflow with a dynamic matrix inside a `workflow_call`. `fromJSON` matrices work there, but `deploy-dev`'s dispatch path is the case to confirm in the smoke. The matrix also can't be empty: `plan` never returns fewer than 2.

---

## Slice 7 — The scheduled refresh PR

**Files**

- New: `.github/workflows/refresh-integration-durations.yml` — per the spec: weekly cron + dispatch, literal concurrency group, find the run, download, `update-durations --if-changed`, push the standing branch, open or update the PR, then dispatch the three required-check workflows.
- Edit: `.github/workflows/unit-test.yml`, `static-checks.yml` — add `workflow_dispatch:`.

**Steps**

1. **Tests.**
   - `lint:ci-cache` must stay clean with the new workflow: rule 4 needs the literal concurrency prefix, and rule 1 is n/a because there's no turbo.
   - Add a self-test case that `update-durations --if-changed` exits 0 and writes nothing when the reports match the file.

   Run; the new case fails, then passes once implemented.
2. **Implement.**
3. **Dispatch it on the branch** (`gh workflow run refresh-integration-durations.yml --ref chore/857-shard-integration-tests`). It either reports "no change" or opens a PR whose three required checks appear. Close that PR (it was a test) and delete its branch.

**Done when:** a dispatched run behaves as specified, and the dispatched checks report on the bot commit.

**Risk:** the scheduled trigger only fires from the default branch, so the cron is only proven after merge. The dispatch proves the steps; the first Monday after merge proves the schedule.

---

## Slice 8 — Docs

**Files**

- Edit: `CLAUDE.md`:
  - "CI gating": the sharded shape, the `Integration Tests` aggregator, the budget, MIN/MAX/fallback, the drift and cap warnings, the 120s ceiling, the refresh PR, and the per-worker-database follow-up and its trigger.
  - "Turborepo remote caching": rule 6, and the tightened rule 3.
  - "Branch protection on `main`": the required context is the aggregator; shard contexts are never required.
- Edit: `.github/copilot-instructions.md` — mirror the same.
- Edit: `apps/api/src/__tests__/__integration__/README.md` — sharding, reproducing one shard locally (`INTEGRATION_SHARD=2/5 npm run test:integration`), refreshing durations by hand, and the ceiling allowlist.
- Edit: `apps/api/README.md` — test scripts under "Available Scripts".

**Steps**

1. **Test:** `npm run lint:doc-pointers` and `npm run lint:review-chain` (CLAUDE.md and its mirror stay consistent). Both pass.
2. **Write.**

**Done when:** both lints pass, and every number in the docs is cited from `scripts/integration-shards.mjs`'s constants.

---

## Sequence summary

| # | Lands | Gate |
|---|---|---|
| 1 | packer + sequencer + shard lib | `lint:integration-shards`; `--listTests` partition |
| 2 | `INTEGRATION_SHARD` script/turbo + rule 6 | `lint:ci-cache`; hash differs per shard |
| 3 | demo-seed → 3 files | 9 tests pass, assertions unchanged |
| 4 | durations writer + file + ceiling lint | self-test; `lint:integration-durations` |
| 5 | planner | self-test; `plan` output |
| 6 | sharded workflow + summary + rule 3 | `lint:ci-cache`; real CI run ≤ 6 min, Σ suites = 200 |
| 7 | refresh workflow + dispatch triggers | dispatched run on the branch |
| 8 | docs | `lint:doc-pointers`, `lint:review-chain` |

The self-test totals ≈ 33 cases, plus 7 new `lint:ci-cache` fixtures.

## Cross-slice notes

- **Every slice is green on the old workflow until slice 6.** Slices 1–5 add things nothing in CI consumes yet; the single-job `Integration Tests` keeps running serially.
- **Turbo cache churn is expected.** Slices 1–4 change `apps/api` inputs (sequencer, config, script, durations), so `apps/api#test:integration` misses the cache on each push. That's correct.
- **The file count is 200 after slice 3,** and the summary's count check derives it with `find`, not a constant.
- **Doc sync.** CLAUDE.md "CI gating" (+ mirror) and the two READMEs are slice 8. `lint:ci-cache`'s header comment documents rule 6 in slice 2, and rule 3's change in slice 6.
- **The smoke** (`/smoke 857`) is the CI walk:
  - timing;
  - a forced failure in one shard (red, the other shards finish);
  - a docs-only push (green, no shards);
  - a re-run of the same commit (cache hits in every shard, the summary still counts 200);
  - `deploy-dev`'s dispatch path;
  - the refresh workflow.

## Next step

Implementation starts on this branch with slice 1, tests first, one commit per slice, once discovery, spec and plan are confirmed.
