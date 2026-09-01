# Agent-guided browser sessions (Playwright harness) — Spec

**Issue:** [EnterpriseBT/portal-ai#304](https://github.com/EnterpriseBT/portal-ai/issues/304) · **Discovery:** `docs/AGENT_BROWSER_SESSIONS.discovery.md`

Pins the contract for a new `packages/e2e` Playwright harness, the devcontainer browser bake, the Playwright-MCP wiring that lets an in-container Claude session drive the running dev stack, the dedicated Auth0 test user + reusable `storageState`, the deterministic seed fixture, a new `/smoke-walk` skill that produces a reviewable evidence report, and the smoke-gate convention rewrite. **Automated `*.spec.ts` and the ephemeral CI workflow are out of scope** (deferred to a follow-up prod/app-dev login-verification ticket).

## Key decisions (flag for review — all ratified in discovery)

1. **D1 — Playwright MCP** (`@playwright/mcp`, stdio, `.mcp.json`) is the agent's browser tool; `claude-in-chrome` is architecturally excluded (no desktop Chrome in a headless devcontainer).
2. **D2 — `packages/e2e`** new workspace (not `apps/web/e2e`) so Playwright stays out of web's lint/tsc/build hashes.
3. **D3 (revised at implementation) — one-time Universal-Login → `storageState`, reached through a guarded dev-only login affordance.** The app's normal login is **Google-OAuth-only** (`auth.api.ts` pins `connection: "google-oauth2"`), which a headless test user can't drive, and auth0-spa-js won't complete a hand-rolled authorize URL. So a small, **twice-guarded** affordance (`import.meta.env.DEV` **and** `?e2e`) triggers `loginWithRedirect` with no pinned connection, showing Universal Login for a **Database-connection** test user (MFA off) in the **local/dev tenant**. auth0-spa-js still owns the localStorage cache shape (nothing hand-assembled). *This supersedes the discovery's "no app-source change" assumption — user-ratified fork, see the revised Files touched.*
4. **D4 — bake browsers into the image** at a fixed `PLAYWRIGHT_BROWSERS_PATH` (survives; `~/.cache` is not a persisted mount).
5. **D5 — reuse `db:seed:org`** for the fixture org; no bespoke seeding.
6. **D6 — new `/smoke-walk` skill** (leave `/smoke` as scaffolder); the agent produces an evidence report and **never checks a box** — the human accepts/denies the evidence and owns the merge confirmation (OQ#1, user-confirmed).

## Scope

### In scope
1. `packages/e2e` workspace: `package.json`, `playwright.config.ts`, `tsconfig`, ESLint/Prettier per repo globs, `.gitignore` for `.auth/` + `test-results/`, `README.md`.
2. Dockerfile: `PLAYWRIGHT_BROWSERS_PATH` + `playwright install --with-deps chromium` baked as an image layer.
3. Auth fixture: `e2e:auth` script driving one Universal-Login → `packages/e2e/.auth/storageState.json`.
4. Seed wrapper: `e2e:seed` → `db:seed:org --name e2e-fixture --member-email $E2E_AUTH0_USERNAME`.
5. `.mcp.json` registering `@playwright/mcp` + `.claude/settings.local.json` allowlist entries.
6. `/smoke-walk` skill + its evidence-report format.
7. Convention rewrite: `CLAUDE.md` ("The smoke gate" + workflow table), `.claude/skills/smoke/SKILL.md`, `.github/copilot-instructions.md`, `/smoke` skill split, README coverage.
8. `docs/AGENT_BROWSER_SESSIONS.smoke.md` — the proving walk (doubles as this ticket's own smoke gate).

### Out of scope
- Automated `*.spec.ts` assertion specs and the `test:e2e` CI runner (packages/e2e ships `test:unit`/`test:integration` as no-ops now).
- Ephemeral CI workflow, failure-artifact upload, unattended CI auth, required-check promotion.
- **Browser-container topology** — the follow-up (CI tier) should decide whether the browser runs as its **own service** (official `mcr.microsoft.com/playwright:v<ver>` image, browsers + deps preinstalled + version-matched, connected via `--cdp-endpoint`) instead of baked into the single `dev` image. Keeps browser bytes out of the base image; trades cross-container networking (`E2E_BASE_URL=http://dev:3000`), an extra Auth0 Allowed-Callback-URL + a `storageState` **origin mismatch** with a human's `localhost` session, and MCP-over-CDP/SSE instead of stdio-local; **no CPU saving** (a headless browser costs the same wherever it runs). CI already runs services separately, so that tier is where the split pays off; local dev can adopt a compose **`profile`-gated** sibling service if `dev`-image bloat bites first. (See discovery → "What this doesn't decide".)
- Visual-regression/screenshot-diff; broad flow coverage; retiring the 33 `.smoke.md` docs.

## Surface

### `packages/e2e/package.json` (new) — mirrors `packages/admin-cli/package.json:21-33`

```jsonc
{
  "name": "@portalai/e2e",
  "version": "0.0.0",
  "type": "module",
  "private": true,
  "scripts": {
    "lint": "eslint src --ext .ts --report-unused-disable-directives --max-warnings 0",
    "lint:fix": "eslint src --ext .ts --fix",
    "format": "prettier --write \"src/**/*.{ts,json}\"",
    "format:check": "prettier --check \"src/**/*.{ts,json}\"",
    "type-check": "tsc --noEmit",
    "test:unit": "true",              // no-op until specs land (deferred)
    "test:integration": "true",       // no-op until specs land (deferred)
    "e2e:seed": "npm --workspace @portalai/api run db:seed:org -- --name e2e-fixture --member-email \"$E2E_AUTH0_USERNAME\"",
    "e2e:auth": "tsx src/setup/auth.setup.ts"
  },
  "devDependencies": { "@playwright/test": "<PINNED>", "tsx": "*", /* eslint/prettier/ts inherited */ }
}
```

`test:unit`/`test:integration` are `"true"` (the admin-cli precedent) so `turbo run test:unit`/`test:integration` stay green without running Playwright in CI. **`@playwright/test` version is `<PINNED>` and must equal the version the Dockerfile installs** (drift = different browser build than the package expects; same lockstep rationale as the turbo symlink comment).

### `packages/e2e/playwright.config.ts` (new)

```ts
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./src/specs",                       // empty for now — specs deferred
  outputDir: "./test-results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    storageState: "./.auth/storageState.json",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    headless: true,
  },
});
```

### App dev-login affordance (revised — `apps/web`)

Because the app is Google-only (D3), the fixture needs a non-Google entry:

- **`apps/web/src/api/auth.api.ts`** — add `login().withUniversal()`: `loginWithRedirect` with **no** `connection` (Auth0 shows Universal Login).
- **`apps/web/src/components/LoginForm.component.tsx`** — `LoginFormUIProps` gains optional `onClickDevLogin?`; when present the pure UI renders a `data-testid="e2e-dev-login"` button. The `LoginForm` container passes it **only** under `import.meta.env.DEV && new URLSearchParams(location.search).has("e2e")`, so it is absent for normal users and stripped from production bundles. Respects the Component File Policy (pure UI prop-driven; container owns the guard).

### `packages/e2e/src/setup/auth.setup.ts` (new) — the auth fixture

Standalone runnable (not a Playwright "project dependency" yet — specs are deferred). Launches Chromium, navigates `/?e2e=1`, clicks the dev affordance, drives Auth0 Universal Login **once**, persists the SPA session:

```ts
// Reads env: E2E_BASE_URL (default http://localhost:3000), E2E_AUTH0_USERNAME, E2E_AUTH0_PASSWORD.
// 1. chromium.launch(); newContext(); goto(baseURL)
// 2. click the app's Login CTA → redirected to Universal Login
// 3. fill username/password (env), submit
// 4. wait for the post-login dashboard route (a stable authed selector)
// 5. context.storageState({ path: ".auth/storageState.json" })
// Fails loudly (nonzero exit + message) if any step times out — never writes a partial state.
```

- **storageState = localStorage capture** works because `apps/web` runs Auth0 with `cacheLocation="localstorage"` + refresh tokens (`Application.provider.tsx:41-50`). No SPA-cache shape is hand-built.
- Credentials come from env only; **never committed**. `.auth/` is git-ignored.
- MFA must be **disabled for the `e2e@` user in the dev tenant** (operator step; not code in this PR).

### `Dockerfile` — browser bake (insert after the Claude CLI block `:67-68`, before the symlink block `:86`)

```dockerfile
# Playwright Chromium + its apt libraries, baked into an image layer. Browsers
# default to ~/.cache/ms-playwright, which is on no persisted mount (only
# ~/.claude is bind-mounted), so pin the path to somewhere the image keeps.
# The version here MUST match packages/e2e's @playwright/test (browser build
# drift otherwise). node_modules isn't present at build time, so install via a
# pinned npx.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
RUN npx --yes playwright@<PINNED> install --with-deps chromium
```

### `.mcp.json` (new, repo root) — project-scoped, auto-loaded by the in-container Claude CLI

```jsonc
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": [
        "--yes", "@playwright/mcp@<PINNED>",
        "--browser", "chromium",
        "--headless",
        "--storage-state", "packages/e2e/.auth/storageState.json",
        "--output-dir", "packages/e2e/test-results/mcp"
      ]
    }
  }
}
```

Exposes `browser_navigate` / `browser_click` / `browser_type` / `browser_take_screenshot` / `browser_console_messages` / `browser_network_requests` (and siblings) as `mcp__playwright__*` tools. **Exact flag names (`--storage-state`, `--output-dir`) are confirmed against `npx @playwright/mcp@<PINNED> --help` at implementation** — the *contract* pinned here is: Chromium, headless, reuses the same storageState the auth fixture writes, artifacts under `test-results/`.

### `.claude/settings.local.json` — add to `permissions.allow`

```jsonc
"mcp__playwright",                 // the agent's browser tools (whole server)
"Bash(npm run e2e:seed:*)",
"Bash(npm run e2e:auth:*)"
```

`mcp__playwright` (server-wide) is a read-ish, local-only browser against a dev stack — safe to allowlist; it drives no prod surface.

### `/smoke-walk` skill (new) — `.claude/skills/smoke-walk/SKILL.md`

**Invocation:** `/smoke-walk <issue-number|path-to-smoke-doc>`. **Consumes** `docs/<SLUG>.smoke.md`. **Produces** an evidence report (stdout + `packages/e2e/test-results/smoke-walk-<SLUG>.md`) — it **does not edit the `.smoke.md` or check any box**.

Flow: (1) **Preflight** — baseURL reachable (else "app not reachable at :3000, run `npm run dev`"), `.auth/storageState.json` present (else "run `npm run e2e:auth`"), fixture seeded (else "run `npm run e2e:seed`"). (2) **Per checkbox step** — drive it via `mcp__playwright__*`, capture a screenshot, record the observed value. (3) **Classify each step**: `verified` / `mismatch (expected X, got Y)` / `could-not-automate: <reason>` (third-party redirect, payment, real vendor account, visual judgment). Evidence-report format:

```markdown
# Smoke walk — <SLUG> (#<N>)  ·  agent evidence, NOT a merge confirmation
Preflight: stack ✓ · storageState ✓ · fixture ✓
## §1 — <section>
- [step text] → **verified** · screenshot: test-results/…/s1.png · observed: <value>
- [step text] → **could-not-automate: Stripe redirect** · (human must walk)
...
## Summary: N verified · M could-not-automate · K mismatch
```

**Hard rule (preserves the gate):** the agent reports evidence; the **human** reviews it and checks the `.smoke.md` boxes. A `mismatch` is surfaced, never silently passed; a step the agent could not observe is `could-not-automate`, never `verified`.

### `/smoke` skill split — `.claude/skills/smoke/SKILL.md`

- Step 2/4: when scaffolding, **classify each acceptance criterion** as *agent-walkable* or *manual-only* (third-party redirect, payment, visual judgment, real vendor account). Manual-only steps carry a `— manual` tag; the rest are eligible for `/smoke-walk`.
- Rewrite the two hard rules (`:84-85`): manual-only steps stay a human walk; agent-walkable steps get an evidence walk via `/smoke-walk`, **but the human still checks every box** — accepting or denying the agent's evidence is the confirmation. The agent still never checks a box and never merges.
- Rule `:96` ("nothing here executes the app") applies to `/smoke` the scaffolder; add a pointer that `/smoke-walk` is the execution verb.

### Convention rewrite — exact targets

- **`CLAUDE.md:657`** ("The smoke gate" body) → merges still require green CI **and** human confirmation of the checklist; add that **automatable steps are walked by the agent via `/smoke-walk`, which produces a per-step evidence report (screenshots + observed values) the human reviews and accepts/denies**, while non-automatable steps remain a human walk. The agent never checks a box or merges. `.smoke.md` narrows to the non-automatable remainder + records which steps were agent-walked.
- **`CLAUDE.md:555`** (workflow table row 5) → "…checklist mapped from acceptance criteria; automatable steps agent-walked with evidence via `/smoke-walk`, the rest manual."
- **`.github/copilot-instructions.md:97`** → mirror the same one-line gate change.
- Add a short **"Agent-guided browser sessions"** note (CLAUDE.md near the smoke gate + `packages/e2e/README.md` + `apps/web/README.md`) documenting: `npm run e2e:seed` → `npm run e2e:auth` → drive via `mcp__playwright__*` / `/smoke-walk`.

## Migration
None — no DB schema change. The fixture org is created by the existing `db:seed:org` path (`apps/api/src/db/seed-org.ts`), not a new migration.

## Seed
No new seed *code*. `e2e:seed` invokes `db:seed:org --name e2e-fixture --member-email $E2E_AUTH0_USERNAME` (idempotent-by-name; provisions org + synthetic owner + sandbox connector + default station, and links the test user as a member). **Sequencing confirmed at implementation:** `ApplicationService.seedOrganization` **requires the member user to already exist** (`findByEmail` → throws `User <email> not found` at `application.service.ts:184-186`), so **`e2e:auth` must run before `e2e:seed`** — the first login auto-provisions the user row. Documented in `packages/e2e/README.md`.

## TDD test plan

**There is no new jest surface, by design** — automated specs are Out of scope (deferred). Verification is three non-jest gates, all script-invoked:

1. **Static Checks** (the existing PR gate) now covers `packages/e2e`: `npm run lint`, `npm run type-check`, `npm run build` stay green with the new package; `turbo run test:unit`/`test:integration` no-op cleanly (`"true"` scripts).
2. **Config + wiring load-checks** (documented commands, run once locally): `npx playwright test --list` (from `packages/e2e`) resolves `playwright.config.ts` without error; `.mcp.json` and `.claude/settings.local.json` are valid JSON; `npx @portalai... ` n/a. These are mechanical, not asserted in CI.
3. **The proving walk = `docs/AGENT_BROWSER_SESSIONS.smoke.md`** (this ticket's smoke gate), which exercises the whole harness end-to-end: seed → auth → an agent `/smoke-walk` that navigates, screenshots, reads console/network, and reports evidence. This is the deliberate substitute for automated specs this cycle.

**Totals ≈ 0 jest cases; 1 harness proving-walk** (the smoke doc). Stated explicitly per the spec rule: no unit/integration tests are warranted for config + a markdown skill + convention edits, and inventing them would test nothing real.

## Acceptance criteria

- [ ] `npm run build && npm run lint && npm run type-check` pass at repo root with `packages/e2e` present; `turbo run test:unit`/`test:integration` stay green.
- [ ] A clean devcontainer build has Chromium present (`PLAYWRIGHT_BROWSERS_PATH` populated) with **no** manual `npx playwright install` step.
- [ ] `npm run e2e:seed` provisions the deterministic `e2e-fixture` org (idempotent across reruns) via `db:seed:org`.
- [ ] `npm run e2e:auth` drives Universal Login once and writes `packages/e2e/.auth/storageState.json`; the file is git-ignored and credentials come only from `E2E_AUTH0_*` env.
- [ ] From a single documented flow, an in-container Claude session opens the app (authed via the reused storageState), navigates to an arbitrary view, and reports back screenshots + console/network output via `mcp__playwright__*`.
- [ ] `/smoke-walk <N>` walks a `.smoke.md` end to end and emits an evidence report distinguishing `verified` from `could-not-automate`; it never edits the `.smoke.md` or checks a box.
- [ ] A session against a **down stack** fails loudly ("app not reachable at :3000"), never reports a step verified it could not observe.
- [ ] `CLAUDE.md`, `.github/copilot-instructions.md`, and the `/smoke` skill describe the new gate — no surface still says the human walks *every* step; the human confirmation (accept/deny the evidence) remains the merge gate.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| No MFA-off `e2e@` user / dev tenant to log into. | Operator prerequisite, called out in `packages/e2e/README.md`; blocks `e2e:auth` loudly. If no such tenant exists, the fallback (password-grant, discovery D3B) is a documented follow-up — not silently substituted. |
| `@playwright/mcp` flag names differ by version. | The *contract* (chromium/headless/shared storageState/artifacts dir) is pinned; exact flags confirmed against `--help` at implementation. `<PINNED>` version fixes the surface. |
| Browser build drifts from the package version. | Dockerfile `playwright@<PINNED>` == `packages/e2e` `@playwright/test` `<PINNED>`; enforced by the in-file lockstep comment (mirrors the turbo-symlink convention). |
| storageState expires (refresh token/session lapses). | `/smoke-walk` preflight detects an unauthed landing and instructs `npm run e2e:auth` to refresh; storageState is disposable. |
| Member-link ordering (user must exist before membership). | Documented order (auth → seed, or seed re-run post-login); behavior confirmed at implementation. |
| Image size grows (~Chromium + apt libs). | Chromium-only (not the full browser matrix); the matrix widens only when specs land. |
| Convention rewrite weakens the gate. | Human confirmation stays the merge gate; the agent produces evidence and is still forbidden to check a box or merge — the rewrite adds an evidence step, it does not remove human sign-off. |

**Rollback:** delete `packages/e2e`, `.mcp.json`, the Dockerfile browser block, the `/smoke-walk` skill, and `git revert` the convention edits. No schema, no data, no infra state — fully reversible.

## Files touched

**New:** `packages/e2e/{package.json,playwright.config.ts,tsconfig.json,.eslintrc*,.gitignore,README.md}`, `packages/e2e/src/setup/auth.setup.ts`, `.mcp.json`, `.claude/skills/smoke-walk/SKILL.md`, `docs/AGENT_BROWSER_SESSIONS.smoke.md`.
**Edit:** `Dockerfile`, `.claude/settings.local.json`, `.claude/skills/smoke/SKILL.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, root `README.md` and/or `apps/web/README.md`, and — for the dev-login affordance (revised D3) — `apps/web/src/api/auth.api.ts` + `apps/web/src/components/LoginForm.component.tsx`. (`package-lock.json` updates for the new workspace + Playwright dep.)
**No change:** `turbo.json` (new package inherits the pipeline; no per-task override needed), DB schema, seed *code*. (App source changes are limited to the twice-guarded dev-login affordance above — a revision from the original "no app change", forced by the Google-only login.)

## Next step

`docs/AGENT_BROWSER_SESSIONS.plan.md` — TDD-ish slices (each a self-contained, locally-confirmable commit): (1) `packages/e2e` scaffold + Playwright config + Dockerfile browser bake (Static Checks green, `--list` resolves); (2) `e2e:seed` wrapper + `e2e:auth` fixture → storageState (login produces state against the dev tenant); (3) `.mcp.json` + allowlist so the agent drives the browser (navigate/screenshot/console proven interactively); (4) `/smoke-walk` skill + evidence-report format; (5) convention rewrite across `CLAUDE.md`/`smoke` skill/copilot-instructions + READMEs; (6) `docs/AGENT_BROWSER_SESSIONS.smoke.md` proving walk. Verification is per-slice manual/agent against the local stack, not jest — the honest shape for a harness-enablement ticket.
