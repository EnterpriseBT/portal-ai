# Enterprise SSO — Operator & Deploy Runbook

Durable operator reference for the identity seam shipped in #577. Covers the **Auth0 vendor teardown** the code change requires on deploy, and the **per-env SSO configuration** for enterprise (SaaS) and self-hosted installs. Each environment (`local` · `app-dev` · `prod`) is a **separate Auth0 tenant** and a **separate secret store**, so every step below is per-env.

Companion phase docs (swept over time): `ENTERPRISE_SSO.discovery.md` / `.spec.md` / `.plan.md`. This runbook is durable and outlives them.

## What changed in the app (context)

- The OIDC validator is config-driven: `SSO_ISSUERS` (a JSON issuer list) with `AUTH0_DOMAIN`/`AUTH0_AUDIENCE` as the default. `DEPLOY_MODE` (`saas` | `self_hosted`) selects provisioning behavior.
- **The Auth0 post-login sync webhook was removed.** Provisioning now happens on the first authenticated request (`metadata.middleware` → `ensureProvisioned`), and the per-login profile-refresh + `auth.login` audit are re-homed onto that same request path. Nothing calls `POST /api/webhooks/auth0/sync` any more — it returns 404.

## Auth0 vendor teardown (required on deploy)

Removing the webhook has a vendor side the code cannot do for you. Do it **per Auth0 tenant**, in this order, so provisioning never gaps:

1. **Deploy the app first.** The request-path self-heal already provisions and audits every login, so the old post-login Action becomes redundant the moment the new build is live.
2. **Remove the post-login Action / Trigger.** In each tenant's **Actions → Flows → Login**, detach and delete the Action that POSTs to `…/api/webhooks/auth0/sync`. Left in place it just 404s on every login (harmless but noisy) — remove it. The Action also carried the HMAC secret below.
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

### Self-hosted / residency — customer OIDC or bundled issuer

- Set `DEPLOY_MODE=self_hosted`. First login provisions the single org tree (first user → owner, rest → member); there is no personal-org fallback.
- Point the validator at the customer's IdP via `SSO_ISSUERS`, e.g.:
  ```
  SSO_ISSUERS=[{"issuer":"https://idp.customer.com/","audience":"portalai","alg":"RS256"}]
  ```
  The issuer must serve `/.well-known/openid-configuration` (the app resolves its `userinfo` from there). `alg` defaults `RS256`; set `ES256`/`PS256` if the IdP signs with those.
- **Bundled issuer fallback:** when the customer has no IdP, the Helm chart (#566/#569) ships an OIDC issuer; point `SSO_ISSUERS` at it. That packaging is deployment-epic work — this ticket defines only the env contract it satisfies.

## Verification

- `POST /api/webhooks/auth0/sync` → **404** (the route is gone).
- A login still writes an `auth.login` audit row (owner-only Settings → Activity) — for a returning user too, deduped per login session.
- SaaS: an invited enterprise user lands in the inviting org; an uninvited one is denied (403 `SSO_PROVISIONING_NOT_INVITED`). Self-hosted: the first user owns the org, later users join as members.

## Env reference

| Var | Where | Meaning |
|---|---|---|
| `DEPLOY_MODE` | api | `saas` (default) or `self_hosted` |
| `SSO_ISSUERS` | api | JSON `[{issuer,audience,alg?}]`; unset → derived from `AUTH0_*` |
| `SSO_ENTERPRISE_CLAIM` / `_VALUE` | api | marks an enterprise-federated login for invite-gating |
| `VITE_DEPLOY_MODE` | web | `saas` → Google button; `self_hosted` → Universal Login |
| ~~`AUTH0_WEBHOOK_SECRET`~~ | — | **removed** (#577); clear it from every store |
