# agent-browser-sessions — Smoke Suite

Smoke test for [#304](https://github.com/EnterpriseBT/portal-ai/issues/304) — the Playwright harness + agent-guided browser sessions: browsers baked into the devcontainer image, a reusable Auth0 session via a guarded dev-login affordance, a seeded fixture org, the Playwright MCP wiring, the `/smoke-walk` skill, and the smoke-gate convention rewrite. **Branch under test:** `feat/agent-browser-sessions` (draft PR for this branch).

Run **§Preflight** once. Sections are independent after it. Steps tagged **`— manual`** are for you to run (CLI commands, prod-build checks, doc reads); untagged steps under §3–§6 are browser/agent steps `/smoke-walk` (or an ad-hoc agent session) can drive for evidence.

> **This ticket's proving walk must run against a REBUILT devcontainer** — the browser bake (slice 1) only takes effect on an image rebuild, and it is one of the things this suite proves. Rebuild before starting.

Filing bugs: template at the bottom.

---

## Preflight

### Environment

- [ ] **Rebuild the devcontainer** (Dev Containers: Rebuild Container) so the `Dockerfile` browser bake applies — *this is under test, do not skip*. — manual
- [ ] `git checkout feat/agent-browser-sessions && git pull --ff-only` — manual
- [ ] `npm install` — no migration, no build step required (`packages/e2e` has no build). — manual
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`). — manual

### Prerequisites (one-time, operator)

- [ ] The **local/dev Auth0 tenant** has a **Database connection** with a dedicated test user, **MFA disabled** for it. — manual
- [ ] Export creds in the dev shell (never commit): `export E2E_AUTH0_USERNAME=…` and `export E2E_AUTH0_PASSWORD=…`. — manual

### Reset between runs

- [ ] Re-runnable: `e2e:auth` overwrites `storageState.json`; `e2e:seed` is idempotent-by-name. No reset needed. — manual

---

## §1 — Harness present & Static Checks (AC1, AC2)

- [ ] `npm run build && npm run lint && npm run type-check` pass at repo root with `packages/e2e` present. — manual
- [ ] `npx turbo run test:unit test:integration --filter=@portalai/e2e` is green (no-op `"true"` scripts). — manual
- [ ] Chromium is baked: `echo $PLAYWRIGHT_BROWSERS_PATH` prints `/opt/ms-playwright`, and `ls "$PLAYWRIGHT_BROWSERS_PATH"` shows a `chromium-*` dir — **without** any `npx playwright install` in the running container. — manual
- [ ] `cd packages/e2e && npx playwright test --list` resolves the config (reports `Total: 0 tests` by design — specs are deferred). — manual

## §2 — Fixtures: auth then seed (AC3, AC4)

- [ ] `npm run --workspace @portalai/e2e e2e:auth` completes and prints `storage state written to …/.auth/storageState.json`. (Internally: opens `/?e2e=1`, clicks **Dev sign-in (E2E)**, logs the test user in through Auth0 Universal Login.) — manual
- [ ] `packages/e2e/.auth/storageState.json` exists, is non-empty, and `git status` shows **nothing** under `.auth/` (git-ignored). — manual
- [ ] `npm run --workspace @portalai/e2e e2e:seed` provisions the org; `portalai org list --env local` shows **e2e-fixture**. Re-running is a no-op (same org). — manual
- [ ] Ordering holds: running `e2e:seed` **before** any `e2e:auth` (fresh DB, user absent) fails loudly with `User <email> not found` — proving the auth-before-seed requirement. — manual

## §3 — Dev-login affordance guard (revised D3)

- [ ] In the running dev app, navigate to `http://localhost:3000/?e2e=1` on the login screen → a **"Dev sign-in (E2E)"** button (`data-testid="e2e-dev-login"`) is present.
- [ ] Navigate to `http://localhost:3000/` (no `?e2e`) → the dev button is **absent**; only "Sign in with Google" shows.
- [ ] In a **production** build the affordance is gone entirely: `npm run build --workspace apps/web`, preview the built bundle, visit `/?e2e=1` → **no** dev button (guarded by `import.meta.env.DEV`). — manual

## §4 — Agent browser session (AC5)

*(Requires: rebuilt container, `npm run dev` up, `.auth/storageState.json` present, and the `mcp__playwright__*` tools loaded — restart the Claude session after `.mcp.json` first appears.)*

- [ ] Ask the in-container agent to open the app: it navigates to `http://localhost:3000` and lands **authenticated** (a dashboard/app view, **not** the login screen — storageState reused).
- [ ] The agent navigates to an arbitrary view (e.g. Settings) and returns a **screenshot** of it.
- [ ] The agent returns **console** output and **network** activity for that view (via `mcp__playwright__browser_console_messages` / `browser_network_requests`).

## §5 — `/smoke-walk` produces an evidence report (AC6)

- [ ] Run `/smoke-walk 304` (or against another `docs/*.smoke.md`). It writes `packages/e2e/test-results/smoke-walk-<SLUG>.md` and summarizes in-session.
- [ ] The report classifies each step `verified` / `mismatch` / `could-not-automate`, with a screenshot + observed value on `verified` rows.
- [ ] It **did not edit** the target `.smoke.md` and **checked no box** (`git diff` on the `.smoke.md` is empty). — manual
- [ ] A `— manual` step (e.g. §1/§2 CLI steps) is reported `could-not-automate`, not `verified`.

## §6 — Fail-loud, never a false pass (AC7)

- [ ] Stop the dev stack (`Ctrl-C` the `npm run dev`), then ask the agent / run `/smoke-walk` preflight → it reports **`app not reachable at :3000 — run npm run dev`** and stops; **no** step is reported `verified`.
- [ ] Move `.auth/storageState.json` aside and open a session → navigation lands on the **login screen** and the walk reports **not authenticated — run `e2e:auth`**, not a false `verified`. — manual (restore the file after)

## §7 — Convention & docs describe the new gate (AC8) — manual

- [ ] `CLAUDE.md` → "The smoke gate" describes agent-walked automatable steps + human review, and the new "Agent-guided browser sessions" subsection exists. — manual
- [ ] `.github/copilot-instructions.md` mentions `/smoke-walk` + the agent-evidence split. — manual
- [ ] `.claude/skills/smoke/SKILL.md` scaffolds the agent-walkable / `— manual` split and points at `/smoke-walk`; `/smoke-walk` skill exists. — manual
- [ ] Sweep: `grep -rn "walked the ticket's manual smoke\|manual walkthrough the user performs" CLAUDE.md .github/copilot-instructions.md .claude/skills/smoke/SKILL.md` returns **nothing** — no surface still says the human walks every step. — manual

---

## Sign-off

- [ ] §1 — harness present; Static Checks green; Chromium baked; config resolves.
- [ ] §2 — `e2e:auth` writes a git-ignored storageState; `e2e:seed` provisions `e2e-fixture`; auth-before-seed enforced.
- [ ] §3 — dev-login affordance appears only under `?e2e` in dev, absent in prod.
- [ ] §4 — agent opens the app authed, screenshots a view, reads console/network.
- [ ] §5 — `/smoke-walk` emits an evidence report, edits no `.smoke.md`, checks no box.
- [ ] §6 — down-stack / unauth both fail loudly; never a false `verified`.
- [ ] §7 — all convention surfaces describe the new gate.
- [ ] _<date + name>_ — confirmed against my own running stack.

## Bug-filing template

```
Section: §<X> — <name>
Step: <which step>
Expected: <what this doc says should happen>
Got: <screenshots / evidence report / command output>
Repro: <command or prompt + preconditions>
Identifiers: <org id / storageState path / screenshot path>
```
