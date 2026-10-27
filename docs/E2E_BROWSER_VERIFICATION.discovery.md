# E2E browser verification (CI specs, post-deploy login, deployed-env agent sessions) — Discovery

**Issue:** [EnterpriseBT/portal-ai#489](https://github.com/EnterpriseBT/portal-ai/issues/489)

**Why this exists.** #304 gave an in-container agent a Playwright harness, but only against the local dev stack. Nothing runs Playwright in CI, and nothing (CI or agent) can sign in to `app-dev` or `prod`. Both are Google-only, the #304 "Dev sign-in (E2E)" affordance is stripped from deployed builds, and the QA users exist only in the local Auth0 tenant. #873 shows the cost of that gap: a stale Auth0 Action looped every prod login and no check noticed.

The ticket has three tiers, each scoped on purpose:
1. **PR walk:** a fresh org walked through the core loop on an ephemeral CI stack.
2. **Post-deploy login check:** after each deploy, log in to that env and nothing more.
3. **Agent sessions:** an agent can sign in to `app-dev` and `prod` as a dedicated QA identity, confined to its own QA org, to troubleshoot and to reproduce customer reports.

This is the work that makes "does login work on prod?" and "does the core loop still work?" machine-answered questions.

## The current shape

### Harness (`packages/e2e`)

| Piece | Location | Note |
|---|---|---|
| Playwright config | `packages/e2e/playwright.config.ts:22-33` | `testDir: ./src/specs` (dir doesn't exist yet); `baseURL` from `E2E_BASE_URL`; one fixed `storageState: ./.auth/storageState.json`; trace on-first-retry, screenshot/video on failure; no projects, no `webServer`, no reporter |
| Version lockstep | `packages/e2e/playwright.config.ts:10-20` | `@playwright/test` 1.62.1 must track the MCP pin and the devcontainer Dockerfile |
| Auth capture | `packages/e2e/src/setup/auth.setup.ts:101-144` | `/?e2e=1` → `e2e-dev-login` → Universal Login (identifier-first or combined) → waits for `@@auth0spajs@@` in localStorage → writes state. `--identity` → `E2E_AUTH0_USERNAME_<ID>` (`:44-71`). Knows only a base URL, no env |
| Scripts | `packages/e2e/package.json:13-20` | `test:unit`/`test:integration` are `true`; no `test:e2e`; `e2e:use` copies a role's state over the active one |
| MCP | `.mcp.json` | `@playwright/mcp@0.0.80 --headless --isolated --storage-state packages/e2e/.auth/storageState.json`. One server, one hardcoded state, no origin restriction |
| Turbo | `turbo.json:67-83`, root `package.json:24-27` | only `test:unit` / `test:integration` |
| smoke-walk | `.claude/skills/smoke-walk/SKILL.md:17-18,40-42` | preflight hardcodes `localhost:3000`, `.auth/storageState.json`, `e2e-fixture` |

### Login path (`apps/web`)

| Piece | Location | Note |
|---|---|---|
| Dev affordance | `apps/web/src/components/LoginForm.component.tsx:138-153` | `showDevLogin = import.meta.env.DEV && ?e2e`; `withUniversal()` pins no connection; the normal button is `withGoogle()` |
| `?e2e` survives redirect | `apps/web/src/components/Authorized.component.tsx:61-63` | `<Navigate to="/login" search={true}>` |
| Session storage | `apps/web/src/providers/Auth.provider.tsx:212-223` | `cacheLocation="localstorage"` + `useRefreshTokens`, so a `storageState` **captures a refresh token** and is a long-lived secret |
| Build-time config | `apps/web/src/utils/runtime-config.util.ts:85-99`; `deploy-dev.yml:322-325`, `deploy-prod.yml:306-309` | `VITE_AUTH0_*` baked per env from `DEV_`/`PROD_` secrets; SPA → `api-dev.portalsai.io` / `api.portalsai.io` |
| Hosting | `deploy-dev.yml:351-356`, `infra/cloudformation/frontend.yml:125-177` | S3 + CloudFront; headers policy is nosniff + COOP only (no CSP to fight) |

### Provisioning — first login *is* org provisioning

The post-login webhook is gone (#873; `apps/api/src/routes/webhook.router.ts:21`). `metadata.middleware.ts:53-70` self-heals instead: an authenticated subject with no user row or no membership is run through `ApplicationService.ensureProvisioned` (`application.service.ts:~165`, `fallback = "personal_org"`), which creates the user **and a personal org** on the first API call. Two consequences:
- On a fresh CI database, the first login is the "newly provisioned org". No seed step is needed beyond the global `db:seed` (tiers, connector definitions, system column definitions).
- In a deployed env, the QA user's first login creates its org. Making that org *the* QA org (rename + tier grant) is what keeps "member of exactly one org" true. `db:seed:org` (`seed-org.ts`) would create a second org.

admin-cli has what the deployed QA org needs: `org set-tier` refuses when a live Stripe subscription exists (`packages/admin-cli/src/commands/org.ts:46-61`), and `org create` / `member *` exist too (`COMMANDS.md:45-75`). `portalops local provision --e2e-org` is local-only (`docs/LOCAL_DEVELOPMENT.md:21-33`).

### CI and deploy workflows

- **Boot pattern** (`.github/workflows/integration-test.yml:127-158`): `docker compose up -d postgres-test redis --wait` → `./.github/actions/setup` → run → `docker compose down` under `if: always()`; Turbo remote-cache env at `:31-34`.
- **deploy-dev.yml:** gated tests (dispatch only) → `deploy-infra` → `deploy-frontend` ∥ `deploy-backend` → `tag-deploy` (`:605-631`). Downstream jobs use the `!cancelled() && needs.X.result == 'success'` guard (`:266-279`). OIDC via `secrets.AWS_ROLE_ARN`.
- **deploy-prod.yml:** release-triggered, `environment: prod`, `secrets.PROD_AWS_ROLE_ARN`, no tag job (`:16-19`).
- **Deploy roles** `github-cicd-deploy-{dev,prod}` (`infra/cloudformation/iam.yml:485-965`) already hold `GetSecretValue` on `portalai/dev/*` (`:617-621`) and `portalai/prod/*` (`:954-958`).

### Secrets and env registry

`packages/cli-env/src/aws.ts:78-100` `getSecret(def, name)` reads `portalai/<envName>/<name>` with ambient credentials (SSO / profile / CI OIDC), so `portalai/dev/qa-auth0-password` needs no new access code. `packages/cli-env/src/registry.ts:40-60` knows each env's **API** URL but not its **web** URL. New secrets are catalogued in `packages/devops-cli/src/catalog.ts:43-70`.

### Core-loop dependencies the CI stack must satisfy

- **Object storage:** upload is a browser PUT to a presigned S3 URL (`apps/api/src/routes/file-uploads.router.ts:29-108`, `services/s3.service.ts`). The `UPLOAD_S3_ENDPOINT` / `UPLOAD_S3_FORCE_PATH_STYLE` seam exists (`apps/api/src/environment.ts:291-301`, #567). `docker-compose.yml` has no MinIO.
- **Queue:** parse runs on BullMQ (`apps/api/src/queues/jobs.worker.ts:162`), in-process with the API, so Redis is required.
- **An LLM, unexpectedly:** CSV interpret wires an **Anthropic classifier + axis-name recommender** (`apps/api/src/services/layout-plan-interpret.service.ts:20-80` → `spreadsheet-parsing-llm.service.ts:99`). The parser itself takes the classifier as optional (`packages/spreadsheet-parsing/src/interpret/index.ts:77-80`), and the API overrides the endpoint with `ANTHROPIC_BASE_URL` (`environment.ts:84`).
- **API boot:** the `dev` script starts ngrok (`apps/api/package.json:8`), so CI runs `build` + `start`.
- **Routes the walk visits:** `/` (`Dashboard.view.tsx`), `/connectors` (`routes/connectors.index.tsx`), `/entities/$entityId`, `/stations/` (`routes/stations.index.tsx:6`), `/portals/$portalId` (`routes/portals.$portalId.tsx:7`). Portal create is `CreatePortalDialog.component.tsx`. Sample fixtures are `/samples/supported_layouts.{csv,xlsx}` (`SampleFiles.component.tsx:24-32`).

## The design space

### Decision 1 — Deployed-build sign-in path

The QA Database connection gets enabled on each deployed tenant's SPA application with sign-ups disabled (decided in the PRD). The question is how a browser reaches it.

- **A. Build-flagged QA button.** A new `VITE_AUTH0_QA_CONNECTION` (connection name, set per env at build) makes `/login?qa=1` render "QA sign-in", which calls `loginWithRedirect({ connection })`, pinned to that connection. Unset ⇒ no affordance; the local `DEV` affordance is unchanged.
- **B. Drop the `DEV` guard on the existing `?e2e` affordance.** The button ships everywhere and Universal Login shows every enabled connection.
- **C. A separate Auth0 "QA" application** with the DB connection enabled only on it, plus a QA web build. The real SPA's Auth0 app config stays untouched.

The threat model makes A and B equivalent in exposure. Once a connection is enabled on the app, anyone can reach its password form by crafting an `/authorize?connection=…` URL, so the button adds no surface. The real guard is Auth0-side: no sign-up, one user, brute-force protection, a strong rotated password.

| | A | B | C |
|---|---|---|---|
| Exposure vs. status quo | connection-enabled only | same + generic chooser | none on the real app |
| Exercises the real SPA build | yes | yes | no (different client/build) |
| Off by default | yes (env opts in) | no | n/a |
| Cost | small | smallest | a second app + build per env |

**Lean: A.** Same real-app fidelity as B, but opt-in per build and pinned to one named connection, so Universal Login never shows a chooser. C stops testing the login users actually hit, which is the point of tier 2.

### Decision 2 — Unattended auth on the ephemeral PR stack

- **A. Dedicated CI user in the local/dev Auth0 tenant** (Database connection, MFA off), with creds in repo secrets. A `setup` project logs in through the existing dev affordance against `localhost:3000` (already an allowed callback). Each run's fresh DB self-provisions a new org on first login. Concurrent runs share the Auth0 user but not a database, which is harmless.
- **B. CI-local OIDC issuer** trusted via `SSO_ISSUERS` (`environment.ts:16-21`) and minted tokens. No Auth0 dependency, but it doesn't exercise login, and the SPA's Auth0 SDK would need a bypass.
- **C. Pre-minted `storageState` in a secret.** Refresh tokens expire or rotate, so this is brittle.

**Lean: A.** It exercises the real Auth0 + SPA login, and the "newly provisioned org" falls out of `ensureProvisioned` for free. The Auth0 dependency is the same one users have.

### Decision 3 — The LLM inside CSV import

The core loop's CSV step calls Anthropic at interpret time. The PRD rules out live LLM calls.

- **A. Stub Anthropic server** in the CI compose (`ANTHROPIC_BASE_URL` → stub). It answers every classifier/recommender call with a valid "no confident match" response, so interpret falls back to the seeded `text` definition, deterministically.
- **B. A heuristic-only switch** (e.g. `INTERPRET_CLASSIFIER=none`) that skips wiring the classifier. It's simpler, but it adds a production config knob that only tests use, and it skips the code path.
- **C. Drop CSV import from the walk.**

**Lean: A.** It runs the real interpret wiring end to end over a seam that already exists (#567's portability work). The stub is generic (shape-valid, content-agnostic), so it doesn't need to track prompt changes.

### Decision 4 — Agent sessions per env

- **A. One MCP server, swap state.** `e2e:auth --env prod` writes `.auth/prod/owner.storageState.json`, `e2e:use --env prod` copies it to the active state, and the session restarts. The env is implicit, so a session can act on prod while the agent believes it's local.
- **B. One MCP server per env** in `.mcp.json` (`playwright`, `playwright-app-dev`, `playwright-prod`). Each has its own `--storage-state`, and each deployed server gets `--allowed-origins` limited to its web host + Auth0 domain + API. The env is in every tool name (`mcp__playwright-prod__*`); no restart, no swap.

| | A | B |
|---|---|---|
| Env explicit per action | no | yes (tool name) |
| Wrong-env navigation blocked | no | yes (`--allowed-origins`) |
| Restart to switch | yes | no |
| Context cost | 1 tool set | 3 (deferred-loaded, so small) |

**Lean: B.** Prod access should be visible in every call and fenced by origin, not by remembering which file was copied last.

### Decision 5 — Browser topology (deferred from #304)

#304's analysis stands: a separate `mcr.microsoft.com/playwright` service costs cross-container networking, an extra Allowed-Callback-URL, a `storageState` origin mismatch and MCP-over-CDP, and saves no CPU. CI runs on the runner host, so the browser and the stack share `localhost`.

**Lean: no browser service.** Keep the devcontainer bake. CI installs Chromium for the pinned version and caches `~/.cache/ms-playwright` keyed on the `@playwright/test` version.

## Tradeoff comparison

| | D1 build-flagged QA button | D2 CI Auth0 user | D3 Anthropic stub | D4 MCP per env | D5 no browser service |
|---|---|---|---|---|---|
| Touches prod config | yes (opt-in var) | no | no | no | no |
| Real login exercised | yes | yes | n/a | yes | n/a |
| New infra | Auth0 conn + secret per env | CI user + repo secrets | stub + MinIO in compose | `.mcp.json` entries | cache step |
| Spread to spec | Yes | Yes | Yes | Yes | Yes |

## Recommendation

1. Add `VITE_AUTH0_QA_CONNECTION` to the web build. When set, `/login?qa=1` renders a "QA sign-in" that calls `loginWithRedirect({ authorizationParams: { connection } })`. When unset, nothing renders. `deploy-dev.yml` / `deploy-prod.yml` pass it from per-env secrets.
2. Each deployed Auth0 tenant gets a Database connection with sign-ups disabled, enabled on the SPA application, holding one QA user (MFA off, brute-force protection on). The password lives at `portalai/<env>/qa-auth0-password`, with the username at `qa-auth0-username`, both catalogued in `packages/devops-cli/src/catalog.ts`. The vendor steps go in a runbook and on the release checklist.
3. The deployed QA org is the personal org the QA user's first login provisions. It's renamed and given a tier grant via `portalai org set-tier` (no Stripe subscription). The runbook states it is that user's only membership.
4. Playwright gets three projects:
   - `setup` logs in once and writes `storageState`;
   - `core-loop` depends on it and walks dashboard → CSV import of `supported_layouts.csv` → records → create station → create and open a portal;
   - `login` signs in and asserts an authenticated API-backed render, for use against any base URL.
   No spec body logs in except `login`.
5. `test:e2e` (headless) and `test:e2e:ui` land in `packages/e2e`. Turbo gets `test:e2e` with `cache: false`, since it runs against a live stack.
6. A new `e2e-test.yml` workflow boots `postgres-test`, `redis`, a new `minio` (CORS allowing `localhost:3000`, bucket created at boot) and a new `anthropic-stub` via compose `--wait`. It runs `db:migrate` + `db:seed`, builds and starts the API and web, runs the `setup` + `core-loop` projects, uploads trace/screenshot/video/HTML report on failure, and tears down under `if: always()`. It's not a required check. Its CI user's creds come from repo secrets.
7. `deploy-dev.yml` and `deploy-prod.yml` get a final `verify-login` job that needs `deploy-frontend` + `deploy-backend` success (`!cancelled()` guard). It waits for the CloudFront invalidation, reads the QA creds with the deploy role, and runs the `login` project against the env's web URL. A failure turns the run red with **screenshot + video only**, no trace and no HTML report (see Enterprise considerations). There is no rollback.
8. `e2e:auth --env <app-dev|prod>` resolves the env through `cli-env`, reads the QA creds with `getSecret`, signs in via `?qa=1` and writes `.auth/<env>/owner.storageState.json` (mode 600). `cli-env`'s registry gains each env's web URL.
9. `.mcp.json` gains `playwright-app-dev` and `playwright-prod`. Each one loads its env's state, has `--allowed-origins` fenced to its web, API and Auth0 hosts, and uses its own output dir under `packages/e2e/test-results/<env>/`.
10. The agent-conduct rules go in `packages/e2e/README.md` and `CLAUDE.md` → "Agent-guided browser sessions":
    - work only in the QA org;
    - reproduce a customer bug by recreating its conditions there;
    - no billing checkout;
    - label created data `qa-<date>-…` and clean it up.
    `/smoke-walk` stays local-only.

**Amendment (2026-10-27): owner, admin and member.** After slice 6 the scope widened to all three system roles, on the PR stack and in agent sessions against app-dev and prod. The post-deploy check stays owner-only. Each role is a real user invited into the org it tests, and its first sign-in goes through its invite link, so no identity ever self-provisions a second org. The one-org invariant above holds per identity. The spec's decision 14 pins the contract, and plan slice 7 builds it.

## Open questions

1. **Does a deployed tenant enforce MFA tenant-wide?** If so, the QA user needs an exemption (an Action or a policy) or unattended login fails. **Lean:** check each tenant in the runbook step. Exempt the QA user by connection in the MFA Action rather than turning MFA off tenant-wide.
2. **Should the deploy role be narrowed to just the QA secret?** It already reads `portalai/<env>/*`, including DB credentials, so the QA password adds no privilege it doesn't have. **Lean:** no narrowing in this ticket. Record the read in the runbook.
3. **What does `login` assert to catch a #873-class loop?** URL ≠ `/login` isn't enough, since a loop bounces back. **Lean:** wait for an authenticated `GET /api/…` 200 *and* the QA org's name rendered in the header, within a bounded timeout.
4. **Does a deployed `verify-login` race the CloudFront invalidation?** The new `index.html` may not be served yet. **Lean:** `aws cloudfront wait invalidation-completed` on the deploy's invalidation id before running the login project.
5. **Can the PR workflow run on fork PRs?** Repo secrets aren't exposed to forks. **Lean:** skip with a notice when the CI credential is absent. The team works on branches, and the check is non-required.
6. **Does the QA org skew product metrics?** **Lean:** out of scope here. Note it in the runbook so any analytics excludes the QA org by id.

## Enterprise-scale considerations

- **Concurrency & correctness.** Parallel PR runs share one Auth0 CI user but have isolated databases, and Auth0 allows concurrent sessions. Two deploys can't overlap per env (the workflows' concurrency groups). Agent sessions and post-deploy checks share the QA user. Refresh-token rotation can invalidate the other holder's token, but each re-authenticates from the secret. **Lean:** each consumer logs in fresh rather than sharing a state file.
- **Accuracy & auditability.** QA-user actions in prod are ordinary audited app actions under a named identity. **Lean:** the identity's email (`qa+<env>@…`) makes them attributable; no extra ledger.
- **Failure modes.** The post-deploy check fails closed (red run) but doesn't roll back, per the PRD. An unreachable Auth0 turns it red, which is correct, since users can't log in either. The PR workflow is non-required, so a flaky failure doesn't block merges. **Lean:** retries 0 for `login` (a flake must be visible), 1 for `core-loop` with the trace on retry.
- **Scale & unbounded growth.** Agent-created QA data accumulates in prod. **Lean:** conduct rule plus label prefix. Artifacts have 14-day retention.
- **Multi-tenancy.** Isolation is server-enforced, because the QA identity's only membership is the QA org. Every customer object is unreadable (404) to it by the #692 rules. No new access path, no impersonation. **Lean:** acceptance verifies the QA user has exactly one membership.
- **Contract stability.** `VITE_AUTH0_QA_CONNECTION` is additive and off by default. The residency (`OIDC_*`) builds don't set it. **Lean:** a residency deploy never enables it.
- **Data lifecycle / secrets.** A `storageState` holds a refresh token, and a Playwright trace records filled values *and* network headers. **Lean:**
  - deployed runs never emit traces or HTML reports;
  - `.auth/<env>/` is git-ignored and mode 600;
  - the QA password rotates via the runbook, which invalidates every captured state;
  - ephemeral-stack traces are fine, since their creds only reach a throwaway stack.

## What this doesn't decide

- **Customer-org access** (support access / impersonation). It's out of scope by PRD and needs consent and audit design of its own.
- **Promoting `e2e-test.yml` to required.** That needs a flake record first, and it's a separate follow-up.
- **Deployed-env smoke walks via `/smoke-walk`.** The merge gate stays local. Deployed sessions are for troubleshooting.
- **Coverage beyond the core loop** (sync, agent chat, billing). Each gets specs as those features land.

## Next step

Write `docs/E2E_BROWSER_VERIFICATION.spec.md` (contract: sign-in affordance, Playwright projects, workflows, MCP entries, secrets, conduct rules) and `.plan.md`. Likely slices:
1. Playwright projects + `test:e2e` locally;
2. MinIO + Anthropic stub in compose, with the core-loop spec green locally;
3. `e2e-test.yml`;
4. `VITE_AUTH0_QA_CONNECTION` affordance + tests;
5. `e2e:auth --env` + `cli-env` web URLs + catalog entries;
6. `verify-login` in both deploy workflows;
7. `.mcp.json` per-env servers + README/CLAUDE.md conduct;
8. the operator runbook (Auth0 tenants, QA org).
Slices 1–3 need no vendor changes. 4–8 depend on the user doing the Auth0 tenant setup.
