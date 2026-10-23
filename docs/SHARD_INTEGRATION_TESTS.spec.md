# Shard the integration test suite — Spec

**Issue:** [EnterpriseBT/portal-ai#857](https://github.com/EnterpriseBT/portal-ai/issues/857) · **Discovery:** `docs/SHARD_INTEGRATION_TESTS.discovery.md`

This spec pins the contract for running `apps/api`'s integration suite as N duration-balanced shards behind the one `Integration Tests` check:

- the workflow's jobs and outputs;
- the `INTEGRATION_SHARD` contract with turbo and Jest;
- the sequencer and the shared shard library;
- the `lint:ci-cache` rules;
- the durations file, its ceiling and its scheduled refresh;
- the demo-seed split.

## Key decisions (flag for review)

1. **N is derived, not fixed.** N = ⌈Σ durations ÷ 210s⌉, clamped to `[2, 10]`, with 5 when `durations.json` is missing or empty. The cap of 10 keeps one push at ~14 of the free plan's 20 concurrent jobs.
2. **The packer lives in `apps/api` so turbo hashes it.** The bin-packing function is in `apps/api/jest.integration.sequencer.mjs`, and `durations.json` is in `apps/api`. Both fall under turbo's default inputs for `apps/api#test:integration`. A packer or durations change therefore invalidates every shard's cache. If either lived at the repo root, a cached "pass" for shard 2 could be restored after the assignment had moved files in or out of shard 2, leaving those files untested.
3. **The shard reaches turbo as a hashed env var** (`INTEGRATION_SHARD="i/N"` in `turbo.json` `env`), never `passThroughEnv`. The new rule 6 enforces it.
4. **The cached report travels with the cache.** `jest-integration-report.json` is declared as the task's turbo `outputs`, so a cache hit restores it, and the summary's suite count works on a fully cached re-run.
5. **One required context, now an aggregator.** Shards are named `Integration Tests (shard i/N)`. The job named exactly `Integration Tests` is a summary that `needs` all of them with `if: always()`. Rule 3 is tightened so the named job must be that aggregator whenever the file has a matrix.
6. **Fail closed.** The summary fails on:
   - a `changes`, `plan` or shard result other than `success` (a docs-only skip excepted);
   - a missing report;
   - a total suite count that differs from the checkout's file count;
   - any failed suite.

   Drift and the cap only **warn**.
7. **The refresh PR gets its checks by dispatch.** Pushes made with `GITHUB_TOKEN` don't trigger workflows, but `workflow_dispatch` calls made with it do. So the three required-check workflows gain a `workflow_dispatch` trigger, and the refresh workflow dispatches them on its branch. No PAT or new secret is involved.
8. **Local runs are unchanged.** With `INTEGRATION_SHARD` unset, the npm script adds no flags and the sequencer's `shard()` is never called.

9. **Changed in implementation:**
   - **Pure functions and constants moved to `scripts/integration-shards.lib.mjs`.** The CLI and self-test stay in `integration-shards.mjs`, which loads the sequencer only for `--self-test`, so CI's plan and summary jobs need no `npm ci`.
   - **`durationsChanged` counts only what planning acts on:** files added or removed, the total moving more than 10%, or one file moving more than 30s and 50%. Two CI runs of one commit moved single files by up to 22s, because the first suite on each runner pays the module compile.
   - **Initial durations are CI-measured,** from the first sharded run (40010967045).
   - **Budget lowered to 150s** (from 210s). Identically sized shards measured up to ~30% apart on different runners, and a 210s budget put one run at 6m17s. 150s gives 5 shards today, and the cap now covers ~1,500s of CI time, about 2.2× today's suite.
   - **Code-review fixes (PR #860):**
     - the summary checks the file set by name;
     - it gates on `!cancelled()`, and rule 3 accepts either gate;
     - the expected files follow Jest's `__integration__` rule;
     - a malformed durations file fails;
     - the setup action uses npm's download cache only on a miss, and saves the clean tree right after `npm ci`;
     - the refresh uses only merged PR heads' runs, with `pipefail`.
   - **The refresh opens an issue, not a PR.** A `GITHUB_TOKEN` PR needs the repo setting "Allow GitHub Actions to create and approve pull requests" (off here), which would also let workflows approve PRs. So the `workflow_dispatch` triggers added for the PR's checks are removed again, and the job needs only `issues: write`. Its dispatch is proven after merge, since GitHub only dispatches default-branch workflows.

## Scope

### In scope
1. `apps/api/jest.integration.sequencer.mjs` (packer + Jest sequencer), wired as the integration config's `testSequencer`.
2. `apps/api/src/__tests__/__integration__/durations.json` (initial values from a full timed run).
3. `scripts/integration-shards.mjs`: the planner, summary verdict, durations writer and ceiling check, with `--self-test`.
4. `apps/api/package.json` `test:integration` shard expansion; `turbo.json` `test:integration` `env` + `outputs`.
5. `integration-test.yml` rewritten as `changes` → `plan` → matrix `shard` → `Integration Tests` summary; `workflow_dispatch` added to it, `unit-test.yml` and `static-checks.yml`.
6. `.github/workflows/refresh-integration-durations.yml` (weekly + manual).
7. `scripts/check-ci-cache.mjs`: rule 3 tightened, rule 6 added, both with fixtures.
8. Root scripts `lint:integration-shards` (self-test) and `lint:integration-durations` (ceiling against the real file), both run in `unit-test.yml`.
9. demo-seed split into three files plus `utils/demo-seed.util.ts`.
10. Docs: CLAUDE.md "CI gating" + "Branch protection on `main`", the Copilot mirror, `apps/api/src/__tests__/__integration__/README.md`, `apps/api/README.md`.

### Out of scope
- One database per Jest worker (the follow-up the cap warning triggers), larger runners, a paid plan.
- ts-jest `isolatedModules`, the Unit Tests and Static Checks suites themselves, and a pre-migrated Postgres image.

## Surface

### `apps/api/jest.integration.sequencer.mjs` (new)

```js
import BaseSequencer from "@jest/test-sequencer"; // class at .default under ESM interop

/** Seconds per file, keyed by path relative to apps/api ("src/__tests__/…"). */
export const DURATIONS_PATH = "src/__tests__/__integration__/durations.json";

/**
 * Longest-processing-time bin packing. Pure and deterministic: files sorted
 * by weight desc, then path asc; each goes to the currently lightest shard
 * (ties → lowest index). A file absent from `durations` weighs the median of
 * the known values (1 when there are none).
 * @param {string[]} files     paths relative to apps/api
 * @param {Record<string, number>} durations
 * @param {number} shardCount  ≥ 1
 * @returns {string[][]}       shardCount arrays; every file in exactly one
 */
export function assignShards(files, durations, shardCount) {}

export default class IntegrationSequencer extends (BaseSequencer.default ?? BaseSequencer) {
  /** Jest's shard hook (Jest 29): keeps only this shard's files. */
  shard(tests, { shardIndex, shardCount }) {}   // shardIndex is 1-based
}
```

- `shard()` loads `durations.json` relative to the config's `rootDir`; a missing or unparseable file reads as `{}`. It calls `assignShards`, and returns the `tests` whose relative path is in bin `shardIndex - 1`.
- `sort()` is inherited.
- `jest.integration.config.js` gains `testSequencer: "<rootDir>/jest.integration.sequencer.mjs"`.

### `durations.json` (new)

```json
{ "src/__tests__/__integration__/routes/foo.router.integration.test.ts": 12.4, "...": 0.8 }
```

- Keys are sorted, relative to `apps/api`, and only `*.integration.test.ts`.
- Values are seconds rounded to 0.1.
- It's written only by `scripts/integration-shards.mjs update-durations`.

### `apps/api/package.json` + `turbo.json`

- `test:integration` becomes `NODE_OPTIONS='…unchanged…' jest --config jest.integration.config.js --maxWorkers=1${INTEGRATION_SHARD:+ --shard=$INTEGRATION_SHARD --json --outputFile=jest-integration-report.json}`.
- `turbo.json` `tasks["test:integration"]` gains:
  - `"INTEGRATION_SHARD"` in `env`, next to the existing two;
  - `"outputs": ["jest-integration-report.json"]`;
  - a comment saying why each is there.
- the root `.gitignore` adds `jest-integration-report.json`.

### `scripts/integration-shards.mjs` (new)

The constants are exported, so the lint and the docs cite a single source:

```js
export const BUDGET_SECONDS = 210, MIN_SHARDS = 2, MAX_SHARDS = 10, FALLBACK_SHARDS = 5;
export const FILE_CEILING_SECONDS = 120, DRIFT_FACTOR = 1.25;
export const CEILING_ALLOWLIST = []; // { file, reason }; starts empty, only shrinks
```

| Function (pure, exported) | Contract |
|---|---|
| `planShards(durations)` | `{ count, matrix: { index: [1..count] }, totalSeconds, capped }`. `count = clamp(ceil(total / BUDGET), MIN, MAX)`; `FALLBACK_SHARDS` when `total === 0`; `capped = ceil(total / BUDGET) > MAX`. |
| `summaryVerdict({ changesResult, run, planResult, shardResult, reports, fileCount, plannedCount })` | `{ ok, skipped, errors[], warnings[], table }`. **ok**: `changesResult === "success"` and either `run !== "true"` (skipped) or all of: `planResult` and `shardResult` are `"success"`, `reports.length === plannedCount`, Σ `numTotalTestSuites === fileCount`, and Σ `numFailedTestSuites === 0`. **Warnings**: a shard whose Σ suite runtime exceeds `BUDGET × DRIFT_FACTOR`, and `capped`. |
| `ceilingViolations(durations, allowlist)` | entries over `FILE_CEILING_SECONDS` not in the allowlist: `[{ file, seconds }]` |
| `mergeReports(reports, existingFiles)` | the new `durations` from Jest JSON reports (`endTime − startTime` per `testResults[]`, path made relative to `apps/api`), keeping only files in `existingFiles` |
| `durationsChanged(prev, next)` | true when a key was added or removed, or any value moved by more than 20% and 5s |

The CLI subcommands write `$GITHUB_OUTPUT`, `$GITHUB_STEP_SUMMARY` and `::warning::`/`::error::` lines; exit 1 is a failure:
- `plan`
- `summarize --reports <dir>`
- `check-durations`
- `update-durations --reports <dir> [--if-changed]`
- `--self-test` runs embedded cases for every pure function, including `assignShards`, imported from `../apps/api/jest.integration.sequencer.mjs`.

### `.github/workflows/integration-test.yml` (rewritten)

Triggers: `push` (branches-ignore main), `workflow_call` (same secrets), and new `workflow_dispatch`. The workflow-level `env` (TURBO_*) and `concurrency` are unchanged.

| Job id | `name:` | `needs` / `if` | What it does |
|---|---|---|---|
| `changes` | `Integration Tests: changes` | — | checkout `fetch-depth: 0`; `node scripts/integration-skip-base.mjs`; job output `run` |
| `plan` | `Integration Tests: plan` | `changes`; `if: needs.changes.outputs.run == 'true'` | sparse checkout of `apps/api/src/__tests__/__integration__/durations.json` + `scripts/`; `node scripts/integration-shards.mjs plan`; outputs `count`, `matrix` |
| `shard` | `Integration Tests (shard ${{ matrix.index }}/${{ needs.plan.outputs.count }})` | `[changes, plan]`; same `if` | `strategy: { fail-fast: false, matrix: ${{ fromJSON(needs.plan.outputs.matrix) }} }`, `timeout-minutes: 20`. Steps: compose up `postgres-test redis --wait`; `./.github/actions/setup`; `npm run test:integration` with `INTEGRATION_TEST_DATABASE_URL`, `REDIS_URL` and `INTEGRATION_SHARD: ${{ matrix.index }}/${{ needs.plan.outputs.count }}`; upload `apps/api/jest-integration-report.json` as `integration-jest-${{ matrix.index }}` (`if: always()`, `retention-days: 30`); compose down (`if: always()`) |
| `summary` | **`Integration Tests`** | `[changes, plan, shard]`; `if: always()` | checkout; download `integration-jest-*` (skipped when `run != 'true'`); `node scripts/integration-shards.mjs summarize` with the results from `needs.*.result`, `run`, `count`, and a file count from `find apps/api/src -name '*.integration.test.ts' \| wc -l` |

`fail-fast: false`, so one failing shard doesn't cancel the others; every report is wanted. The permissions are `contents: read` + `actions: read`, as today.

### `.github/workflows/unit-test.yml` and `static-checks.yml`

- Add `workflow_dispatch:` to both.
- Unit Tests gains two steps after `lint:integration-skip`: `npm run lint:integration-shards` and `npm run lint:integration-durations`.

### `.github/workflows/refresh-integration-durations.yml` (new)

- **Triggers:** `schedule: cron "0 6 * * 1"` + `workflow_dispatch`.
- **Concurrency:** `group: "refresh-integration-durations"`, `cancel-in-progress: false`.
- **Permissions:** `contents: write`, `pull-requests: write`, `actions: write`.
- **Steps:**
  1. Check out `main`.
  2. Find the newest successful `integration-test.yml` run on any branch: `gh run list -w integration-test.yml -s success -L 1`.
  3. `gh run download <id> -p 'integration-jest-*'`.
  4. `node scripts/integration-shards.mjs update-durations --reports … --if-changed`. If nothing changed, exit 0.
  5. Push to `chore/refresh-integration-durations` (force; a single standing branch).
  6. `gh pr create` or update, with a body listing the added, removed and moved files, any ceiling violations, and `Refs #857`.
  7. `gh workflow run {unit-test,static-checks,integration-test}.yml --ref chore/refresh-integration-durations`, so the required checks report on the bot's commit.
- It never merges.

### `scripts/check-ci-cache.mjs`

- `findViolations` gains a `rootTurbo` input, threaded like `siteTurbo` and loaded with the existing `parseJsonc`.
- **Rule 3 (tightened).** For a file in `REQUIRED_CHECK_JOB_NAMES`, if any of its jobs has `strategy.matrix`, the job named exactly the required name must:
  - have no matrix;
  - have an `if` containing `always()`;
  - list every matrix job in `needs`.

  The message names the file and which condition failed.
- **Rule 6 (new).** If any workflow sets `INTEGRATION_SHARD` (in workflow, job or step `env`), then `rootTurbo.tasks["test:integration"].env` must include it, and `passThroughEnv` must not.
- **Fixtures:**
  - matrix + correct summary → clean;
  - summary without `always()` → rule 3;
  - summary missing the shard in `needs` → rule 3;
  - the matrix job itself named `Integration Tests` → rule 3;
  - shard var in `env` → clean;
  - shard var missing from `env` → rule 6;
  - shard var in `passThroughEnv` → rule 6.

### demo-seed split

`services/demo-seed.service.integration.test.ts` is replaced by three files under `services/`. The shared `beforeEach`/`afterEach`, `provisionOrg`, `rawCount`, `entityIdByKey` and `EXPECTED` move to `__integration__/utils/demo-seed.util.ts`.

| File | Tests (from the old file) |
|---|---|
| `demo-seed.counts.integration.test.ts` | 1 counts, 2 wide tables, 3 idempotent, 4 bounded `--rows` |
| `demo-seed.toolpacks.integration.test.ts` | 5 built-ins, 6 custom with URL, 7 custom re-register |
| `demo-seed.reset.integration.test.ts` | 8 reset reconverges, 9 missing system column throws |

Every assertion is kept verbatim; only the file boundaries move.

## Migration

None.

## Seed

None.

## TDD test plan

Run from the repo root: `npm run lint:integration-shards`, `npm run lint:integration-durations`, `npm run lint:ci-cache`. From `apps/api`: `npm run test:integration -- --testPathPattern demo-seed`. Never invoke jest directly.

### `scripts/integration-shards.mjs --self-test` (≈ 26 cases)

- **`assignShards`**, the property cases:
  - every file appears exactly once (sizes 0, 1, N−1, N, 198);
  - deterministic across calls;
  - unknown files get the median;
  - max shard load ≤ ideal + the largest file;
  - `shardCount = 1` returns all files.
- **`planShards`:** total 0 → 5; small total → MIN; 988s → 5; 2,100s → 10; 5,000s → 10 with `capped`.
- **`summaryVerdict`:**
  - docs-only skip → ok and skipped;
  - `changes` failure → fail;
  - a cancelled shard → fail;
  - a missing report → fail;
  - suite-count mismatch → fail;
  - a failed suite → fail;
  - all green → ok;
  - a drift shard → ok with a warning;
  - capped → ok with a warning.
- **`ceilingViolations`:** over the ceiling → listed; allowlisted → not.
- **`mergeReports`:** relativizes paths; drops a file no longer present.
- **`durationsChanged`:** added, removed, small move (false), big move (true).

### `scripts/check-ci-cache.mjs` self-test (+7 fixtures)

The seven fixtures under rules 3 and 6 above.

### `apps/api` integration

- **The demo-seed split:** the three files pass, with the same test count (9) and assertions as before.
- **The real `--shard` path, run locally and by hand, not as a test:** `INTEGRATION_SHARD=1/5` and `5/5` runs, each listing its suites with `--listTests`. Together the five lists equal the unsharded `--listTests`.

### CI (the smoke, on this branch)

- One run's timing and suite count.
- A forced failure in one shard.
- A docs-only push.
- A full cache-hit re-run.
- A `workflow_dispatch` of the refresh workflow.

**Totals ≈ 33 cases** in the self-tests, plus the demo-seed suites and the CI walk.

## Acceptance criteria

- [ ] An uncached `Integration Tests` run on this branch finishes in **≤ 6 min** wall.
- [ ] Σ `numTotalTestSuites` across the shards equals the count of `*.integration.test.ts` files, and the test count matches a serial run of the same commit.
- [ ] A failing test in one shard turns `Integration Tests` red; a cancelled shard does too. The other shards still run (`fail-fast: false`).
- [ ] A docs-only push since the last green run reports `Integration Tests` green with no shard started.
- [ ] A re-run of an unchanged commit hits the turbo cache in every shard, and the summary still counts every suite from the restored reports.
- [ ] `npm run test:integration` locally is unchanged: serial, no flags, no report file.
- [ ] `lint:ci-cache` passes on the tree and fails its new fixtures. `lint:integration-durations` fails if a `durations.json` entry is set to 121s.
- [ ] The refresh workflow, dispatched by hand, opens or updates one PR whose three required checks report.
- [ ] Branch protection's required contexts are unchanged (`Unit Tests`, `Integration Tests`, `Static Checks`).

## Risks & rollback

| Risk | Mitigation |
|---|---|
| A sequencer bug drops a file | The suite count in the summary fails closed, and the self-test proves the assignment is disjoint and complete. |
| A cached shard restores the wrong files' pass | Prevented three ways: the shard is in the hash, and the packer and durations are hashed as `apps/api` inputs. |
| The reusable-workflow aggregate seen by `deploy-dev`/`deploy-prod` | Unchanged semantics: any failed job fails the called workflow. The smoke's forced failure proves it on the branch. |
| Matrix legs exceed the free plan's 20 concurrent jobs | The cap of 10. The cap warning is the trigger for the per-worker-database follow-up. |
| The refresh workflow's dispatched runs | They run with that branch's code, which is `main` plus one JSON file. |

**Rollback:** revert the PR. Every piece is CI configuration, test layout or scripts; no runtime or schema change.

## Files touched

- **New:**
  - `apps/api/jest.integration.sequencer.mjs`
  - `apps/api/src/__tests__/__integration__/durations.json`
  - `apps/api/src/__tests__/__integration__/utils/demo-seed.util.ts`
  - `apps/api/src/__tests__/__integration__/services/demo-seed.{counts,toolpacks,reset}.integration.test.ts`
  - `scripts/integration-shards.mjs`
  - `.github/workflows/refresh-integration-durations.yml`
- **Edited:**
  - `apps/api/jest.integration.config.js`, `apps/api/package.json`, root `.gitignore`
  - `turbo.json`, root `package.json` (two lint scripts)
  - `.github/workflows/{integration-test,unit-test,static-checks}.yml`
  - `scripts/check-ci-cache.mjs`
  - `CLAUDE.md`, `.github/copilot-instructions.md`, `apps/api/src/__tests__/__integration__/README.md`, `apps/api/README.md`
- **Deleted:** `services/demo-seed.service.integration.test.ts`

## Next step

`/plan 857` slices this into about eight test-first commits on `chore/857-shard-integration-tests`:

1. The packer, sequencer and shard library, with the self-test.
2. The env var, npm script, turbo `env`/`outputs`, and rule 6.
3. The demo-seed split.
4. The durations writer, the initial file and the ceiling lint.
5. The planner.
6. The workflow rewrite and the summary, plus rule 3.
7. The refresh workflow and the `workflow_dispatch` triggers.
8. Docs.

The CI walk on the branch is the smoke.
