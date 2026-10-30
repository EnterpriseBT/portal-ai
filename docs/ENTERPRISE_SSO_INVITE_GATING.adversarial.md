# enterprise-sso-invite-gating — Adversarial Review

Adversarial probes for [#916](https://github.com/EnterpriseBT/portal-ai/issues/916). The change adds:
- **The gate:** invite-gating of enterprise logins, keyed on the `sub` connection.
- **The re-check:** a deny-path invitation re-check, run under the provisioning lock.
- **The lookup:** an anonymous `POST /api/public/sso-discovery`.
- **The sign-in page:** a **Sign in with SSO** form and a `/not-invited` page.

**Branch under test:** `feat/916-enterprise-sso-invite-gating` (PR [#926](https://github.com/EnterpriseBT/portal-ai/pull/926)).

Tags: untagged = agent-walkable (`/smoke-walk`), `— manual` = needs a human (a real IdP login, or timing a browser can't force), `— backend` = curl, DB or CLI.

## Preflight

### Environment

- [ ] The same as the smoke doc's preflight: `npm run dev` on this branch, with `SSO_ENTERPRISE_CONNECTIONS='[{"connection":"smoke-sso","domains":["<your IdP domain>"]}]'` in `apps/api/.env` and a restart.

### Fixtures

- [ ] The smoke doc's `smoke-sso` enterprise connection and its IdP users. Two more are needed here: **P** (never signed in) and **Q** (invited later).
- [ ] An org owner who can invite, and a **second org** (the e2e fixture org) to test cross-org behavior.
- [ ] A refused user's access token for the `— backend` probes. Sign in as P (refused), then copy the bearer token from any `/api/*` request in DevTools → Network as `$TOKEN`.

### Reset between runs

- [ ] As in the smoke doc: delete the `smoke-sso` users from the tenant and the DB, revoke leftover invitations, and clear the rate-limit keys with `redis-cli --scan --pattern 'usage:rate:public-*' | xargs -r redis-cli del`.

## §1 — Boundary and limit inputs

- [ ] `curl -s -X POST localhost:3001/api/public/sso-discovery -H 'content-type: application/json' -d '{}'` — **safe:** `400 SSO_DISCOVERY_INVALID_PAYLOAD` naming `email`, and no lookup logged. — backend
- [ ] Send a 321-character email (`printf '{"email":"%s@acme.com"}' "$(head -c 312 /dev/zero | tr '\0' a)"`). **Safe:** a 400 for the length, not a 500, and no `matched` log line. — backend
- [ ] Send a 1 MB body, a 2 MB string in `email`. **Safe:** refused by the JSON body limit (413) or the schema (400). The API stays up, and nothing is echoed back at length. — backend
- [ ] On the SSO form, submit an **empty** field. **Safe:** the "Enter a valid email address" field error and **no** `sso-discovery` request (DevTools → Network).
- [ ] Rate limit: 70 lookups from one IP inside a minute (the smoke §7 loop). **Safe:** 429s with `SSO_DISCOVERY_RATE_LIMITED` and a `Retry-After` header. After that, `GET /api/public/site-config` still returns non-429, and the SSO form shows the 429 message in its error alert rather than hanging. — backend (curl) + UI check

## §2 — Malformed and injection input

- [ ] Send each of these emails to the lookup:
  - `jo@acme.com@evil.com`
  - `"jo@acme.com"@evil.com`
  - `jo@ACME.COM.`
  - `jo@аcme.com` (Cyrillic `а`)
  - ` jo@acme.com ` (surrounding spaces)

  **Safe:** each is either a 400 or `{ "connection": null }`, except the trimmed and case-folded genuine domain. None maps a domain the caller doesn't hold to *another* connection than its own. — backend
- [ ] Try parameter smuggling through the email: on the SSO form, enter `jo@<listed domain>&connection=google-oauth2` and press Continue. **Safe:** the schema rejects it as an email, so no redirect happens. If it were accepted, the Auth0 `/authorize` URL would still carry it URL-encoded inside `login_hint` only, with exactly one `connection=` parameter.
- [ ] Wrong body types: `{"email":["a@b.co"]}`, `{"email":42}`, a top-level array, and `{"email":"a@b.co","tenant":"x"}`. **Safe:** `400 SSO_DISCOVERY_INVALID_PAYLOAD` each time; an unknown key is named, not silently dropped. — backend
- [ ] A non-JSON content type: `-H 'content-type: application/x-www-form-urlencoded' -d 'email=a@b.co'`. **Safe:** `415 REQUEST_UNSUPPORTED_MEDIA_TYPE`. — backend
- [ ] A NUL character: `-d '{"email":"jo\u0000@acme.com"}'`. **Safe:** `400 REQUEST_INVALID_CHARACTERS`, not a 500. — backend
- [ ] A malformed config value: boot with `SSO_ENTERPRISE_CONNECTIONS='[{"connection":"a","domains":["acme.com"]},{"connection":"b","domains":["acme.com"]}]'` (one domain under two connections). **Safe:** the API refuses to start, naming the duplicate domain. — backend

## §3 — Concurrency and races

- [ ] As refused user **P**, reload `/` five times quickly. **Safe:**
  - every `/api/*` response is `403 SSO_PROVISIONING_NOT_INVITED`, never a 500 or a provisioning-lock timeout;
  - the page settles on `/not-invited` with one entry in history;
  - DB: P has one `users` row, and no `organizations` or `organization_users` rows. — manual
- [ ] Invite **P**, then click **Try again** while a second tab of P reloads `/` at the same moment. **Safe:**
  - P ends with exactly **one** `organization_users` row in the inviting org;
  - the invitation is consumed once;
  - P owns no org;
  - neither tab shows a 500. — manual
- [ ] On the SSO form, press Enter twice quickly (or Enter, then click Continue). **Safe:** exactly **one** `sso-discovery` request in DevTools → Network, and at most one redirect.
- [ ] An invite for P whose identity provider sends `email_verified: false` (skip if your IdP can't), then reload `/` ten times inside a minute. **Safe:** each reload is still a fast 403, never a 500. The API log shows at most **one** profile fetch for P that minute: no repeated `SSO invite re-check: profile fetch failed`, and no Auth0 429 errors. — manual

## §4 — Auth and permission boundaries

- [ ] As refused user P, with `$TOKEN`, call `curl -s localhost:3001/api/organization/current -H "authorization: Bearer $TOKEN"`, and do the same for `/api/stations` and `/api/connector-instances`. **Safe:** `403 SSO_PROVISIONING_NOT_INVITED` for each, with no data. — backend
- [ ] Repeat with a write: `curl -s -X POST localhost:3001/api/stations -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"name":"x"}'`. **Safe:** 403 with that code, and no `stations` row. — backend
- [ ] Signed out, open `http://localhost:3000/not-invited`. **Safe:** you're sent to sign in first (the page sits behind `Authorized`), and no API call is made while signed out.
- [ ] Send `sso-discovery` with someone else's `Authorization` header (`-H "authorization: Bearer $TOKEN"`). **Safe:** the same `{ connection }` answer as without it. The header is ignored, and nothing about the caller is returned. — backend
- [ ] **Gate bypass through Google:** as P's real person, sign in with **Google** using the same email address. **Expected (by design):** a separate identity gets a **personal** org and **no** access to the inviting org's data. Confirm the personal org contains none of the enterprise org's connectors, stations or members. — manual

## §5 — Multi-tenant isolation

- [ ] The lookup reveals no tenant data. For a listed domain the response body is exactly `{"success":true,"payload":{"connection":"smoke-sso"}}`: no org id, name, user count or invite state. — backend
- [ ] **Cross-org invitation through one connection:** invite Q's email into the **second org** (the e2e fixture org), not the org that "owns" `smoke-sso`, then sign Q in through `smoke-sso`. **Expected:** Q joins the second org. Invitations aren't bound to a connection (the accepted model from #584; the security review flagged binding as a separate hardening). Confirm Q sees only the second org and no data from any other org. — manual
- [ ] A refused user's `/not-invited` page and network calls name no org. The page makes no `/organization` requests, and the copy names no org.

## §6 — State and lifecycle abuse

- [ ] Invite P, **revoke** the invitation, then P clicks **Try again**. **Safe:** still refused, and no membership is created. — manual
- [ ] Invite P with an **expired** invitation (set `expires_at` in the past in `invitations` via `db:studio`), then Try again. **Safe:** still refused. — manual
- [ ] Remove member B (who joined in the smoke walk) from the org, then B signs in through `smoke-sso`. **Safe:** B is **refused** (no membership), and does **not** get a personal org. — manual
- [ ] Unlist a connection while a member is signed in: change the config to `none` and restart. **Safe:** existing members keep working (gating only affects users with no membership), and B (removed) now gets a personal org, as unlisted connections do. — manual
- [ ] B **deletes the personal org** they got before gating (#197 org delete) while an invite to the real org is pending, then signs in again. **Safe:** B joins the invited org and doesn't get a fresh personal org. — manual

## §7 — Misuse sequences

- [ ] On the SSO form, enter a personal `@gmail.com` address. **Safe:** "Single sign-on isn't set up for that email domain. Sign in with Google instead.", and no redirect.
- [ ] Type a listed-domain email, but at the identity provider sign in as a *different* user of the same IdP. **Safe:** gating follows the token's `sub` (still `smoke-sso`), so an uninvited different user is refused. `login_hint` is only a hint. — manual
- [ ] From `/not-invited`, press the browser **Back** button. **Safe:** you don't land on an app page with org chrome. Any page you reach re-requests, is refused, and replaces history back to `/not-invited`, with no loop of entries and no console errors.
- [ ] Click **Try again** ten times quickly while still uninvited. **Safe:** each lands back on `/not-invited`, with no 500s and no growth in history entries. The API log shows refusals only, with no profile fetches (no pending invite).
- [ ] While refused, open a real invite link (`/invitations/accept?token=…`, copied by the owner). **Safe:** the accept page (public layout) joins the invited org without being refused first, and Try again is then unnecessary. — manual
- [ ] Open the SSO form, type an invalid email, then click **Back**, then **Sign in with SSO** again. **Safe:** the form reopens empty, with no stale error or alert.

## Findings

| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | low / med / high | fixed-in-PR / waived: <reason> |

## Sign-off

- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (user id / `auth0_id` / org id / invitation id):
