# Enterprise SSO invite-gating (SaaS) — Discovery

**Issue:** [EnterpriseBT/portal-ai#916](https://github.com/EnterpriseBT/portal-ai/issues/916)

**Why this exists.** In SaaS, a customer's IdP is added to our Auth0 tenant as an Enterprise Connection. People who sign in through it are meant to be **invitation-gated** (#577/#584): an uninvited one should be refused, not handed a personal org. The API makes that call in `SsoConfig.provisioningFallback` by exact-matching a named access-token claim (`SSO_ENTERPRISE_CLAIM` / `_VALUE`). Auth0 only issues such a claim from a post-login Action, and since #873 our tenants deliberately run **no** Action. The gate therefore can't be switched on, and today an uninvited enterprise user gets a personal org.

The survey also found two gaps that keep the acceptance criteria out of reach even once the marker exists. First, a user who was denied and invited afterwards stays denied. Second, the web app has no screen for the denial. This is the change that lets an operator name the enterprise connections from config, with no Auth0 Action, and makes the deny → invite → join loop work end to end.

PRD answers (recorded on the issue): the **operator** configures it, through deploy config; it's a **global list** of enterprise connections with no per-org binding; gating applies **only to users with no membership**, and existing personal orgs are left alone; the denied user sees a not-invited screen. After the survey, the issue was amended to require building that screen (none exists) and to require that a user denied before being invited joins on their next sign-in.

## The current shape

### The decision

| Piece | Location | Note |
|---|---|---|
| `ProvisioningFallback` type | `apps/api/src/config/sso.config.ts:21-28` | `personal_org` \| `join_single_org` \| `deny` |
| `enterpriseClaim()` | `sso.config.ts:120-125` | `{name, value?}` from `SSO_ENTERPRISE_CLAIM` / `_VALUE`, null when blank |
| `isEnterpriseFederated` | `sso.config.ts:128-136` | Matches presence, or `===` the value. No prefix or list matching |
| `provisioningFallback(payload)` | `sso.config.ts:145-152` | residency → `join_single_org`; saas + claim → `deny`; else `personal_org` |
| Sole caller | `apps/api/src/middleware/metadata.middleware.ts:86-88` | Passes `req.auth?.payload`, the **verified access token**. `sub` is read at `:42` as `auth0Id` |
| Env vars | `apps/api/src/environment.ts:16-23`, `apps/api/.env.example:50-57` | Optional. **Not** in `infra/cloudformation/backend.yml`, `packages/devops-cli/src/catalog.ts` or Helm, so no deployed env sets them |

### Provisioning (`ApplicationService.ensureProvisioned`, `apps/api/src/services/application.service.ts:158-298`)

The whole thing runs under `SyncLockService.withProvisioningLock(auth0Sub)`. The steps, in order:
1. Find or create the user row (`:176-192`). `profile` (userinfo) is resolved **only when the row is new**.
2. Accept invitations by verified email (`:202-215`, via `SeatService.acceptPendingForEmail`, `seat.service.ts:425-480`). The guard is `profile?.emailVerified`, so this step runs **only on first login**.
3. Use the existing membership if there is one (`:218-226`).
4. The fallback: `deny` throws `403 SSO_PROVISIONING_NOT_INVITED` (`:232-239`), then `join_single_org`, then the personal org.

**Gap 1: denied, then invited, still denied.** A denied first login still creates the user row. On the next login `profile` is null, so step 2 is skipped and the user is denied again. The only way in is the token link (`POST /api/organization/invitations/accept`, `organization.router.ts:867-871`, which skips `getApplicationMetadata`). This breaks the acceptance criterion "an invited one joins their org" whenever the user tried to sign in before they were invited, and enterprise users are the people most likely to do that.

### Web

`SSO_PROVISIONING_NOT_INVITED` appears nowhere in `apps/web/src` or `packages/`. `client.ts:23-30` stops retrying on a 4xx, and `onAuthError` (`:54-60`) only handles 401 and `ORGANIZATION_USER_NOT_FOUND`. The 403 therefore shows up as whatever generic error each `sdk.organizations.current()` consumer renders. The nearest existing pieces are `views/Forbidden.view.tsx:9-16` and the copy table in `AcceptInvitation.view.tsx:49-85`.

**Gap 2: there is no not-invited screen.** The PRD answer assumed one exists. It has to be built (see Open questions 1).

### Auth0 `sub` and the tenant posture

- Nothing in production code parses `sub`. It's stored opaquely as `auth0Id` (`packages/core/src/models/user.model.ts:13`).
- Auth0 builds a user id as `<strategy>|<connection>|<id>` for enterprise connections (`samlp|acme-okta|…`, `oidc|…`, `okta|…`). Social and Database ids have two segments (`google-oauth2|…`, `auth0|…`; `docs/AUTH0_CLI_OPS.md:103`).
- The QA sign-in is a Database connection (`auth0|…`), and its identities already belong to the QA org, so they never reach the fallback.
- The API holds no Auth0 Management API credential (the only Auth0 env is `AUTH0_DOMAIN` / `AUTH0_AUDIENCE`, `environment.ts:9-10`).
- Posture docs: `docs/PROD_PROVISIONING.runbook.md:83` ("the tenant needs no Action at all"), `docs/AUTH0_CLI_OPS.md:112`, and `docs/ENTERPRISE_SSO.runbook.md:29-36`. Line `:33` of the last says a `sub`-prefix convention can't be used; this ticket makes that line false.

### Tests

- `apps/api/src/__tests__/config/sso.config.test.ts:125-200` covers `enterpriseClaim` and `provisioningFallback`.
- `__tests__/middleware/metadata.middleware.test.ts:216-230` checks that the 403 passes through.
- `__tests__/services/application.provision.test.ts`.
- `__tests__/__integration__/services/ensure-provisioned.integration.test.ts` covers deny with no invite (`:347`) and an invite winning over deny (`:363`).
- Nothing in e2e covers SSO.

## The design space

### Decision 1: where the enterprise marker comes from

**A. A narrow post-login Action** that only sets a connection claim (`event.connection.name`) and keeps today's claim matching. #873's failure mode was an Action that *called the API*, and this one wouldn't. It is still vendor-side logic in every tenant, invisible to code review and CI, and the runbooks would gain a "never restore the Action" exception.

**B. Key off the connection segment of `sub`.** Auth0 already signs `sub` into every access token. A new `SSO_ENTERPRISE_CONNECTIONS` (a comma-separated list of connection names) is matched against the middle segment of a three-segment `sub`. Nothing changes vendor-side. A self-serve user can't influence the segment: connection names are created by the tenant admin, and the token is verified.

**C. A server-side connection registry.** The server can learn a user's connection two ways. One is from `sub` (that's B with a different store). The other is from Auth0's Management API (`identities[].connection`), which adds a new credential, a new egress call on the login path, and a new failure mode.

