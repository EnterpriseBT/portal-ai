# Turborepo remote caching in CI — Discovery

**Issue:** [EnterpriseBT/portal-ai#454](https://github.com/EnterpriseBT/portal-ai/issues/454) · Feature · `full`

**Why this exists.** Every push to a branch runs three suites and each starts from absolute zero. `static-checks.yml` runs `npm run build` explicitly; `test:unit` and `test:integration` both pull the same full monorepo build in through `dependsOn: ["^build"]` (`turbo.json`). Nothing is shared between the three jobs of one run, and nothing is shared between one push and the next — `.github/` contains no `.turbo` restore and no remote cache. Measured on recent successful runs: **Static Checks 3–4m, Unit Tests 5–7m, Integration Tests ~6m** — 14–17 job-minutes per push, most of it byte-identical to the push before. `concurrency.cancel-in-progress` throws it all away on an amended commit and pays again.

Turborepo already knows how to skip this work; CI simply never gives it anywhere to put the answer. But the survey turned up something that changes the shape of the ticket: **the task graph is not currently hash-correct, and enabling a shared cache on top of an incorrect hash is how you ship the wrong artifact to production.** This is the discovery that establishes what must be fixed *before* the cache is switched on, not after.

## The current shape

### The task graph

`turbo.json` declares nine tasks and **no** `globalEnv`, `globalDependencies`, `globalPassThroughEnv`, or `remoteCache` block — confirmed absent. `envMode` therefore defaults to **`strict`** (verified via `--dry=json`).

| Task | `outputs` | `cache` | `env` | Note |
|---|---|---|---|---|
| `build` | `dist/**` | default (on) | none | Accurate — every package writes only to `dist/` |
| `lint`, `type-check` | none | default (on) | none | Log/exit-status-only caching, which is correct for them |
| `format:check` | none | default (on) | none | No `dependsOn` at all |
| `test:unit` | `coverage/**` | `true` | none | Real suite in every package |
| `test:integration` | `coverage-integration/**` | **`false`** | `INTEGRATION_TEST_DATABASE_URL`, `REDIS_URL` | Only `apps/api` has a real one; every other package's script is literally `"true"` |

Builds are not one tool per package: `apps/web` is `tsc && vite build` (`apps/web/package.json:8`), `apps/site` is `build:tokens && astro build && verify-pages.mjs` (`apps/site/package.json:9`), `apps/api` wraps tsc in `dotenv -e .env --` (`apps/api/package.json:11`), and `packages/core`'s build is a five-step pipeline (tsc, sass, asset copy, `scripts/build-fonts.mjs`). All land under `dist/`, so the `outputs` glob holds.

### Where turbo runs in CI today

| Workflow | Invocation | Host-side turbo? |
|---|---|---|
| `static-checks.yml` | `npm run build`, `type-check`, `lint` | Yes |
| `unit-test.yml` | `format:check`, `lint:doc-pointers`, `test:unit` | Yes |
| `integration-test.yml` | `test:integration` | Yes |
| `deploy-dev.yml:280` / `deploy-prod.yml:279` | `npx turbo run build --filter=@portalai/web` (job `deploy-frontend`, after `Setup`) | Yes |
| `deploy-static-site.yml:163` | `npx turbo run build --filter=@portalai/site` (after `Setup`) | Yes |
| `deploy-dev`/`deploy-prod` `deploy-backend` | **none** — no `npm ci`, no Setup; `docker/build-push-action@v6` runs `npx turbo run build --filter=@portalai/api --env-mode=loose` *inside* `apps/api/Dockerfile:26` | **No** |

`deploy-prod.yml:59-61` runs `static-checks` **unconditionally**, with an in-file rationale that a release tag can be cut from any commit so "this tree already passed" is an assumption rather than a fact — unlike `deploy-dev.yml:16-39`, which skips the suites on push to `main`. Every prod release therefore pays the full cold cost today, which is a second place the cache pays off.

`.github/actions/setup/action.yml` is the one shared composite: `actions/setup-node@v4` (`cache: "npm"`) then `npm ci`. All six `workflow_call` invocations in `deploy-dev.yml:29-39` and `deploy-prod.yml:51-61` pass **no** `secrets:` block, and the three suites declare no `secrets:` under `on.workflow_call`. `deploy-static-site.yml:9-76` is the counter-example that already does declare `inputs:` and `secrets:` explicitly.

### The hash-correctness hazards (measured, not theorized)

1. **`apps/site`'s build hash ignores its environment.** Framework inference detects `framework: astro`, which auto-hashes `PUBLIC_*` — but the site reads plain `process.env.SITE_URL` (`apps/site/astro.config.mjs:15`) and `SITE_CONFIG_URL` (`apps/site/src/lib/site-config.ts`), neither `PUBLIC_*`-prefixed. Two dry runs differing only in those values produce the **identical hash `0e93daf1a79163a4`**, and a sentinel `SITE_URL` provably reaches the build (it lands in `dist/index.html`) because the vars are declared under `passThroughEnv` — which passes them through while deliberately excluding them from the hash.

   **Correction (found during slice 2):** this hazard is **latent, not active.** `apps/site/turbo.json` already exists and has set `build.cache: false` since Aug 2026, so nothing can restore a wrong artifact today. The real exposure is a one-flag flip: anyone who sets `cache: true` — a reasonable-looking "why isn't this cached?" edit — reopens the bleed, because `passThroughEnv` names are still not hashed. That is what #454's guard rule 5 now prevents. This survey missed the file because it only inspected the **root** `turbo.json`; package-level configs were never checked.
2. **`apps/site`'s build reaches the network.** `apps/site/src/lib/site-config.ts:1-20` fetches `GET /api/public/site-config` once per build and bakes prices/tiers into static HTML (falling back to `site-config.fixture.json`). A byte-identical source tree can legitimately require a fresh build when Stripe prices change — turbo cannot see that at all.
3. **`apps/web`'s build is nondeterministic by construction.** `versionJson()` (`apps/web/vite.config.ts:35`) mints `crypto.randomUUID()` per build invocation and emits it as `version.json`; `apps/web/src/utils/app-version.util.ts:12` polls it every 60s to prompt a reload. A cache hit restores the old UUID.
4. **`apps/web` is otherwise safe.** `framework: vite` *is* inferred, and `VITE_*` values do change the hash (`0bf8916c` vs `5d6b0896` for dev vs prod API URLs) — so the equivalent cross-env bleed does **not** exist for the app bundle.
5. **`apps/site`'s `build:tokens` writes outside `outputs`.** `apps/site/scripts/generate-tokens.mjs:149-152` writes `src/styles/tokens.css` (gitignored). Deterministic, and consumed within the same task, but never captured or restored by `outputs: ["dist/**"]`.
6. **Jest maps siblings to source, not `dist`.** `apps/web`, `apps/site`, `apps/api`, `packages/core` all `moduleNameMapper` `@portalai/*` → `../src`. This *looks* like it breaks turbo's input model but is fine, because turbo derives the graph from `package.json` workspace edges (all declared) and every consumer has `dependsOn: ["^build"]`. It stays fine only while both hold.

## The design space

### Decision 1 — Cache backend

Settled at ticket time: **Vercel Remote Cache**, over `actions/cache`-on-`.turbo` (per-branch scoping, 10 GB eviction) and self-hosted `turborepo-remote-cache` (new infra to operate). Recorded here for completeness; not re-litigated.

### Decision 2 — Sequencing: fix hashes first, or cache first?

**A. Cache first, audit after.** Wire credentials in, get the win now, correct `turbo.json` in a follow-up.

**B. Fix hash correctness first, then enable.** Declare the missing env, resolve the two nondeterministic builds, and only then turn the cache on.

**C. Enable the cache but scope it to provably-safe tasks** — `lint`, `type-check`, `format:check`, `test:unit`, and library builds — leaving `apps/web`/`apps/site` builds uncached until their determinism is settled.

| | A | B | C |
|---|---|---|---|
| Time to first win | Immediate | After the audit | Immediate for the three suites |
| Risk of a wrong artifact deploying | **High** — hazard 1 ships dev config to prod | None | None (app builds excluded) |
| Where the measured minutes actually are | Suites | Suites | **Suites** — the deploy builds are a minority of the cost |

**Lean: C, then B.** The three PR suites are where the 14–17 job-minutes live, and none of them build `apps/web`'s or `apps/site`'s *deployable* artifact for its env — they build to type-check and test. Enabling caching for the suites captures nearly the whole win with none of hazard 1's exposure, and lets the env/determinism fixes land as their own reviewable slices before the deploy workflows opt in. A is rejected outright: it is the "green check that tested nothing" failure mode with a production deploy attached.

### Decision 3 — `apps/site`'s undeclared env and its build-time fetch

**A. Declare `SITE_URL`/`SITE_CONFIG_URL`/`SITE_APP_URL` etc. in the `build` task's `env`.** Fixes the cross-env bleed: dev and prod hash differently. Does not fix the price-drift problem — the same URL with changed upstream prices still hits cache.

**B. Declare the env *and* mark `apps/site#build` uncacheable** via a package-level `apps/site/turbo.json` (`cache: false`). Correct under all conditions; forfeits caching for one package whose build is not on the hot path.

**C. Declare env and make the fetched config an explicit input** — write the fetched payload to a file and hash it. Correct and cacheable, but it means the preflight step (`apps/site/scripts/preflight-site-config.mjs`) becomes a hash-producing build input, a real restructuring.

**Lean: B.** The site's build is a marketing-page render behind a build-time price fetch; its correct output is a function of live state, which is the textbook case for *not* caching. Declaring the env as well is belt-and-braces so a future re-enable can't silently reintroduce hazard 1. C is the right answer only if the site build ever becomes expensive enough to matter.

### Decision 4 — `apps/web`'s `version.json` UUID

**A. Leave it, and accept that a cache hit restores the old UUID.** Worth stating plainly: if the build was a cache hit, the bundle bytes are identical, so there *is* no new version to reload for. The restored UUID is semantically correct.

**B. Derive the version from the bundle/commit deterministically** instead of `crypto.randomUUID()`.

**C. Exclude `version.json` from cached outputs** so it regenerates per build.

**Lean: B, and note that the current behavior is already a bug.** Today the UUID changes on *every* build of the *same* commit, so any rebuild or redeploy of an unchanged commit prompts every user to reload for nothing. A deterministic, content-derived version fixes that pre-existing defect and makes the build cacheable in the same stroke. A is a defensible no-op fallback if B is judged out of scope; C is the worst of both — it keeps the spurious-prompt bug and adds cache complexity. **Caveat for the spec:** do not simply hash `GITHUB_SHA` into the task `env`, or every commit gets a distinct hash and `apps/web#build` never hits cache at all.

### Decision 5 — Where credentials attach, and crossing `workflow_call`

Composite actions cannot read the `secrets` context, so `.github/actions/setup` can only take a `turbo-token` **input** that every caller must pass anyway.

**A. Workflow-level `env:` block** in each of the workflows that run turbo — every step inherits, one block per file, no input plumbing.
**B. `secrets: inherit`** on the six `workflow_call` invocations — one line each.
**C. Explicit `secrets:` declaration** in each suite's `on.workflow_call.secrets` plus an explicit map at each call site.

**Lean: A for placement, C for crossing the boundary.** A keeps every turbo invocation in a file covered by one visible block. C over B because the failure mode here is *silent*: an absent `TURBO_TOKEN` degrades the cache to a no-op without failing anything, and this repo has already been bitten by exactly this class of `workflow_call` context trap (the concurrency-group literal-prefix rule, documented at `unit-test.yml:9-25`). An explicit declaration in the reusable workflow is a place to write that down. `deploy-static-site.yml:9-76` is the in-repo precedent.

### Decision 6 — Cache integrity and write posture

Artifacts round-trip through a third party and are then executed and deployed. Turbo supports `remoteCache: { signature: true }` with `TURBO_REMOTE_CACHE_SIGNATURE_KEY` (HMAC verify on download, reject on mismatch), and `--remote-cache-read-only` / `--cache=remote:r` to make a job read-only.

**Lean: enable signature verification, and keep every CI job read-write.** Signing is the guard against a poisoned or corrupted artifact becoming a green check — cheap, one secret. Read-only-on-branches would protect against a malicious branch poisoning `main`'s cache, but this is a private repo with no fork PRs and the branches *are* where the cache needs to be warmed; revisit if the repo ever accepts outside contributors.

### Decision 7 — `test:integration`'s `cache: false`

Flipping it is the single biggest remaining win (~6 min, the most expensive job in CI). Its result is a function of source **plus** things turbo does not currently hash: `docker-compose.yml` (root, in no package — needs `globalDependencies`) and the migration set under `apps/api/drizzle/`.

**A tension worth naming:** root `docker-compose.yml` holds *both* the test services (`postgres-test`, `redis`) and the devcontainer's own `dev` service (`docker-compose.yml:2-6`). Declaring the whole file in `globalDependencies` means a purely local devcontainer tweak — including Decision 9's — invalidates every cached task in the monorepo. Options: accept it (the file changes rarely), or split the test services into their own compose file so the dependency is narrow. **Lean: accept for now and name it in the spec's risks**; splitting compose files is a bigger change than this ticket should carry, and a rare full invalidation is a performance event, not a correctness one.

**Lean: cache it, but only after those inputs are declared, and treat it as the highest-risk item in the smoke walk.** A false green here is the worst outcome in the ticket, so it earns the deliberate break-it-and-confirm-red test the issue's acceptance criteria already require. If the declaration turns out to be hard to make airtight, keeping `cache: false` with an in-file comment explaining why is an acceptable landing spot — the suite skip for docs-only pushes already covers the common cheap case.

### Decision 9 — The devcontainer CLI, and whether developer machines share the cache

`turbo` is a root devDependency (`^2.3.3`, resolving to **2.8.12**) but is not on PATH in the devcontainer, so every local invocation is `npx turbo`. The devcontainer has no `.devcontainer/Dockerfile` — it builds from `docker-compose.yml`'s `dev` service (`docker-compose.yml:2-6`), whose image is the `dev` target of the root `Dockerfile`.

**A. `npm install -g turbo` in the Dockerfile.** Simple, but pins a version independent of the lockfile. For a cache tool this is actively dangerous: a different turbo version can compute different task hashes, so a developer and CI would silently disagree about what is cached.

**B. Symlink the workspace binary**, following the documented precedent at `Dockerfile:70-77`, which already does exactly this for `portalops`/`portalai` and explains that the links dangle at image-build time and resolve once `onCreateCommand`'s `npm i` populates `node_modules/.bin`.

**Lean: B.** It is the established in-repo pattern and it makes version drift structurally impossible — the CLI *is* the lockfile's turbo.

Separately: should a local `turbo` read or write the shared cache? A developer's machine is not a reproducible build environment (uncommitted edits, local `.env`, `apps/api`'s `dotenv -e .env` build wrapper), so an artifact it uploads would later be consumed by CI on trust. **Lean: developer machines read-only at most (`--remote-cache-read-only` / `--cache=remote:r`), and not linked by default.** CI is the only writer. This keeps the provenance of every cached gate result inside CI, which is what makes Decision 6's signing meaningful.

