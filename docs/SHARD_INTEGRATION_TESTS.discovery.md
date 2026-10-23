# Shard the integration test suite — Discovery

**Issue:** [EnterpriseBT/portal-ai#857](https://github.com/EnterpriseBT/portal-ai/issues/857) · Task · sizing `full`

**Why this exists.** The `Integration Tests` check is the slowest required check on every PR: ~19–20 min when the turbo cache misses, of which 988s is Jest. The suite is serial by necessity. `apps/api` runs it with `--maxWorkers=1` because every suite shares one Postgres and one Redis: `teardownOrg()` deletes every row of every table, and the queue suites obliterate shared BullMQ queues. One file, `demo-seed.service.integration.test.ts`, takes 197s, about 20% of the run.

Splitting the suite across CI runners sidesteps the isolation problem without touching any test: each runner brings its own Postgres and Redis. This is the change that runs the integration suite as N balanced shards behind the one `Integration Tests` check branch protection already requires.

## The current shape

### The workflow

| Piece | Location | Note |
|---|---|---|
| Triggers | `.github/workflows/integration-test.yml:3-16` | `push` (branches-ignore main) + `workflow_call` (two optional TURBO secrets). No `pull_request` |
| Turbo env | `:31-34` | `TURBO_TOKEN`, `TURBO_TEAM`, `TURBO_REMOTE_CACHE_SIGNATURE_KEY` at workflow level |
| Concurrency | `:39-41` | per-branch group, `cancel-in-progress: true` |
| The one job | `:44-45` | `test-integration`, `name: Integration Tests`; no matrix, no `timeout-minutes`; checkout `fetch-depth: 0` (`:58`) |
| Docs-only skip | `:78-82` | step `changes` runs `scripts/integration-skip-base.mjs`; every later step gates on `steps.changes.outputs.run == 'true'`, so a skip reports green |
| Services | `:86`, `docker-compose.yml:38-50,82-100` | `postgres-test` (PostGIS 17, `5433`, tmpfs) + `redis` (`6380`), with healthchecks |
| Run | `:94-97` | `INTEGRATION_TEST_DATABASE_URL`, `REDIS_URL`; `npm run test:integration` → root `turbo run test:integration` (`package.json:23`), unfiltered |
| Callers | `deploy-dev.yml:36-47` (dispatch only), `deploy-prod.yml:57-67` | Both call it as a reusable workflow; `deploy-infra` needs its aggregate result (`deploy-dev.yml:58-65`, `deploy-prod.yml:80`) |

Only `apps/api` has a real `test:integration`; every other package's is `"true"`.

### Jest

| Piece | Location | Note |
|---|---|---|
| Script | `apps/api/package.json:26` | `jest --config jest.integration.config.js --maxWorkers=1`, 6 GB heap |
| Config | `apps/api/jest.integration.config.js` | testMatch `:37`, globalSetup/Teardown `:41-42`, `testTimeout: 60000` `:61`, `workerIdleMemoryLimit: "1.5GB"` (#220) `:63-70`, `forceExit` `:77`. No sequencer, no reporters |
| globalSetup | `src/__tests__/__integration__/setup.ts:21-153` | truncates every table, **runs Drizzle `migrate()` every run** (`:98-101`), seeds `spatial_ref_sys` + the `standard` tier. Each shard pays one full migrate on its fresh container |
| Files | `src/__tests__/__integration__/**` | 198 `*.integration.test.ts`; no timing data anywhere today |
| demo-seed | `services/demo-seed.service.integration.test.ts` | one describe, 9 tests; `beforeEach` = `teardownOrg` + `seedConnectorDefinitions` (`:55-63`). Seeding/data tests 1–4 (`:92-167`), toolpacks 5–7 (`:187-241`), reset/errors 8–9 (`:290-357`) |

### The guards

| Guard | Location | What it holds |
|---|---|---|
| Rule 3, required-check names | `scripts/check-ci-cache.mjs:47-51,105-124` | *some* job in `integration-test.yml` is named exactly `Integration Tests`. It can't tell an aggregator from a shard |
| Rule 1, turbo credentials | `:161-191` | any turbo-running step has the three cache env vars in scope |
| Rule 2, `workflow_call` secrets | `:201-229` | every caller passes the callee's declared secrets |
| Self-test | `:102`, fixtures `:384-503` | pure `findViolations({workflows, siteTurbo, turboScripts})` with `{files, expectRule}` fixtures |
| Docs-only skip | `scripts/integration-skip-base.mjs:46-76,217-237` | pure decision; reads the *workflow-run* conclusion, so it survives a multi-job workflow |
| Turbo task | `turbo.json:83-109` | `test:integration`: `cache: true`, `env: [INTEGRATION_TEST_DATABASE_URL, REDIS_URL]` hashed; `remoteCache.signature: true` |

## The design space

### Decision 1 — How many shards, now and as the suite grows

The goal is to keep the check at 3–6 min as the suite grows, on GitHub's **free plan** (the repo is public, so runners cost nothing). A fixed N only defers the problem: at ~988s of Jest today, 5 shards run ~200s each, and every new suite adds to each of them.

Each shard pays about 2 min of fixed overhead: `npm ci` 58s, services 23s, plus a full migrate. Jest time per shard is the recorded total ÷ N.

- **A. A fixed N** (say 5). ~5.3 min today. It drifts past 6 min once the suite grows about 25%, and every increase means a workflow edit.
- **B. N derived from the recorded suite size.** A `plan` job, run before the matrix, reads `durations.json` and sets N = ⌈total ÷ budget⌉, clamped to `[MIN, MAX]`. It emits the matrix as JSON (`strategy.matrix: ${{ fromJSON(needs.plan.outputs.matrix) }}`). With a ~210s budget, that's 5 today and grows on its own.
- **The cap protects the free plan.** The free plan allows 20 concurrent jobs per account, shared by every workflow and every PR that's running. A push already starts Unit Tests, Static Checks and npm audit. A cap of **10** shards keeps one push to ~14 concurrent jobs, which leaves room for a second PR's push before jobs queue.
- **Headroom.** With a ~210s budget, the cap covers ~2,100s of Jest: about **2.1× today's suite** at the same 3–6 min. Past that, N stays at 10 and wall time rises slowly rather than jumping.

| | A. Fixed N | B. Derived N, capped at 10 |
|---|---|---|
| Wall time as the suite grows | rises linearly | flat (~2 min + budget) until the cap |
| Changes needed to grow | workflow edit | none (refresh durations) |
| Concurrent-job pressure | fixed | grows with the suite, bounded by the cap |
| Moving parts | none | a `plan` job + a dynamic matrix |

**Lean: B, budget ~210s, MIN 2, MAX 10.** It holds the target for roughly a doubling of the suite with no plan upgrade. When the planner hits the cap, the per-worker-database strategy is the next step (What this doesn't decide); the summary job warns when that happens (Decision 7), so the trigger is visible rather than discovered.

### Decision 2 — How files are assigned to shards

- **A. Jest's built-in `--shard=i/N`.** It splits by path hash. Heavy files (demo-seed, portal-map, layout-plans, curated-view) can stack on one shard, so the wall time is set by the unluckiest shard.
- **B. A custom `testSequencer` whose `shard()` bin-packs by recorded duration.** It uses greedy longest-processing-time packing over a committed durations file; a file missing from the file gets the median. Every runner computes the same assignment from the same inputs. Stale durations worsen the balance but never correctness: each file still lands on exactly one shard.
- **C. A matrix of explicit file lists generated by a setup job.** Same balance as B, but moves the logic into workflow YAML and a dynamic matrix, and local runs couldn't reproduce a shard.

**Lean: B.** It balances, stays inside Jest (`--shard` keeps working locally for reproducing one shard), and the assignment is a pure function we can unit-test for "disjoint and complete".

### Decision 3 — Getting the shard into the turbo hash

The shard must reach both Jest and turbo's task hash, or shard 2 could restore shard 1's cached "pass".

- **A. CLI passthrough** (`npm run test:integration -- -- --shard=i/N`). Turbo hashes passthrough args, but the double `--` through npm and turbo is easy to break silently.
- **B. An env var `INTEGRATION_SHARD`.** Listed in `turbo.json` `test:integration.env` (hashed, never `passThroughEnv`), set by the matrix. `apps/api`'s script expands it: `jest … ${INTEGRATION_SHARD:+--shard=$INTEGRATION_SHARD}`. Unset locally, so local runs are unchanged.

**Lean: B.** A declared env var is what `lint:ci-cache` can check mechanically. New rule 6: if `integration-test.yml` sets `INTEGRATION_SHARD`, then `turbo.json`'s `test:integration.env` must list it, and it must not appear in `passThroughEnv`.

### Decision 4 — The check branch protection requires

- **A. Rename shards to `Integration Tests` and require each.** Branch protection matches context names exactly, so N shards would mean N required contexts and a settings change whenever N changes.
- **B. Shards named `Integration Tests (shard i/N)`, plus a summary job named exactly `Integration Tests`.** The summary uses `needs: [changes, plan, shard]` with `if: always()`, and fails unless the skip said "don't run" or every shard's result is `success`. Only `failure` or `cancelled` fail it; a skipped matrix because of docs-only is green.

**Lean: B.** The required context and rule 3 keep matching, and no branch-protection change is needed. Rule 3 is tightened so `Integration Tests` must be a job with `if: always()` that `needs` the shard job. Otherwise a shard named `Integration Tests` would satisfy it while the aggregate check went unreported.

### Decision 5 — Where the docs-only skip runs

- **A. Inside every shard** (as today). It costs N API calls, and N skipped shards plus a summary that has to infer the skip.
- **B. A `changes` job before the matrix.** It owns `fetch-depth: 0` and `actions: read`, and outputs `run`. Shards run only `if: needs.changes.outputs.run == 'true'`; the summary reads the same output.

**Lean: B.** One decision, made once. `integration-skip-base.mjs` already reads the workflow-run conclusion, so a multi-job run is history it understands.

### Decision 6 — Proving every file ran exactly once

The sequencer's unit test proves the assignment is disjoint and complete. CI can still drift: a config change could narrow `testMatch` on one runner.

**Lean:**
- Each shard writes `jest --json` to an artifact.
- The summary job sums `numTotalTestSuites` and checks it against the file count (`find … -name '*.integration.test.ts' | wc -l` on the same checkout).
- Any mismatch fails `Integration Tests`.
- The same artifacts feed the durations refresh (Decision 7), so they pay for themselves.

### Decision 7 — Keeping durations fresh

With a derived N, `durations.json` isn't only a balancing hint. It also sets the shard count, so a stale file means too few shards and slow runs.

**Lean:** three pieces.

- **A writer.** `scripts/update-integration-durations.mjs` reads one or more Jest JSON reports and writes `apps/api/src/__tests__/__integration__/durations.json`, keyed by repo-relative path. The format is plain sorted JSON, so a refresh is a reviewable diff. Run by hand: `gh run download <run> -p 'integration-jest-*'`, run the script, commit.
- **A scheduled refresh PR.** `refresh-integration-durations.yml` runs weekly (cron, plus `workflow_dispatch`). It downloads the shard reports from the latest green `Integration Tests` run on `main`, runs the writer, and opens or updates one PR if anything moved more than a threshold. It never commits to `main`: the PR goes through the normal checks, and a human merges it. It uses the default `GITHUB_TOKEN` with `contents: write` + `pull-requests: write` on a bot branch, so it needs no new secret.
- **A drift warning.** The summary job compares each shard's actual Jest time with the budget. It writes a warning annotation to the run (and the job summary) when a shard runs more than ~25% over, or when the planner sat at the cap. That's a signal, never a failure: slow isn't broken.

New files count as the median until a refresh picks them up.

### Decision 8 — Splitting demo-seed

**Lean:** three files by concern, every assertion kept, with the shared helpers (`provisionOrg`, `rawCount`, `entityIdByKey`, `EXPECTED`) moved to `utils/demo-seed.util.ts`:

- `demo-seed.counts.integration.test.ts`: tests 1–4.
- `demo-seed.toolpacks.integration.test.ts`: tests 5–7.
- `demo-seed.reset.integration.test.ts`: tests 8–9.

Total time is unchanged; what changes is the biggest single unit the bin-packer has to place.

### Decision 9 — A ceiling on any one file

A file can't be split across shards, so the slowest file is a floor no N removes: a shard's wall time can't drop below its biggest file plus the fixed overhead. demo-seed reached 197s because nothing noticed it growing.

- **A. No guard.** The next demo-seed is found the way this one was, by profiling a slow check.
- **B. A warning in the summary job** when a file runs past the ceiling. Visible, but easy to ignore.
- **C. A failing check.** `lint:integration-durations`, run in Unit Tests next to `lint:ci-cache`, fails when any entry in `durations.json` exceeds the ceiling (**120s**). The error names the file and says to split it by concern, as Decision 8 does. An allowlist with a reason per entry covers a file that truly can't split; it starts empty and only shrinks.

**Lean: C, with B as well.** The planner's budget (~210s) assumes no single file takes most of it. The lint runs against the committed durations, so it fires on the refresh PR (Decision 7) that first records the slow file. That PR is exactly where the split belongs, before the slow file becomes the floor on every run.

## Tradeoff comparison

|  | D1 derived N | D2 sequencer | D3 env var | D4 summary job | D5 changes job | D6 count check | D7 refresh + drift | D8 split | D9 file ceiling |
|---|---|---|---|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Touches | `plan` job, matrix | apps/api | turbo.json, script | workflow, rule 3 | workflow | workflow | scripts, scheduled workflow | tests | lint script |

## Recommendation

1. Run `integration-test.yml` as four jobs:
   - a `changes` job (the docs-only skip);
   - a `plan` job that sets N = ⌈Σ `durations.json` ÷ 210s⌉ clamped to `[2, 10]` and outputs the matrix;
   - the matrix `shard` (`name: Integration Tests (shard i/N)`, `timeout-minutes: 20`, its own compose Postgres + Redis);
   - a summary job named exactly `Integration Tests` (`needs: [changes, plan, shard]`, `if: always()`).

   The budget, MIN and MAX live in one place: the planner script, with constants the lint can read.
2. Pass the shard as `INTEGRATION_SHARD=i/N`. List it in `turbo.json` `test:integration.env`; `apps/api`'s script appends `--shard` only when it's set.
3. Add `apps/api/jest.integration.sequencer.mjs`: LPT bin-packing in `shard()` over `durations.json`, median for unknown files, deterministic tie-breaks by path. Add a unit test proving the assignment is disjoint and complete.
4. Each shard uploads its `jest --json` report. The summary fails on any shard `failure` or `cancelled`, and on a suite-count mismatch against the checkout's file count.
5. Add `lint:ci-cache` rule 6 (shard var hashed, not pass-through) and tighten rule 3 (the named job aggregates the shards), each with fixtures.
6. Split demo-seed into three files by concern, with the helpers shared.
7. Add `scripts/update-integration-durations.mjs` and an initial `durations.json` from a full timed run. Add a weekly `refresh-integration-durations.yml` that opens or updates one PR from the latest green `main` run's shard reports, never committing to `main` itself.
8. The summary job warns (an annotation plus the job summary, never a failure) when a shard ran more than ~25% over budget or the planner sat at the cap.
9. Add `lint:integration-durations` (in Unit Tests): it fails when any `durations.json` entry exceeds 120s, unless the file is on a reasoned allowlist that starts empty.
10. Update CLAUDE.md "CI gating", the Copilot mirror, `apps/api/src/__tests__/__integration__/README.md` and `apps/api/README.md`: the sharded shape, the summary check, the budget and cap, how to refresh durations, and what to do when the cap warning fires.

## Open questions

1. **Does `deploy-dev`/`deploy-prod` see a correct aggregate from the reusable workflow?** A failed matrix leg fails the called workflow, and `needs.integration-test.result` is `failure`. Lean: yes, no caller change. The plan's smoke runs a deliberately failing shard on a scratch branch to confirm.
2. **Initial `durations.json` before any sharded run exists.** Lean: generate it from one serial run on this branch with `--json`. Until then the planner has no total, so it uses MIN shards (or a fallback N of 5 when the file is missing) and every file weighs the same. That split is still correct.
5. **Does the free plan's 20-job limit cover the scheduled refresh too?** It's one job, weekly, off-hours. Lean: yes; it never overlaps a burst of PR pushes in practice, and it queues harmlessly if it does.
6. **Is a 210s budget right?** It targets ~5.5 min wall with ~2 min overhead, leaving 30s for imbalance before 6 min. Lean: start there; the drift warning shows whether shards land over it, and it's one constant to tune.
3. **Does each shard pay the full migrate?** Yes, ~10–20s on a fresh tmpfs DB. Lean: accept it; caching a migrated image is a separate optimization.
4. **Does a matrix leg cancelled by `cancel-in-progress` turn the summary red rather than green?** Lean: the summary treats `cancelled` as failure, so a superseded run's summary is red. A cancelled run is superseded by a newer one that reports its own result, so nothing is blocked.

## Enterprise-scale considerations

- **Concurrency & correctness.** Lean: shards are isolated by construction (one container pair each). Correctness rests on the assignment being disjoint and complete; the sequencer test and the summary's suite count both hold it.
- **Accuracy & auditability.** Lean: per-shard Jest JSON artifacts are the record of which files ran where.
- **Failure modes.** Lean: fail closed. A failed, cancelled or missing shard, or a count mismatch, turns the required check red. Stale durations degrade only balance. The remote cache stays fail-open on availability and fail-closed on integrity (#454), and the shard is in the hash.
- **Scale & unbounded growth.** Lean: N grows with the recorded suite up to a cap of 10, which holds 3–6 min for about 2× today's suite on the free plan. The 120s file ceiling keeps any single file from becoming the floor. The cap warning marks the point where the per-worker-database strategy has to land. New files get the median weight, and the count check catches omissions.
- **Multi-tenancy.** N/A because this is CI infrastructure, no tenant data.
- **Contract stability.** Lean: the required context `Integration Tests` is unchanged, so branch protection and both deploy callers need no edits.
- **Data lifecycle.** Lean: artifacts use GitHub's default retention, enough for a durations refresh.

## What this doesn't decide

- One database per Jest worker (`--maxWorkers>1`): it changes how every suite connects and needs runner memory measured. Out of scope per the ticket. It's the next step once the planner sits at the cap: it multiplies each runner's throughput by its worker count (2–4 on a standard runner) instead of adding runners, so it stays inside the free plan. The cap warning (Decision 7) is the trigger to file it.
- A paid GitHub plan or larger runners: avoided by design. The cap is sized to the free plan's 20 concurrent jobs.
- Turning off ts-jest type-checking: measured at ~6%, not worth it.
- Unit Tests and Static Checks workflows: unchanged.
- Caching a pre-migrated Postgres image.

## Next step

`/spec 857` pins:

- the workflow shape (job ids, names, needs, conditions);
- the sequencer API;
- the `INTEGRATION_SHARD` contract;
- rules 3 and 6 with their fixtures;
- the durations file format.

`/plan 857` slices it in this order:

1. The sequencer and its test.
2. The env var, script and turbo hash, plus rule 6.
3. The demo-seed split.
4. The durations writer, the initial `durations.json`, and the file-ceiling lint.
5. The planner script.
6. The workflow (`changes`, `plan`, matrix, summary with the count check and drift warning), plus the tightened rule 3.
7. The scheduled refresh workflow.
8. Docs.

The smoke is a real CI run on the branch: timing, a forced failure, a docs-only push, and a cached re-run.
