# Enterprise SSO — Operator & Deploy Runbook

Durable operator reference for the identity seam shipped in #577. Covers the **Auth0 vendor teardown** the code change requires on deploy, and the **per-env SSO configuration** for enterprise (SaaS) and self-hosted installs. Each environment (`local` · `app-dev` · `prod`) is a **separate Auth0 tenant** and a **separate secret store**, so every step below is per-env.

Companion phase docs (swept over time): `ENTERPRISE_SSO.discovery.md` / `.spec.md` / `.plan.md`. This runbook is durable and outlives them.

## What changed in the app (context)

- The OIDC validator is config-driven and **mode-gated** (`DEPLOY_MODE` = `saas` | `residency`, owned by `config/deploy-mode.ts` since the epic merge #616). **saas:** `SSO_ISSUERS` (a JSON issuer list for enterprise federation *into* the SaaS) with `AUTH0_DOMAIN`/`AUTH0_AUDIENCE` as the default. **residency:** the single customer issuer `OIDC_ISSUER`/`OIDC_AUDIENCE` (the boot guard requires both). The multi-issuer validator is built lazily; a malformed `SSO_ISSUERS` fails the boot check in `index.ts start()`.
- **The Auth0 post-login sync webhook was removed.** Provisioning now happens on the first authenticated request (`metadata.middleware` → `ensureProvisioned`), and the per-login profile-refresh + `auth.login` audit are re-homed onto that same request path. Nothing calls `POST /api/webhooks/auth0/sync` any more — it returns 404.

## Auth0 vendor teardown (required on deploy)

Removing the webhook has a vendor side the code cannot do for you, and **ordering is load-bearing**: a post-login Action that POSTs to the removed route will fail, and unless the Action swallows its own error, **Auth0 fails the entire login** — the user is bounced straight back to the sign-in page (a login loop, observed during #577 smoke). The Action must therefore go **before** the webhook route disappears from the app that users hit. Per Auth0 tenant (`local` · `app-dev` · `prod`):

1. **Remove/disable the post-login Action FIRST.** In each tenant's **Actions → Triggers → post-login**, drag the Action out of the flow, click **Apply**, and delete the Action that POSTs to `…/api/webhooks/auth0/sync`. Provisioning does **not** gap: the request-path self-heal (#583) already provisions every login without the webhook. Do this **before** (or in the same change as) deploying the webhook removal — never leave a live Action pointing at a route the deployed app no longer serves, or every login in that window loops. The Action also carried the HMAC secret below.
2. **Then deploy the webhook removal.** With no Action calling it, the gone route is inert.
3. **Remove `AUTH0_WEBHOOK_SECRET`** from each env's secret store, but only **after** a deploy whose `backend.yml` no longer references it (#873). The app stopped reading it in #577, but until #873 the task definition still injected it from Secrets Manager. **ECS refuses to start a task whose secret is missing**, so deleting it first takes the API down at the next deploy or task replacement.
   - `local`: delete the line from your `.env`.
   - `app-dev` / `prod`: after that deploy, run `aws secretsmanager delete-secret --secret-id portalai/<env>/auth0-webhook-secret --recovery-window-in-days 7`, and delete the `DEV_`/`PROD_SECRET_ARN_AUTH0_WEBHOOK_SECRET` repo secret only **after** the 7-day window has passed. The window is the rollback: redeploying a pre-#873 release needs both the secret (`aws secretsmanager restore-secret` brings it back) and the repo secret its workflow passes as the ARN. (`portalops` has no delete verb, and the key left its catalog in #873.)
   Leaving unused credentials in a store is what SOC 2 access-control review flags, so do clear it.

**Rolling back:** provisioning needs nothing from Auth0, because the request path provisions every release. **Never restore the Action**: no release since #577 serves its route, so it loops every login. A release from before #873 needs `AUTH0_WEBHOOK_SECRET` to exist, though, because its task definition injects it. Within step 3's 7-day window, restore the secret first. After the window, re-create it and its repo secret before redeploying such a release.

## Per-env SSO configuration

SSO is an **enterprise-tier capability**, operator-configured — there is no in-app SSO admin UI in #577.

### SaaS (Auth0 tenant per env) — enterprise connections

- Add the customer's IdP as an **Auth0 Enterprise Connection** (Okta/Entra/Ping via SAML or OIDC) in the tenant. Auth0 brokers it; the app keeps validating the same Auth0 issuer, so **no `SSO_ISSUERS` change is needed** for the SaaS path.
- Federated users are **invitation-gated** (#916): seat them first via the #584 invite flow. An uninvited login through a gated connection is refused with `403 SSO_PROVISIONING_NOT_INVITED` and lands on the web's **"You need an invitation"** page (`/not-invited`), instead of getting a personal org. **No Auth0 Action is involved**, so the tenants keep #873's no-Action posture.
  - **How the app tells.** Auth0 builds an enterprise user id as `<strategy>|<connection>|<id>` (e.g. `samlp|acme-okta|jo@acme.com`), and that id is the access token's signed `sub`. `SsoConfig.connectionOf` (`apps/api/src/config/sso.config.ts`) reads the middle segment and gates it when it is listed in `SSO_ENTERPRISE_CONNECTIONS`. Social and database ids (`google-oauth2|…`, `auth0|…`) have no connection segment, so a self-serve login is never gated.
  - **`SSO_ENTERPRISE_CONNECTIONS`** is a comma-separated list of Auth0 connection **names** (case-sensitive, Auth0's alphanumeric-and-dash rule). `none` turns gating off. Every deployed env stores the key, because SSM can't hold an empty value and the API task won't start while the parameter is missing. A malformed list stops the API at boot (`DEPLOY_MODE_CONFIG_INVALID`), so a typo is loud rather than silently ungating.
  - **Before listing a connection, read one real user id from it.** After a test login through the connection, run `auth0 users search --query 'identities.connection:"<connection>"' --number 1` in that env's tenant and confirm the `user_id` reads `<strategy>|<connection>|…`. A strategy whose ids carry no connection segment can't be gated this way: it **fails open**, and its uninvited users get a personal org exactly as before. `samlp`, `oidc` and `okta` follow the three-part shape; confirm any other strategy (`waad`, `adfs`, `google-apps`) this way first.
  - **Check the connection marks emails verified.** The app only auto-accepts an invitation for a **verified** email, on a first sign-in and on the re-check after a refusal alike. Trusting an unverified one would let any IdP that sends an arbitrary email claim someone else's invite. SAML and OIDC enterprise connections don't always send `email_verified`. In the same `auth0 users search` result, confirm `email_verified: true`. If it's false, map it in the connection (a SAML attribute mapping, or the OIDC `email_verified` claim). Until it is, invited users of that connection can join only through the emailed invitation link, which accepts by token, and **Try again** on the not-invited page won't let them in.
  - **To gate a connection:** `portalops vars set SSO_ENTERPRISE_CONNECTIONS <name>[,<name>…] --env <env>` with the env's guard flags (`--yes` on app-dev, `--yes --confirm-prod` on prod). Read the current value first and keep every existing name, since `set` replaces the list. The API reads the list at task start, so it takes effect on the next deploy or task restart.
  - **Who is gated.** Only a user with **no membership** who signs in through a listed connection. Before refusing, the API checks once more for pending invitations to the user's verified email, so someone refused before they were invited gets in on their next request (or **Try again**) without the emailed link. A user who already got a personal org through the connection before it was listed keeps it. To move one into their real org, invite them there. The invitation can then be accepted from the emailed link, or the user can delete the personal org they own (org delete, #197), after which their next sign-in joins the invited org. `portalai org delete` works on app-dev but is refused on prod.
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
- A login still writes an `auth.login` audit row (Settings → Activity, which needs permission to view the audit log) — for a returning user too, deduped per login session.
- SaaS: an invited enterprise user lands in the inviting org; an uninvited one is denied (403 `SSO_PROVISIONING_NOT_INVITED`) and sees "You need an invitation". A Google login, or a login through an unlisted connection, still gets a personal org. The API's boot log line `Enterprise SSO connections resolved` lists what is gated. Residency: the first user owns the org, later users join as members.

## Env reference

| Var | Where | Meaning |
|---|---|---|
| `DEPLOY_MODE` | api | `saas` (default) or `residency` (owned by `config/deploy-mode.ts`) |
| `SSO_ISSUERS` | api | **saas only** — JSON `[{issuer,audience,alg?}]` for enterprise federation; unset → derived from `AUTH0_*` |
| `SSO_ENTERPRISE_CONNECTIONS` | api (SSM `sso-enterprise-connections`) | **saas only** — comma-separated Auth0 connection names whose logins are invite-gated (#916); `none` = off. Required in every deployed env |
| `OIDC_ISSUER` / `OIDC_AUDIENCE` | api | **residency only** — the single customer issuer; boot guard requires both |
| `OIDC_CLIENT_ID` | web | **residency only** — the customer IdP's client id for the browser sign-in, served in the runtime `config.js` (Helm `oidc.clientId`) |
| web auth provider | web | runtime `config.js` `AUTH_PROVIDER` (`auth0` / `oidc`, #607) — not a build-time `VITE_*` |
| ~~`AUTH0_WEBHOOK_SECRET`~~ | — | **removed** (#577 from the app, #873 from the deployment); delete it from each store after the #873 deploy (step 3 above) |