### Decision 8 — The API Docker build path

The ticket asks for all six workflows; the survey shows `deploy-backend` has **no host-side turbo process at all**. Options: (a) leave it out of scope; (b) forward the token via `docker/build-push-action`'s `secrets:` mount so it never lands in image history; (c) move the API build onto the runner and `COPY --from` the `dist/`.

**Lean: (a) for this ticket, with (b) named as the follow-up.** The API image build is not among the measured 14–17 minutes, and (c) restructures the deploy path — disproportionate here. This was a **scope correction against the issue body**, and #454 has been amended to record it: deliverable 3 now scopes the cache to the *host-side* turbo invocations, Out of scope carries the deferral with its cause, and an acceptance criterion requires the exclusion be stated in-file so the next contributor doesn't read the gap as an oversight.

## Tradeoff comparison

| | D2: suites-first | D3: site uncached | D4: deterministic version | D5: explicit secrets | D6: signed | D7: cache integration | D8: Docker deferred |
|---|---|---|---|---|---|---|---|
| Captures the measured win | **Yes** | No (not on hot path) | Minor | Enabling | Neutral | **Yes, biggest** | No |
| Removes a correctness hazard | Yes | **Yes (prod bleed)** | Yes (pre-existing bug) | Yes (silent no-op) | Yes | Adds risk if rushed | Neutral |
| Spread to spec | Yes | Yes | Yes — touches app code | Yes | Yes | Yes | Issue amendment |

