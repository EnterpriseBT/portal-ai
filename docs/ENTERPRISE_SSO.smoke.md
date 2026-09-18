# ENTERPRISE_SSO — Smoke Suite

Manual smoke test for [#577](https://github.com/EnterpriseBT/portal-ai/issues/577) — the config-driven OIDC identity seam: multi-issuer validator, `DEPLOY_MODE` provisioning split, webhook removal + re-homed per-login audit, and the frontend deploy-mode login switch. **Branch under test:** `feat/577-enterprise-sso` (PR [#605](https://github.com/EnterpriseBT/portal-ai/pull/605), into `epic/security-readiness`).

**Scope note.** Default local config (no `SSO_ISSUERS`, `DEPLOY_MODE` unset) is **SaaS mode against your Auth0 tenant** — that path is fully walkable here. The **self-hosted / customer-OIDC** and **SaaS enterprise-connection** paths need a real customer IdP (or a configured Auth0 Enterprise Connection) and are **deferred to the #569 epic smoke**, where a mock issuer + enterprise connection are stood up — they are marked `— manual (deferred)` below, with the integration test that already covers each named.

## Preflight

### Environment

- [ ] `git checkout feat/577-enterprise-sso && git pull --ff-only`
- [ ] `npm install`
- [ ] **Migration** — `cd apps/api && npm run db:migrate` applies `0098_add-user-last-login-session` (adds `users.last_login_session`). `npm run dev` seeds but does **not** migrate, so run this or the login path 500s.
- [ ] `npm run dev` boots cleanly (API :3001, web :3000); no `SSO_ISSUERS` / `DEPLOY_MODE` set → SaaS defaults.

### Fixtures

- [ ] A working Auth0 login for your local tenant (the dev Google login, or the `?e2e` dev sign-in + `@portalai/e2e` `storageState`). The account should already own or belong to an org so Settings → Activity is reachable.

### Reset between runs

- [ ] Read-mostly. §2 writes an `auth.login` audit row per new login session; §1/§4 are read-only. No reset needed between runs.

## §1 — SaaS login, no regression (slice 2, 3) — `/smoke-walk`

Covers: *"SaaS Google login provisions a personal org as today; the validator accepts the current Auth0 issuer unchanged when `SSO_ISSUERS` is unset."*

- [ ] Navigate to http://localhost:3000 and sign in through the normal login button. **Expected:** login succeeds and the app lands on an authenticated view (the token from today's Auth0 issuer is accepted by the multi-issuer validator with default config).
- [ ] A brand-new user (an Auth0 account with no prior org) signing in **Expected:** is provisioned into a personal org as owner — verify in `npm run db:studio` → `organization_users` (`role = owner`) for the new `users` row, unchanged from today.

## §2 — Re-homed per-login audit (slice 6) — `/smoke-walk`

Covers: *"returning-user logins still produce an `auth.login` audit row and a refreshed profile (when the IdP asserts `auth_time`)."*

- [ ] After signing in (§1), open **Settings → Activity** (the owner-only audit-log view, #596). **Expected:** an `auth.login` entry for your user appears for this login — now emitted from the request path, not the removed webhook.
- [ ] Sign out and sign back in (a **new** login session). **Expected:** a **second** `auth.login` entry appears; refreshing a page within the same session adds **none** (deduped by the session marker). Confirm `users.last_login_session` is populated in `db:studio`.

## §3 — Auth0 sync webhook removed (slice 6) — manual (one command)

Covers: *"`POST /api/webhooks/auth0/sync` no longer exists."*

- [ ] Run `curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/api/webhooks/auth0/sync -H 'Content-Type: application/json' -d '{"user_id":"auth0|x"}'`. **Expected:** `401` (the route is gone; the path falls through to the authenticated `/api` space) — and crucially **not** `200`. `POST /api/webhooks/stripe` still returns non-404 (unchanged).

## §4 — Multi-issuer validator: unknown issuer (slice 2) — manual (crafted token)

Covers: *"A token from an unconfigured issuer is rejected 401 `SSO_UNKNOWN_ISSUER`."*

- [ ] With a JWT whose `iss` is not a configured issuer (mint one, or hand-craft `header.payload.sig` with `{"iss":"https://evil.example/"}`), call any `/api/*` endpoint with `Authorization: Bearer <token>`. **Expected:** `401` with code `SSO_UNKNOWN_ISSUER`. (Unit-covered by `auth.middleware.test.ts`; this confirms it end-to-end.)

## §5 — Self-hosted provisioning (slice 4) — manual (deferred to #569 epic smoke)

Covers: *"a user from the customer's OIDC (or bundled) issuer is provisioned on first token into the single org — first user owner, subsequent members."*

- [ ] With `DEPLOY_MODE=self_hosted` and `SSO_ISSUERS` pointing at a (mock) customer OIDC issuer: first login → owner of the singleton org; a second distinct user → member of the **same** org. **No local issuer exists**, so this is walked during the #569 epic smoke against the mock issuer. Already covered by `ensure-provisioned.integration.test.ts` (self_hosted first→owner, second→member).
- [ ] Frontend: a `VITE_DEPLOY_MODE=self_hosted` build shows **"Sign in with SSO"** (no Google icon) and routes to Auth0 Universal Login. (Unit-covered by `LoginForm.test.tsx`; visual confirm during the epic smoke.)

## §6 — SaaS enterprise deny / invite (slice 4) — manual (deferred to #569 epic smoke)

Covers: *"a claim-marked federated user with a pending invite lands in the inviting org with the invited role; without one → 403 `SSO_PROVISIONING_NOT_INVITED`, no org created."*

- [ ] With an Auth0 Enterprise Connection + `SSO_ENTERPRISE_CLAIM` configured: an **invited** federated user lands in the inviting org with the invited role; an **uninvited** one is denied `403 SSO_PROVISIONING_NOT_INVITED` and gets **no** org. Needs a real enterprise connection → walked in the #569 epic smoke. Already covered by `ensure-provisioned.integration.test.ts` (deny with no invite; invite wins over deny).

## Sign-off

- [ ] §1–§4 verified against my own running stack
- [ ] §5–§6 acknowledged as deferred to the #569 epic smoke (mock issuer + enterprise connection), integration-covered in the meantime
- [ ] <date + name> — confirmed

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/user/audit-row ids):
