# @portalai/e2e

Playwright browser harness for **agent-guided UI smoke walks** against the local dev stack (#304). It exists so an in-container Claude session can open the running app, log in as a dedicated test user, navigate, screenshot, and read console/network output — walking a `.smoke.md` checklist and producing reviewable evidence instead of reasoning about the UI from source.

> **Scope.** This package is the *harness*. Automated `*.spec.ts` and the ephemeral CI runner are deferred to a follow-up ticket (prod / app-dev login verification). `test:unit` / `test:integration` are deliberately no-ops here, and `src/specs/` is empty for now.

## One-time operator prerequisites (not code)

1. **A dev Auth0 tenant with a Database (username/password) connection.** The app's normal login is Google-only; the harness authenticates through a guarded dev affordance that shows Auth0 Universal Login, so it needs a Database connection enabled on the SPA app in the **local/dev** tenant.
2. **A dedicated test user** in that Database connection, with **MFA disabled** for it. This is the automated user — keep it out of any real org until the seed step links it.

## Environment

Put these in `packages/e2e/.env` (git-ignored — copy `.env.example`) so they load on every run, or export them in your dev shell; a shell export **overrides** the `.env` value. **Never commit the real values.**

| Var | Purpose | Default |
|---|---|---|
| `E2E_AUTH0_USERNAME` | the Database-connection test user's email | — (required) |
| `E2E_AUTH0_PASSWORD` | its password | — (required) |
| `E2E_BASE_URL` | the running web app | `http://localhost:3000` |

```bash
cp packages/e2e/.env.example packages/e2e/.env   # then fill in the real values
```

## Setup — run in this order

The order is load-bearing: `db:seed:org --member-email` **requires the user to already exist** (`ApplicationService.seedOrganization` throws `User <email> not found` otherwise), and the user row is created on first login.

```bash
# 0. Dev stack running in another shell
npm run dev

# 1. Capture the reusable session (creates the user row on first login)
#    → drives /?e2e=1 → "Dev sign-in (E2E)" → Auth0 Universal Login → storageState
npm run --workspace @portalai/e2e e2e:auth      # writes packages/e2e/.auth/storageState.json (git-ignored)

# 2. Seed the deterministic fixture org and link the test user as a member
npm run --workspace @portalai/e2e e2e:seed      # db:seed:org --name e2e-fixture --member-email $E2E_AUTH0_USERNAME
```

`e2e:auth` is idempotent — re-run it any time the session expires; it overwrites `storageState.json`. `e2e:seed` is idempotent-by-name — re-running against an existing `e2e-fixture` org is a no-op. The captured user starts in its own default org (`lastLogin: 0` on the seeded membership keeps the fixture org from hijacking the current-org selector); switch into `e2e-fixture` in-app or via `portalai member switch` when a walk needs it.

## The guarded dev login affordance

`e2e:auth` relies on a **dev/test-only** sign-in path (`apps/web`): visiting `/?e2e=1` in a **dev build** reveals a "Dev sign-in (E2E)" button that calls `loginWithRedirect` without pinning the Google connection, so Auth0 shows Universal Login. It is guarded twice — `import.meta.env.DEV` (stripped from production bundles) **and** the `?e2e` query param — so it never appears for normal users or in production.

## Agent browser session & smoke walks

Once the one-time setup above is done, an in-container Claude session drives the browser through the **Playwright MCP** server registered in the repo-root `.mcp.json` (`mcp__playwright__*` tools — navigate, click, type, screenshot, read console/network). It runs `--headless --isolated`, seeded from `.auth/storageState.json`, so every session starts from the reused authed state. Artifacts land under `packages/e2e/test-results/` (git-ignored).

Two ways to use it:

- **Ad-hoc troubleshooting** — ask the session to open a view, reproduce a reported bug, inspect a broken render, or confirm a fix in the real app.
- **Smoke walks** — `/smoke-walk <issue-number>` reads the ticket's `docs/<SLUG>.smoke.md`, walks each automatable step in the browser, and writes a per-step **evidence report** (`verified` / `mismatch` / `could-not-automate`, with screenshots and observed values). It **never checks a box or merges** — you review the evidence and confirm the checklist.

The `mcp__playwright__*` tools load at session start, so a session must be (re)started after `.mcp.json` changes. Browsers come from the devcontainer image (`PLAYWRIGHT_BROWSERS_PATH`); a freshly built image already has them — no `npx playwright install` in a running container.