## Recommendation

1. Enable Vercel Remote Cache for the **three PR suites first** (`unit-test.yml`, `integration-test.yml`, `static-checks.yml`), where the measured 14–17 job-minutes actually are.
2. Attach `TURBO_TOKEN`/`TURBO_TEAM` as a **workflow-level `env:` block** in each workflow that runs turbo; do not plumb them through `.github/actions/setup` as inputs.
3. Declare `secrets:` **explicitly** in each suite's `on.workflow_call` and map them at all six call sites in `deploy-dev.yml`/`deploy-prod.yml`, following `deploy-static-site.yml`'s precedent. Verify on a live `workflow_dispatch` — a missing token fails silently.
4. Add `remoteCache: { signature: true }` to `turbo.json` with `TURBO_REMOTE_CACHE_SIGNATURE_KEY`; keep all CI jobs read-write.
5. Declare the missing env: `SITE_URL`, `SITE_CONFIG_URL`, `SITE_APP_URL`, `SUPPORT_EMAIL`, `SALES_EMAIL`, `ADMIN_EMAIL`, `GITHUB_SHA` on `apps/site#build`; add `globalDependencies` for root `docker-compose.yml`; keep `apps/api`'s `dotenv -e .env` behavior in mind (gitignored, absent in CI, already `--env-mode=loose` in Docker).
6. Keep `apps/site#build` **uncacheable** — already true in `apps/site/turbo.json`; this ticket adds the guard rule and the in-file rationale that were missing.
7. Replace `crypto.randomUUID()` in `versionJson()` with a deterministic content- or commit-derived value — fixing the existing spurious-reload-prompt bug — **without** putting `GITHUB_SHA` in the task's hashed `env`.
8. Enable caching for `test:integration` only once `docker-compose.yml` and `apps/api/drizzle/` are declared inputs; prove it with a deliberate red-then-green.
9. Make hit/miss legible in every run (`--summarize`, or `--log-order`/an explicit step) so a silently-degraded cache is visible rather than merely slow.
10. Leave the API Docker build path uncached; #454 amended to say so.
11. Put `turbo` on PATH in the devcontainer by symlinking `/workspace/node_modules/.bin/turbo`, following `Dockerfile:70-77`; do not `npm install -g`.
12. Keep CI the only cache **writer**; developer machines read-only at most, and not linked by default.

