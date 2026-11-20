# web-unit-shards — Smoke Suite

Smoke for [#1091](https://github.com/EnterpriseBT/portal-ai/issues/1091): `Unit Tests` runs the web unit suite as planned shards behind one required check.

**Branch under test:** `chore/1091-shard-web-unit-suite` (PR [#1092](https://github.com/EnterpriseBT/portal-ai/pull/1092)).

This is CI-only, so the walk happens in GitHub Actions, not a browser. §1–§3 are walked on the branch's CI runs. §4 can only run after merge, because both workflows involved run from `main`. Every step is `— backend`: a `gh` command or a run page.

## Preflight

- [ ] `gh auth status` is signed in with access to `EnterpriseBT/portal-ai`.
- [ ] No reset is needed. Each step reads a run, or dispatches one.

## §1 — Unit Tests runs as checks + plan + web shards + summary

- [ ] **Shape:** on a web-touching push, `gh pr checks 1092` lists `Unit Tests: checks`, `Unit Tests: plan`, `Unit Tests (web shard i/3)` × 3 and `Unit Tests`, all passing. `Unit Tests` is the only required context. — backend
- [ ] **File coverage:** the `Unit Tests` job's summary table totals **407 of 407 files**, each shard about a third (136/136/135). — backend
- [ ] **Shard count:** `Unit Tests: plan` plans **3** from `apps/web/src/__tests__/durations.json` (≈853 file-seconds ÷ 300). — backend
- [ ] **Speed:** the run takes about 2.5–3.5 min end to end, against 8m28s for the single job on this branch before slice 4. — backend
- [ ] **20-job budget:** `npm run lint:ci-cache` reports one branch push peaking at **20 of 20** (unit 7, integration 10, three single-job checks). — backend

## §2 — It fails closed

- [ ] **Injected failures:** a throwaway commit with a failing web test and a formatting error turns `Unit Tests` **red**. The summary names all three causes: `the checks job (lint + non-web unit tests) ended failure`, `the shards ended failure`, and `1 suite(s) failed`. The commit is reverted. — backend

## §3 — Turbo caching

- [ ] **Cached re-run:** re-running `Unit Tests` on an unchanged commit restores each web shard from turbo in seconds, and the summary still verifies 407 of 407 files from the restored reports. — backend
- [ ] **`Integration Tests` unchanged:** green on the renamed scripts with the same 6 planned shards. — backend

## §4 — After merge

- [ ] **deploy-dev's dispatch path** runs `Unit Tests` through `workflow_call`, unchanged. Run `gh workflow run deploy-dev.yml --ref main`, then confirm that its unit-test call shows the four jobs, and that `Unit Tests` passes before the deploy proceeds. — backend
- [ ] **The durations refresh covers both suites.** Run `gh workflow run refresh-test-durations.yml --ref main`. Both matrix legs, `Refresh integration durations` and `Refresh web durations`, finish green.
  - Web samples this PR's merged run, or warns "nothing to refresh".
  - A drift issue opens only if planning would change.
  - — backend

## Sign-off

- [ ] Every section above verified
- [ ] <date + name> — confirmed against the CI runs

## Bug-filing template

Section: · Expected: · Got: · Repro (run id / command): · Identifiers (run / job ids):