| | A: Action claim | B: `sub` segment | C: Mgmt API registry |
|---|---|---|---|
| Vendor-side change | New Action per tenant | None | M2M client + scopes |
| Keeps #873 posture | Exception recorded | Yes | Yes |
| Visible in code review | No | Yes | Yes |
| New egress or credential | No | No | Yes (login path) |
| Relies on | Action deployed per env | Auth0's id format | Mgmt API availability |
| Failure if the format differs | n/a | Connection never matches → personal org | n/a |

**Lean: B.** It's the only option with no vendor-side state and no new credential, and it reads a signed claim we already verify. Its one risk is a strategy whose id omits the connection name. That fails *open*, so the connection silently isn't gated. Smoke checks each configured connection's real id, and the runbook says to.

### Decision 2: where the list lives

**A. An env var via SSM** (`portalops vars`), with an optional `ValueFrom` in `backend.yml` behind a condition like `HasGithubDispatchToken` (`backend.yml:135`, `:661`). It's read on each call, as `SsoConfig` does today. Adding a customer means a redeploy or task restart.

**B. A DB table** managed by `portalops`. It changes live with no restart, but brings a new table, migration, repository and CLI command. Its natural use is per-org binding, which the PRD ruled out.

**Lean: A.** Onboarding an enterprise customer is a rare, operator-run event that already involves creating the Auth0 connection, so a restart is acceptable. A table is warranted only if per-org binding ever comes back.