## Open questions

1. ~~**Does a Vercel account/team already exist for this org?**~~ **Resolved — token and team slug are both set.** Decision 1 is settled and `actions/cache` is not needed as a fallback. Two mechanical follow-ups for the spec: (a) the token must land in **repo secrets** (`TURBO_TOKEN`) — it should never be pasted into a transcript, a doc, or a workflow file; and (b) `TURBO_TEAM` needs the **team slug**, which is a separate value from the token and is not secret (a repo *variable* is the better home for it than a secret).
2. **Is `routeTree.gen.ts` regenerated during CI builds?** It's committed (`git ls-files` returns it) *and* produced by the `tanstackRouter` plugin (`apps/web/vite.config.ts:104`). If a build rewrites it, the tracked file and the regenerated file can disagree and the input hash flaps between jobs. **Lean: verify with a `git diff --exit-code` after a CI build; if it flaps, add it to the task's `inputs` exclusions.**
3. **Is a stale restored `src/styles/tokens.css` ever observed by a later task?** It's written outside `outputs` (hazard 5). **Lean: no** — `astro build` consumes it inside the same task, and Decision 6 makes the site build uncached anyway, so this is moot unless the site is re-enabled for caching.
4. **Does `packages/core`'s `build:fonts` (ttf2woff2) produce byte-identical output across runners?** If the encoder is not reproducible, `dist/**` differs per build and downstream hashes flap. **Lean: assume yes, verify once** — a mismatch shows up immediately as a permanent cache miss on `@portalai/core#build`, which is loud, not silent.
5. **Should `format:check` gain `dependsOn`?** It has none, so it can run before dependency builds. **Lean: leave it** — Prettier reads source only; adding a dependency edge would make it wait on builds for no benefit.

