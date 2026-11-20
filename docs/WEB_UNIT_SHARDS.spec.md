# Shard the web unit suite — Spec

This spec pins the contract for running `apps/web`'s unit suite as planned, capped shards behind the one required check **`Unit Tests`**, on sharding machinery the integration suite now shares. It also pins a guard that keeps one push within GitHub Free's 20 concurrent jobs.

Discovery: `docs/WEB_UNIT_SHARDS.discovery.md`. Issue: #1091.

## Amendment — slice 2

- **`Suite` gains `durationsRequired: boolean`:** `true` for integration, and `false` for web until slice 5 seeds its file.
  - While `false`, `check-durations` and `plan` read a missing file as "not recorded yet": a notice, and the fallback count.
  - A malformed file still fails either way.

## Amendment — slice 4

- **The web budget is 300 file-seconds per shard, not 450.** On CI the web suite measured about 853 file-seconds, far below the discovery estimate, so 450 would plan 2 shards at about 3.5 min. 300 plans 3 at about 2.5 min.
  - The `planShards(web)` cases change accordingly: 853 → 3, 1,200 → 4, 1,800 → the cap, 2,000 → capped.
  - The drift check now compares against 300 × 1.25.

## Key decisions (flag for review)

1. **One lib, two suites.**
   - `scripts/integration-shards{,.lib}.mjs` are renamed to `scripts/test-shards{,.lib}.mjs`. Each suite's specifics live in a `SUITES` record, and every lib function takes the suite.
   - `assignShards` moves from `apps/api/jest.integration.sequencer.mjs` into the lib. Both packages' sequencers import it.
   - Turbo still hashes it: `$TURBO_ROOT$/scripts/test-shards.lib.mjs` is in both test tasks' `inputs`.
2. **No aliases.** `lint:integration-shards` / `lint:integration-durations` are replaced by `lint:test-shards` / `lint:test-durations`, and `refresh-integration-durations.yml` by `refresh-test-durations.yml`.
3. **`unit-test.yml` keeps one workflow and one required name:**
   - `checks`: lint steps plus every unit suite except web;
   - `plan`;
   - the `web` matrix;
   - `summary`, named exactly `Unit Tests`, with `!cancelled()`. It fails closed and also fails on `checks`.

   `deploy-dev` / `deploy-prod` call it unchanged.
4. **Web caps:** min 2, max 6, fallback 3. The budget is **450 file-seconds per shard**: 150s wall × 3 Jest workers. Web's own `test:unit` stays parallel, unlike the integration suite's `--maxWorkers=1`.
5. **Turbo hashing:** `WEB_UNIT_SHARD` is hashed by a new `apps/web/turbo.json`, which also caches `jest-unit-report.json`. Rule 6 generalizes to every suite's shard variable.
6. **Rule 8, the concurrency budget:**
   - it sums, over push-triggered workflows, each workflow's peak concurrent jobs: the heaviest set of jobs with no `needs` path between any two;
   - a matrix job weighs its suite's cap;
   - a dynamic matrix not planned by `test-shards.mjs plan --suite <s>` is a violation;
   - the limit is 20, and the current shape sums to exactly 20.
7. **Seeding:** web's durations are seeded from this branch's own CI reports (fallback N = 3 until then), never from local timings.

## Scope

### In scope
- Generalizing the lib and CLI, and the web sequencer, script, turbo config and durations file.
- Restructuring `unit-test.yml`, and the renamed, two-suite refresh workflow.
- Generalizing rule 6, adding rule 8, and a new `lint:test-files` agreement check.
- Docs sync.

### Out of scope
- One database per Jest worker in the integration suite.
- Swapping the Jest transformer, or persisting Jest's cache.
- Sharding the API's or core's unit tests.
- Concurrency across pushes, or during deploy-dev's `workflow_dispatch`.

## Surface

### `scripts/test-shards.lib.mjs` (renamed from `integration-shards.lib.mjs`)

Still pure, with no imports beyond Node built-ins. The module-level `BUDGET_SECONDS`, `MIN_SHARDS`, `MAX_SHARDS`, `FALLBACK_SHARDS`, `FILE_CEILING_SECONDS`, `CEILING_ALLOWLIST` and `DURATIONS_FILE` are removed; their values move into `SUITES`.