### Decision 3: what happens to `SSO_ENTERPRISE_CLAIM` / `_VALUE`

**Remove** them (no deployed env sets them, and the memory rule is "no compat aliases"), or **keep** them alongside the list as an OR.

**Lean: remove.** They describe the Action path we're declining. `SSO_ISSUERS` directly-trusted issuers are covered by Open question 3, not by keeping a generic claim.

### Decision 4: re-checking invitations for an existing user with no membership

**A.** On the `deny` path only, resolve userinfo and run `acceptPendingForEmail` before throwing.
**B.** Do the same for every no-membership fallback, `personal_org` included.

**Lean: A.** It fixes the acceptance criterion with the narrowest change. The cost is one userinfo call, and only for a user who is about to be denied. B changes #584's documented behavior for self-serve users ("they accept via the token endpoint", `application.service.ts:199-201`), so it's its own ticket.

### Decision 5 — enterprise sign-in entry point (amendment, 2026-10-29)

The smoke scaffold found that a deployed build can't reach an enterprise connection. The only sign-in button pins `connection: "google-oauth2"` (`apps/web/src/providers/Auth.provider.tsx:152`). Auth0's own login page is reachable only from a dev-only button (`LoginForm.component.tsx`, `import.meta.env.DEV`). Without an entry point, the gate never runs outside local dev, so the issue was amended to include one.

**A. Email → the app routes.** "Sign in with SSO" asks for a work email. An anonymous API lookup maps its domain to a connection from config, and the web calls `loginWithRedirect` with that `connection` pinned and the email as `login_hint`. Nothing in the Auth0 tenant changes, and the QA sign-in is untouched.

**B. Auth0 Identifier First with Home Realm Discovery.** Domains live on each Auth0 connection, but the setting is tenant-wide and changes the QA sign-in flow that e2e and `verify-login` drive.

**C. Auth0's login page with every connection as a button.** Every customer's IdP is visible to everyone, and the QA Database connection's password form shows too.

| | A: app routes | B: identifier first | C: Auth0 buttons |
|---|---|---|---|
| Tenant-wide Auth0 change | No | Yes | Display flags |
| QA / e2e sign-in affected | No | Yes | Password form shown |
| Where the domains live | Our config | Auth0 connection | n/a |
| Reveals a domain has SSO | Yes (rate-limited) | Yes (Auth0 behavior) | Shows every IdP |

**Decision: A** (confirmed). The domain map joins the gating list as **one JSON value**, `SSO_ENTERPRISE_CONNECTIONS=[{"connection":"acme-okta","domains":["acme.com"]}]`, so every listed connection is both routed and gated. `none` still means off. The lookup is `POST /api/public/sso-discovery` with body `{ email }`, rate-limited per IP; it uses a body so the email never appears in a URL or access log. An unmatched domain is an inline error on the form. The exposure, a public answer to "does this domain have SSO", is accepted as standard for SSO discovery. No session or user data is involved.

## Tradeoff comparison

| | D1: `sub` segment | D2: SSM env var | D3: remove claim vars | D4: deny-path re-check |
|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes |
| Touches vendor config | No | No | No | No |
| New contract surface | One env var | CFN + catalog | Deletes two env vars | None |

## Recommendation

1. Replace `SSO_ENTERPRISE_CLAIM` / `_VALUE` with `SSO_ENTERPRISE_CONNECTIONS`, a comma-separated list of Auth0 connection names, read only in SaaS mode.
2. `SsoConfig.provisioningFallback` returns `deny` when the token's `sub` has three or more `|`-separated segments and the second segment exactly equals a configured name. Otherwise SaaS returns `personal_org`. Residency is unchanged.
3. Parse the list at boot next to `SsoConfig.issuers()` (`apps/api/src/index.ts:46-66`), failing fast on an entry that is empty, contains `|`, or names a social or Database strategy such as `auth0` or `google-oauth2`.
4. In `ensureProvisioned`, when the fallback is `deny` and the user has no live membership, resolve userinfo and run `SeatService.acceptPendingForEmail` (verified email only) before throwing.
5. Wire `SSO_ENTERPRISE_CONNECTIONS` as an optional SSM parameter: add it to `packages/devops-cli/src/catalog.ts` and add a conditional `ValueFrom` in `backend.yml`, with the parity tests updated.
6. Build a web not-invited state for `SSO_PROVISIONING_NOT_INVITED`: it explains that an invitation from their organization is required and offers sign out.
7. Rewrite `docs/ENTERPRISE_SSO.runbook.md:29-36` and its env table, and note in `PROD_PROVISIONING.runbook.md` and `AUTH0_CLI_OPS.md` that gating needs no Action.