## Enterprise-scale considerations

- **Concurrency & correctness.** Multiple jobs write the same key concurrently. Safe by construction: artifacts are content-addressed by input hash, so an identical hash means identical content and last-write-wins is a no-op. **Lean: no coordination needed.**
- **Accuracy & auditability.** The thing being cached is a *gate result* — a cached green check asserts a suite passed. That assertion is only as good as the hash. **Lean: signature verification (D6) plus per-run hit/miss visibility (R9) are the audit surface; a cached pass must be traceable to the run that produced it.**
- **Failure modes.** Split deliberately: **fail-open on availability** (cache unreachable → turbo runs the work; the cache is an optimization, never a gate) and **fail-closed on integrity** (signature mismatch → reject the artifact). A blanket fail-open on integrity is what turns a poisoned cache into a green check.
- **Scale & unbounded growth.** Cache artifacts accumulate per input hash; a busy branch generates many. **Lean: rely on the provider's retention rather than inventing a pruning job — but confirm the plan's storage ceiling before enabling, since silent eviction presents as an unexplained drop in hit rate, not an error.**
- **Multi-tenancy.** `N/A because` this is one repo and one CI tenant. The one adjacent concern is credential scope: the token should be scoped to this project, not an org-wide write token.
- **Contract stability.** The load-bearing contract is the **required-status-check job names** — `Unit Tests`, `Integration Tests`, `Static Checks` (`unit-test.yml:29`, `integration-test.yml:18`, `static-checks.yml:29`). Renaming one un-gates it and wedges every PR on a context that never reports. Also preserve the concurrency-group literal-prefix rule and `integration-test.yml`'s in-job docs-only skip (never convert it to `paths-ignore`). **Lean: no name, group, or trigger changes in this ticket.**
- **Data lifecycle.** Build artifacts leave the repo boundary and sit on a third party. `apps/web`'s bundle has `VITE_*` values inlined at build time — public-by-design client config, but it *is* config leaving the perimeter. **Lean: acceptable and worth stating in the spec's risks; it is also an argument against ever caching an artifact built with genuinely secret env.**

