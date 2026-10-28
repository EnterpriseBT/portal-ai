# @portalai/e2e

Playwright browser verification for Portals AI, in three tiers:

- **Agent-guided sessions** (#304). An in-container Claude session opens the app, signs in as a dedicated test user, navigates, screenshots, and reads console and network output. It walks a `.smoke.md` checklist or reproduces a bug with reviewable evidence, instead of reasoning about the UI from source. This works against the local dev stack, and against app-dev and prod as a QA identity (#489).
- **The PR walk** (#489). `E2E Tests` (`.github/workflows/e2e-test.yml`, not a required check) boots an ephemeral stack and runs the specs under `src/specs/` on a freshly provisioned org: login, the core loop (CSV import → records → station → portal), and the owner / admin / member split.
- **The post-deploy login check** (#489). `verify-login`, the last job of `deploy-dev.yml` / `deploy-prod.yml`, signs in to the environment just deployed as its QA owner, and turns the run red if that fails.

`test:unit` covers the library (targets, sign-in, the Anthropic stub, configs and guards). `test:e2e` runs the browser specs.

## One-time operator prerequisites (not code)

1. **A dev Auth0 tenant with a Database (username/password) connection.** The app's normal login is Google-only; the harness authenticates through a guarded dev affordance that shows Auth0 Universal Login, so it needs a Database connection enabled on the SPA app in the **local/dev** tenant.
2. **A dedicated test user per role** in that Database connection, with **MFA disabled** for each. One is the org owner (`E2E_AUTH0_USERNAME`); for multi-role smoke walks (#620) add an admin and a member user (`E2E_AUTH0_USERNAME_ADMIN` / `_MEMBER`). Keep them out of any real org until the seed step links them.

## Environment

Put these in `packages/e2e/.env` (git-ignored — copy `.env.example`) so they load on every run, or export them in your dev shell; a shell export **overrides** the `.env` value. **Never commit the real values.**

| Var | Purpose | Default |
|---|---|---|
| `E2E_AUTH0_USERNAME` | the owner identity's email (Database-connection user) | — (required) |
| `E2E_AUTH0_PASSWORD` | its password | — (required) |
| `E2E_AUTH0_USERNAME_ADMIN` / `_PASSWORD_ADMIN` | the admin identity (#620) | — (multi-role only) |
| `E2E_AUTH0_USERNAME_MEMBER` / `_PASSWORD_MEMBER` | the member identity (#620) | — (multi-role only) |
| `E2E_BASE_URL` | the running web app (local target only) | `http://localhost:3000` |
| `E2E_TARGET` | `local` · `app-dev` · `prod` | `local` |
| `E2E_SIGN_IN_VIA` | `dev` (`/?e2e=1`) · `qa` (`/login?qa=1`); deployed targets are always `qa` | `dev` locally |
| `E2E_IDENTITY` | the identity `e2e:auth` and the `login` spec sign in as | the owner |
| `E2E_QA_CONNECTION` | the Auth0 Database connection the QA sign-in pins (`e2e-stack.sh up` requires it) | — |
| `E2E_ANTHROPIC_STUB_PORT` | port for the Anthropic stub the CI stack runs | `4010` |
| `E2E_ORG_ID` | pins a local session to this org (ignored on deployed targets, which use their QA org) | — |

For an arbitrary identity `<X>`, `e2e:auth --identity <X>` reads `E2E_AUTH0_USERNAME_<X>` / `E2E_AUTH0_PASSWORD_<X>` (uppercased) and writes `.auth/<x>.storageState.json`.

```bash
cp packages/e2e/.env.example packages/e2e/.env   # then fill in the real values
```

## Setup — run in this order

The order is load-bearing: `db:seed:org` **requires each named user to already exist** (`ApplicationService.seedOrganization` throws `User <email> not found` otherwise), and a user row is created on first login. So every identity must run `e2e:auth` **before** `e2e:seed`.

```bash
# 0. Dev stack running in another shell
npm run dev

# 1. Capture a reusable session per identity (each creates its user row on first
#    login) → drives /?e2e=1 → "Dev sign-in (E2E)" → Auth0 Universal Login
npm run --workspace @portalai/e2e e2e:auth:all  # owner + admin + member
#   or individually: e2e:auth  ·  e2e:auth:admin  ·  e2e:auth:member
#   writes .auth/{owner,admin,member}.storageState.json; the owner's is also
#   copied to .auth/storageState.json, the one the MCP server loads

# 2. Seed the deterministic fixture org with all three roles
npm run --workspace @portalai/e2e e2e:seed
#   db:seed:org --name e2e-fixture --owner-email $E2E_AUTH0_USERNAME \
#     --admin-email $E2E_AUTH0_USERNAME_ADMIN --member-email $E2E_AUTH0_USERNAME_MEMBER \
#     --all-toolpacks
```

`e2e:auth*` is idempotent — re-run any identity when its session expires; it overwrites that identity's `storageState`. `e2e:seed` is idempotent-by-name and **convergent**: re-running against an existing `e2e-fixture` org re-applies the admin/member role memberships (owner is fixed at creation). The seeded admin/member memberships use `lastLogin: 0` so they never hijack each user's current-org selector; switch into `e2e-fixture` in-app or via `portalai member switch` when a walk needs it.

`--all-toolpacks` (#629) enables **every** built-in toolpack on the fixture's station, not the minimal `data_query`-only default a new station gets — so an agent-guided smoke walk can exercise any pack's features (rbac_management, entity_management, gis, …). It is a fixture concern; production org provisioning keeps its minimal default. Re-run `e2e:seed` after a new built-in pack lands to enable it on an existing fixture (the enablement reconciles, so it's a safe no-op otherwise).

### Switching the MCP identity

The Playwright MCP loads **one** `storageState` at session start (`.auth/storageState.json`, per `.mcp.json`). Two ways to walk as a different role:

- **Within a live session (no restart):** log out in the browser, then re-run the dev sign-in (`/?e2e=1` → Dev sign-in) and enter another identity's Auth0 credentials. The dev-login button is identity-agnostic — Auth0 decides who signs in.
- **Boot as a role:** `npm run --workspace @portalai/e2e e2e:use admin` copies `.auth/admin.storageState.json` over the active `.auth/storageState.json`, then **restart the MCP session** so it loads the new state. `e2e:use owner` switches back.

## Specs and `test:e2e`

The specs run against an **ephemeral stack** that `scripts/e2e-stack.sh` boots, never against your dev stack.
- **Services:** compose `postgres-test` (a fresh `portal_ai_e2e` database), Redis db 5 and `s3mock`.
- **Apps:** an Anthropic stub on `:4010` and the API on `:3001`, plus a production web build served by `vite preview` on `:3000`.
- **No live LLM:** the interpret step's model calls go to the stub.
- **Logs:** under `test-results/stack/`.

```bash
# Stop `npm run dev` first: the stack uses :3000 and :3001.
E2E_QA_CONNECTION=Username-Password-Authentication \
  npm run --workspace @portalai/e2e e2e:stack:up
E2E_SIGN_IN_VIA=qa npm run --workspace @portalai/e2e test:e2e -- \
  --project=setup --project=core-loop --project=login --project=roles
npm run --workspace @portalai/e2e e2e:stack:down
```

| Project | What it proves | Retries |
|---|---|---|
| `setup` | signs the owner in once; the first login provisions the org | 0 |
| `login` | sign-in lands with `organization/current` 200, exactly one membership, the Dashboard; runs against any target. Deployed, that membership must be the QA org (`qa-org-id`); locally `E2E_ORG_ID` pins it optionally | 0 |
| `core-loop` | CSV upload → region → entity → interpret (stub) → commit → records → new station → open portal, with no console errors | 1 |
| `roles` | the owner invites an admin and a member; each joins through its invite link with exactly one membership; the member has no Members tab and gets a 403 inviting; the admin has Members but no Delete organization and gets a 403 deleting | 0 |

Notes:
- **One run per stack.** `roles` can't run twice on one stack, because an accepted invite can't be replayed. Run `e2e:stack:down` and `up` between runs.
- **Sign-in path.** `E2E_SIGN_IN_VIA=qa` is needed because the preview build has no dev affordance. The stack bakes `VITE_AUTH0_QA_CONNECTION` from `E2E_QA_CONNECTION`.
- **Failures.** Run locally, a failed spec leaves a trace, screenshots, video and the HTML report under `test-results/local/` and `playwright-report/`. In CI (where `CI` is set) there's no trace, no report and no page snapshot, because each would hold a typed password and this repo's artifacts are public. CI uploads only the stack logs, screenshots and video.
- **Authoring.** `npm run --workspace @portalai/e2e test:e2e:ui` opens the Playwright UI.

## Deployed environments (app-dev, prod)

Each deployed env has three QA users (owner, admin, member), and each one's only membership is that env's QA org. The membership is the boundary, and the API enforces it. Setup, verification, rotation and incidents: **`docs/E2E_DEPLOYED_QA.runbook.md`**. The Auth0 and secrets setup is scripted: `npm run --workspace @portalai/e2e e2e:qa:setup -- app-dev|prod`.

```bash
npm run --workspace @portalai/e2e e2e:auth:app-dev            # owner; also the active session
npm run --workspace @portalai/e2e e2e:auth:app-dev:member     # a role (first time: --invite '<link>')
npm run --workspace @portalai/e2e e2e:use -- member --env app-dev   # switch, then restart the MCP session
```

- **Credentials:** read from that env's Secrets Manager (`portalai/<env>/qa-auth0-*`) with your AWS credentials, or from `E2E_QA_AUTH0_USERNAME` / `_PASSWORD[_<ID>]` if exported. Never from the local `E2E_AUTH0_*` pair in `.env`, which is a different tenant's user. The QA org's id comes the same way (`qa-org-id`, or `E2E_QA_ORG_ID`).
- **Sessions:** land in `.auth/<env>/<identity>.storageState.json` (mode 0600), and `.auth/<env>/storageState.json` is the active one.
- **Browser servers:** `playwright-app-dev` and `playwright-prod` in `.mcp.json` load the active session. They run headless and in memory, write under `test-results/<env>/`, and allow only that env's app, API, Auth0 tenant, and the app's map and Google Picker hosts. `--allowed-origins` keeps a walk from wandering, but it isn't a boundary and doesn't cover redirects.
- **Traces:** a deployed target records no trace, no HTML report and no page snapshot, since each captures typed passwords. Its config also runs only the `login` project: the other specs create data, and only the ephemeral stack is theirs to write to.

### Conduct in a deployed environment

- **Only in the QA org**, as whichever QA identity the walk needs. Never change the QA identities' own roles or memberships.
- **A customer's bug is reproduced by recreating its conditions in the QA org**, never by entering a customer's org: the QA identities can't, and nothing here should try.
- **No billing checkout**, and no third-party account linking that would bill or email a real person.
- **Label created data** `qa-<yyyymmdd>-…`, and delete it when the walk is done.
- **On prod, read first.** Write only what the walk needs.

## The guarded dev login affordance

`e2e:auth` relies on a **dev/test-only** sign-in path (`apps/web`): visiting `/?e2e=1` in a **dev build** reveals a "Dev sign-in (E2E)" button that calls `loginWithRedirect` without pinning the Google connection, so Auth0 shows Universal Login. It is guarded twice — `import.meta.env.DEV` (stripped from production bundles) **and** the `?e2e` query param — so it never appears for normal users or in production.

## The QA sign-in

Deployed builds have no dev affordance, so the specs and deployed sessions use a second entry: `/login?qa=1` renders **QA sign-in** (`data-testid="e2e-qa-login"`), which calls `loginWithRedirect` pinned to the connection the build baked into `VITE_AUTH0_QA_CONNECTION`.
- **Where it renders:** only where a build sets that var (the S3 web builds of app-dev and prod, and the e2e stack), and only with `?qa`. It never renders under residency OIDC, and the chart image never sets the var.
- **The real guard is Auth0-side:** sign-ups are disabled on that connection, so only the users created in it can sign in.

## Agent browser session & smoke walks

Once the one-time setup above is done, an in-container Claude session drives the browser through the **Playwright MCP** server registered in the repo-root `.mcp.json` (`mcp__playwright__*` tools — navigate, click, type, screenshot, read console/network). It runs `--headless --isolated`, seeded from `.auth/storageState.json`, so every session starts from the reused authed state. Artifacts land under `packages/e2e/test-results/` (git-ignored).

Two ways to use it:

- **Ad-hoc troubleshooting** — ask the session to open a view, reproduce a reported bug, inspect a broken render, or confirm a fix in the real app.
- **Smoke walks** — `/smoke-walk <issue-number>` reads the ticket's `docs/<SLUG>.smoke.md`, walks each automatable step in the browser, and writes a per-step **evidence report** (`verified` / `mismatch` / `could-not-automate`, with screenshots and observed values). It **never checks a box or merges** — you review the evidence and confirm the checklist.

**An action stuck "pending" in a dev walk, while the network tab shows it succeeded, is probably React StrictMode, not the feature (#783).** StrictMode runs a mount effect twice; the second request joins the first's promise and the mutation hook's `isPending` never clears. Production never double-runs effects. Confirm by reading the request's response (`browser_network_request`), then check the component reads its `mutateAsync` promise rather than the hook's state (`effect-mutation.guard.test.ts` catches `mutate` and callback-carrying `mutateAsync` calls in an effect). Report it as a mismatch with that diagnosis; don't record a product failure.

The `mcp__playwright__*` tools load at session start, so a session must be (re)started after `.mcp.json` changes. Browsers come from the devcontainer image (`PLAYWRIGHT_BROWSERS_PATH`); a freshly built image already has them — no `npx playwright install` in a running container.
