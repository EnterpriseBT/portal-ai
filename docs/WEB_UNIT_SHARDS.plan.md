# Shard the web unit suite — Plan

**The plan implements the spec in TDD order:**
1. Generalize the sharding lib with no behaviour change.
2. Teach it the web suite.
3. Guard the hashing and the 20-job budget.
4. Restructure `Unit Tests` with the fallback shard count.
5. Seed the web durations from that run and refresh both suites.
6. Sync the docs.

Spec: `docs/WEB_UNIT_SHARDS.spec.md`. Discovery: `docs/WEB_UNIT_SHARDS.discovery.md`. Issue: #1091. Builds on the shipped sharded integration suite (#857).

There are six slices. Each sits behind a green self-test or guard and leaves the repo compilable. They land as **commits on `chore/1091-shard-web-unit-suite`** (PR #1092), per `CLAUDE.md` → "Phase = commit, not PR".

The tests are the scripts' embedded self-tests and guards, run from the repo root through npm scripts:

```bash
npm run lint:test-shards      # scripts/test-shards.mjs CASES (lint:integration-shards until slice 1 renames it)
npm run lint:ci-cache         # scripts/check-ci-cache.mjs FIXTURES, then the real tree
npm run lint:test-files       # predicate ⇔ jest --listTests (from slice 2)
npm run lint:test-durations
```

Each slice:
1. Write the failing cases.
2. Make the smallest change that greens them.
3. Run the focused script.
4. Run `npm run lint && npm run format:check` at the boundary (these are `.mjs`/YAML/JSON, so `type-check` only matters where web's config changes).
5. Push. CI is the integration check for the workflow slices (1, 4, 5).

**Sequencing rationale:**
- **Slice 1** is a pure refactor under the existing 31 cases. If integration still plans, splits and summarizes identically, everything after it builds on a proven lib.
- **Slice 2** adds web's pieces, but nothing in CI shards web yet, so it can't break a required check.
- **Slice 3** adds the guards **before** the workflow they police. Rule 8 passes on today's tree, which totals 14 concurrent jobs.
- **Slice 4** is the only slice that changes what CI runs for `Unit Tests`. The guards from slice 3 hold its shape on arrival: rule 3 (the summary), rule 6 (the hashing) and rule 8 (exactly 20).
- **Slice 5** needs slice 4's CI artifacts to seed from.
- **Slice 6** is docs.

---

## Slice 1 — One lib, suite-parameterized; integration unchanged

**Files**

- Rename `scripts/integration-shards.lib.mjs` to `scripts/test-shards.lib.mjs`, then:
  - add `Suite`, `SUITES.integration`, `CONCURRENT_JOB_LIMIT`, `toPackageRelative`, and `gates` on `summaryVerdict`;
  - make the suite the first parameter of `mergeRuns`, `mergeReports`, `ceilingViolations`, `planShards` and `summaryVerdict`;
  - move `assignShards` in.
  - `SUITES.web` arrives in slice 2.
- Rename `scripts/integration-shards.mjs` to `scripts/test-shards.mjs`:
  - `--suite` on every subcommand except `--self-test` and `sample-runs`;
  - `assignShards` is imported from the lib, so the sequencer's dynamic import goes;
  - the `artifactPrefix` and `title` strings come from the suite.
- Edit `apps/api/jest.integration.sequencer.mjs`: import `assignShards` from `../../scripts/test-shards.lib.mjs`, and delete the local copy and its median helper.
- Edit `turbo.json`: `test:integration` gets `"inputs": ["$TURBO_DEFAULT$", "$TURBO_ROOT$/scripts/test-shards.lib.mjs"]`.
- Edit the root `package.json`: `lint:integration-shards` becomes `lint:test-shards`, and `lint:integration-durations` becomes `lint:test-durations` (integration only for now).
- Edit `.github/workflows/integration-test.yml` (plan and summarize get `--suite integration`, plus the comments), `unit-test.yml` (the renamed lint steps) and `refresh-integration-durations.yml` (the CLI path and `--suite integration`; the file rename waits for slice 5).

**Steps**

1. **Tests.** Port all 31 CASES to the suite-first signatures with `SUITES.integration`.
   - Their expected values are unchanged; the refactor's regression is that they stay green.
   - Add the suite-table cases (spec: every field present, `min ≤ fallback ≤ max`, distinct prefixes and shard vars; 2). Run them; they fail on the missing exports.
2. **Implement** the renames and parameterization. Green.
3. **Check the cache:**
   - `npx turbo run test:integration --filter=@portalai/api --dry=json` shows the lib in the task's inputs;
   - editing a comment in the lib changes the `test:integration` hash; revert the edit.
4. Push. CI: `Integration Tests` green with the same planned N and the same per-shard file lists as `main`'s last run (compare the summary tables). `Unit Tests` green on the renamed lint steps.

**Done when:**
- all 33 cases pass;
- `grep -r integration-shards` finds only historical phase docs;
- integration CI is unchanged.

**Risk:** the `$TURBO_ROOT$` microsyntax. If turbo 2.10 rejects it, fall back to keeping `assignShards` in each package's sequencer (discovery D2 option C) and re-confirm the spec.

---

## Slice 2 — The web suite: record, predicate, sequencer, script, turbo

**Files**

- Edit `scripts/test-shards.lib.mjs`: add `isWebUnitTestPath` and `SUITES.web` (spec table), with `durationsRequired: false` until slice 5. Integration is `true`.
- Edit `scripts/test-shards.mjs`:
  - `list-agreement --suite`;
  - `check-durations` honours `durationsRequired` (a missing file is a notice, not a failure, when false);
  - the root `lint:test-durations` runs both suites;
  - a new `lint:test-files` runs `list-agreement` for both.
- New: `apps/web/jest.unit.sequencer.mjs`.
- Edit `apps/web/jest.config.js`: add `testSequencer`.
- Edit `apps/web/package.json`: the `test:unit` shard suffix.
- New: `apps/web/turbo.json`: `test:unit` with `env: ["WEB_UNIT_SHARD"]`, `outputs: ["jest-unit-report.json"]`, and the `$TURBO_ROOT$` input.
- Edit `.gitignore`: add `jest-unit-report.json`.
- Edit `unit-test.yml`: add a `npm run lint:test-files` step to the existing single job.

**Steps**

1. **Tests:**
   - `planShards(SUITES.web)` (6);
   - `isWebUnitTestPath` (7);
   - `toPackageRelative` (3);
   - `summaryVerdict(SUITES.web)` (8);
   - `mergeRuns(SUITES.web)` (2);
   - `ceilingViolations(SUITES.web)` (1).

   That's 27 new cases. Run them; they fail.
2. **Implement.** Green.
3. **Live checks:**
   - `npm run lint:test-files` agrees for both suites (407 web files, and integration's set);
   - `WEB_UNIT_SHARD=1/3 npm run test:unit --workspace @portalai/web` runs about a third of the files and writes `jest-unit-report.json`; the three shards' file lists partition the 407;
   - a plain `npm run test:unit --workspace @portalai/web` runs all 407 and writes no report;
   - `npx turbo run test:unit --filter=@portalai/web --dry=json` hashes `WEB_UNIT_SHARD` and lists the lib input.
4. `npm run lint`, `format:check`, and `type-check` for web. Push. CI green (still one unit job).

**Done when:** about 60 CASES pass, `lint:test-files` agrees, and the three local shards partition the suite.

**Risk:** the web sequencer importing a module outside `rootDir`. It's a plain Node ESM import of a dependency-free file. If Jest's resolver objects, load it with `createRequire` / an absolute `pathToFileURL`.

---

## Slice 3 — Guards: rule 6 generalized, rule 8 added

**Files**

- Edit `scripts/check-ci-cache.mjs`:
  - import `SUITES` and `CONCURRENT_JOB_LIMIT`;
  - rule 6 loops over `SUITES` (`shardVar` / `turboFile` / `turboTask`);
  - `runRealTree` reads `apps/web/turbo.json`;
  - fixtures take a `turboFiles` map, with the existing `rootTurbo` fixtures mapped onto `turbo.json`;
  - add rule 8 (push-workflow selection, job weights, dynamic-matrix resolution through the plan step's `--suite`, the maximum-weight antichain, the sum against 20);
  - update the header comment's rule list.

**Steps**

1. **Tests:**
   - rule 6: 4 fixtures;
   - rule 3: the new unit-test shape, 1;
   - rule 8: 9 fixtures, per the spec.

   They fail.
2. **Implement.** Green.
3. Real tree: rule 8 computes **14** today (integration 10, plus four single jobs). Log the per-workflow peaks under a `--verbose` flag (or always, on success) so the number is visible.

**Done when:** `lint:ci-cache` passes its fixtures and the real tree, and prints the 14.

**Risk:** reading `on.push` correctly. YAML's `on` key parses as boolean `true` in some loaders; mirror how the script already reads triggers.

---

## Slice 4 — `Unit Tests` runs as checks + plan + web shards + summary

**Files**

- Edit `.github/workflows/unit-test.yml`: the four jobs per the spec table. `checks` keeps every lint step plus `lint:test-files`, and runs `npm run test:unit -- --filter='!@portalai/web'`.

**Steps**

1. **Tests:** the real tree under `lint:ci-cache`. Rule 3 holds the summary shape, rule 6 the web hashing, and rule 8 must now print **20** (unit 7). Run it before pushing.
2. Push. **CI walk:**
   - `Unit Tests: plan` plans 3 (the fallback, with no web durations yet);
   - three `Unit Tests (web shard i/3)` legs;
   - `Unit Tests` green, with a summary table totalling 407 suites;
   - record the wall times.
3. **Fail-closed walk, with throwaway commits, each reverted:**
   - a web test that `expect(1).toBe(2)` → `Unit Tests` red, naming the failed suite;
   - a `checks` failure (break `format:check` in one file) → `Unit Tests` red, naming the checks job.
4. **Cache walk:** re-run the workflow on the same commit. The shards restore from turbo, the reports are restored, and the summary is still green.

**Done when:** `Unit Tests` is green on 3 shards and red for each injected failure, and `deploy-dev.yml` is unchanged.

**Risk:** the `deploy-dev` `workflow_call` path can't be exercised from a branch. Its inputs are unchanged and the jobs need nothing from the caller beyond the secrets, so verify it on the first `main` dispatch after merge, as a step in the smoke doc.

---

## Slice 5 — Seed web durations; refresh both suites

**Files**

- New: `apps/web/src/__tests__/durations.json`, from slice 4's run (`gh run download <id> -p 'web-unit-jest-*' -D /tmp/web-reports`, then `node scripts/test-shards.mjs update-durations --suite web --reports /tmp/web-reports`).
- Edit `scripts/test-shards.lib.mjs`: set `SUITES.web.durationsRequired: true`.
- Rename `.github/workflows/refresh-integration-durations.yml` to `refresh-test-durations.yml`:
  - the per-suite loop (`workflowFile`, artifact pattern, `update-durations --suite`, the issue by `driftIssueTitle`);
  - concurrency group `refresh-test-durations`;
  - a failure in one suite doesn't skip the other, and fails the job at the end.
- Edit `.github/workflows/nginx-advisories.yml`: the comment naming the refresh workflow.

**Steps**

1. **Tests:**
   - a case that `check-durations` fails on a missing web file now that `durationsRequired` is true (1);
   - `lint:test-durations` passes on the seeded file, with every web file under 120s.
2. **Implement and seed.** Push. CI plans N from the seed, expected about 4. Record the per-shard Jest seconds and the `Unit Tests` wall time; the target is ≤ ~4 min.
3. **Refresh walk:** dispatch `refresh-test-durations.yml` on the branch (`gh workflow run refresh-test-durations.yml --ref chore/1091-shard-web-unit-suite`). It samples both suites without error.
   - Web has no merged-PR samples yet, so it reports "no runs" and opens nothing.
   - Integration behaves as before.

**Done when:**
- web plans from its durations;
- `Unit Tests` finishes in ≤ ~4 min on a web-touching push;
- the refresh runs for both suites.

**Risk:** the refresh samples only merged PRs' heads, so web's first real refresh happens after this PR merges. That's expected, and noted in the README section in slice 6.

---

## Slice 6 — Docs

**Files**

- Edit `CLAUDE.md` → "CI gating":
  - the sharded integration section generalizes to "sharded suites";
  - name the web suite, its caps and the 450s budget;
  - `lint:test-shards`, `lint:test-durations`, `lint:test-files`;
  - rule 6 generalized and rule 8;
  - `refresh-test-durations.yml`.
- Edit `apps/api/src/__tests__/__integration__/README.md`: the script names and `--suite integration`.
- New or edited: a short "Sharding" note in `apps/web/README.md`, covering the durations file, `WEB_UNIT_SHARD` and the refresh.

**Steps:** `npm run lint:doc-pointers` and `npm run lint:review-chain` pass. Then `grep -rn "integration-shards\|lint:integration-\|refresh-integration-durations"` outside phase docs returns nothing.

**Done when:** no stale script names remain outside phase docs.

---

## Sequence summary

| # | Lands | Gate |
|---|---|---|
| 1 | Lib and CLI renamed and suite-parameterized; `assignShards` shared; integration identical | 33 CASES; integration CI unchanged |
| 2 | Web suite record, predicate, sequencer, script, turbo, `lint:test-files` | ~60 CASES; local 3-way partition |
| 3 | Rule 6 generalized, rule 8 | 14 new fixtures; real tree = 14 |
| 4 | `unit-test.yml` → checks / plan / web shards / `Unit Tests` | real tree = 20; CI green on 3 shards, red on injected failures |
| 5 | Web durations seeded; two-suite refresh | planned N ≈ 4; `Unit Tests` ≤ ~4 min |
| 6 | Docs | no stale names |

## Cross-slice notes

- **Required check:** `Unit Tests` is the required context throughout. Slices 1–3 keep the single job. Slice 4 moves the name onto the summary in one commit, so no push leaves the name missing.
- **Durations:** `durationsRequired` is `false` for web from slice 2 until slice 5's seed, and `check-durations` tells the two states apart.
- **Turbo inputs:** turbo's `inputs` replace the defaults unless `$TURBO_DEFAULT$` is listed. Both tasks list it first.
- **No product code changes:** smoke for this ticket is the CI walk itself (slices 4–5), plus the first post-merge `deploy-dev` dispatch.
- **Docs sync:** slice 6 covers `CLAUDE.md` and the READMEs. The durable `docs/` set doesn't name these scripts (checked by grep in slice 6).

## Next step

Once this plan is confirmed, implementation starts on this branch with slice 1, tests first, one commit per slice.
