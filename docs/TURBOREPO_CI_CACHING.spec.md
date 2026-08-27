# Turborepo remote caching in CI — Spec

Pins the contract for [#454](https://github.com/EnterpriseBT/portal-ai/issues/454): which turbo tasks may be cached, which env vars enter each hash, where the credentials attach, and the guard that stops the wiring silently rotting. Builds on `docs/TURBOREPO_CI_CACHING.discovery.md` — all five of its open questions are resolved (three empirically, below).

## Key decisions (flag for review)

1. **Suites first, deploys second.** The three PR suites get the cache; the deploy workflows opt in only after the env declarations land. The measured 14–17 job-minutes are in the suites.
2. **`apps/site#build` stays never-cached.** Already true in `apps/site/turbo.json`; what this ticket adds is the guard rule that pins it and the in-file rationale that was missing. Its env is invisible to the hash by design (`passThroughEnv`), which is exactly why a flip to `cache: true` is unsafe.
3. **`version.json` becomes deterministic**, derived from `VITE_APP_SHA` (which both deploys already pass). This also fixes a pre-existing user-facing bug.
4. **CI is the only cache writer.** Developer machines are not linked by default; read-only at most.
5. **Artifact signing is on** (`remoteCache.signature`). Fail-open on cache *availability*, fail-closed on cache *integrity*.
6. **`test:integration` becomes cacheable**, gated on `docker-compose.yml` entering `globalDependencies`.
7. **The API image build stays uncached** — no host-side turbo exists in `deploy-backend`. Recorded in #454's Out of scope.
8. **`turbo` reaches the devcontainer PATH by symlink**, not `npm install -g`, so the CLI is always the lockfile's turbo.

### Resolved by measurement, not assumption

| Question | Result |
|---|---|
| Does the web build rewrite the tracked `routeTree.gen.ts`? | **No.** Identical `sha256` before/after a forced build; `git diff --exit-code` clean. No `inputs` exclusion needed. |
| Is `packages/core`'s `build:fonts` deterministic? | **Yes.** Two runs produced identical output digests. No exclusion needed. |
| Is the `version.json` UUID actually unstable? | **Yes.** Two forced builds of the same commit: `c10a2478-…` then `3d9c812e-…`. |
| Does `apps/site`'s env reach the build but miss the hash? | **Yes — both**, via `passThroughEnv`. A sentinel `SITE_URL` appeared in `dist/index.html` while the task hash stayed `0e93daf1a79163a4`. **Latent, not active** — the task has been `cache: false` since Aug 2026, so the exposure is a `cache: true` flip, which rule 5 now blocks. |
| Does `apps/web`'s env enter the hash? | **Yes.** `framework: vite` inference is prefix-based, not usage-based; dev vs prod API URLs hash differently (`0bf8916c` / `5d6b0896`). |

## Scope

### In scope

Root `turbo.json`; a new `apps/site/turbo.json`; `apps/web`'s build-version identity; the three suite workflows; the six `workflow_call` sites in `deploy-dev.yml`/`deploy-prod.yml`; `deploy-static-site.yml`; the devcontainer `dev` target of the root `Dockerfile`; a new root guard script; docs.

### Out of scope

The API image build (`deploy-backend`); Docker layer/registry caching; suite sharding; `npm ci`/`setup-node` cache changes; splitting `docker-compose.yml`; removing `deploy-dev`'s push-to-`main` suite skip.

## Surface

### 1. Secrets & variables inventory

| Name | Kind | Value | Consumed by |
|---|---|---|---|
| `TURBO_TOKEN` | repo **secret** | Vercel access token | every turbo invocation in CI |
| `TURBO_TEAM` | repo **variable** | Vercel account/team slug (not secret) | every turbo invocation in CI |
| `TURBO_REMOTE_CACHE_SIGNATURE_KEY` | repo **secret** | freshly generated HMAC key | signature verify on download |

Referenced as `${{ secrets.TURBO_TOKEN }}`, `${{ vars.TURBO_TEAM }}`, `${{ secrets.TURBO_REMOTE_CACHE_SIGNATURE_KEY }}`. No token value ever appears in a workflow file, a doc, or a commit.

### 2. Root `turbo.json`

Three additions and one flip, against the current file (nine tasks, no global keys):

```jsonc
{
  "$schema": "https://turbo.build/schema.json",
  "ui": "tui",
  "remoteCache": { "signature": true },          // NEW — reject tampered artifacts
  "globalDependencies": ["docker-compose.yml"],   // NEW — see §note
  "tasks": {
    "test:integration": {
      "dependsOn": ["^build"],
      // `outputs` REMOVED — see note below
      "cache": true,                              // WAS false
      "env": ["INTEGRATION_TEST_DATABASE_URL", "REDIS_URL"]   // unchanged
    }
  }
}
```

`envMode` stays at its default (`strict`) — unchanged and not declared.

**`outputs` removed from both test tasks.** `test:unit` and `test:integration` run `jest` *without* `--coverage`, so the configured `coverageDirectory` is never written and turbo warns `no output files found` on every cache miss. With `cache: false` that was invisible; the moment `test:integration` becomes cacheable it warns on every miss. A test task's cacheable result is its **log and exit status**, which turbo stores regardless of `outputs`. `test:unit`'s declaration was equally wrong and pre-existing — fixed in the same slice, because leaving it would emit a CI warning a reader would attribute to this ticket. Re-add the glob only if a script starts passing `--coverage`.

**Deliberately NOT added:** `inputs` for `apps/api/drizzle/**`. Turbo's default inputs already cover every tracked file inside a package, and the migrations live at `apps/api/drizzle/`, so they are hashed today. Declaring an explicit `inputs` array would *narrow* the default and is the wrong direction.

**Note on `globalDependencies`.** `docker-compose.yml` carries both the test services (`postgres-test`, `redis` — including their image tags) and the devcontainer's own `dev` service. A devcontainer-only edit therefore invalidates every cached task in the monorepo. Accepted: the file changes rarely, and a full invalidation is a performance event, not a correctness one.

### 3. `apps/site/turbo.json` — existing file, pinned and documented

**This file already exists** (tracked since Aug 2026) and already carries the operative guarantee:

```jsonc
{
  "extends": ["//"],
  "tasks": {
    "build": {
      "cache": false,
      "passThroughEnv": [
        "SITE_URL", "SITE_CONFIG_URL", "SITE_APP_URL", "GITHUB_SHA",
        "BUILD_SHA", "SUPPORT_EMAIL", "SALES_EMAIL", "ADMIN_EMAIL"
      ]
    }
  }
}
```

Eight names, not seven — `BUILD_SHA` is declared here but not set by `deploy-static-site.yml`. `passThroughEnv` (not `env`) is the correct key while the task is uncached: under the default `strict` envMode an undeclared var never reaches the build at all, and hashing names that nothing caches buys nothing.

The change here is therefore **not** the config — it is the two things that were missing:

1. **The rationale, in-file.** A comment stating both reasons the task must stay uncached, and stating that moving these names from `passThroughEnv` to `env` is the prerequisite for any future re-enable, not an afterthought.
2. **Mechanical enforcement** — guard rule 5 (§9), because a comment does not stop a flag flip.

### 4. `apps/web` build-version identity

New `apps/web/src/utils/build-version.util.ts`:

```ts
/** Resolves the build identity stamped into version.json and polled by useAppVersion. */
export function resolveBuildVersion(
  env: Record<string, string | undefined>
): string;
```

Contract:

| Input | Output |
|---|---|
| `VITE_APP_SHA` set and non-blank | that value, trimmed |
| `VITE_APP_SHA` unset, empty, or whitespace | `"dev"` |

`apps/web/vite.config.ts:35` changes from `const buildHash = crypto.randomUUID()` to `const buildHash = resolveBuildVersion(process.env)`. The `crypto` import goes if nothing else uses it.

Both deploys already supply the input — `deploy-dev.yml:270` and `deploy-prod.yml:282` each set `VITE_APP_SHA: ${{ github.sha }}` — so version identity becomes the commit, matching what the sidebar already displays (`apps/web/src/components/SidebarNav.component.tsx:198-199`). Consequences, all intended:

- A rebuild of an unchanged commit no longer prompts every connected user to reload (the current bug).
- A cache hit restores a `version.json` whose value is still correct, because identical inputs mean an identical bundle — there is no new version to reload for.
- Local builds report `"dev"` and never self-prompt.

The util lives under `src/` (rather than beside `vite.config.ts`) so `apps/web`'s existing jest `testMatch` picks up its test with no config change. Build-time-only code in `src/` is a deliberate, commented trade.

### 5. The three suite workflows

Identical treatment for `unit-test.yml`, `integration-test.yml`, `static-checks.yml`:

**(a)** A workflow-level `env:` block (above `concurrency:`), so every step inheriting it covers all present and future turbo calls in the file:

```yaml
env:
  TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
  TURBO_TEAM: ${{ vars.TURBO_TEAM }}
  TURBO_REMOTE_CACHE_SIGNATURE_KEY: ${{ secrets.TURBO_REMOTE_CACHE_SIGNATURE_KEY }}
```

**(b)** An explicit secrets contract on the reusable interface, so a caller that forgets to pass them is visible in *this* file rather than silently cacheless:

```yaml
on:
  push:
    branches-ignore: [main]
  workflow_call:
    secrets:
      TURBO_TOKEN:
        required: false
      TURBO_REMOTE_CACHE_SIGNATURE_KEY:
        required: false
```

`required: false` because a `push`-triggered run has no caller. A comment records that an absent token degrades to a no-op rather than failing — which is why acceptance requires a live dispatch check.

**Unchanged, and load-bearing:** the job `name:` values (`Unit Tests`, `Integration Tests`, `Static Checks` — required checks on `main`), each `concurrency.group`'s hardcoded literal prefix, and `integration-test.yml`'s in-job docs-only skip. `vars.TURBO_TEAM` needs no `workflow_call` declaration — repo variables are available to reusable workflows directly.

### 6. `deploy-dev.yml` / `deploy-prod.yml`

**(a)** All six `workflow_call` sites (`deploy-dev.yml:29-39`, `deploy-prod.yml:51-61`) gain an explicit map:

```yaml
    secrets:
      TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
      TURBO_REMOTE_CACHE_SIGNATURE_KEY: ${{ secrets.TURBO_REMOTE_CACHE_SIGNATURE_KEY }}
```

**(b)** Both `deploy-frontend` jobs' existing `Build frontend` step gains the three cache vars alongside the ten `VITE_*` it already sets (`deploy-dev.yml:267-279`, `deploy-prod.yml:278-291`).

Expected and documented in-file: `apps/web#build` will **miss on every new commit**, because `VITE_APP_SHA`/`VITE_APP_VERSION` carry the commit SHA and inference hashes them. The win there is same-commit re-runs and within-run reuse, not cross-commit. Removing the SHA from the bundle is not on the table — the sidebar displays it.

### 7. `deploy-static-site.yml`

The three cache vars join the existing `Build site` env block (`deploy-static-site.yml:154-163`). Because §3 marks the task `cache: false`, this yields no hits for the site build itself; it exists so the *dependency* builds (`@portalai/core`) in that job can hit. A comment says exactly that, so the next reader doesn't "fix" the apparent contradiction.

### 8. Devcontainer — `turbo` on PATH

`Dockerfile`'s `dev` target extends the existing symlink block at `Dockerfile:76-77`:

```dockerfile
RUN ln -sf /workspace/node_modules/.bin/portalops /usr/local/bin/portalops \
    && ln -sf /workspace/node_modules/.bin/portalai /usr/local/bin/portalai \
    && ln -sf /workspace/node_modules/.bin/turbo /usr/local/bin/turbo
```

Same semantics the existing comment already documents: dangling at image-build time, resolved once `onCreateCommand`'s `npm i` populates `node_modules/.bin`. The comment is extended to say why turbo must *not* be globally installed — a CLI version that differs from the lockfile computes different task hashes.

No `TURBO_TOKEN` is baked into the image and the devcontainer is **not** linked to the remote cache. A developer opting in does so per-shell and read-only (`--cache=remote:r`); the rationale (a developer machine is not a reproducible build environment) goes in `docs/LOCAL_DEVELOPMENT.md`.

### 9. New `scripts/check-ci-cache.mjs` + `npm run lint:ci-cache` — five rules

A guard in the shape of the existing `scripts/check-doc-pointers.mjs`, wired into `unit-test.yml` beside `lint:doc-pointers`. It parses the workflow YAML (using `yaml`, promoted from a transitive dep to an explicit root devDependency) and **fails** when:

1. A workflow that invokes turbo — directly (`turbo run`) or via an `npm run` script that maps to a turbo task — lacks `TURBO_TOKEN` **and** `TURBO_TEAM` in an inherited `env`.
2. A `uses: ./.github/workflows/<suite>.yml` call site omits the `secrets:` map for a secret that suite declares.
3. Any of the three required-check job names drifts from `Unit Tests` / `Integration Tests` / `Static Checks`.
4. A `concurrency.group` in those three workflows starts with `${{ github.workflow` instead of a literal.
5. `apps/site`'s `build` task does not declare `cache: false`, or declares nothing in either `env` or `passThroughEnv` (under `strict` envMode an undeclared var never reaches the build, so the site would silently render fallback values). This is the mechanical guarantee behind Key decision 2 — the proven cache-poisoning path (§Resolved by measurement) must not be silently reopened by a later edit.

Rules 3 and 4 guard pre-existing invariants that this ticket must not break and that nothing currently tests. Rule 5 guards this ticket's own most important correctness decision.

Rules land with the slice whose implementation satisfies them, never earlier — rules 3–4 in slice 1 (they already hold), rule 5 in slice 2, rules 1–2 in slice 4. See the plan's sequencing rationale.

## Migration

**None.** No schema change, no new table, no column. No `npm run db:generate`.

## Seed

**None.** No per-org or global seeded row is involved.

## TDD test plan

### Root guard script — self-check, because no runner would execute a jest test here

There is **no root jest config**, and `npm run test:unit` is `turbo run test:unit`, which only runs per-package `test:unit` scripts. A test file under `scripts/__tests__/` would therefore be executed by nothing — so the guard carries its own fixture-driven self-check instead. `scripts/check-doc-pointers.mjs` has no test at all today; this is a deliberate step up from that precedent, not a departure from it.

`npm run lint:ci-cache` runs the self-check **first** against embedded synthetic YAML fixtures, then the real `.github/` tree. Either half failing fails the gate, so the rules are verified on every CI run with no new test infrastructure. Fixture cases:

1. Workflow with `turbo run` and no `TURBO_TOKEN` → violation.
2. Workflow with `turbo run` and both vars in workflow-level `env` → clean.
3. Workflow with `npm run build` (a turbo task) and no vars → violation.
4. Call site omitting a declared secret → violation.
5. Call site passing it → clean.
6. Job renamed from `Static Checks` → violation.
7. `concurrency.group` starting with `${{ github.workflow` → violation.
8. `apps/site/turbo.json` absent, `cache` absent, `cache: true`, or nothing declared in either env key → violation (four fixtures).
9. `cache: false` with `env` populated → clean; `cache: false` with `passThroughEnv` populated (**the real shape**) → clean.
10. The real `.github/` tree + `apps/site/turbo.json` → clean.

Case 10 is the one that would have caught this ticket's own wiring mistakes.

### `apps/web` — `apps/web/src/__tests__/build-version.util.test.ts`

Run via `npm run test:unit` from `apps/web`:

1. `VITE_APP_SHA: "abc123"` → `"abc123"`.
2. `VITE_APP_SHA: "  abc123  "` → `"abc123"`.
3. `VITE_APP_SHA` unset → `"dev"`.
4. `VITE_APP_SHA: ""` → `"dev"`.
5. `VITE_APP_SHA: "   "` → `"dev"`.
6. Two calls with the same env → identical results (the determinism property the old UUID violated).

### Not unit-testable, verified in the smoke walk

Cache hit/miss behavior, the live-dispatch secret check, the deliberate red-then-green, and the before/after timings. These are `docs/TURBOREPO_CI_CACHING.smoke.md`'s job.

**Totals ≈ 17 cases** — 6 jest cases (`apps/web`, via `npm run test:unit`) + 11 guard fixture cases (via `npm run lint:ci-cache`).

## Acceptance criteria

- A second push changing one `apps/web` file does not rebuild `@portalai/core`; skipped tasks report as cache hits.
- Within one run, only one job pays for a given package's build.
- `Unit Tests`, `Integration Tests`, `Static Checks` still report under exactly those names.
- A `workflow_dispatch` of `deploy-dev` shows real cache hits in its called suites.
- A docs-only push still reports **Integration Tests** successful without running the suite.
- Breaking a type in `packages/core` fails Static Checks; fixing it passes. A cache hit never turns a red check green.
- With the token removed or invalid, all three suites still complete and report accurate results.
- `apps/site`'s build reports as uncached in every run.
- Two builds of the same commit produce the **same** `version.json`; two different commits produce different ones.
- A rebuilt devcontainer has `turbo` on PATH resolving through `/workspace/node_modules/.bin`, at the lockfile's version.
- `npm run lint:ci-cache` passes, and fails if any of its five rules is violated.
- The API image build is unchanged and uncached.
- Before/after wall-clock and job-minutes recorded on the PR.

## Risks & rollback

| Risk | Detection | Mitigation / rollback |
|---|---|---|
| **A wrong-hash cache hit greens a check that never ran.** The ticket's worst outcome. | The deliberate red-then-green; the guard's real-tree case. | Signing on; `apps/site` uncached; `test:integration` enabled only after `globalDependencies`. Rollback: `TURBO_TOKEN` → cache degrades to no-op, zero code revert. |
| **A poisoned or corrupted artifact.** | Signature mismatch → turbo rejects. | Fail-**closed** on integrity, deliberately, unlike availability. |
| Silent no-op from a missing/misscoped token. | `lint:ci-cache` rule 1–2; live dispatch. | Explicit `workflow_call` secrets so the omission is visible in the suite file. |
| Devcontainer edit invalidates all caches via `docker-compose.yml`. | Unexplained full miss after an unrelated commit. | Accepted; noted in `turbo.json`. Escalation is splitting the compose file — out of scope here. |
| Build artifacts (incl. inlined `VITE_*` client config) leave the repo perimeter. | N/A — by design. | Public-by-design client config only. Never cache a task whose output embeds a genuine secret. |
| `test:integration` cached against drifted service state. | Red-then-green in smoke. | `docker-compose.yml` (image tags included) in the hash. Fallback: restore `cache: false` with an in-file reason — a one-line revert. |

Every element is independently revertible; nothing here changes application behavior except §4, which is a bug fix with its own tests.

## Files touched

**New** — `apps/web/src/utils/build-version.util.ts`; `apps/web/src/__tests__/build-version.util.test.ts`; `scripts/check-ci-cache.mjs` (guard + embedded self-check fixtures).

**Edit** — `turbo.json`; `apps/site/turbo.json` (comment only); `package.json` (`lint:ci-cache` script, `yaml` + `jsonc-parser` devDependencies); `apps/web/vite.config.ts`; `.github/workflows/unit-test.yml`, `integration-test.yml`, `static-checks.yml`, `deploy-dev.yml`, `deploy-prod.yml`, `deploy-static-site.yml`; `Dockerfile`; `docs/LOCAL_DEVELOPMENT.md`; `CLAUDE.md` (+ `.github/copilot-instructions.md` mirror).

## Next step

`docs/TURBOREPO_CI_CACHING.plan.md` slices this into roughly five TDD commits, ordered so every correctness fix precedes the thing that would exploit it: (1) the guard script + its self-check + the `yaml` dep, red against today's tree, then green once (2) `turbo.json` global keys, `apps/site/turbo.json`, and the signature block land; (3) deterministic `version.json`, test-first; (4) credentials + explicit `workflow_call` secrets — cache live for the three suites; (5) `test:integration` flipped and the deploy workflows opted in. Slices 1–3 stand on their own even if the cache were never switched on.