## Open questions

1. **What does the not-invited screen look like, given none exists?** The PRD answer assumed an existing screen. Lean: a minimal state in the authorized layout, keyed on the error code, with the title "You need an invitation", one line of copy and a Sign out button. It reuses `Forbidden.view.tsx`'s shape rather than a new route. The issue's denied-state criterion now asks for this screen.
2. **Does every enterprise strategy we'd use put the connection name in `sub`?** This is confirmed for `samlp`, `oidc` and `okta` from Auth0's id convention. It is unverified for `waad`, `adfs` and `google-apps` (`google-apps` may be two-segment). Lean: document the supported strategies, and have the runbook tell the operator to read one real user id from the tenant before enabling. A non-matching strategy fails open, which is today's behavior.
3. **Should a directly-trusted `SSO_ISSUERS` issuer (not brokered by Auth0) be gate-able?** Its tokens carry no Auth0 `sub` format. Lean: out of scope. No SaaS customer federates directly today, and if one does, an `enterprise: true` flag on the issuer entry is the natural extension.
4. **Should a denied login still create a user row?** It does today. Lean: keep it. The row is what the token-link accept and the Decision 4 re-check attach to, and it costs nothing.

## Enterprise-scale considerations

- **Concurrency & correctness.** The re-check runs inside the existing `withProvisioningLock(auth0Sub)`, and `acceptPendingForEmail` already consumes invites transactionally. Lean: no new locking.
- **Accuracy & auditability.** A denial is a 403 that `req.log` already records, and acceptance goes through `SeatService`'s audit context. Lean: log the matched connection name at info on deny. No new ledger.
- **Failure modes.** A misconfigured or non-matching list fails **open** (personal org, today's behavior). A malformed list fails **closed at boot**. Lean: that split is right, because a boot failure is loud while a silent deny would lock real users out. The userinfo call on the deny path can fail; then deny anyway. It's the safe side, and a retry re-checks.
- **Scale & unbounded growth.** The list is O(customers), small, and parsed per call or cached on parse. The userinfo call fires only for users about to be denied. Lean: no concern.
- **Multi-tenancy.** Global list, and the invitation decides the org (PRD). A user invited to org X through Acme's connection joins X. Lean: accepted. Per-org binding was explicitly declined, and Decision 2's table is its future home.
- **Contract stability.** One env var replaces two. It sits on `SsoConfig`, so a future per-org or per-issuer source plugs in behind `provisioningFallback` without touching callers.
- **Data lifecycle.** N/A, because nothing is retained or windowed. Existing personal orgs of enterprise users stay (PRD); the runbook gives the manual cleanup.

## What this doesn't decide

- Residency (always joins the single org).
- Per-org connection binding and org-owner configuration (declined in the PRD).
- Email re-check for self-serve users with no membership (Decision 4B), which belongs in its own ticket.
- Gating for directly-trusted `SSO_ISSUERS` issuers (Open question 3).
- Auto-joining by email domain.

## Next step

`/spec 916` turns the Recommendation into the contract: the env var's grammar, the `provisioningFallback` truth table, the deny-path re-check, the web state and its copy, and the CFN/catalog wiring. `/plan 916` will likely slice it as:
1. `SsoConfig` and boot parse, with unit tests.
2. The `ensureProvisioned` re-check, with integration tests.
3. The web not-invited state.
4. CFN, catalog and parity tests.
5. Runbooks.

Smoke needs a real Enterprise Connection in the app-dev tenant, so it is largely manual.
