# Agent-guided browser sessions (Playwright harness) — Discovery

**Issue:** [EnterpriseBT/portal-ai#304](https://github.com/EnterpriseBT/portal-ai/issues/304)

**Why this exists.** Every merge gate in this repo is a human walking a `.smoke.md` checklist against their own running stack — `docs/` holds 33 of them and the count grows by one per non-trivial ticket. There is no browser automation anywhere in the monorepo (no Playwright/Cypress/Puppeteer in any `package.json`), so an agent that wants to confirm a UI change today can only reason about it from source. This ticket gives an in-container Claude session a real browser pointed at the running dev stack — it can navigate, click, fill, screenshot, and read console/network — so it can walk a smoke checklist and produce reviewable evidence, and troubleshoot the live UI instead of inferring behavior.

This is the **harness plus its first consumer** (the agent). Automated `*.spec.ts` specs and the ephemeral CI workflow are deliberately deferred to a follow-up ticket aimed at prod / app-dev login-flow verification — but the harness (browsers, package, auth fixture, seed baseline) and the smoke-gate convention change are built here so that follow-up is purely additive.

## The current shape

### Devcontainer + Dockerfile

The single root `Dockerfile:1` (`FROM node:latest AS dev`, Debian) installs system deps via apt (`:4-15`) then vendor CLIs from official repos — AWS/ngrok (`:16-28`), Docker/GH/Stripe/Auth0 CLIs (`:35-64`), and the Claude CLI (`:67`). Portal CLIs + `turbo` are symlinked from `node_modules/.bin` (`Dockerfile:86-88`), dangling at build time and resolving after `onCreateCommand: "npm i"`. `.devcontainer/devcontainer.json` bind-mounts **only** `~/.claude` (`mounts`); `/workspace` is the compose bind-mount. **Playwright browsers default to `~/.cache/ms-playwright`, which is on neither persisted mount** — so browsers must be baked into an image layer at a fixed `PLAYWRIGHT_BROWSERS_PATH`, alongside `npx playwright install-deps` for the apt libs.

### docker-compose + networking

`docker-compose.yml` runs `dev` (the whole toolchain, ports 3000/3001/3002/7006/7007, `sleep infinity`, `:10-15`), plus `redis`, `postgres` (PostGIS, 5432), `postgres-test` (tmpfs, 5433), `ollama`. **Web (:3000) and API (:3001) both run inside the single `dev` container** via `npm run dev` — so all browser→web→api traffic is `localhost` inside `dev`. Every service joins the `mcp-net` bridge (`:109-111`), but despite the name **there is no MCP server container** — `mcp-net` is just the shared bridge (grep confirms the only "mcp" hit is the network name).

### MCP wiring

**Greenfield — no MCP is configured anywhere.** No `.mcp.json`, no `mcpServers` block in `.claude/`. `.claude/settings.local.json` is only a Bash `permissions.allow` list (git commit/push and many read-only vendor commands are already allowed). Wiring a Playwright MCP server means adding a project-scoped `.mcp.json` (auto-loaded by the in-container Claude CLI) and adding its tool names to the allow list.

### Monorepo package conventions

Workspaces are `apps/*` + `packages/*`; inter-package refs use `"@portalai/x": "*"`. `turbo.json` pipelines `build`/`lint`/`type-check`/`test:unit`/`test:integration` (`dependsOn: ["^build"]`), with `globalDependencies: ["docker-compose.yml"]`. A new package needs a `package.json` in the standard shape (`packages/admin-cli/package.json:21-33`): `lint` = `eslint … --max-warnings 0`, `format`/`format:check` scoped to `src/**`, `test:integration: "true"` when N/A. Root `lint-staged` globs `{apps,packages}/*/{src,scripts}/**`, so specs/fixtures under `src/` are covered automatically.

### Seed + fixture provisioning

`db:seed` → `SeedService.seed()` (`apps/api/src/services/seed.service.ts:352`) seeds **global** rows only (tiers `:383`, connector definitions `:436`) — no orgs. A deterministic **org+owner+connector+station+member** baseline already exists via `db:seed:org` (`apps/api/package.json:38` → `apps/api/src/db/seed-org.ts` → `ApplicationService.seedOrganization`, `application.service.ts:167`): idempotent-by-name, mints a synthetic `seed+<slug>@portalsai.io` owner, `provisionOrganizationInTx` creates the sandbox connector instance + default station + toolpack (`:270-285`), and `--member-email` links a real member (`:180-227`). The `portalai` admin CLI wraps these (`packages/admin-cli/src/commands/provision.ts:44-70`, `member.ts:13-45`).

### Auth0 flow (web)

`apps/web` uses `@auth0/auth0-react`. `ApplicationProvider` (`src/providers/Application.provider.tsx:41-50`) mounts `<Auth0Provider>` with `cacheLocation="localstorage"` + `useRefreshTokens={true}` — the SPA session lives in **localStorage**, which is exactly what Playwright `storageState` captures and replays. Login is redirect-based Universal Login (`loginWithRedirect`, `src/api/auth.api.ts:14-17`); tokens attach via `getAccessTokenSilently({ audience })` (`src/utils/api.util.ts:62-71`). Env is `VITE_AUTH0_CLIENT_ID/DOMAIN/AUDIENCE` (`apps/web/.env.example`). **No existing test-user or headless-login affordance** — the Auth0 CLI is installed but no reusable storage state exists.

### Smoke-gate convention surfaces (the lines this rewrites)

- **`CLAUDE.md:655-657`** ("The smoke gate"): merges require green CI **and** the human has walked the checklist; "checking boxes is the human's act — the agent never checks one and never merges on the user's behalf." Also the workflow header and table row (`:547`, `:555`).
- **`.claude/skills/smoke/SKILL.md:8, 84-86, 96`**: "Manual, never automated"; "Every box scaffolds unchecked, and you never check one … a pre-checked box forges the gate"; "nothing here executes the app."
- **`.github/copilot-instructions.md:97`**: "a **manual smoke checklist** … the user must confirm."

### CI conventions (deferred context only)

`.github/workflows/integration-test.yml:89-106` is the model the *deferred* CI ticket follows: `docker compose up -d postgres-test redis --wait`, `./.github/actions/setup` (`npm ci`), env-scoped run, teardown in `if: always()`. Out of scope here.

## The design space

### Decision 1 — Browser tooling for the agent

| | A. Playwright MCP (`@playwright/mcp`) | B. `claude-in-chrome` | C. Agent runs raw Playwright scripts |
|---|---|---|---|
| Headless Linux devcontainer | Native — Chromium headless | **No** — automates the user's local Chrome, not an in-container browser | Works |
| Tool surface (nav/click/fill/screenshot/console/network) | First-class MCP tools | N/A here | Agent writes/reads ad-hoc scripts each time |
| Reuses `storageState` + baseURL | Config-driven | N/A | Manual per script |
| Setup | `.mcp.json` + allowlist entries | — | None, but no structured tools |

**Lean: A — Playwright MCP.** It is the only option that runs in a headless Linux container *and* exposes structured navigate/screenshot/console tools the agent invokes directly; it reads the same `storageState`/`baseURL` the future specs will. `claude-in-chrome` is architecturally excluded (it drives a desktop Chrome, which the devcontainer has none of). Raw scripts work but give the agent no stable tool contract and duplicate what the harness config already declares.

### Decision 2 — Package placement

**`packages/e2e`** (new workspace, own toolchain) vs **`apps/web/e2e`** (folder inside web, reuses web's `lint`/`tsc`).

**Lean: `packages/e2e`.** Cleaner boundary matching existing package conventions; keeps Playwright's config, browsers-list, and (future) specs out of web's `lint`/`tsc`/build globs. `apps/web/e2e` is lighter but muddies web's task hashes and drags Playwright types into the app's TS project.

### Decision 3 — Auth fixture (the crux)

The session must not re-drive Universal Login every run. Options for producing the reusable `storageState`:

| | A. One-time Playwright UI login → save `storageState` | B. Resource-Owner-Password grant → mint token, write SPA cache | C. Direct localStorage injection |
|---|---|---|---|
| Tenant config | Dedicated test user; **MFA disabled** for it | Enable password grant + a test DB connection | Same as B plus reverse-engineer the auth0-spa-js cache shape |
| Fragility | Sensitive to Universal Login markup changes (rare) | Password grant is legacy/discouraged; token refresh still needs the SPA cache shape | Undocumented cache shape — brittle across SDK bumps |
| Matches ticket wording ("logged in once, storage state reused") | Exactly | Partially | No |

**Lean: A.** A one-time Playwright login against the test tenant with a dedicated `e2e@…` user (MFA off in that tenant), saved as `packages/e2e/.auth/storageState.json` (git-ignored) via a Playwright **global-setup**/setup-project, reused by both the agent session and future specs. It's the canonical Playwright pattern and the SPA's localStorage cache is captured wholesale, so no SDK-internal shape is hand-built. Credentials come from env (`E2E_AUTH0_USERNAME/PASSWORD`), never committed.

> **Reconciled at implementation (slice 2):** the app's login is **Google-OAuth-only** (`auth.api.ts` pins `connection: "google-oauth2"`) — there is no username/password form to drive, and this survey missed it. Option A still holds, but reaching Universal Login for a Database-connection user needs a **twice-guarded dev-only login affordance** in `apps/web` (`import.meta.env.DEV` ∧ `?e2e`). User-ratified change to the "no app-source change" premise; the spec's revised D3 + Files-touched carry it.

### Decision 4 — Browser binary persistence

**Lean: bake into the image.** `RUN npx playwright install --with-deps chromium` in the `Dockerfile` with `ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright`, so browsers live in an image layer (survives, since neither `/workspace` nor `~/.cache` is a persisted mount) and there is no ad-hoc `npx playwright install` into a running container. Pin to Chromium only for now (agent smoke walks one browser); the full matrix can widen when specs land.

### Decision 5 — Seed baseline

**Lean: reuse `db:seed:org`.** Provision a named fixture org through the existing idempotent path (`npm run db:seed:org -- --name e2e-fixture --member-email <test-user>`), giving a deterministic org + owner + sandbox connector + default station + linked test member. No bespoke seeding. A thin `packages/e2e` wrapper script (or a documented one-liner) invokes it so "seed the fixture" is one command.

### Decision 6 — The agent walk skill

**Lean: a new `/smoke-walk` skill**, leaving `/smoke` as the scaffolder. `/smoke-walk <N>` reads the ticket's `docs/<SLUG>.smoke.md`, drives the browser via Playwright MCP step-by-step, captures a screenshot per step, and emits an **evidence report** that marks each step `verified` / `could-not-automate` (third-party redirect, payment, visual judgment) — reviewable, never self-asserted. Extending `/smoke` instead would overload one skill with two very different jobs (scaffold vs. execute).

## Tradeoff comparison

| | D1 Playwright MCP | D2 `packages/e2e` | D3 UI-login storageState | D4 bake browsers | D6 `/smoke-walk` |
|---|---|---|---|---|---|
| Spreads to spec | Yes (tool contract + config) | Yes (package shape) | Yes (auth-fixture contract) | Yes (Dockerfile) | Yes (skill + report format) |
| Reused by deferred CI ticket | Config only; CI runs specs not MCP | Yes — specs land here | Yes — same fixture | Yes | No (agent-only) |

## Recommendation

1. Create **`packages/e2e`** with `playwright.config.ts` (baseURL `http://localhost:3000`, `storageState`, `trace: "on-first-retry"`, `screenshot`/`video` on failure), monorepo-consistent `tsconfig`, and `lint`/`format`/`type-check`/`test:integration: "true"` scripts.
2. **Dockerfile:** `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright` + `npx playwright install --with-deps chromium`, baked as an image layer.
3. **Auth fixture:** dedicated Auth0 test user (MFA off in test tenant), Playwright setup-project performs one Universal-Login and saves `packages/e2e/.auth/storageState.json` (git-ignored), from `E2E_AUTH0_*` env.
4. **Seed:** reuse `db:seed:org --name e2e-fixture --member-email <test-user>`; document/wrap it as the single fixture-provisioning command.
5. **Playwright MCP:** add project `.mcp.json` registering `@playwright/mcp` (pointed at the storageState + baseURL) and add its tool names to `.claude/settings.local.json` allow list.
6. **`/smoke-walk` skill:** reads a `.smoke.md`, drives the browser, writes a per-step evidence report distinguishing verified vs. non-automatable.
7. **Convention rewrite:** amend `CLAUDE.md`, `.claude/skills/smoke/SKILL.md`, `.github/copilot-instructions.md` so automatable steps are agent-walked with evidence and `.smoke.md` narrows to the non-automatable remainder — human confirmation stays the merge gate.
8. **Turbo/npm scripts + READMEs** for starting a session and running a walk.

## Open questions

1. **Does agent evidence replace human box-checking for automatable steps, or inform it?** The ticket says agent-driven verification "becomes the merge gate for what can be automated." **Lean: the human still owns the merge confirmation (checks the box), but may check an automatable box on the strength of the agent's evidence report rather than personally re-walking it.** This preserves "the agent never merges on the user's behalf" (the forged-gate concern in `smoke/SKILL.md:84`) while realizing the cost saving. The rewrite phrases it as *agent produces evidence → human accepts*, not *agent self-certifies*.

2. **Where does the storageState / test-user credential live for the local session?** `.env`-sourced `E2E_AUTH0_USERNAME/PASSWORD` in the dev shell, storageState git-ignored. **Lean: yes** — never commit either; document in `packages/e2e/README.md`. (The deferred CI ticket owns the repo-secret path — out of scope here.)

3. **Test-tenant reality: is there a non-prod Auth0 tenant to hold the `e2e@` user with MFA off?** The Auth0 CLI is installed and `VITE_AUTH0_*` points at a tenant per env. **Lean: create the user in the existing local/dev tenant** (the one local web already authenticates against); provisioning it is a documented one-time operator step (`auth0 users create` / dashboard), not code in this PR. Flag for the user to confirm the tenant.

4. **Does the Playwright MCP server need to be a compose service, or a process the agent spawns?** `@playwright/mcp` runs fine as an stdio MCP server launched by the Claude CLI from `.mcp.json` inside `dev`. **Lean: stdio via `.mcp.json`** — no new compose service, no `mcp-net` change; it shares `localhost` with web/api.

5. **Skill name — `/smoke-walk` vs folding into `/smoke`?** **Lean: new `/smoke-walk`.** Keeps the scaffolder pure; the walker is a distinct verb with a distinct output (evidence report).

## Enterprise-scale considerations

Local dev-infra + agent capability, so most dimensions are `N/A`; the ones that engage:

- **Concurrency & correctness** — `N/A`: single-developer local stack, no multi-instance races. Seed org is idempotent-by-name so repeated provisioning converges.
- **Accuracy & auditability** — the walk's **evidence report** (per-step screenshot + verified/could-not-automate verdict) is the audit record; it must be reviewable, not asserted. That is the whole point of the report format (D6).
- **Failure modes** — fail-loud: a session against a **down stack** (web/api not running) must error clearly ("app not reachable at :3000"), not silently pass. The agent must never report a step "verified" it couldn't actually observe.
- **Multi-tenancy** — the fixture is one isolated seed org; it must not touch real org data. Reusing `db:seed:org` (its own synthetic owner) keeps it isolated.
- **Contract stability** — the storageState + baseURL + Playwright-config shape is deliberately the *same* one the deferred CI-spec ticket consumes, so specs plug in without re-plumbing auth or seed. `N/A` for tiers/quotas/RBAC — no billing surface.
- **Secrets** — test-user credentials are env-sourced and never committed; storageState is git-ignored. Prototype-grade local handling is acceptable **because** this is a non-prod test user in a dev tenant; the CI secret path is explicitly the deferred ticket's job.

## What this doesn't decide

- **Automated `*.spec.ts` specs** — deferred. Only the harness + agent capability ship; specs land with the CI ticket.
- **Ephemeral CI workflow, failure-artifact upload, unattended CI auth, required-check promotion** — all the deferred ticket's, targeting prod / app-dev login verification.
- **Broad flow coverage** — connector sync, agent chat, tier changes, portal rendering get walks/specs as their features land.
- **Visual-regression / screenshot-diff** — screenshots are evidence for humans/agents, not assertions.
- **Retiring the 33 `.smoke.md` docs** — they stay until a flow has coverage; this changes gate *policy*, not the corpus.

## Next step

Write `docs/AGENT_BROWSER_SESSIONS.spec.md` (contract: package shape, Dockerfile delta, `.mcp.json` + allowlist entries, auth-fixture + storageState contract, seed command, `/smoke-walk` I/O + evidence-report format, and the exact convention edits) and `.plan.md`. The plan will likely slice as: (1) `packages/e2e` scaffold + Playwright config + Dockerfile browser bake; (2) auth fixture (setup-project + storageState) against the test user + seed wrapper; (3) `.mcp.json` + allowlist wiring so the agent can drive the browser; (4) `/smoke-walk` skill + evidence-report format; (5) convention rewrite across `CLAUDE.md` / `smoke` skill / copilot-instructions + READMEs. Each slice independently confirmable against the local stack.
