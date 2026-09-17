# config-driven-web-auth — Smoke Suite

Manual smoke test for [#607](https://github.com/EnterpriseBT/portal-ai/issues/607) — the web app authenticates through a runtime-selected provider (Auth0 for SaaS, generic OIDC for residency) behind one `useAuth()` seam, chosen from `window.__RUNTIME_CONFIG__` with no rebuild.

**Branch under test:** `feat/607-config-driven-web-auth` (base `epic/enterprise-deployment`). **PR:** _to be opened_.

Run **§Preflight** once before any section. The rest can be walked top-to-bottom; each section is independent after preflight. Steps tagged **`— manual`** need a human (a real IdP / a login round-trip against a local OIDC issuer that doesn't exist in this repo yet); everything else is `/smoke-walk`-eligible against your own running stack.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, set type `Bug`, link this file's section (template at the bottom).

---

## Preflight

### Environment

- [ ] `git checkout feat/607-config-driven-web-auth && git pull --ff-only`
- [ ] `npm install` — this branch adds two web dependencies (`react-oidc-context`, `oidc-client-ts`); confirm they resolve. **No migration** (frontend-only).
- [ ] `npm run dev` boots cleanly (web `:3000`, API `:3001`); no console error about a missing auth provider.
- [ ] `apps/web/public/config.js` exists and is the SaaS default: `window.__RUNTIME_CONFIG__ = {"AUTH_PROVIDER":"auth0","OIDC_ISSUER":"","OIDC_CLIENT_ID":"","OIDC_AUDIENCE":"","DEPLOY_MODE":"saas"}`. (In dev this is served statically; the residency image writes it at container start.)

### Fixtures

- [ ] A seeded org + a dev sign-in path. The SaaS walk uses the `@portalai/e2e` auth fixture (`npm run --workspace @portalai/e2e e2e:auth`, then `e2e:seed`) — the guarded dev-login affordance (`/?e2e=1`) authenticates a Database-connection test user against the Auth0 dev tenant. See `packages/e2e/README.md`.

### Reset between runs

- [ ] Sections §2–§3 edit `apps/web/public/config.js`. **Restore it to the SaaS default (above) after each**, and hard-reload (the file is served no-cache but the SPA caches the bundle). `git checkout apps/web/public/config.js` restores it.

---

## §1 — SaaS parity (Auth0, the default) — the no-regression check

Default `config.js` (`AUTH_PROVIDER: "auth0"`). This is the revenue path; it must behave exactly as before.

- [ ] Load `http://localhost:3000/login`. The primary button reads **"Sign in with Google"** with the Google icon (AC8, SaaS). *(agent-walkable)*
- [ ] Sign in via the e2e dev affordance (`/?e2e=1` → "Dev sign-in (E2E)"), or with Google in a normal browser — **manual** for real Google. Landing reaches a protected route (dashboard), not bounced back to `/login`. *(agent-walkable via e2e fixture)*
- [ ] An authenticated API-backed view loads (e.g. the org's stations/portals list renders with data) — proves `useAuthFetch` → `getToken()` attaches a valid Bearer token. *(agent-walkable)*
- [ ] Open a portal/result that renders a **map widget**; the map tiles load (not stuck "Rendering…") — proves `MapWidget`'s `getToken()` path still authorizes tile requests. *(agent-walkable)*
- [ ] Click **Logout** (header menu). You return to `/login` and a protected route now redirects to `/login` — proves `sdk.auth.logout()` → the Auth0 bridge logout + `returnTo` origin. *(agent-walkable)*
- [ ] **401 → logout:** with an expired/invalid session (e.g. clear the Auth0 localStorage keys `@@auth0spajs@@*` mid-session, then trigger a fetch), the app routes through `handleAuthError` and lands on `/login` rather than showing a broken authed view. *(— manual — hard to force deterministically; unit-covered by `auth-consumers.test` case 14)*

## §2 — Residency login (generic OIDC) — no rebuild

Point the **same built app** at a standards OIDC issuer via `config.js` only. There is **no local customer OIDC issuer in this repo** (a mock issuer is stood up during the #569 epic smoke), so this section is **manual** and best walked there.

- [ ] **— manual** Stand up a local standards OIDC issuer (Keycloak/Dex) with a public SPA client (PKCE, redirect URI `http://localhost:3000`, audience mapped to the API's `OIDC_AUDIENCE`). Set `apps/web/public/config.js` to `{"AUTH_PROVIDER":"oidc","OIDC_ISSUER":"<issuer-url>","OIDC_CLIENT_ID":"<client>","OIDC_AUDIENCE":"<audience>","DEPLOY_MODE":"residency"}` and hard-reload — **no rebuild** (AC3, AC7).
- [ ] **— manual** `/login`'s primary button reads a generic **"Sign in"** with **no** Google icon (AC8, residency).
- [ ] **— manual** Clicking it redirects to the OIDC issuer's own login; after authenticating you land back at `http://localhost:3000` (the `?code=&state=` is stripped from the URL) on a protected route — no rebuild (AC3).
- [ ] **— manual** An authenticated API-backed view loads against the residency backend (`DEPLOY_MODE=residency`, backend validating the issuer per #577) — the OIDC `getToken()` acquires a token with the right `aud` (AC4). Note: the audience mechanism is IdP-specific (Keycloak uses a client scope/mapper, not a request param) — see the discovery Open Q3.
- [ ] **— manual** Logout redirects through the issuer's `end_session_endpoint` and returns to `/login`.

## §3 — Fail-closed on misconfigured residency

A residency build must never silently fall back to Auth0 or anonymous (AC5).

- [ ] Set `apps/web/public/config.js` to `{"AUTH_PROVIDER":"oidc","OIDC_ISSUER":"","OIDC_CLIENT_ID":"c","OIDC_AUDIENCE":"a","DEPLOY_MODE":"residency"}` (blank issuer) and hard-reload `http://localhost:3000`. *(agent-walkable)*
- [ ] The app **fails closed**: it does not render the authenticated app, does not present a working Auth0/Google login, and does not proceed anonymously. The console shows a `RuntimeConfigError` naming the missing `OIDC_ISSUER`. *(agent-walkable — read the console message)*
- [ ] Restore `config.js` to the SaaS default (`git checkout apps/web/public/config.js`); the app logs in normally again. *(agent-walkable)*

## §4 — No secret in the client (PKCE public client)

Only non-secret identity values ever reach the browser (AC6).

- [ ] `apps/web/public/config.js` contains **only** the five keys `AUTH_PROVIDER`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_AUDIENCE`, `DEPLOY_MODE` — no `*_SECRET`. *(agent-walkable)*
- [ ] `npm run build --workspace @portalai/web` then `grep -ri "client_secret\|OIDC_CLIENT_SECRET" apps/web/dist` returns **nothing** — no client secret is bundled. *(agent-walkable — command)*

## §5 — Automated gates (the CI-equivalent locally)

Maps AC1. These are commands, not jest-as-smoke — they are the same gates CI runs.

- [ ] `cd apps/web && npm run test:unit` — full suite green (includes the #607 suites: `runtime-config.util`, `Auth.provider`, `auth-consumers`, `LoginForm`). *(agent-walkable — command)*
- [ ] `cd apps/web && npm run type-check` — clean. *(agent-walkable — command)*
- [ ] `cd apps/web && npm run lint` — clean (zero-warning gate). *(agent-walkable — command)*
- [ ] `npm run build --workspace @portalai/web` — the bundle builds (the new OIDC deps resolve). *(agent-walkable — command)*

---

## Sign-off checklist

After every applicable section is green:

- [ ] §1 (SaaS parity) — Google label, login → protected route, authed data, map tiles, logout; SaaS behaves exactly as before.
- [ ] §2 (residency) — generic OIDC login with no rebuild, generic "Sign in" label, token reaches a protected route. **(manual — epic-smoke)**
- [ ] §3 (fail-closed) — blank residency config refuses to run; no Auth0/anonymous fallback.
- [ ] §4 (no-secret) — only the five non-secret keys in `config.js`; no secret in the bundle.
- [ ] §5 (automated gates) — unit suite, type-check, lint, build all green.
- [ ] _date + name_ — confirmed against my own running stack.

**Gate:** the PR merges only after CI is green **and** the boxes above are confirmed by a human. §2 (residency federation) is expected to be completed during the #569 epic smoke against a mock customer issuer, not in isolation.

---

## Bug-filing template

```
**Section:** §<X> — <name>
**Step:** <which step>
**Expected:** <what the smoke doc says should happen>
**Got:** <screenshots / console output / observed label or redirect>
**Repro:** <config.js contents + steps>
**Identifiers:** <org id, browser, config.js AUTH_PROVIDER>
```
