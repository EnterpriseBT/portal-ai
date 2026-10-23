# shard-integration-tests — Smoke Suite

Smoke test for [#857](https://github.com/EnterpriseBT/portal-ai/issues/857): the integration suite as N duration-balanced shards behind the one `Integration Tests` check, the planner, the summary's fail-closed verdict, the durations ceiling and refresh, and the `node_modules` cache. **Branch under test:** `chore/857-shard-integration-tests` (PR [#860](https://github.com/EnterpriseBT/portal-ai/pull/860)).

The surface is CI, so the walk is GitHub Actions runs, not a browser. Every step is `— backend`: `gh` and workflow logs. §7 runs **after merge**, because GitHub only dispatches workflows that exist on the default branch.

## Preflight

### Environment
- [ ] `gh auth status` is logged in with access to EnterpriseBT/portal-ai.
- [ ] `git checkout chore/857-shard-integration-tests && git pull --ff-only`.

### Fixtures
- [ ] None. The suite and its runs are the fixture.

### Reset between runs
- [ ] The forced-failure branch (§3) is deleted afterwards: `git push origin --delete smoke/857-forced-failure`.

## §1 — Timing: an uncached run ≤ 6 min, with the module cache hitting

- [ ] A push to the PR branch that changes an `apps/api` input (so turbo misses) runs `changes` → `plan` → `Integration Tests (shard i/N)` × N → `Integration Tests`. — backend
- [ ] The run's wall time (first job start → last job end, `gh run view <id> --json jobs`) is **≤ 6 min**. — backend
- [ ] Each shard's `Setup` step is ≈ 10s (a `node_modules` cache hit), not ≈ 65s. — backend
- [ ] The summary table reads `200 of 200 files`, 0 failed, and N matches `node scripts/integration-shards.mjs plan` on the same commit. — backend

## §2 — Every file runs exactly once, and local runs are unchanged

- [ ] `npm run lint:integration-shards` passes (every file in exactly one shard, for 0…198 files). — backend
- [ ] `cd apps/api && npm run test:integration -- --listTests` lists 200 files; `--listTests --shard=i/5` for i = 1…5 together list the same 200, with no duplicates. — backend
- [ ] With `INTEGRATION_SHARD` unset, a local run writes no `jest-integration-report.json`. — backend

## §3 — A failing shard turns the check red; the others finish

- [ ] Push `smoke/857-forced-failure`, a branch off this one that breaks one assertion in a single integration test. — backend
- [ ] Exactly one shard fails. The other shards run to completion (`fail-fast: false`). — backend
- [ ] `Integration Tests` (the summary) is **red**, and its log names the failed suite and "the shards ended failure". — backend
- [ ] Delete the branch. — backend

## §4 — Docs-only push: green with no shard

- [ ] A push of only `docs/` or `*.md` since the branch's last green run gives `Integration Tests: changes` = success with `run=false`. `plan` and every shard are **skipped**, and `Integration Tests` is **green** ("Skipped: only docs changed"). — backend

## §5 — Fully cached re-run

- [ ] `gh run rerun <id>` on an unchanged commit: every shard's test step finishes in a few seconds (turbo cache hit), and the summary still reads `200 of 200 files` from the restored reports. — backend

## §6 — Guards fail where they should

- [ ] `npm run lint:ci-cache` passes, and its self-test includes the rule 3 (aggregator) and rule 6 (hashed shard var) fixtures. — backend
- [ ] Set one `durations.json` entry to `121` locally: `npm run lint:integration-durations` fails, naming the file. Revert. — backend
- [ ] Branch protection's required contexts are unchanged: `gh api repos/EnterpriseBT/portal-ai/branches/main/protection/required_status_checks -q .contexts` lists `Unit Tests`, `Integration Tests`, `Static Checks`. — backend

## §7 — After merge

- [ ] `gh workflow run refresh-integration-durations.yml`: the run either reports "unchanged beyond noise", or opens/updates **one** PR whose `Unit Tests`, `Static Checks` and `Integration Tests` checks appear (dispatched). Close it if it's only a test. — backend
- [ ] `gh workflow run deploy-dev.yml` (the `workflow_dispatch` path that calls `integration-test.yml` as a reusable workflow): the called workflow plans and shards, and `deploy-infra` waits on its aggregate result. — backend
- [ ] The first Monday after merge, the scheduled refresh runs on its own. — backend

## Sign-off

- [ ] Every section above verified, or deferred with a recorded reason
- [ ] <date + name>: confirmed against CI

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (run id, job, shard):
