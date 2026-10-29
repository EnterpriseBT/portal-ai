# enterprise-sso-invite-gating — Smoke Suite

Smoke test for [#916](https://github.com/EnterpriseBT/portal-ai/issues/916). An uninvited SaaS login through an Auth0 enterprise connection listed in `SSO_ENTERPRISE_CONNECTIONS` is refused onto a "You need an invitation" page instead of getting a personal org. The connection is read from the token's `sub`, with no Auth0 Action. **Branch under test:** `feat/916-enterprise-sso-invite-gating` (PR [#926](https://github.com/EnterpriseBT/portal-ai/pull/926)).

Step tags: untagged = agent-walkable (`/smoke-walk`), `— manual` = needs a human (a real IdP login or visual judgment), `— backend` = terminal, DB or CLI.

> **Enterprise sign-in.** Users reach an enterprise connection through **Sign in with SSO** on the sign-in page (the #916 amendment). They enter a work email, and the app routes its domain to the connection. Every enterprise login below goes through it, not the dev-only button.

## Preflight

### Environment

- [ ] `git checkout feat/916-enterprise-sso-invite-gating && git pull --ff-only`
- [ ] `npm install && npm run build`. No migration.
- [ ] `npm run dev` boots cleanly (API :3001, web :3000).

### Fixtures — manual

- [ ] **An enterprise connection in the local Auth0 tenant**, named `smoke-sso`. Any IdP you control works: an OpenID Connect connection to a free Okta Integrator org, or to a second Auth0 tenant. In the Auth0 dashboard: Authentication → Enterprise → (OpenID Connect | SAML) → create `smoke-sso`.
  - Enable it for the local SPA application.
  - For §5 and §6 only, turn on **Display connection as a button**. Those steps reach smoke-sso through Auth0's own page, via the dev login at `http://localhost:3000/login?e2e`, because the SSO form deliberately won't route an unlisted domain.
- [ ] **Four IdP users with verified emails**, called A, B, C and D below. None of them has signed in to the local app before.
- [ ] **An org owner** who can invite. Your usual local login (`bbgrabbag@gmail.com`) or the e2e owner (`npm run --workspace @portalai/e2e e2e:auth`). Note the org's name.
- [ ] In `apps/api/.env`, set `SSO_ENTERPRISE_CONNECTIONS='[{"connection":"smoke-sso","domains":["<your IdP users' email domain>"]}]'`, then **restart** `npm run dev`. The env is read at process start, so a nodemon reload is not enough.

### Reset between runs — backend

- [ ] Delete the smoke users from the tenant (`auth0 users delete <user_id>`), and from the local DB (`users` where `auth0_id LIKE '%|smoke-sso|%'`, plus their `organization_users` rows), or run `npm run db:seed` after a reset. Revoke leftover invitations in Settings → Members.

## §1 — Config and boot (slices 1, 3)

- [ ] **Malformed value refuses to boot.** Stop the dev server, then from `apps/api` run `npm run build && SSO_ENTERPRISE_CONNECTIONS='[{"connection":"smoke-sso","domains":[]}]' PORT=3999 npm start`. Expected: exit 1 with `FATAL … refusing to start`, `code: "DEPLOY_MODE_CONFIG_INVALID"`, and an `SSO_ENTERPRISE_CONNECTIONS[0]` error naming `domains`. — backend
- [ ] **Valid list is logged.** Restart `npm run dev`. The API log shows `Enterprise SSO connections resolved` with `enterpriseConnections: ["smoke-sso"]`. — backend
- [ ] **Operator catalog.** `portalops vars describe --env app-dev` lists `SSO_ENTERPRISE_CONNECTIONS` at `/portalai/dev/sso-enterprise-connections`. — backend

## §2 — An uninvited enterprise login is refused (AC 1)

- [ ] Sign out. At `http://localhost:3000/login`, click **Sign in with SSO**, enter **user A's** email, click **Continue**, and complete the IdP sign-in. — manual
- [ ] **Expected page:** you land on `/not-invited`, showing:
  - a lock icon;
  - the title **"You need an invitation"**;
  - the body "Your organization signs you in with its own identity provider, so you need an invitation before you can use Portals AI. Ask someone in your organization to invite this email address, then try again.";
  - **Try again** and **Sign out** buttons;
  - **no sidebar navigation or org switcher** (the public layout). — manual
- [ ] **Expected network:** DevTools shows the first API call answered `403` with `code: "SSO_PROVISIONING_NOT_INVITED"`. Nothing on `/not-invited` calls `/api/organization/current` or `/memberships`. — manual
- [ ] **Expected DB** (`npm run db:studio`):
  - `users` has one row for A, with `auth0_id` = `oidc|smoke-sso|…` (or `samlp|smoke-sso|…`);
  - `organization_users` has **no** row for that user id;
  - `organizations` has **no** row with that user as `owner_user_id`. — backend
- [ ] **Confirm the `sub` shape**, as the runbook asks: `auth0 users search --query 'identities.connection:"smoke-sso"' --number 1` shows a three-part `user_id` and `email_verified: true`. — backend
- [ ] **Expected API log:** `SSO provisioning denied: not invited` with A's `userId`, and **no** `SSO invite re-check: profile fetch failed` line. An uninvited refusal makes no profile call. — backend

## §3 — An invited user's first sign-in joins the org (AC 2)

- [ ] As the org owner, go to Settings → Members → **Invite**, enter **user B's** email with role Member, and submit. The invitation appears under pending invitations. — manual
- [ ] In a separate browser profile, sign in as **user B** with **Sign in with SSO**, **not** the invite link. — manual
- [ ] **Expected:** B lands on the dashboard of the inviting org, with B's role shown as Member. In the DB, the `invitations` row for B's email is no longer `pending`, and B owns no org. — manual / backend

## §4 — Refused first, invited later, then joins (AC 3)

- [ ] Still signed in as **user A** on `/not-invited` from §2, as the owner invite **A's** email. — manual
- [ ] As A, click **Try again**. **Expected:** A lands on the inviting org's dashboard without using the invite link. The `invitations` row for A is no longer `pending`, and A owns no org. — manual
- [ ] **Expected API log:** no `SSO invite re-check: profile fetch failed` line. — backend
- [ ] *(Variant)* Repeat with **user C**: refuse C first, invite C, then **Sign out** and sign back in with **Sign in with SSO**, rather than using Try again. Expected: C joins the inviting org. — manual

## §5 — Self-serve and unlisted connections still get a personal org (AC 4)

- [ ] Sign in with **Google** using an account that has never signed in locally. **Expected:** it gets a personal org, with that user as owner, as before. — manual
- [ ] Set `SSO_ENTERPRISE_CONNECTIONS='[{"connection":"some-other-conn","domains":["example.invalid"]}]'` and restart. Sign in as **user D** (never signed in, not invited) through the dev login (`/login?e2e`), choosing smoke-sso on Auth0's page: the SSO form no longer routes D's domain. **Expected:** D gets a personal org, because an unlisted connection is not gated. — manual

## §6 — Gating off (AC 5)

- [ ] Set `SSO_ENTERPRISE_CONNECTIONS=none` and restart. The boot log shows `enterpriseConnections: []`. Delete D (see Reset), then sign D in again through the dev login (`/login?e2e`) and smoke-sso. **Expected:** D gets a personal org, the same behavior as `main`. — manual
- [ ] Remove the line from `.env` (unset) and restart. **Expected:** the boot is clean and logs `enterpriseConnections: []`. — backend

## §7 — Sign in with SSO (amendment, slices 7–8)

- [ ] Signed out, at `http://localhost:3000/login`. **Expected:** under **Sign in with Google** there's a **Sign in with SSO** link.
- [ ] Click it. **Expected:** a form with an auto-focused **Work email** field, a **Continue** button and a **Back** button.
- [ ] Type `not-an-email` and press Enter. **Expected:** the field error "Enter a valid email address", `aria-invalid="true"` on the field, and no network request.
- [ ] Enter `someone@example.invalid` and press **Continue**. **Expected:** `POST /api/public/sso-discovery` returns `200 { "connection": null }` (DevTools). The form stays put and shows "Single sign-on isn't set up for that email domain. Sign in with Google instead."
- [ ] Click **Back**. **Expected:** the Google and SSO choices again.
- [ ] Enter user A's email. **Expected:** the browser goes to the local Auth0 tenant's `/authorize` with `connection=smoke-sso` and `login_hint=<the email>` in the URL. — manual (the IdP login that follows is §2)
- [ ] **Rate limit:** `for i in $(seq 1 70); do curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3001/api/public/sso-discovery -H 'content-type: application/json' -d '{"email":"a@b.co"}'; done | sort | uniq -c`. **Expected:** some `429`s, each with code `SSO_DISCOVERY_RATE_LIMITED`. Meanwhile `curl localhost:3001/api/public/site-config` still returns 200 (a separate window). — backend
- [ ] **Swagger:** `http://localhost:3001/api/docs` lists `POST /api/public/sso-discovery` under no security. — backend

## §7b — The not-invited page itself (slice 4)

- [ ] Signed in as the e2e owner, navigate to `http://localhost:3000/not-invited`. **Expected:** the §2 copy and buttons, with no sidebar navigation.
- [ ] Click **Try again**. **Expected:** you land on `/` (the dashboard). The owner has a membership, so nothing refuses.
- [ ] Return to `/not-invited` and click **Sign out**. **Expected:** you are signed out and back on `/login`.

## §8 — Posture and deploy (AC 6–9)

- [ ] **No Auth0 Action** in each tenant (`local`, `app-dev`, `prod`): `auth0 api get actions/triggers/post-login/bindings` returns no bindings. — backend
- [ ] **Runbooks:** `docs/ENTERPRISE_SSO.runbook.md` → "SaaS enterprise connections" describes the connection list, the user-id check, `email_verified`, `none`, and personal-org cleanup, with no `SSO_ENTERPRISE_CLAIM`. `docs/PROD_PROVISIONING.runbook.md` has the prod `vars set … none` step. — manual
- [ ] **Residency unaffected.** There is no residency stack in this walk. The `sso.config` unit suite pins residency → `join_single_org` even through a listed connection, and CI runs it. Confirm CI is green on the PR head. — manual
- [ ] **After merge:** the app-dev deploy goes green and the API task starts. In the ECS service events there's no `ResourceInitializationError` for `sso-enterprise-connections`. — manual (post-merge)

## §9 — Error and edge cases

- [ ] **Malformed list:** covered in §1.
- [ ] **Unverified email** (only if your IdP can mark an email unverified): refuse user E, invite E, then click **Try again**. **Expected:** E is still refused, because invitations are only auto-accepted for a verified email. Opening the copied **invite link** as E still joins, since that path accepts by token. — manual

## Sign-off

- [ ] Every section above verified
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (user id / `auth0_id` / org id / invitation id):
