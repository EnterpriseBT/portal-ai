# CI gates and redundant runs — Condensed design (#427)

**Issue:** [EnterpriseBT/portal-ai#427](https://github.com/EnterpriseBT/portal-ai/issues/427) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Two problems in one file tree. (a) No CI job runs `build`, `type-check` or `lint`, so a type error or lint failure cannot fail a PR — it lands on `main` and breaks the app-dev deploy instead (#423 is the worked case). (b) The same suites are paid for repeatedly: every branch push runs a full cycle, nothing cancels a superseded run, and then `deploy-dev` re-invokes both suites at merge against a tree that just went green. Touches `.github/` only, plus one branch-protection settings change.

## Current shape

| Piece | Location | Note |
|---|---|---|
| PR gate (unit) | `.github/workflows/unit-test.yml` | `push: branches-ignore: [main]` + `workflow_call`; runs `format:check`, `lint:doc-pointers`, `test:unit`. **No `concurrency`** |
| PR gate (integration) | `.github/workflows/integration-test.yml` | same triggers; `docker compose up postgres-test redis` + `test:integration`. **No `concurrency`** |
| Duplicate at merge | `deploy-dev.yml:17-21`, consumed at `:25` `needs: [unit-test, integration-test]` | re-invokes both via `workflow_call` on push to `main` |
| Same duplicate for prod | `deploy-prod.yml:51-55`, consumed at `:59` | identical pattern, on `release: published` |
| Deploy concurrency (precedent) | `deploy-dev.yml:8`, and all three other `deploy-*` | `group` + `cancel-in-progress: false` — the mechanism exists, just not on the test workflows |
| The only real build | `apps/api/Dockerfile:26` | `npx turbo run build --filter=@portalai/api`, inside the deploy image |
| CI install | `.github/actions/setup/action.yml` | `npm ci`, npm cache only — **no turbo remote cache**, so every run is cold |
| Turbo cacheability | `turbo.json` | `test:unit` `cache: true`; `test:integration` **`cache: false`** by design; `lint`/`type-check` `dependsOn: ["^build"]` |
| Root scripts | `package.json` | `build`, `type-check`, `lint` all fan out through turbo; all 8 packages implement each |
| Lint strictness is **already split** | `apps/web` + `apps/site` `package.json` vs `apps/api` + `packages/core` | web (`--report-unused-disable-directives --max-warnings 0`) and site (`--max-warnings 0`) already gate at zero **and are clean**; api (`eslint src --ext .ts`) and core do not, and carry **17 warnings** between them (16 + 1) |
| `main` protection (live) | GitHub settings | `strict: true`, contexts `["Unit Tests","Integration Tests"]`, `enforce_admins: true`, linear history, reviews required |

## Decision 1 — a separate `Static Checks` job, added to the required contexts

Extra steps inside `Unit Tests` would gate immediately with no settings change, but serializes build+lint+type-check ahead of the tests and lets a lint failure mask test results. A separate job runs in parallel and gives a distinct signal.

**Decision: a new `Static Checks` job running `npm run build`, `npm run type-check`, `npm run lint`** — and **added to `main`'s required status checks in the same change**. Protection currently requires exactly `Unit Tests` and `Integration Tests`; a gating job absent from that list blocks nothing, which would recreate this ticket's bug in a new costume.

Run **both** `build` and `type-check`: they are not equivalent per package. `apps/api`'s build excludes `**/*.test.ts`, so `type-check` covers strictly more; `apps/web`'s build is `tsc && vite build`; `apps/site`'s is `astro build`. Turbo caches both, so the overlap is cheap.

**Lint gates on warnings too — `--max-warnings 0`.** This is not a new policy, it is an inconsistently applied one: `apps/web` and `apps/site` already gate at zero in their own lint scripts and are clean. `apps/api` and `packages/core` do not, and hold **17 warnings** between them. Fix the two lagging package scripts to match web rather than passing the flag only in CI — otherwise CI is stricter than `npm run lint` locally, and the first contributor to hit that learns it from a red PR.

The 17 split into two kinds, and only one needs judgment:

- **8 mechanical.** 5 unused vars (`rest-api.probe.integration.test.ts:68`, `tiers-card-fields.integration.test.ts:10`, `analytics.service.test.ts:249`, `portal-viz-refresh.service.test.ts:8`, and `builtin-toolpacks.ts:1081` in core) — delete or `_`-prefix. 3 dead `eslint-disable` directives (`webhook.tool.test.ts:50`, `bulk-transform.processor.ts:393` and `:416`) — delete the directive.
- **9 `no-explicit-any`, all in test files** (`technical-indicator-stream.test.ts` ×4, `result-sink.test.ts` ×5). Type them properly where the real type is reachable; where a test is deliberately feeding a malformed value, keep a **scoped** `eslint-disable-next-line` **with a reason comment** rather than widening the rule. A bare disable to clear a count is how the next 17 accumulate.

## Decision 2 — cancel superseded runs, and stop re-running at merge

Four options, and they are not alternatives — they address different halves:

- **A. `concurrency` + `cancel-in-progress: true`** on both test workflows, keyed by workflow + ref. Orthogonal to everything else, no safety argument needed.
- **B. Drop the `workflow_call` test jobs** from `deploy-dev`'s `needs`. Safe *because* `strict: true` + squash means the merged commit's **tree is identical** to the branch tree that just passed — so the re-run tests nothing new.
- **C. `paths-ignore`** so a docs-only commit skips the suites.
- **D. Turbo remote caching.**

**Decision: A, B and C now; D declined for now as overkill.**

B carries two conditions that must land with it, not after: the safety argument is *entirely* dependent on `strict: true`, so that coupling goes in the workflow as a comment (if `strict` is ever disabled, B must be reverted); and `workflow_dispatch` has no PR behind it, so the test jobs stay for that event via `if: github.event_name == 'workflow_dispatch'`. **`deploy-prod.yml` keeps its suites** — a release tag can be cut from any commit, so there is no equivalent "already tested this tree" guarantee.

C is per-workflow, not global: `lint:doc-pointers` exists to validate `docs/**` pointers, so docs changes must still reach the unit workflow even when they skip the integration one.

**D's evaluation, recorded so it isn't re-litigated:** remote caching would help `build`, `type-check`, `lint` and `test:unit` (all `cache: true`), but **cannot** help `test:integration` — `turbo.json` sets `cache: false` on it deliberately, since it depends on external Postgres/Redis state. The integration suite is the expensive one (~5–6 min), so topology (A/B/C) is what actually reduces it; caching is a separate, later win that also needs a provider decision and a repo secret.

## Plan — 5 slices

**Slice 1 — cancel superseded runs.** Edit `unit-test.yml`, `integration-test.yml`: add `concurrency: {group: "${{ github.workflow }}-${{ github.ref }}", cancel-in-progress: true}`. No test file; verified by smoke step 3. Smallest independent win — lands first so the rest of the work benefits from it.

**Slice 2 — clear the 17 warnings, then gate at zero.** Edit `apps/api/package.json` and `packages/core/package.json` lint scripts to `--report-unused-disable-directives --max-warnings 0`, matching `apps/web`. Fix the 8 mechanical findings and the 9 `no-explicit-any` per Decision 1. Verify with `npm run lint` at root — it must exit 0 with the flags in place. **Lands before slice 3**: enabling the gate while the warnings stand would red-flag every open PR.

**Slice 3 — the static gate.** New `.github/workflows/static-checks.yml` — job `name: Static Checks`, triggers `push: branches-ignore: [main]` + `workflow_call` (mirroring the two existing gates), running `npm run build`, `npm run type-check`, `npm run lint`. A separate file rather than extra steps in `unit-test.yml` so `deploy-prod` can reuse it by `workflow_call`, and so a lint failure doesn't mask test results. Wire it into `deploy-dev.yml` and `deploy-prod.yml` alongside their existing suites. Then add `Static Checks` to `main`'s required contexts (settings change — not in the diff). **Applied 2026-08-21** via the `required_status_checks` sub-resource, so the rest of the protection object was left intact: contexts are now `Unit Tests`, `Integration Tests`, `Static Checks`, with `strict: true` preserved. Smoke step 7 verifies it rather than performs it.

**Slice 4 — drop the duplicate at merge.** Edit `deploy-dev.yml`: gate `unit-test`/`integration-test` on `github.event_name == 'workflow_dispatch'`, with the `strict: true` coupling as an in-file comment. Leave `deploy-prod.yml` alone.

**Slice 5 — skip untouchable work, without deadlocking the gate.** **Not** `paths-ignore`: a required check that never runs never reports, and GitHub blocks the PR indefinitely waiting for it ("Expected — waiting for status to be reported"). Filtering a *required* workflow at the trigger is a merge deadlock, not an optimization.

Instead keep `integration-test.yml` triggering unconditionally and filter *inside* the job: a first step diffs `github.event.before..github.sha`, and the remaining steps carry `if: steps.changes.outputs.run == 'true'`. The job still reports **success**, so the required check is satisfied, while the ~6 minutes of `docker compose` + suite is skipped. **Fails safe:** an unusable base (new branch, force-push, unfetched SHA) runs the tests. Done with `git` in a shell step rather than a third-party paths-filter action, to avoid a new supply-chain dependency. `unit-test.yml` stays unfiltered so `lint:doc-pointers` still validates `docs/**` pointers.

No unit tests apply — the deliverable *is* CI config. Correctness is established by the smoke walk below, which exercises each slice's externally-observable behavior. `packages/devops-cli/src/__tests__/deploy-parity.test.ts` is the place to add an assertion if we later want the required-context list itself guarded.

## Smoke (manual, against a throwaway branch + PR)

1. **The gate bites.** On a scratch branch, introduce a deliberate type error (e.g. assign a string to a number in `apps/api/src`). Push, open a PR. **Expect:** `Static Checks` fails, the PR shows "Merging is blocked", and merge is unavailable. Revert the error; `Static Checks` goes green and merge unblocks.
2. **The lint gate bites too.** Add an unused variable (no `_` prefix) to `apps/api/src`. **Expect:** `Static Checks` fails on it — a warning, not an error, is now enough to block. Also confirm `npm run lint` fails locally on the same change, so CI and local agree.
3. **Superseded runs cancel.** Push two commits ~20 s apart to that branch. **Expect:** the first run shows as *cancelled*, not completed; only the latest commit's run finishes.
4. **No duplicate at merge.** Merge the (green, up-to-date) PR. **Expect:** the `Deploy Dev` run contains **no** `Unit Tests` / `Integration Tests` jobs, and the deploy still reaches `deploy-backend: success`.
5. **Manual deploy still tested.** Trigger `Deploy Dev` via `workflow_dispatch`. **Expect:** both suites *do* run in that run.
6. **Docs-only skips the work but still reports.** Push a commit touching only `docs/**`. **Expect:** `Integration Tests` reports **success in well under a minute** having skipped the suite — *not* "expected/waiting", which would mean the required check is deadlocked. `Unit Tests` runs normally and `lint:doc-pointers` inside it still executes.
7. **Nothing lost.** Confirm `main`'s required-check list is exactly `Unit Tests`, `Integration Tests`, `Static Checks` — no gating job missing from it.

## Out of scope

- **Turbo remote caching** — declined for now as overkill. Recorded rather than dropped: it needs a provider decision (Vercel vs self-hosted S3) plus a repo secret, and by design cannot touch `test:integration`, the suite that dominates CI time. Revisit only if A/B/C prove insufficient.
- Sharding or per-package test matrices — only worth it if the above proves insufficient.
- Any protection change beyond the required-context list (reviewer counts, push restrictions).
- `deploy-prod.yml`'s duplicate suites, kept deliberately: a release tag has no "this tree already passed" guarantee.
