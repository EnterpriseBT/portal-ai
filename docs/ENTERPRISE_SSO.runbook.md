# Enterprise SSO — Operator & Deploy Runbook

Durable operator reference for the identity seam shipped in #577. Covers the **Auth0 vendor teardown** the code change requires on deploy, and the **per-env SSO configuration** for enterprise (SaaS) and self-hosted installs. Each environment (`local` · `app-dev` · `prod`) is a **separate Auth0 tenant** and a **separate secret store**, so every step below is per-env.

Companion phase docs (swept over time): `ENTERPRISE_SSO.discovery.md` / `.spec.md` / `.plan.md`. This runbook is durable and outlives them.

## What changed in the app (context)

- The OIDC validator is config-driven and **mode-gated** (`DEPLOY_MODE` = `saas` | `residency`, owned by `config/deploy-mode.ts` since the epic merge #616). **saas:** `SSO_ISSUERS` (a JSON issuer list for enterprise federation *into* the SaaS) with `AUTH0_DOMAIN`/`AUTH0_AUDIENCE` as the default. **residency:** the single customer issuer `OIDC_ISSUER`/`OIDC_AUDIENCE` (the boot guard requires both). The multi-issuer validator is built lazily; a malformed `SSO_ISSUERS` fails the boot check in `index.ts start()`.
- **The Auth0 post-login sync webhook was removed.** Provisioning now happens on the first authenticated request (`metadata.middleware` → `ensureProvisioned`), and the per-login profile-refresh + `auth.login` audit are re-homed onto that same request path. Nothing calls `POST /api/webhooks/auth0/sync` any more — it returns 404.

## Auth0 vendor teardown (required on deploy)

Removing the webhook has a vendor side the code cannot do for you, and **ordering is load-bearing**: a post-login Action that POSTs to the removed route will fail, and unless the Action swallows its own error, **Auth0 fails the entire login** — the user is bounced straight back to the sign-in page (a login loop, observed during #577 smoke). The Action must therefore go **before** the webhook route disappears from the app that users hit. Per Auth0 tenant (`local` · `app-dev` · `prod`):

1. **Remove/disable the post-login Action FIRST.** In each tenant's **Actions → Flows → Login**, detach and delete the Action that POSTs to `…/api/webhooks/auth0/sync`. Provisioning does **not** gap: the request-path self-heal (#583) already provisions every login without the webhook. Do this **before** (or in the same change as) deploying the webhook removal — never leave a live Action pointing at a route the deployed app no longer serves, or every login in that window loops. The Action also carried the HMAC secret below.
2. **Then deploy the webhook removal.** With no Action calling it, the gone route is inert.
3. **Remove `AUTH0_WEBHOOK_SECRET`** from each env's secret store, **after** the new build (which no longer reads it) is deployed:
   - `local`: delete the line from your `.env`.
   - `app-dev` / `prod`: it lives in AWS Secrets Manager / SSM. Remove it with `portalops vars` (per `packages/devops-cli/COMMANDS.md`); on `prod` the guard requires `--yes --confirm-prod`.
   The code no longer references it (removed from `environment.ts` + `.env.example`), so a lingering secret is inert — but leaving credentials in a store is exactly what SOC 2 access-control review flags, so clear it.

There is **no rollback coupling**: if you must roll the app back, the request path still provisions; you'd only lose the eager pre-first-request provision (invisible to users) until the Action is restored.

## Per-env SSO configuration

SSO is an **enterprise-tier capability**, operator-configured — there is no in-app SSO admin UI in #577.

### SaaS (Auth0 tenant per env) — enterprise connections

- Add the customer's IdP as an **Auth0 Enterprise Connection** (Okta/Entra/Ping via SAML or OIDC) in the tenant. Auth0 brokers it; the app keeps validating the same Auth0 issuer, so **no `SSO_ISSUERS` change is needed** for the SaaS path.
- Federated users are **invitation-gated**: seat them first via the #584 invite flow. To make an unmatched federated login **deny** (rather than fall through to a personal org), set the enterprise-connection marker so the app can tell an enterprise login from a self-serve Google one:
  - `SSO_ENTERPRISE_CLAIM` — the token claim that marks an enterprise login (e.g. a namespaced connection claim added by an Auth0 Action, or `sub`-prefix convention).
  - `SSO_ENTERPRISE_CLAIM_VALUE` — optional; when set the claim must equal it, else presence alone marks it.
- Leave `DEPLOY_MODE` unset (defaults `saas`). Google self-serve login is unchanged.

### Residency — customer OIDC or bundled issuer

- Set `DEPLOY_MODE=residency`. First login provisions the single org tree (first user → owner, rest → member); there is no personal-org fallback. The boot guard (`config/deploy-mode.ts`) refuses to start unless `OIDC_ISSUER` + `OIDC_AUDIENCE` are set (and rejects any central Stripe creds).
- Point the validator at the customer's IdP via `OIDC_ISSUER` / `OIDC_AUDIENCE` (a single issuer in residency; `SSO_ISSUERS` is ignored):
  ```
  OIDC_ISSUER=https://idp.customer.com/
  OIDC_AUDIENCE=portalai
  ```
  The issuer must serve `/.well-known/openid-configuration` (the app resolves its `userinfo` from there); the validator uses `RS256`.
- The **web** logs in against that same issuer at runtime via `config.js` (`AUTH_PROVIDER=oidc`, #607) — no rebuild, no `VITE_*` at build time.
- **Bundled issuer fallback:** when the customer has no IdP, the Helm chart (#566/#569) ships an OIDC issuer; point `OIDC_ISSUER` at it.

## Verification

- `POST /api/webhooks/auth0/sync` → **404** (the route is gone).
- A login still writes an `auth.login` audit row (owner-only Settings → Activity) — for a returning user too, deduped per login session.
- SaaS: an invited enterprise user lands in the inviting org; an uninvited one is denied (403 `SSO_PROVISIONING_NOT_INVITED`). Residency: the first user owns the org, later users join as members.

## Env reference

| Var | Where | Meaning |
|---|---|---|
| `DEPLOY_MODE` | api | `saas` (default) or `residency` (owned by `config/deploy-mode.ts`) |
| `SSO_ISSUERS` | api | **saas only** — JSON `[{issuer,audience,alg?}]` for enterprise federation; unset → derived from `AUTH0_*` |
| `SSO_ENTERPRISE_CLAIM` / `_VALUE` | api | **saas only** — marks an enterprise-federated login for invite-gating |
| `OIDC_ISSUER` / `OIDC_AUDIENCE` | api | **residency only** — the single customer issuer; boot guard requires both |
| web auth provider | web | runtime `config.js` `AUTH_PROVIDER` (`auth0` / `oidc`, #607) — not a build-time `VITE_*` |
| ~~`AUTH0_WEBHOOK_SECRET`~~ | — | **removed** (#577); clear it from every store |
