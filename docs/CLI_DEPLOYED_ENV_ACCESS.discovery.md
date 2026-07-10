# CLI deployed-environment access & authorization — Discovery

**Issue:** [EnterpriseBT/portal-ai#194](https://github.com/EnterpriseBT/portal-ai/issues/194) · epic **Portal CLIs** (#191) · consumers #190 (App-admin), #192 (DevOps)

**Why this exists.** The motivating reason for the CLIs is reaching *deployed* environments (app-dev, prod) to perform devops and customer-data management effectively — including **handing the CLIs to an AI agent** to execute tasks quickly. Today nothing centralizes "given `--env X`, authorize and connect": env config is scattered (CI-injected `VITE_API_BASE_URL`/`VITE_AUTH0_*` at build time — `.github/workflows/deploy-dev.yml:142-145`; the API reads `.env`; `api-cli.sh` resolves AWS secrets ad-hoc). This ticket is the **shared environment-access layer** — an env registry, per-env authorization on both paths (AWS IAM for infra/DB, Auth0 for the app API), and a `resolveEnvConnection(--env)` seam both CLIs import — production-quality: it must function correctly, scale across environments, and be safely drivable by an agent.

## The current shape

### Env config is real but scattered — no central registry

- **API base URL:** `apps/web/src/utils/api.util.ts:29-31` (`resolveApiUrl` uses build-time `VITE_API_BASE_URL`; CI sets `=https://api-dev.portalsai.io`, `deploy-dev.yml:145`). The API publishes `PUBLIC_API_BASE_URL` (`environment.ts:54-55`).
- **Auth0 per env:** SPA config via `VITE_AUTH0_DOMAIN/CLIENT_ID/AUDIENCE`, injected per-env by CI (`deploy-dev.yml:142-144`); separate app registrations per env.
- **AWS secrets/params (deployed source of truth):** `api-cli.sh:72-98` — Secrets Manager `portalai/${ENV}/*` (8 secrets incl. `database-url`), SSM `/portalai/${ENV}/*` (8 params incl. **`auth0-domain`, `auth0-audience`**).
- **Missing:** any shared `env → {apiBaseUrl, auth0*, awsRegion, secretsPrefix, ssmPrefix}` map. Every surface hardcodes its own.

### Two authorization paths, asymmetric maturity

- **Infra / DB path (proven):** `api-cli.sh:48-75` assumes AWS creds (`aws sso login` / `AWS_PROFILE`); resolves secrets + opens the SSM/bastion DB tunnel. #192 ports this.
- **App API path (new for a CLI):** the web uses Auth0 **SPA authorization-code + PKCE** (`Application.provider.tsx:40-59`, tokens in localStorage, `getAccessTokenSilently` `api.util.ts:62-72`). A CLI cannot reuse the SPA registration — it needs its **own Auth0 app per env** (device-code grant).

### No local credential-cache precedent

The repo reads live from AWS per call; no `~/.portalai/` config or on-disk token cache exists (`storage.util.ts` is browser-only). This layer introduces that pattern — deliberately, with file-permission + lifetime discipline.

### npm scripts made redundant by the epic (retire map)

| Script (`apps/api`) | Fate | Owner |
|---|---|---|
| `cli`, `db:tunnel` (`package.json:37-38`) | **Retired** — pure `api-cli.sh` wrappers | #192 |
| `db:seed`, `db:seed:ci` | **Stay** — `predev` bootstrap and the in-container ECS seed command (`portalops db seed` runs it); app-data seeding remains #190's scope | — |
| `db:reset` | **Stays for #190** — org-scoped app-data reset (`ResetService`), not an infra op | #190 |
| `db:reset:hard` | **Removed by #192** — absorbed as `portalops db reset` (partition-aware, #106) | #192 ✅ |
| `db:generate/migrate/migrate:ci/push/studio` | **Stay** — drizzle schema workflow remains with the API (migrations are CI/deploy's job) | — |
| `tunnel` (ngrok), `webhook:toolpack` | **Stay** — local webhook/dev-server tooling, unrelated to env access (mock-server fold-in is a someday-candidate only) | — |
| `scripts:migrate-signing-secrets` | **Stay** — one-off migration | — |

Doc-sync: `CLAUDE.md` → "API Database Scripts" and `apps/api/README.md` (operator-CLI + seed sections) update in whichever PR retires each script.

## The design space

### Decision 1 — Where env→config lives ✅ *(confirmed in review)*

**Hybrid.** A small checked-in registry of *non-secret, stable* facts (`local | app-dev | prod` → `{apiBaseUrl, awsRegion, secretsPrefix, ssmPrefix, kind}`) + **secrets** (`database-url`) and canonical per-env values resolved from Secrets Manager/SSM at runtime. Non-secret facts are versioned/reviewable; secrets never touch the repo; `local` works with zero AWS. (Rejected: pure-SSM breaks `local` and round-trips AWS for static strings; pure-code would duplicate or commit secrets.)

Each entry carries a **`kind: "development" | "staging" | "production"` classification** — the property consuming CLIs gate destructive operations on (mock/seed/reset: free in `development`, confirm-flag in `staging`, **hard-blocked** in `production`; not string-matching env names). A minimal **local override** (`~/.portalai/environments.json`, entries forced to `kind: "development"`) supports ad-hoc test targets (scratch DB, docker-compose) without a full custom-env system.

### Decision 2 — The two-path authorization model (both in scope)

The layer ships **both** authorization paths — they serve different operations and both are needed for effective devops + app-data management:

- **Infra/DB path — AWS IAM.** The operator's identity (`aws sso login`) gates which env's secrets and tunnel they may touch (`portalai/${ENV}/*` is the permission boundary). Used by #192's ops commands and any direct-DB data access. Proven model, ported as-is.
- **App API path — Auth0 device-code grant.** A **CLI-type Auth0 app per env** (mirroring the per-env SPA registrations); `login --env X` runs the device flow once (human confirms in a browser — works headless/SSH), the session is cached, then commands (or an **agent** driving the CLI) use the cached token against that env's API. Refresh handled transparently; `logout` revokes/clears.

| | AWS IAM (infra/DB) | Auth0 device flow (app API) |
|---|---|---|
| Gates | secrets, tunnel, ECS, direct DB | app endpoints (admin CRUD) |
| Principal | operator's AWS identity | operator's Auth0 user (admin-scoped) |
| Agent-drivable after one human login | Yes (`aws sso` session) | Yes (cached device-flow session) |
| Exists today | Yes (`api-cli.sh`) | No — new Auth0 app registrations |

**Confirmed in review: both, as above.** Device flow over loopback-PKCE (headless-friendly); M2M client credentials **only if** unattended automation with no human-initiated session emerges — the agent-driven scenario is human-authorizes-once + agent-drives, which the cached user session covers with better audit attribution (actions trace to the human principal).

### Decision 3 — Agent & programmatic operability (design requirement, not an option)

The CLIs will be handed to an AI agent, run in CI, and imported by test harnesses (dev-loop seeding/mocking). The env layer (and both consuming CLIs) must therefore be **non-interactive-capable end to end**:

- Every command runnable without prompts; confirmations via **explicit flags** (`--yes`; prod via a distinct barrier flag, e.g. `--confirm-prod`), never interactive-only.
- **Structured output** (`--json`) and **stable exit codes / typed errors** — an agent must distinguish denied / not-found / infra-error without parsing prose.
- Auth is session-based: the human authorizes once per env (device flow / `aws sso login`); the agent operates within that session. CI uses ambient AWS creds (OIDC). The safety guardrails (active-env echo, prod barrier, audit log) exist precisely to make non-human driving safe.
- **Library-first structure:** every capability is an exported, importable function; CLI commands are thin wrappers. Test setup/teardown (jest) and CI call the same primitives programmatically — no TTY-coupled logic anywhere below the command layer.
- **`local` is load-bearing**, not a degenerate case: the inner dev loop (seed → test → reset, many times a day) runs against it — zero AWS, zero Auth0, zero prompts, instant connection from `.env`.

**Lean: adopt as hard requirements on the `resolveEnvConnection` contract and all commands.**

### Decision 4 — Where the shared module lives ✅ *(confirmed in review)*

**Confirmed: a dedicated `@portalai/cli-env` package.** It carries AWS SDK + Auth0 device-flow deps — infra-heavy code that must not leak into `@portalai/core` (imported by the web bundle). It's the one shared CLI package, now concretely justified by two consumers (#190, #192). Kept narrow: registry + authorization + `resolveEnvConnection`, nothing else.

### Decision 5 — The `resolveEnvConnection` contract ✅ *(confirmed in review)*

**Confirmed:** `resolveEnvConnection(env): Promise<EnvConnection>` returning `{ env, apiBaseUrl, db(): Promise<TunneledClient>, token(): Promise<string> }` — **lazy** (tunnel opens on `db()`, device-flow/cache consulted on `token()`), explicit lifecycle (dispose closes the tunnel), path-agnostic. This is the stable seam #190, #192, and a future public CLI bind to; typed errors (`EnvNotAuthorizedError`, `EnvNotConfiguredError`) support the agent-operability requirement.

### Decision 6 — Tunnel implementation sequencing (plan-level, not scope) ✅ *(confirmed in review)*

The DB path's tunnel is shell-native (`aws ssm start-session` + session-manager-plugin). **Confirmed:** implement `db()` by spawning that subprocess directly (lifecycle-managed), sharing the primitive with #192's port rather than blocking on it — whichever lands first owns it, behind the same seam. This is commit sequencing, not a scope cut.

## Tradeoff comparison

| | D1 hybrid registry | D2 both auth paths | D3 agent-operable | D4 `@portalai/cli-env` | D5 lazy seam | D6 spawn tunnel directly |
|---|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes (cross-cutting reqs) | Yes | Yes | Yes |
| New external setup | — | CLI Auth0 app per env | — | — | — | — |
| Blocks on #192 / #83 | No | prod app: #83 | No | No | No | No |

## Recommendation

1. **`@portalai/cli-env`** package: hybrid env registry (checked-in non-secret map + Secrets Manager/SSM at runtime), consumed by #190 and #192. Entries carry **`kind: development | staging | production`**, the property destructive-op gating keys on; a minimal `~/.portalai/environments.json` override (forced `kind: development`) supports ad-hoc test targets.
2. **Both authorization paths**: AWS IAM (infra/DB — secrets, tunnel) and Auth0 **device-code** login per env (app API) with a cached, refreshable session in `~/.portalai/` (0600).
3. **Agent & programmatic operability as hard requirements**: non-interactive flags, `--json` output, typed errors/exit codes, session-based auth, prod barrier flag, **library-first structure** (exported functions, thin CLI wrappers) so agents, CI, and test harnesses drive the same primitives.
4. **`resolveEnvConnection(env)`** as the stable lazy seam (`{ apiBaseUrl, db(), token() }`) with explicit lifecycle; **`local` frictionless** (zero AWS/Auth0/prompts) for the dev seed→test→reset loop.
5. **Environments:** `local`, `app-dev`, and `prod` — prod entries activate when #83 provisions them; the registry and code paths treat prod as first-class from day one (extra barrier, never a default).
6. **New Auth0 CLI app registrations per env** — created as part of this feature (dev/app-dev now, prod with #83).

## Open questions

1. **Session cache location** — ✅ *resolved in review:* `~/.portalai/credentials` (0600) file cache — scriptable/agent-friendly, matches vendor-CLI norms (aws/gh); OS keychain remains a hardening follow-up.
2. **Admin authorization semantics on the API** — the device-flow token is a normal Auth0 user token; what marks it *admin* (an Auth0 role/permission claim the API checks, or an allowlist)? **Lean: an Auth0 role → RBAC permission claim** validated by the admin routes; needs a small API-side check that doesn't exist yet (lands with #190's admin endpoints).
3. **Registry ↔ CI drift** — CI's deploy workflow hardcodes the same URLs the registry declares. **Lean: accept for now; follow-up to make CI consume the registry** (single source of truth).
4. **Auth0 tenant strategy** — the survey suggests separate registrations (possibly tenants) per env. One CLI app per env mirrors that. **Lean: per-env CLI apps; confirm against the actual Auth0 tenant layout when creating them.**

## Enterprise-scale considerations

The **security-critical access foundation** — the lens engages hard:

- **Multi-tenancy / isolation** — *engaged.* Per-env isolation is the point: dev creds must never reach prod. AWS IAM scopes which env's `portalai/${ENV}/*` an operator reads; Auth0 per-env apps keep API tokens env-scoped; prod is a separate IAM grant + a distinct Auth0 app.
- **Failure modes** — *fail-closed.* No implicit prod default; active env echoed on every command; prod requires its barrier flag; lost/expired credentials fail closed (can't resolve secrets / token refresh fails → re-login).
- **Accuracy & auditability** — *engaged.* Every authorized session and mutating command logs operator identity + env; the device-flow session means agent-driven actions still attribute to the human who authorized. Feeds #179's audit direction.
- **Contract stability** — *engaged.* `resolveEnvConnection` is the seam all CLIs (and a future public CLI) bind to; path-agnostic + typed errors so tunnel-implementation swaps and API-surface growth don't ripple.
- **Concurrency & correctness** — *engaged.* Tunnel = per-invocation subprocess with explicit lifecycle; token refresh must be safe under concurrent CLI invocations (file lock or atomic write on the session cache).
- **Scale & unbounded growth** — *Lean:* adding environments is a registry entry + IAM/Auth0 provisioning — O(1) code change; no per-env code paths.
- **Data lifecycle** — *engaged (lightly):* cached sessions have bounded lifetime (refresh-token expiry per Auth0 app settings); `logout` clears; no other retention surface.

## What this doesn't decide

- **The DevOps CLI's command surface** — #192 (secrets/ECS/param CRUD); #194 provides env/connection primitives, not commands.
- **The App-admin CLI's domain commands + admin API endpoints** — #190; it consumes `resolveEnvConnection` and defines the admin RBAC check (OQ2 lands there).
- **Prod provisioning itself** (bastion, secrets, Auth0 prod app) — #83; this layer treats prod as first-class the moment those exist.

## Next step

Write `docs/CLI_DEPLOYED_ENV_ACCESS.spec.md` (the `@portalai/cli-env` contract: registry type + entries, both authorization paths incl. the device-flow session lifecycle, `resolveEnvConnection` + typed errors, agent-operability requirements, guardrails) and `docs/CLI_DEPLOYED_ENV_ACCESS.plan.md`. Likely slices: (1) package scaffold + registry + non-secret resolution; (2) AWS-IAM secret/SSM resolution; (3) the tunnel-backed `db()` connector; (4) Auth0 device-flow `login`/`logout`/`token()` + session cache; (5) guardrails (env echo, prod barrier, audit) + `--json`/typed-error surface. Sequencing is plan-level; the spec covers the whole contract.