## What this doesn't decide

- Splitting or sharding the suites themselves (matrix-sharded Jest, a shared long-lived test DB). Orthogonal — this ticket only skips work already done.
- Docker layer caching for the API image, and the `--secret`-mounted token that would let remote cache reach inside the Dockerfile (Decision 8's follow-up).
- Whether `deploy-dev` should stop skipping the suites on push to `main`. That skip rests on `strict` branch protection plus squash merges, is independently argued at `deploy-dev.yml:16-39`, and remote caching is **not** a reason to revisit it.
- Any change to `npm ci` / `actions/setup-node`'s npm cache.
- Turbo's own change-detection (`--filter=...[origin/main]`) as a substitute for `integration-test.yml`'s docs-only gate. The gate exists so a required check still *reports*; turbo filtering does not report a check.

## Next step

`docs/TURBOREPO_CI_CACHING.spec.md` fixes the contract — which env vars are declared where, the exact `turbo.json` diff, the secret names, and the red-then-green proof for each cached gate. Then `docs/TURBOREPO_CI_CACHING.plan.md` slices it roughly as: (1) `turbo.json` hash correctness — declared env, `globalDependencies`, `apps/site` uncached, signature block, no CI change yet; (2) deterministic `version.json`; (3) credentials + explicit `workflow_call` secrets, cache live for the three suites; (4) `test:integration` inputs declared and caching enabled, with the deliberate-red proof; (5) deploy-frontend/static-site opt in. Each slice is independently green-testable, and slices 1–2 are pure correctness fixes that stand on their own even if the cache were never switched on.