The shared exports:
- `SAMPLE_RUNS = 5` and `DRIFT_FACTOR = 1.25`;
- `CONCURRENT_JOB_LIMIT = 20`: GitHub Free's per-account limit, read by rule 8;
- `isIntegrationTestPath(relative)`, unchanged;
- **`isWebUnitTestPath(relative)`**, matching `^src/(.*/)?[^/]+\.(test|spec)\.tsx?$`. It mirrors web's `testMatch` (`apps/web/jest.config.js:75`) after `testPathIgnorePatterns`. Today it matches all 407 files that `jest --listTests` lists;
- **`SUITES`**: `Record<"integration" | "web", Suite>`.

```js
/** @typedef {{
 *   key: "integration" | "web",
 *   title: string,               // the required check's name, used in annotations and the step summary
 *   packageDir: string,          // "apps/api" | "apps/web"; report paths are made relative to it
 *   isTestPath: (relative: string) => boolean,
 *   durationsFile: string,       // repo-relative
 *   budgetSeconds: number,       // recorded file-seconds per shard
 *   minShards: number, maxShards: number, fallbackShards: number,
 *   fileCeilingSeconds: number,
 *   ceilingAllowlist: Array<{file: string, reason: string}>,
 *   shardVar: string,            // the env var carrying "i/N"
 *   turboFile: string,           // the turbo.json whose task hashes shardVar
 *   turboTask: string,
 *   reportFile: string,          // repo-relative path of a shard's Jest JSON report
 *   artifactPrefix: string,      // "<prefix><i>" per shard
 *   workflowFile: string,        // the workflow whose green runs the refresh samples
 *   driftIssueTitle: string,
 *   skippable: boolean,          // has a docs-only `changes` job (#663)
 *   capAdvice: string,           // what the cap warning recommends
 * }} Suite */
```

| field | `integration` | `web` |
|---|---|---|
| title | `Integration Tests` | `Unit Tests` |
| packageDir | `apps/api` | `apps/web` |
| durationsFile | `apps/api/src/__tests__/__integration__/durations.json` | `apps/web/src/__tests__/durations.json` |
| budgetSeconds | 150 | 450 |
| min / max / fallback | 2 / 10 / 5 | 2 / 6 / 3 |
| fileCeilingSeconds | 120 | 120 |
| shardVar | `INTEGRATION_SHARD` | `WEB_UNIT_SHARD` |
| turboFile / turboTask | `turbo.json` / `test:integration` | `apps/web/turbo.json` / `test:unit` |
| reportFile | `apps/api/jest-integration-report.json` | `apps/web/jest-unit-report.json` |
| artifactPrefix | `integration-jest-` | `web-unit-jest-` |
| workflowFile | `integration-test.yml` | `unit-test.yml` |
| driftIssueTitle | `Integration test durations have drifted` (unchanged) | `Web unit test durations have drifted` |
| skippable | true | false |
| capAdvice | `time for one database per Jest worker (#857 follow-up)` | `split the heaviest web suites, or rebalance the caps within lint:ci-cache rule 8` |

