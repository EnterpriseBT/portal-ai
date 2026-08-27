# TURBOREPO_CI_CACHING — Smoke Suite

Manual smoke test for [#454](https://github.com/EnterpriseBT/portal-ai/issues/454) — a Turborepo remote cache wired into every turbo invocation in CI, with a guard that fails the build when the wiring rots. **Branch under test:** `feat/turborepo-ci-caching` (PR [#466](https://github.com/EnterpriseBT/portal-ai/pull/466)).

Most of this ticket lives in CI rather than in the app, so the walkthrough is mostly *observing runs and running the guard* rather than clicking through the UI. Two sections (§6, §7) ask you to push a deliberately-broken commit to this branch and then revert it — that is the point of them, and the branch is not merged.

Where a step was already observed while implementing, the evidence is noted inline so you can spot-check rather than re-derive. **Confirming it is still yours to do** — none of these boxes are pre-checked.

## Preflight

### Environment

- [ ] `git checkout feat/turborepo-ci-caching && git pull --ff-only`
- [ ] `npm install` — the lockfile gained two explicit root devDependencies (`yaml`, `jsonc-parser`) plus `jsonc-parser` in `apps/site`
- [ ] No migration on this branch. **Nothing to migrate, no seed to run** — this ticket touches no schema.
- [ ] `npm run dev` boots cleanly (API :3001, web :3000) — only needed for §8

### Fixtures

- [ ] Repo settings carry `TURBO_TOKEN` (secret), `TURBO_TEAM` (variable), `TURBO_REMOTE_CACHE_SIGNATURE_KEY` (secret). Confirm with `gh secret list --repo EnterpriseBT/portal-ai` and `gh variable list --repo EnterpriseBT/portal-ai` — you should see the two secrets and the one variable by name (values are never shown).
- [ ] The compose test services are up for §4: `docker compose up -d postgres-test redis --wait`

### Reset between runs

- [ ] Nothing to reset for §1–§5, §8–§10 — they are read-only or self-contained.
- [ ] §6 and §7 each end with an explicit revert step. Do not leave either committed.

## §1 — The guard passes, and actually bites

`npm run lint:ci-cache` self-tests its five rules against embedded fixtures, then checks the real tree.

- [ ] `npm run lint:ci-cache` → `self-test: 18 fixture(s) passed` and `.github/workflows: 8 workflow(s) clean`, exit 0
- [ ] `npm run lint:ci-cache -- --self-test` → fixtures only, exit 0
- [ ] **Rule 3 bites.** Edit `.github/workflows/static-checks.yml`, change `name: Static Checks` to `name: Static Analysis`. Re-run → fails naming `rule 3`, exit 1. `git checkout -- .github/workflows/static-checks.yml`
- [ ] **Rule 5 bites.** In `apps/site/turbo.json` change `"cache": false` to `"cache": true`. Re-run → fails naming `rule 5`, exit 1. `git checkout -- apps/site/turbo.json`
- [ ] **Rule 1 bites.** Delete the `TURBO_TOKEN:` line from `.github/workflows/unit-test.yml`'s workflow-level `env:`. Re-run → fails naming `rule 1`, exit 1. `git checkout -- .github/workflows/unit-test.yml`
- [ ] `git status` is clean afterwards

## §2 — `apps/site` is uncached, and its env is declared

The load-bearing correctness decision: this build bakes live prices into static HTML, and its env vars are `passThroughEnv` — they reach the build but stay out of the task hash.

- [ ] `npx turbo run build --filter=@portalai/site --dry=json | sed -n '/^{/,$p' | jq '.tasks[0].cache'` → `local` and `remote` both `false`
- [ ] Same command with `.tasks[0].environmentVariables.specified` → `env` is `[]` and `passThroughEnv` lists 8 names
- [ ] `apps/site/turbo.json` carries the comment explaining *why* it must stay uncached, and that re-enabling requires moving those names to `env` first

## §3 — `version.json` is deterministic

The user-visible bug this ticket fixes: the old `crypto.randomUUID()` changed on every build, so redeploying unchanged code prompted every connected user to reload.

- [ ] `npx turbo run build --filter=@portalai/web --force` then `cat apps/web/dist/version.json` → note the value
- [ ] Repeat the exact same command → **the same value** (locally, `{"version":"dev"}`)
- [ ] `VITE_APP_SHA=abc123 npx turbo run build --filter=@portalai/web --force` → `{"version":"abc123"}`
- [ ] `VITE_APP_SHA=def456 …` → `{"version":"def456"}` — different commits differ
- [ ] `cd apps/web && npm run test:unit -- --testPathPattern=build-version` → 6 passed

## §4 — `test:integration` caches, and a real failure still fails

The highest-risk change in the ticket. Run from the repo root with the compose services up:

```bash
export INTEGRATION_TEST_DATABASE_URL=postgresql://postgres:postgres@postgres-test:5432/portal_ai_test
export REDIS_URL=redis://redis:6379
```

(Those are the *in-container* hostnames. From the host it is `localhost:5433` / `localhost:6380`.)

- [ ] `npx turbo run test:integration --filter=@portalai/api` → passes, several minutes, writes the cache
- [ ] Run it again unchanged → `Cached: 3 cached, 3 total` and `FULL TURBO` in well under a second
- [ ] **The one that matters.** Append a failing test to `apps/api/src/__tests__/__integration__/app.integration.test.ts`:
      ```ts
      describe("smoke probe", () => { it("must fail", () => { expect(1).toBe(2); }); });
      ```
      Run again → the task **misses**, genuinely re-runs (minutes, not milliseconds), and **fails with exit 1**. A cache hit must never mask this.
- [ ] `git checkout -- apps/api/src/__tests__/__integration__/app.integration.test.ts`, run again → `FULL TURBO` returns
- [ ] No `no output files found` warning appears in any of the above

## §5 — CI hits the cache on this branch

Observed while implementing: Static Checks 3.8m → 1.0m, Unit Tests 5–7m → 1.2m, Integration Tests 6.4m → 1.2m.

- [ ] `gh run list --repo EnterpriseBT/portal-ai --branch feat/turborepo-ci-caching --limit 3` → all three suites `success`
- [ ] `gh run view <static-checks-id> --log | grep -iE 'remote caching|Cached:'` → `Remote caching enabled`, and hits like `11 cached, 11 total`
- [ ] The three checks report under exactly `Unit Tests`, `Integration Tests`, `Static Checks` on PR #466
- [ ] Within one run, only one job pays for a given package's build — Static Checks' `Build` step shows misses, then its `Type-check`/`Lint` steps show hits for the same packages
- [ ] No `401`, `403`, or signature errors in any run

## §6 — A cache hit never turns a red check green

Requires pushing a knowingly-broken commit to this branch, then reverting.

- [ ] Introduce a type error in `packages/core` (e.g. `const x: number = "nope";` in any exported source file)
- [ ] Commit and push → **Static Checks fails**, and the failure names the type error rather than passing from cache
- [ ] Revert the change, commit and push → Static Checks passes again
- [ ] `git log --oneline` shows both commits; leave the branch green

## §7 — Degradation when the cache is unavailable

Fail-open on availability is deliberate: an unreachable cache must slow CI, never break it. **This briefly affects other branches' runs**, so pick a quiet moment.

- [ ] Note the current token, then set an invalid one: `gh secret set TURBO_TOKEN --repo EnterpriseBT/portal-ai --body "invalid-token-smoke-test"`
- [ ] Push any trivial commit → **all three suites still complete and still report accurate results** (slower, no hits)
- [ ] Restore the real token: `gh secret set TURBO_TOKEN --repo EnterpriseBT/portal-ai` (paste when prompted — never inline it)
- [ ] Push again → hits return
- [ ] If you would rather not touch a live secret, say so and leave this box unchecked with that reason recorded — do not check it unverified

## §8 — The reload prompt in the running app

- [ ] `npm run dev`, open http://localhost:3000, sign in
- [ ] The sidebar footer shows a version/SHA (locally `dev (local)`) — unchanged behavior
- [ ] No spurious "update available" prompt appears while the app sits idle on an unchanged build

## §9 — The deploy path (cannot be verified from a branch)

`deploy-dev` runs on push to `main` or `workflow_dispatch`, and dispatching one **deploys to app-dev**. These are the items nothing on this branch could prove.

- [ ] `gh workflow run deploy-dev.yml --repo EnterpriseBT/portal-ai` (only if you are content to deploy app-dev), then confirm its called suites log `Remote caching enabled` and show cache hits
- [ ] In that run, `deploy-frontend`'s `Build frontend` step logs `Remote caching enabled`; `@portalai/web#build` itself **misses** (expected — the commit SHA is in its hash via `VITE_APP_SHA`) while its dependency builds hit
- [ ] `deploy-backend` is unchanged: it still builds via `docker/build-push-action`, and nothing claims a cache hit for `@portalai/api#build`. Confirm by inspection too — `git diff main...HEAD -- apps/api/Dockerfile` is empty
- [ ] Alternatively defer §9 to the first post-merge `main` deploy and record that choice here

## §10 — Devcontainer `turbo` on PATH

Needs a container rebuild, so it cannot be checked from inside the current one.

- [ ] Rebuild the devcontainer (VS Code → *Dev Containers: Rebuild Container*)
- [ ] `which turbo` → resolves through `/usr/local/bin/turbo` → `/workspace/node_modules/.bin/turbo`
- [ ] `turbo --version` → matches the lockfile (`node -e "console.log(require('turbo/package.json').version)"`)
- [ ] `turbo run build --filter=@portalai/core` works without `npx`
- [ ] The container is **not** linked to the remote cache: a build logs no `Remote caching enabled` unless you pass a token yourself

## §11 — Docs match what shipped

- [ ] `CLAUDE.md` → "CI gating" describes the cache, the guard's five rules, and the fail-open/fail-closed split
- [ ] `.github/copilot-instructions.md` carries the mirrored summary
- [ ] `docs/LOCAL_DEVELOPMENT.md` → "Turborepo cache on your machine" explains the symlink and why developer machines never write
- [ ] `npm run lint:doc-pointers` passes
- [ ] PR #466's Test plan records the before/after wall-clock and job-minutes

## Sign-off

- [ ] Every section above verified, or explicitly recorded as skipped with a reason
- [ ] ______________ (date + name) — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (run ids / workflow / job / commit SHA):
