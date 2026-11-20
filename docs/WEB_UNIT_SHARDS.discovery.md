# Shard the web unit suite — Discovery

**Issue:** [EnterpriseBT/portal-ai#1091](https://github.com/EnterpriseBT/portal-ai/issues/1091)

**Why this exists.** **Unit Tests** gates every PR. It takes 8–10 minutes whenever `apps/web` or `packages/core` changes.

Measured on run 44618778883:
- `npm run test:unit` was 492s of the job.
- `apps/web`'s Jest suite alone was 487s: 407 files and 6,414 tests on one 4-core runner, sharing it with the API's unit suite (129s).

It isn't compile time. On a 101-file sample, a cold Jest cache took 118s and a warm one 110s. The time is jsdom and MUI test runtime, which only parallelism shortens.

The integration suite already solved this shape (#857): a planned shard count, longest-first packing from recorded durations, and a fail-closed summary under the required name. This ticket brings that machinery to the web unit suite. It also caps both suites so one push never exceeds GitHub Free's 20 concurrent jobs.

## The current shape

### The integration sharding machinery

| Piece | Location | Note |
|---|---|---|
| Constants | `scripts/integration-shards.lib.mjs:10-25` | `BUDGET_SECONDS=150`, `MIN_SHARDS=2`, `MAX_SHARDS=10`, `FALLBACK_SHARDS=5`, `FILE_CEILING_SECONDS=120`, `DRIFT_FACTOR=1.25`. Module-level, not parameters |
| `planShards` | `integration-shards.lib.mjs:185-200` | ⌈total ÷ budget⌉, clamped; returns `{count, matrix, totalSeconds, capped}` |
| `summaryVerdict` | `integration-shards.lib.mjs:219-304` | Fails on a file that ran twice, never ran, or is unknown, and on a failed or cancelled leg. Warns on drift and on the cap |
| Medians / refresh | `integration-shards.lib.mjs:77-156` | `SAMPLE_RUNS=5`, `mergeRuns` median, `durationsChanged` noise filter |
| Integration-specific bits | `integration-shards.lib.mjs:28-43`; `integration-shards.mjs:414-418, 470, 519, 535-542` | `DURATIONS_FILE`, `/apps/api/` relativizing, `isIntegrationTestPath`, artifact names, "Integration Tests" strings |
| `assignShards` (LPT) | `apps/api/jest.integration.sequencer.mjs:47-68` | Lives in `apps/api` **so turbo hashes it**; the sequencer's `shard()` is at :80-93 |
| CLI | `integration-shards.mjs:555-565` | `--self-test`, `plan`, `summarize`, `check-durations`, `update-durations`, `sample-runs` |
| Durations | `apps/api/src/__tests__/__integration__/durations.json` | Flat `{relativePath: seconds}`, ~209 entries |
| Refresh | `.github/workflows/refresh-integration-durations.yml:21-125` | Weekly: reports from merged PR heads, medians, one issue (never a PR) |

### The integration workflow

`integration-test.yml` runs `changes` (:63-83) → `plan` (:88-110) → `shard` matrix (:112-158) → `summary` (:169-201).
- **plan:** a sparse checkout with no `npm ci`.
- **shard:** sets `INTEGRATION_SHARD: i/N` (:143) and uploads its Jest JSON report with `if: always()` (:146-154).
- **summary:** named exactly `Integration Tests`, with `if: ${{ !cancelled() }}` (:170-172). It enumerates the expected files by name from a sparse checkout.

On the API side, `apps/api/package.json:26` appends `--shard` and the report only when the variable is set. `turbo.json:123-138` hashes `INTEGRATION_SHARD` in `env` and caches the report as an output.

### The unit workflow today

- **Job:** `unit-test.yml` is one job named `Unit Tests` (:55-56). It runs about nine lint steps (:66-123), then `npm run test:unit` (:125-126), which is root `turbo run test:unit` with no filter (`package.json:25`).
- **Callers:** it is also `workflow_call`ed by `deploy-dev.yml:31` and `deploy-prod.yml:52`.
- **turbo:** `test:unit` (`turbo.json:90-100`) has no `env` and no `outputs`.
- **Web's Jest:** `apps/web/jest.config.js` has no `testSequencer` and no `maxWorkers`, so Jest uses cores − 1 = 3 workers on CI. Its `testMatch` is at :75. ts-jest already only transpiles (`isolatedModules` in `apps/web/tsconfig.json:14`).
- **Per-package turbo config:** only `apps/site/turbo.json` exists. turbo is 2.10.12, which supports `$TURBO_ROOT$` in `inputs`.

### Guards

`scripts/check-ci-cache.mjs`:
- **Rule 3** (:133-170) is already generic. Any required workflow with a matrix job must carry its required name on a non-matrix job that `needs` every matrix job with `always()` / `!cancelled()`. `REQUIRED_CHECK_JOB_NAMES` (:52-56) already lists `unit-test.yml`.
- **Rule 6** (:340-388) is hardcoded: `SHARD_VAR = "INTEGRATION_SHARD"` must be in `turbo.json`'s `test:integration` `env`.
- **Self-test fixtures:** YAML builders (:406-542) and the `FIXTURES` array (:552-750).

### Concurrency today

These workflows run on a branch push: `static-checks` (1 job), `unit-test` (1), `e2e-test` (1), `npm-audit` (1), and `integration-test`. Integration's changes and plan jobs finish before its ≤10 shards start, and the summary runs after.

Nothing counts concurrent jobs. The budget is only prose: `integration-shards.lib.mjs:11-13` (which says "three other checks" and misses npm audit), `integration-test.yml:85-87` and `CLAUDE.md`.

## The design space

### Decision 1 — How the web suite is split

- **A. Jest's built-in `--shard`.** It splits by path hash into equal file counts, with N fixed or derived from the file count. There's no durations file. With 407 files the counts balance, but the time doesn't: RegionEditor and the workflow suites are several times heavier than a component test.
- **B. The integration approach.** N is planned from recorded per-file durations, and a custom sequencer packs files longest-first.

| | A | B |
|---|---|---|
| Shard balance | by count | by time |
| Variable N | from file count (a proxy) | from recorded time |
| New moving parts | none | durations file, sequencer, refresh |
| Matches #857 / user ask | no | yes |

**Lean: B.** You asked for the integration suite's variable-N shape, and N is only meaningful if it comes from time.

### Decision 2 — Where the shared code lives

- **A. Copy** the lib and the sequencer for web.
- **B. Generalize in place.** The lib becomes suite-parameterized. Each suite is a config record: name, durations path, test-path predicate, budget, min/max/fallback, workers, artifact prefix and display name. `assignShards` moves into the shared lib, and each package's sequencer imports it. Turbo still hashes it, via `inputs: ["$TURBO_DEFAULT$", "$TURBO_ROOT$/scripts/test-shards.lib.mjs"]` on both test tasks.
- **C. Generalize the lib, but keep a copy of `assignShards` in each package,** so turbo hashes it without `$TURBO_ROOT$`.

**Lean: B.** It's one packer and one verdict, as the ticket asks. `$TURBO_ROOT$` keeps the reason `assignShards` sat in `apps/api`, which was that a change to the packer must miss the cache.
- **Renames:** the files become `scripts/test-shards.lib.mjs` and `scripts/test-shards.mjs`, with a `--suite integration|web` flag. Per the no-compat-aliases rule, the npm scripts are renamed outright: `lint:test-shards` and `lint:test-durations` replace `lint:integration-shards` and `lint:integration-durations`, everywhere they're referenced.

### Decision 3 — The unit-test.yml shape

- **`checks`:** a non-matrix job holding the lint steps and `turbo run test:unit --filter='!@portalai/web'`.
- **`plan`:** a sparse checkout, no `npm ci`, running `test-shards.mjs plan --suite web`.
- **`web`:** a matrix job, `Unit Tests (web shard i/N)`, that sets `WEB_UNIT_SHARD` and runs `turbo run test:unit --filter=@portalai/web`.
- **`summary`:** named exactly **`Unit Tests`**, `needs: [checks, plan, web]` with `if: ${{ !cancelled() }}`. It fails on a failed or cancelled `checks` job as well as on a web coverage gap.

The alternative, two workflows (web and everything else), would add a second required context. Branch protection lists contexts by name, so that's a settings change, and `deploy-dev`/`prod` would need a second `workflow_call`.

**Lean:** one workflow with four jobs. Rule 3 already enforces its shape, and the callers don't change.

### Decision 4 — Hashing the web shard in turbo

- **A.** Add `WEB_UNIT_SHARD` to the root `test:unit` `env`. Every package's unit hash then includes it. It's unset for them, so this is harmless but noisy.
- **B.** A package `apps/web/turbo.json` that `extends: ["//"]` and overrides `test:unit` with `env: ["WEB_UNIT_SHARD"]` and `outputs: ["jest-unit-report.json"]`. `apps/site` sets the precedent.

**Lean: B.** It's scoped to the one package that shards.
- **Rule 6 generalizes:** for each shard variable a workflow sets, the task that runs it (root or package `turbo.json`) lists it in `env`, never in `passThroughEnv`.

### Decision 5 — The 20-job guard

- **A.** Prose and constants only. That's today, and it's already wrong by one.
- **B.** A new **rule 8 in `check-ci-cache.mjs`**, which already parses every workflow and carries fixtures.
  - For each push-triggered workflow it computes the peak concurrent jobs. That's the heaviest set of jobs with no `needs` path between any two, with a matrix job weighted at its suite's cap from the shared lib.
  - It sums the peaks and fails over 20.

  Today: integration = 10 (changes → plan → shards → summary is a chain), unit = 7 (`checks` overlaps the web shards), and three single-job workflows. Total 20.

**Lean: B.** It's computed from the YAML and the caps, so a new push workflow or job fails it rather than quietly queueing. The search is brute force; each workflow has at most a handful of jobs.

### Decision 6 — Web budget and initial durations

- **Budget:** web runs 3 Jest workers per runner, so N = ⌈Σ file seconds ÷ (budget × workers)⌉, with budget 150s, min 2 and max 6.
  - Measured total ≈ 487s wall × 3 workers, which gives N = 4, or about 2.5 min of Jest per shard plus ~30s of setup.
  - The per-file ceiling (120s) applies too; no web file is near it.
- **Seeding the durations:** local timings come from a 14-core machine, so their scale is wrong for N. The branch's first CI runs use `FALLBACK_SHARDS` (3 for web) and upload reports, and `update-durations --suite web` then writes the seed file from those reports in a commit on this branch.
- **Refresh:** `refresh-integration-durations.yml` becomes `refresh-test-durations.yml` and loops over both suites. It keeps one drift issue per suite, each with its own exact title.

**Lean:** as above.

## Tradeoff comparison

| | D1 durations + LPT | D2 generalize lib | D3 one workflow, 4 jobs | D4 package turbo.json | D5 rule 8 | D6 seed from CI |
|---|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes | Yes |

## Recommendation

1. **Plan and packing:** split the web unit suite by a planned N from `apps/web/src/__tests__/unit-durations.json`, packed longest-first by a web Jest sequencer that imports the shared `assignShards`.
2. **Shared lib:** rename `scripts/integration-shards*.mjs` to `scripts/test-shards*.mjs`, parameterized by a suite config (`integration`, `web`), with `--suite` on every CLI subcommand. Rename the npm scripts to `lint:test-shards` and `lint:test-durations`, with no aliases.
3. **Turbo hashing:** both test tasks list `$TURBO_ROOT$/scripts/test-shards.lib.mjs` in `inputs`, so a packer change misses the cache.
4. **`unit-test.yml`:**
   - jobs: `checks` (lint plus non-web unit tests), `plan`, the web matrix `Unit Tests (web shard i/N)`, and the summary **`Unit Tests`** (`!cancelled()`, fail-closed, which also fails on `checks`);
   - `deploy-dev` and `deploy-prod` call it unchanged.
5. **`apps/web` setup:**
   - `apps/web/turbo.json` hashes `WEB_UNIT_SHARD` and caches `jest-unit-report.json`;
   - web's `test:unit` appends `--shard` and the JSON report only when the variable is set;
   - `jest.config.js` gets a `testSequencer`.
6. **Caps:** web min 2, max 6, fallback 3, budget 150s at 3 workers. Integration stays at max 10.
7. **`check-ci-cache.mjs`:**
   - rule 6 generalizes to every shard variable;
   - a new rule 8 fails when the push-triggered workflows' peak concurrent jobs (matrix jobs at their caps) exceed 20;
   - both get self-test fixtures.
8. **Refresh:** `refresh-test-durations.yml` refreshes both durations files, with one drift issue per suite.
9. **Docs:** update `CLAUDE.md`'s "CI gating" sharding section and the lib's 20-job comment.

## Open questions

1. **Should the web summary also fail when a web test file is missing from the durations file?** No. The integration suite treats a new file as unknown-but-run: the sequencer assigns it the median, and the next refresh picks it up. Coverage is checked by the files that actually ran, not by the durations file. Lean: no.
2. **How does the summary enumerate the expected web files without `npm ci`?** A path predicate mirroring web's `testMatch` (`jest.config.js:75`), held equal to `jest --listTests` by a self-test in the `checks` job, which has `node_modules`. Lean: predicate plus that agreement test.
3. **Should a fully cached web run still start N shard runners?** Yes. Each costs about 20s of setup plus a turbo cache hit. Skipping them would need turbo's dry run in the plan job, which needs `npm ci`, and a skipped matrix complicates the summary. Lean: always run them.
4. **Does a `workflow_dispatch` of deploy-dev (suites + build) break the 20-job budget?** It runs on `main` only and isn't a branch push. Rule 8 counts push-triggered workflows; note the dispatch case in the rule's comment. Lean: out of the rule's scope.

## Enterprise-scale considerations

- **Concurrency & correctness:**
  - Each shard's turbo hash includes its shard, so no shard restores another's result.
  - The summary checks coverage by file name, so a file that runs in no shard, or in two, fails CI.
  - Lean: mirror #857's guards exactly.
- **Accuracy & auditability:** the Jest JSON reports are the record of what ran. They're uploaded per shard and read by the summary and by the refresh. Lean: as #857.
- **Failure modes:** fail-closed on coverage and on leg results. Fail-open on cache availability, unchanged. A missing durations file falls back to `FALLBACK_SHARDS` in `plan`, but fails `lint:test-durations`. Lean: as #857.
- **Scale & unbounded growth:**
  - N is capped at 6.
  - Rule 8 bounds the total, and the cap warning signals when the suite outgrows it.
- **Multi-tenancy:** N/A because this is CI-only, with no product data or tenants.
- **Contract stability:** the required context name stays `Unit Tests`, and the `deploy-dev`/`prod` callers don't change. Lean: no branch-protection change.
- **Data lifecycle:**
  - the durations file is a median over the last 5 green merged-PR runs, as #857;
  - artifacts keep the repo's default retention.

## What this doesn't decide

- **One database per Jest worker in the integration suite:** #857's planned next step, which is separate.
- **Swapping the transformer, or persisting Jest's cache:** measured at under a 10% gain.
- **Sharding core's or the API's unit tests:** each is under 2.5 min and runs in `checks`. Revisit if `checks` becomes the long pole.
- **Concurrency across pushes:** GitHub's limit is per account, so two simultaneous pushes can still queue. That costs time, not money, since the repo is public on GitHub Free.

## Next step

`docs/WEB_UNIT_SHARDS.spec.md` pins the suite config, the renamed CLI, the workflow YAML shape, rules 6 and 8, and the turbo config. The plan then slices it as follows:
1. generalize the lib and rename the integration suite onto it, with no behaviour change;
2. the web sequencer, script and turbo config;
3. the rule 6 generalization and rule 8;
4. the `unit-test.yml` restructure with the fallback N;
5. seed `unit-durations.json` from that run, and generalize the refresh workflow;
6. docs.