Function signatures. The suite comes first, and the behaviour is unchanged for `integration`:
- `parseDurations(text)`, unchanged.
- `toPackageRelative(suite, absolute) → string | null`: the old `toApiRelative`, with the marker `/${suite.packageDir}/`.
- `mergeRuns(suite, runs, existingFiles)` and `mergeReports(suite, reports, existingFiles)`.
- `durationsChanged(prev, next)`, unchanged.
- `ceilingViolations(suite, durations)`: uses `suite.fileCeilingSeconds` and `suite.ceilingAllowlist`.
- `planShards(suite, durations) → {count, matrix, totalSeconds, capped}`: ⌈total ÷ `suite.budgetSeconds`⌉ clamped to `[minShards, maxShards]`, or `fallbackShards` when the total is 0.
- **`assignShards(files, durations, shardCount)`**, moved verbatim from the API sequencer (LPT; unknown files weigh the median).
- **`summaryVerdict(suite, input)`**. `input` is the old shape with `changesResult` and `run` now optional, plus **`gates: Array<{label: string, result: string}>`**:
  - each gate whose `result !== "success"` adds the error `` `${label} ended ${result}` ``;
  - the docs-only skip branch (`changesResult` / `run`) applies only when `suite.skippable`;
  - an `unknown` file's message reads `` `ran but isn't a ${suite.key} test file in the checkout` ``;
  - drift compares a shard's file-seconds against `suite.budgetSeconds × DRIFT_FACTOR` and says `` `refresh ${suite.durationsFile}` ``;
  - the cap warning names `suite.maxShards` and `suite.capAdvice`.
  - Integration passes `gates: []`; web passes `gates: [{label: "the checks job (lint + non-web unit tests)", result: CHECKS_RESULT}]`.

### `scripts/test-shards.mjs` (renamed from `integration-shards.mjs`)

Every subcommand except `--self-test` and `sample-runs` requires **`--suite integration|web`**. An unknown or missing suite exits 2 and prints usage.

| subcommand | change |
|---|---|
| `--self-test` | runs every case. `assignShards` now comes from the lib, so no dynamic import of the sequencer |
| `plan --suite s` | step outputs `count`, `matrix` and `capped`, from `planShards(SUITES[s], …)` |
| `summarize --suite s --reports dir` | shards parsed by `/<artifactPrefix>(\d+)/`. Env: `PLAN_RESULT`, `SHARD_RESULT`, `PLANNED_COUNT`, `CAPPED`, plus `CHANGES_RESULT` / `RUN` (integration) or `CHECKS_RESULT` (web). Annotations and the step summary use `suite.title` |
| `check-durations --suite s` | as before, per suite. **A missing web file passes with a notice** until the seed lands, and fails once `durationsFile` exists in git (see Seed) |
| `update-durations --suite s --reports dir [--if-changed]` | single-run detection by `artifactPrefix`; the expected files come from `packageDir/src` filtered by `isTestPath` |
| `sample-runs` | unchanged |
| **`list-agreement --suite s`** (new) | Runs the suite's Jest `--listTests` (`npm exec --workspace <pkg> -- jest --listTests [--config jest.integration.config.js]`). It fails, listing both differences, unless the set equals the predicate's set over `packageDir/src`. Needs `node_modules`, so it runs only in `checks` |

### Sequencers

- **`apps/api/jest.integration.sequencer.mjs`:** keeps `DURATIONS_PATH`, `readDurations` and `shard()`. It imports `assignShards` from `../../scripts/test-shards.lib.mjs`, and no longer defines or exports it.
- **`apps/web/jest.unit.sequencer.mjs`** (new): the same class shape, with `DURATIONS_PATH = "src/__tests__/durations.json"`. Jest calls `shard()` only under `--shard`.
- **`apps/web/jest.config.js`:** adds `testSequencer: "<rootDir>/jest.unit.sequencer.mjs"`.

### Package scripts and turbo

- **`apps/web/package.json`:** `test:unit` becomes `NODE_OPTIONS='--experimental-vm-modules --max-old-space-size=4096' jest${WEB_UNIT_SHARD:+ --shard=$WEB_UNIT_SHARD --json --outputFile=jest-unit-report.json}`.
- **`apps/web/turbo.json`** (new): `{"extends": ["//"], "tasks": {"test:unit": {…}}}`, where the task has:
  - `"env": ["WEB_UNIT_SHARD"]` (never `passThroughEnv`);
  - `"outputs": ["jest-unit-report.json"]`;
  - `"inputs": ["$TURBO_DEFAULT$", "$TURBO_ROOT$/scripts/test-shards.lib.mjs"]`.
- **`turbo.json`:** `test:integration` gains the same `inputs`.
- **`.gitignore`:** adds `jest-unit-report.json`.
- **Root `package.json`:**
  - `lint:test-shards` → `node scripts/test-shards.mjs --self-test`;
  - `lint:test-durations` → `node scripts/test-shards.mjs check-durations --suite integration && node scripts/test-shards.mjs check-durations --suite web`;
  - `lint:test-files` → `list-agreement` for both suites;
  - the two `lint:integration-*` scripts are removed.

### `.github/workflows/unit-test.yml`

The concurrency group, triggers, workflow `env` and `workflow_call` secrets are unchanged. The jobs:

| id | name | needs / if | does |
|---|---|---|---|
| `checks` | `Unit Tests: checks` | — | checkout, setup, the existing lint steps (with the renamed scripts), `npm run lint:test-files`, then `npm run test:unit -- --filter='!@portalai/web'` |
| `plan` | `Unit Tests: plan` | — | sparse checkout (`scripts`, `apps/web/src/__tests__/durations.json`); `node scripts/test-shards.mjs plan --suite web`; outputs `count`, `matrix`, `capped` |
| `web` | `Unit Tests (web shard ${{ matrix.index }}/${{ needs.plan.outputs.count }})` | `needs: [plan]`; `fail-fast: false`; matrix `fromJSON(needs.plan.outputs.matrix)`; `timeout-minutes: 15` | checkout, setup; `npm run test:unit -- --filter=@portalai/web` with `WEB_UNIT_SHARD: i/N`; upload `apps/web/jest-unit-report.json` as `web-unit-jest-<i>` (`if: always()`, 30 days) |
| `summary` | **`Unit Tests`** | `needs: [checks, plan, web]`; `if: ${{ !cancelled() }}` | sparse checkout (`scripts`, `apps/web/src`); download `web-unit-jest-*`; `summarize --suite web` with `CHECKS_RESULT`, `PLAN_RESULT`, `SHARD_RESULT`, `PLANNED_COUNT`, `CAPPED` |

Every job runs on `ubuntu-26.04`.

`integration-test.yml` changes only the script name and `--suite integration` in `plan` and `summarize`, plus the comment at :48 and :84-87.

### `.github/workflows/refresh-test-durations.yml` (renamed)

- **Schedule, permissions and the no-PR rationale:** unchanged.
- **Concurrency group:** `refresh-test-durations`.
- **One job.** It runs the existing steps once per suite (integration, then web), each with its own `workflowFile`, artifact pattern (`<artifactPrefix>*`), `update-durations --suite`, and issue lookup and edit by its own `driftIssueTitle`.
- **Failure handling:** one suite failing to sample doesn't skip the other, and the job fails at the end if either failed.

### `scripts/check-ci-cache.mjs`

- **Rule 6, generalized.** For each `SUITES` entry whose `shardVar` any workflow sets (`setsEnvVar`), the task `turboTask` in `turboFile` must list it in `env` and not in `passThroughEnv`. A `turboFile` that doesn't exist counts as a violation.
  - `runRealTree` reads `apps/web/turbo.json` alongside the root and site turbo files.
  - Fixtures gain a `turboFiles: Record<path, object>` map; the existing `rootTurbo` fixtures map onto `turbo.json`.
- **Rule 8, new (the concurrency budget).** Over every workflow whose `on.push` is present and whose `branches` filter isn't exactly `["main"]`:
  1. **Weight each job.** A job without `strategy.matrix` weighs 1. A literal matrix weighs its combination count, computed from the cartesian product of its array values (`include` / `exclude` aren't used today, so they count as a violation).
  2. **Weight a dynamic matrix** (`${{ … }}`) as `SUITES[s].maxShards`, where `s` is the `--suite` argument of a `test-shards.mjs plan` step in the job its expression reads (`needs.<job>.outputs.matrix`). Any other dynamic matrix is a violation: "unbounded matrix".
  3. **Find the workflow's peak:** the maximum total weight over sets of jobs with no `needs` path, direct or transitive, between any two members. It's brute force; a workflow with more than 16 jobs uses its total weight instead.
  4. **Sum the peaks.** Over `CONCURRENT_JOB_LIMIT`, it's a violation naming each workflow's peak.

  The current tree sums to: unit 7 (`checks` + 6 shards), integration 10, static 1, e2e 1, audit 1 = **20**.

## Migration
## Seed

There is **no database change.**

The seed here is the web durations file. Slice 4's first CI run on this branch plans the fallback 3 shards. Its three `web-unit-jest-*` artifacts are downloaded (`gh run download <id> -p 'web-unit-jest-*' -D /tmp/web-reports`), and `node scripts/test-shards.mjs update-durations --suite web --reports /tmp/web-reports` writes `apps/web/src/__tests__/durations.json`, which is committed.

From that commit on, `check-durations --suite web` treats the file as required.

## TDD test plan

Tests run through the npm scripts:
- `npm run lint:test-shards`: the CLI's embedded `CASES`, which are pure;
- `npm run lint:ci-cache`: its `FIXTURES`;
- `npm run lint:test-files`, which runs live;
- `npm run lint:test-durations`.

### `scripts/test-shards.mjs` CASES

- **Ported (31 today):** every existing case, now calling with `SUITES.integration`. Same expected values, as a regression.
- **`planShards(SUITES.web, …)`:**
  - totals 0 → 3 (fallback);
  - 400 → 2 (min);
  - 1,350 → 3;
  - 1,800 → 4;
  - 2,700 → 6;
  - 3,000 → 6 with `capped: true`.
  - Count: 6.
- **`isWebUnitTestPath`:**
  - `src/views/X.test.tsx`, `src/__tests__/a/b.test.ts`, `src/x.spec.ts` → true;
  - `src/x.test.js`, `scripts/x.test.ts`, `src/x.stories.tsx`, `dist/x.test.ts` → false.
  - Count: 7.
- **`toPackageRelative`:**
  - a web absolute path relativizes under `/apps/web/`;
  - an API path doesn't relativize under web;
  - Windows separators are normalized.
  - Count: 3.
- **`summaryVerdict(SUITES.web, …)`:**
  - a `checks` gate `failure` → error naming the checks job;
  - all green → ok;
  - the skip branch is ignored for web, even with `run: "false"`;
  - a file run twice, or never → error;
  - the unknown-file message names `web`;
  - drift is measured against 450 × 1.25;
  - the cap warning names 6 and the web advice.
  - Count: 8.
- **`mergeRuns(SUITES.web, …)`:** keys are relative to `apps/web`, and files outside `existing` are dropped. Count: 2.
- **`ceilingViolations(SUITES.web, …)`:** uses web's ceiling and allowlist. Count: 1.
- **`assignShards` from the lib:** the same partition cases as before, now importing the lib only. Count: 0 new.
- **The suite table itself:**
  - every `SUITES` entry has every field;
  - `min ≤ fallback ≤ max`;
  - artifact prefixes are distinct;
  - shard vars are distinct.
  - Count: 2.

### `scripts/check-ci-cache.mjs` FIXTURES

- **Rule 6:**
  - `WEB_UNIT_SHARD` set and listed in `apps/web/turbo.json` `env` → clean;
  - missing from `env` → 6;
  - present in `passThroughEnv` → 6;
  - `apps/web/turbo.json` absent → 6;
  - the existing integration cases still pass through `turboFiles`.
  - Count: 4.
- **Rule 3:** a sharded `unit-test.yml` fixture shaped like the new file → clean. Count: 1.
- **Rule 8:**
  - a budget-exact tree (20) → clean;
  - +1 job in a push workflow → 8;
  - a dynamic matrix whose plan step reads `--suite web` weighs 6;
  - a dynamic matrix with no `test-shards.mjs plan` → 8 ("unbounded");
  - a literal matrix of 2×3 weighs 6;
  - a `needs` chain counts its maximum, not its sum (changes → plan → shards → summary = shards);
  - a non-chained sibling adds (`checks` with shards = 1 + cap);
  - a main-only push workflow isn't counted;
  - `include` in a matrix → 8.
  - Count: 9.

### Live checks

- **`lint:test-files`:** both suites agree with `jest --listTests`, run in `checks`.
- **The branch's CI runs:**
  - `Unit Tests` green with 3 shards, then with the seeded N;
  - a deliberately failing web test (a throwaway commit, reverted) turns `Unit Tests` red, and so does a deliberately failing lint step in `checks`;
  - `Integration Tests` stays green on the renamed scripts.

**Totals ≈ 75 cases:**
- `lint:test-shards`: about 31 ported plus 29 new;
- `lint:ci-cache`: 14 new fixtures, plus the existing ones;
- the CI walk.

## Acceptance criteria

- [ ] On a PR touching `apps/web`, `Unit Tests` finishes in ≤ ~4 min. The PR records the before (~8–9 min) and after times from real runs.
- [ ] `Unit Tests` is the only required context, and branch protection is unchanged. The web legs (`Unit Tests (web shard i/N)`) and `Unit Tests: checks` / `: plan` report but aren't required.
- [ ] `Unit Tests` turns red on any of:
  - a failing web test in any shard;
  - a failing lint step or non-web unit test in `checks`;
  - a web test file run in no shard, or in two;
  - a missing shard report.
- [ ] The web shard count is planned from `apps/web/src/__tests__/durations.json` and never exceeds 6. The summary warns when it's capped.
- [ ] A fully cached web run restores each shard's result and report from turbo, and the summary still verifies coverage.
- [ ] A local `npm run test:unit` (root or `apps/web`) behaves as before: no `--shard`, and no report written.
- [ ] `npm run lint:ci-cache` fails when the push-triggered workflows' peak concurrent jobs exceed 20, and passes on the tree at exactly 20.
- [ ] `Integration Tests` behaves exactly as before on the renamed scripts, with the same plan, the same split and the same summary.
- [ ] `deploy-dev`'s `workflow_dispatch` path still runs `Unit Tests` through `workflow_call` with no change to `deploy-dev.yml`.
- [ ] The weekly refresh refreshes both durations files, with one drift issue per suite.
- [ ] `CLAUDE.md`'s CI-gating section, `apps/api/src/__tests__/__integration__/README.md` and the workflow comments name the new scripts and the web sharding.

## Risks & rollback

- **The web report's path relativizing is wrong:** the summary then sees every file as unknown and fails closed (red, not a false green). Caught on the branch's first run.
- **A lib change doesn't miss the cache:** if `$TURBO_ROOT$` inputs were ignored, a packer change could restore a stale shard pass. Verified on the branch by editing a comment in the lib and confirming both test tasks miss (`turbo run … --dry=json`).
- **Concurrency:** at exactly 20, a second simultaneous push queues jobs, which is slower but never red. Rule 8 stops the caps from creeping past 20.
- **`deploy-dev`'s dispatch path** now runs four unit jobs instead of one. That's fine within its own run, and noted as out of rule 8's scope.
- **Rollback:** revert the PR. The required context name never changed, so branch protection needs no edit.

## Files touched

- **Renamed:**
  - `scripts/integration-shards.lib.mjs` → `scripts/test-shards.lib.mjs`
  - `scripts/integration-shards.mjs` → `scripts/test-shards.mjs`
  - `.github/workflows/refresh-integration-durations.yml` → `refresh-test-durations.yml`
- **New:**
  - `apps/web/jest.unit.sequencer.mjs`
  - `apps/web/turbo.json`
  - `apps/web/src/__tests__/durations.json` (seeded from CI)
- **Edited:**
  - `apps/api/jest.integration.sequencer.mjs` (imports `assignShards`)
  - `apps/web/jest.config.js`, `apps/web/package.json`
  - `turbo.json`, root `package.json`, `.gitignore`
  - `.github/workflows/unit-test.yml`, `integration-test.yml`, and `nginx-advisories.yml` (a comment naming the refresh workflow)
  - `scripts/check-ci-cache.mjs`
  - `CLAUDE.md`, `apps/api/src/__tests__/__integration__/README.md`

## Next step

`docs/WEB_UNIT_SHARDS.plan.md` sequences this in about 6 slices:
1. Generalize the lib and CLI, rename them, and move `assignShards`. Integration behaves identically, and the existing cases are ported.
2. Web's suite record, predicate, sequencer, script and turbo config, plus `lint:test-files`.
3. Generalize rule 6 and add rule 8.
4. Restructure `unit-test.yml` with the fallback N, then verify on CI.
5. Seed the web durations from that run, and rename and generalize the refresh workflow.
6. Docs.
