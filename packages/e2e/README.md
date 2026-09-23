# @portalai/e2e

Playwright browser harness for **agent-guided UI smoke walks** against the local dev stack (#304). It exists so an in-container Claude session can open the running app, log in as a dedicated test user, navigate, screenshot, and read console/network output — walking a `.smoke.md` checklist and producing reviewable evidence instead of reasoning about the UI from source.

> **Scope.** This package is the *harness*. Automated `*.spec.ts` and the ephemeral CI runner are deferred to a follow-up ticket (prod / app-dev login verification). `test:unit` / `test:integration` are deliberately no-ops here, and `src/specs/` is empty for now.

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
| `E2E_BASE_URL` | the running web app | `http://localhost:3000` |

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
#   writes .auth/storageState.json (owner) + .auth/{admin,member}.storageState.json

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
- **Boot as a role:** `npm run --workspace @portalai/e2e e2e:use admin` copies `.auth/admin.storageState.json` over the active `.auth/storageState.json`, then **restart the MCP session** so it loads the new state.

## The guarded dev login affordance

`e2e:auth` relies on a **dev/test-only** sign-in path (`apps/web`): visiting `/?e2e=1` in a **dev build** reveals a "Dev sign-in (E2E)" button that calls `loginWithRedirect` without pinning the Google connection, so Auth0 shows Universal Login. It is guarded twice — `import.meta.env.DEV` (stripped from production bundles) **and** the `?e2e` query param — so it never appears for normal users or in production.

## Agent browser session & smoke walks

Once the one-time setup above is done, an in-container Claude session drives the browser through the **Playwright MCP** server registered in the repo-root `.mcp.json` (`mcp__playwright__*` tools — navigate, click, type, screenshot, read console/network). It runs `--headless --isolated`, seeded from `.auth/storageState.json`, so every session starts from the reused authed state. Artifacts land under `packages/e2e/test-results/` (git-ignored).

Two ways to use it:

- **Ad-hoc troubleshooting** — ask the session to open a view, reproduce a reported bug, inspect a broken render, or confirm a fix in the real app.
- **Smoke walks** — `/smoke-walk <issue-number>` reads the ticket's `docs/<SLUG>.smoke.md`, walks each automatable step in the browser, and writes a per-step **evidence report** (`verified` / `mismatch` / `could-not-automate`, with screenshots and observed values). It **never checks a box or merges** — you review the evidence and confirm the checklist.

The `mcp__playwright__*` tools load at session start, so a session must be (re)started after `.mcp.json` changes. Browsers come from the devcontainer image (`PLAYWRIGHT_BROWSERS_PATH`); a freshly built image already has them — no `npx playwright install` in a running container.
