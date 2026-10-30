# Enterprise SSO invite-gating (SaaS) — Spec

This spec pins the contract that makes enterprise invite-gating work in SaaS with no Auth0 Action. It covers:
- the `SSO_ENTERPRISE_CONNECTIONS` grammar;
- the `provisioningFallback` truth table;
- re-checking invitations before a deny;
- the web not-invited state;
- the SSM/CloudFormation wiring.

It builds on [`ENTERPRISE_SSO_INVITE_GATING.discovery.md`](./ENTERPRISE_SSO_INVITE_GATING.discovery.md), for [#916](https://github.com/EnterpriseBT/portal-ai/issues/916).

## Key decisions (flag for review)

1. **The marker is the Auth0 connection segment of `sub`** (`<strategy>|<connection>|<id>`). Tenants keep running no post-login Action (#873).
2. **`SSO_ENTERPRISE_CONNECTIONS` replaces `SSO_ENTERPRISE_CLAIM` / `_VALUE`**, with no alias. No deployed environment sets the old vars.
3. **The list is a required SSM parameter, and the literal `none` turns gating off.** SSM rejects an empty value, and an ECS task won't start while a `ValueFrom` parameter is missing. Each environment therefore stores the key, and `none` is the explicit off value. Locally the var may simply be unset.
4. **A non-matching or unsupported strategy fails open** (personal org, today's behavior). **A malformed list fails closed at boot** (`DEPLOY_MODE_CONFIG_INVALID`, exit 1).
5. **The deny path re-checks invitations by verified email** before throwing. If userinfo fails, the user is denied anyway. Self-serve users with no membership are unchanged (#584 behavior).
6. **A denied login keeps its user row** (confirmed in discovery).
7. **The web not-invited state is a route, `/not-invited`.** The client's global error handler sends any `403 SSO_PROVISIONING_NOT_INVITED` there. It renders under `PublicLayout`, so no org-reading chrome mounts (the #881 rule).
8. **Strategy names are not rejected.** Discovery suggested refusing entries like `auth0`. The spec drops that rule: matching only reads the middle segment of a three-segment `sub`, so a strategy name in the list can never match anything.
9. **Amendment (2026-10-29): an enterprise sign-in entry point.** A deployed build's only sign-in button pins Google, so the sign-in page gains "Sign in with SSO". The user enters a work email, `POST /api/public/sso-discovery` maps its domain to a connection, and the web redirects to Auth0 with that `connection` pinned and the email as `login_hint`. Nothing changes in the Auth0 tenant (discovery Decision 5).
10. **`SSO_ENTERPRISE_CONNECTIONS` is JSON** (amendment): `[{"connection":"acme-okta","domains":["acme.com"]}]`. Every listed connection is both routed (by email domain) and gated (by `sub`). `none` and unset still mean off. This supersedes the comma list in slice 1, which never shipped.
11. **The anonymous lookup is accepted exposure.** It answers only `{ connection }` for a domain, never user or org data. It's rate-limited per IP with its own code, and the email travels in a body, not a URL.

## Scope

### In scope
- `SsoConfig` parsing and matching, plus the boot-time parse.
- The deny-path invitation re-check in `ensureProvisioned`.
- The web `/not-invited` route, view and global redirect.
- The env var in `environment.ts`, `.env.example`, `catalog.ts`, `backend.yml` and the egress-parity map.
- Runbooks: `ENTERPRISE_SSO`, `PROD_PROVISIONING`, `AUTH0_CLI_OPS`.

### Out of scope
- Residency, which always joins the single org.
- Per-org connection binding and org-owner configuration.
- Gating directly trusted `SSO_ISSUERS` issuers.
- The email re-check for self-serve users with no membership.
- Auto-joining by email domain.
- Cleaning up personal orgs that enterprise users already have. The runbook gives the manual steps.

## Surface

### `apps/api/src/config/sso.config.ts`

- **Remove** `EnterpriseClaimConfig`, `enterpriseClaim()` and `isEnterpriseFederated()`.
- **Add** `static enterpriseConnections(): ReadonlySet<string>`.
  - It reads `environment.SSO_ENTERPRISE_CONNECTIONS` on each call (no caching, matching the file's convention).
  - **Off:** unset, blank after trim, or exactly `none` returns an empty set.
  - **Otherwise** (amended), the value is JSON: a non-empty array of `{ connection: string, domains: string[] }`.
    - `connection` must match `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,126}[A-Za-z0-9])?$` (Auth0's connection-name rule). It is case-sensitive and must not be `none`.
    - `domains` is a non-empty array of lowercase hostnames, each matching `^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$`.
    - A connection or a domain listed twice throws. Unknown keys throw.
    - Malformed JSON, a non-array, an empty array or an invalid entry throws `Error("SSO_ENTERPRISE_CONNECTIONS…")`, naming the index and field.
  - It returns the set of connection names. A new `static enterpriseDomains(): ReadonlyMap<string, string>` returns domain → connection, parsed the same way.
- **Add** `static connectionForEmail(email: string): string | null`. Returns `null` in residency. Otherwise it lowercases the part after the last `@` and looks it up exactly in `enterpriseDomains()`, so `jo@ACME.com` matches `acme.com`, and a subdomain such as `eu.acme.com` doesn't match unless it's listed.
- **Add** `static connectionOf(sub: unknown): string | null`.
  - It returns `sub.split("|")[1]` when `sub` is a string with three or more `|`-separated segments and that segment is non-empty. Otherwise it returns `null`.
  - `google-oauth2|1` and `auth0|abc` therefore return `null`, and `samlp|acme-okta|jo@acme.com` returns `acme-okta`.
- **Change** `provisioningFallback(payload)`. The signature is unchanged, and the cases are checked in order:

| Mode | `connectionOf(payload?.sub)` | Result |
|---|---|---|
| residency | any | `join_single_org` |
| saas | in `enterpriseConnections()` | `deny` |
| saas | `null`, or not in the set | `personal_org` |

- The `ProvisioningFallback` doc (`:21-28`) changes to say "SaaS login through a configured enterprise connection" in place of "enterprise-federated".

### `apps/api/src/index.ts` (boot)

Inside the existing guard `try` (`:46-66`), call `SsoConfig.enterpriseConnections()` right after `SsoConfig.issuers()`.
- A throw takes the existing path: `logger.fatal({ err, code: DEPLOY_MODE_CONFIG_INVALID })`, then `process.exit(1)`.
- On success in SaaS, it logs `logger.info({ enterpriseConnections: [...set] }, "Enterprise SSO connections resolved")`.

### `apps/api/src/services/application.service.ts` (`ensureProvisioned`)

The signature is unchanged. The `deny` branch (`:232-239`) becomes:
1. Only when `profile` is `null` (an existing user, whose first-login accept never ran this request):
   - Resolve `resolveProfile()`, swallowing an error into `null`.
   - If the result has `emailVerified && email`, run `SeatService.acceptPendingForEmail(user, email, auditCtx ?? {sourceIp:null,userAgent:null})`.
   - If that joins an org, return `{ user, organization, organizationUser, created: true }`. This mirrors the first-login branch at `:202-215`.
2. Otherwise, log `logger.info({ userId: user.id }, "SSO provisioning denied: not invited")` and throw the existing `ApiError(403, ApiCode.SSO_PROVISIONING_NOT_INVITED, …)`. The message is unchanged.

All of this runs inside the existing `withProvisioningLock(auth0Sub)`, so no new locking. No new `ApiCode`.

### `apps/api/src/environment.ts`, `apps/api/.env.example`

- Replace `SSO_ENTERPRISE_CLAIM` and `SSO_ENTERPRISE_CLAIM_VALUE` with `SSO_ENTERPRISE_CONNECTIONS: process.env.SSO_ENTERPRISE_CONNECTIONS`.
- Update the comment to give the grammar above.
- `.env.example` shows `# SSO_ENTERPRISE_CONNECTIONS=` with an example `acme-okta,globex-entra` and explains `none`.

### `apps/api/src/__tests__/subprocessor-egress-parity.test.ts`

Replace the two claim keys with `SSO_ENTERPRISE_CONNECTIONS: CUSTOMER_IDP`.

### Deploy wiring

- **`packages/devops-cli/src/catalog.ts`:** add `ssm("SSO_ENTERPRISE_CONNECTIONS", "sso-enterprise-connections")` to the SSM block, with a `#916` comment.
- **`infra/cloudformation/backend.yml`:** add an unconditional `Secrets` entry to the API container, `Name: SSO_ENTERPRISE_CONNECTIONS` with `ValueFrom: …:parameter/portalai/${Environment}/sso-enterprise-connections`, beside `AUTH0_DOMAIN` (`:678`). No new template parameter, so no workflow change.
- **Rollout prerequisite:** `portalops vars set SSO_ENTERPRISE_CONNECTIONS none --env app-dev --yes` must run before this PR merges, because `main` auto-deploys to app-dev. The `prod` equivalent (`--yes --confirm-prod`) must run before the next prod release. Both are recorded in the runbooks and the PR's test plan.

### Web

- **`utils/auth-error.util.ts`:**
  - Add `SSO_PROVISIONING_NOT_INVITED = "SSO_PROVISIONING_NOT_INVITED"` as an exported const.
  - Add `registerNotInvitedHandler(fn: () => void)` and `handleNotInvited(): void`, on the same register/handle pattern as `registerAuthLogout`. Each is a no-op when nothing is registered.
- **`client.ts`:** `onAuthError` also calls `handleNotInvited()` when `error.code === SSO_PROVISIONING_NOT_INVITED`. It's a 403, so the existing 4xx rule already suppresses retries.
- **`routes/__root.tsx`:** `RootComponent` registers the handler in an effect with `navigate({ to: "/not-invited", replace: true })`. That is the first place that has the router.
- **`routes/not-invited.tsx`:** new. `createFileRoute("/not-invited")` rendering `<Authorized><PublicLayout><NotInvitedView /></PublicLayout></Authorized>`. Commit the regenerated `routeTree.gen.ts`.
- **`utils/routes.util.ts`:** add `ApplicationRoute.NotInvited = "/not-invited"`.
- **`views/NotInvited.view.tsx`:** new, following the Component File Policy.
  - `NotInvitedViewUI({ onTryAgain, onSignOut })` is pure. It shows `IconName.Lock` and:
    - title **"You need an invitation"**;
    - body **"Your organization signs you in with its own identity provider, so you need an invitation before you can use Portals AI. Ask someone in your organization to invite this email address, then try again."**;
    - buttons **Try again** (contained) and **Sign out** (text).
  - The copy names no role, to pass `permission-copy.guard`.
  - `NotInvitedView` wires `onSignOut` to `sdk.auth.logout()`'s `logout`. `onTryAgain` invalidates `queryKeys.organizations.root` and navigates to `/`. The next API call re-runs `ensureProvisioned`, which now accepts a newly arrived invite.

### Enterprise sign-in entry point (amendment)

- **`packages/core` contract** (`contracts/sso-discovery.contract.ts`, exported from `@portalai/core/contracts`):
  - `SsoDiscoveryRequestBodySchema = z.object({ email: z.string().trim().email("Enter a valid email address").max(320) }).strict()`.
  - `SsoDiscoveryResponseSchema = z.object({ connection: z.string().nullable() }).strict()`.
- **`apps/api/src/routes/public-sso.router.ts`** (new), mounted in `app.ts` with `app.use("/api/public", publicSsoRouter)` ahead of `protectedRouter`, next to `publicSiteRouter`.
  - It answers `POST /sso-discovery`.
  - The body is `safeParse`d against the request schema; a failure answers `invalidPayload(ApiCode.SSO_DISCOVERY_INVALID_PAYLOAD, …)` (400).
  - Success answers `200 { connection: SsoConfig.connectionForEmail(email) }`, with `Cache-Control: no-store`.
  - It logs `{ matched: boolean }` only, never the email or domain.
  - It carries an `@openapi` block that `$ref`s `SsoDiscoveryRequestBody` / `SsoDiscoveryResponse`, both registered in `swagger.config.ts`.
  - It is classified in `route-authorization.map.ts` as anonymous with no lock, like `GET /api/public/site-config`.
- **`middleware/public-rate-limit.middleware.ts`:** `publicRateLimit(limitPerMinute, code = ApiCode.SITE_CONFIG_RATE_LIMITED, bucket = "site")`. The bucket goes into the counter key, so the two public routes don't share a window. The SSO router uses `publicRateLimit(environment.PUBLIC_SITE_RATE_LIMIT_PER_MIN, ApiCode.SSO_DISCOVERY_RATE_LIMITED, "sso")`.
- **`ApiCode`:** add `SSO_DISCOVERY_INVALID_PAYLOAD` and `SSO_DISCOVERY_RATE_LIMITED`.
- **Web SDK, anonymous calls (a new pattern):** `utils/api.util.ts` gains `usePublicMutation`, which matches `useAuthMutation` but attaches no token and never calls `handleAuthError`. It keeps the same response unwrapping, `ApiError` mapping, `WRITE_TIMEOUT_MS` bound and in-flight dedupe. `api/auth.api.ts` gains `ssoDiscovery: () => usePublicMutation<SsoDiscoveryResponse, SsoDiscoveryRequestBody>({ url: "/api/public/sso-discovery", method: "POST" })`. CLAUDE.md's "API Calls & SDK Helpers" lists the new helper as the only path for an anonymous call.
- **`providers/Auth.provider.tsx`:** `login.withEnterpriseConnection(connection: string, loginHint: string)` calls `loginWithRedirect` with `authorizationParams: { connection, login_hint, redirect_uri }` and the same `appState` return-to. The OIDC (residency) provider's version is a no-op.
- **`components/SsoLoginForm.component.tsx`** (new): `SsoLoginFormUI`, a pure component that holds its own field state. Its props are `{ onSubmit(email): void, onBack(): void, pending: boolean, notConfigured: boolean, serverError: ServerError | null }`.
  - It renders a `<form>` with a "Work email" `TextField` (`type="email"`, `required`, auto-focused).
  - It validates with `validateWithSchema(SsoDiscoveryRequestBodySchema, …)`, keeping `touched`/`errors` and setting `aria-invalid` and `helperText`. It calls `focusFirstInvalidField()` on an invalid submit.
  - The buttons are **Continue** (submit, disabled while `pending`) and **Back** (`type="button"`).
  - When `notConfigured`, it shows an `info` alert: "Single sign-on isn't set up for that email domain. Sign in with Google instead."
  - It renders `<FormAlert serverError>` for a 429 or other failure.
- **`components/LoginForm.component.tsx`:**
  - `LoginFormUI` gains an optional `onClickSso` and renders a text **Sign in with SSO** link under the primary button when that prop is given. The container passes it only when the provider isn't OIDC.
  - The container holds `mode: "default" | "sso"` and renders `SsoLoginFormUI` in SSO mode.
  - On submit it calls `mutateAsync({ email })`. If a `connection` comes back, it calls `withEnterpriseConnection(connection, email)`; otherwise it sets `notConfigured`. Typing again clears `notConfigured`.

## Migration
## Seed

None. No schema or seed change.

## TDD test plan

API: `npm run test:unit` and `npm run test:integration` from `apps/api`. Web: `npm run test:unit` from `apps/web`. devops-cli: `npm run test:unit` from `packages/devops-cli`.

### `apps/api/src/__tests__/config/sso.config.test.ts`

This replaces the `enterpriseClaim` block and the claim cases in `provisioningFallback`.
- `enterpriseConnections`:
  - unset, blank and `none` each give an empty set;
  - parses and trims `acme-okta, globex`;
  - collapses duplicates;
  - throws on `a,,b`, on a trailing comma, on `bad|name`, on `-lead`, on a name over 128 chars, and on `none,acme`;
  - is case-sensitive (`Acme` is not `acme`).
- `connectionOf`:
  - `samlp|acme-okta|jo@acme.com` gives `acme-okta`;
  - `oidc|c|a|b` gives `c`;
  - `google-oauth2|1`, `auth0|x`, `a||b`, `""`, `undefined` and `42` each give `null`.
- `provisioningFallback`:
  - residency gives `join_single_org` even with a listed connection;
  - saas with a listed connection gives `deny`;
  - saas with an unlisted connection gives `personal_org`;
  - saas with a Google or Database sub gives `personal_org`;
  - saas with `none` gives `personal_org`;
  - a missing payload gives `personal_org`. **≈ 22**

### `apps/api/src/__tests__/__integration__/services/ensure-provisioned.integration.test.ts`

`ensureProvisioned` is covered only here; `application.provision.test.ts` deliberately leaves it to this suite (`:228-229`).
- Deny, then invite, then the next call joins the invited org: `created: true`, the invitation is consumed, and no personal org is created.
- On deny, an existing user with no invite throws `SSO_PROVISIONING_NOT_INVITED`. Exactly one user row remains, with zero orgs or memberships.
- On deny, an existing user with an **unverified** email and a pending invite is not accepted, and the call throws.
- On deny, a `resolveProfile` rejection throws `SSO_PROVISIONING_NOT_INVITED`, not 502.
- On deny for a new user, `resolveProfile` is called exactly once (no second userinfo call).
- With `personal_org`, an existing user with no membership still gets a personal org and `resolveProfile` is never called (#584 unchanged).
- The existing `:347` and `:363` cases are kept. **≈ 6 new**

### `apps/api/src/__tests__/middleware/metadata.middleware.test.ts`

- A token whose `sub` is `samlp|acme-okta|…`, with `SSO_ENTERPRISE_CONNECTIONS=acme-okta`, passes `deny` to `ensureProvisioned`.
- The existing `:216-230` passthrough case is kept. **≈ 1**

### `packages/devops-cli/src/__tests__/catalog.test.ts`, `deploy-parity.test.ts`

These need no new cases; the existing parity assertions must stay green with the new key in both files. **0 new (2 suites re-run)**

### Web (`apps/web/src/__tests__/`)

- `NotInvitedView.test.tsx` (new, renders the UI): shows the title and body; Try again calls `onTryAgain`; Sign out calls `onSignOut`.
- `client.test.ts`: a query or mutation error with code `SSO_PROVISIONING_NOT_INVITED` calls the registered not-invited handler, not logout; a plain 403 calls neither.
- `NotInvitedPage` (route) test: renders under `PublicLayout` and mounts no `organizations.current` query.
- `permission-copy.guard.test.ts` runs unchanged and must pass. **≈ 7**

### Amendment tests

- `apps/api/src/__tests__/config/sso.config.test.ts`: the comma-list cases are replaced by JSON grammar cases:
  - unset, blank and `none` are off;
  - parses connections and domains;
  - throws on bad JSON, a non-array, `[]`, a bad name, an empty `domains`, a bad or uppercase domain, a duplicate domain, a duplicate connection, and an unknown key;
  - `connectionForEmail`: case-insensitive match, no subdomain match, no `@`, residency gives null. **≈ 16, replacing ≈ 12**
- `apps/api/src/__tests__/__integration__/routes/public-sso.router.integration.test.ts` (new):
  - a listed domain returns 200 `{ connection }`, unauthenticated;
  - an unlisted domain returns `{ connection: null }`;
  - a malformed email returns 400 `SSO_DISCOVERY_INVALID_PAYLOAD`;
  - an unknown body key returns 400;
  - over the per-minute limit returns 429 `SSO_DISCOVERY_RATE_LIMITED`, and `site-config` keeps its own window;
  - `Cache-Control: no-store`. **≈ 6**
- The route-authorization guard and `strict-request-bodies.test.ts` (core) run unchanged and must pass with the new route and schema.
- Web:
  - `SsoLoginFormView.test.tsx` (UI): renders the field auto-focused; Enter submits a valid email; an invalid email shows "Enter a valid email address" with `aria-invalid`; Back calls `onBack`; the `notConfigured` alert; the `FormAlert`; Continue is disabled while `pending`.
  - `LoginForm.test.tsx`: the SSO link renders only when `onClickSso` is given.
  - A container test with the SDK mocked: a match calls `withEnterpriseConnection(connection, email)`, and `null` shows the alert.
  - `api.util` `usePublicMutation`: sends no `Authorization` header and doesn't call `handleAuthError` on 401. **≈ 12**

**Totals ≈ 36 + ≈ 22 (amendment) ≈ 58 cases.**

## Acceptance criteria

- [ ] In SaaS with `SSO_ENTERPRISE_CONNECTIONS=<conn>`, an uninvited user signing in through `<conn>` gets `403 SSO_PROVISIONING_NOT_INVITED`. The web shows "You need an invitation", no organization is created, and the user's only row is the `users` row.
- [ ] A user invited before their first sign-in through `<conn>` joins the inviting org.
- [ ] A user denied first and invited afterwards joins the inviting org on Try again or on their next sign-in, without the emailed link.
- [ ] A Google self-serve login, and a login through an unlisted connection, still gets a personal org.
- [ ] With the value `none`, or unset locally, behavior is exactly today's.
- [ ] A malformed `SSO_ENTERPRISE_CONNECTIONS` stops the API at boot with `DEPLOY_MODE_CONFIG_INVALID`.
- [ ] Residency is unaffected.
- [ ] `portalops vars describe --env app-dev` lists `SSO_ENTERPRISE_CONNECTIONS`, and app-dev deploys green with it set to `none`.
- [ ] No Auth0 Action exists in any tenant, and the runbooks describe gating without one.
- [ ] **(Amendment)** On a deployed build's sign-in page, **Sign in with SSO** plus a work email on a listed domain redirects to Auth0 with that connection pinned. An unlisted domain shows "Single sign-on isn't set up for that email domain. Sign in with Google instead." and stays on the form. A malformed email shows a field error after blur or submit. Residency doesn't show the link.
- [ ] **(Amendment)** `POST /api/public/sso-discovery` needs no token, answers only `{ connection }`, and returns 429 `SSO_DISCOVERY_RATE_LIMITED` past the per-IP limit.

## Risks & rollback

- **The SSM parameter is missing at deploy.** The ECS task fails to start, and app-dev's deploy goes red. This is caught by the rollout prerequisite and by deploy health. Recover by creating the parameter, then redeploying. Rollback is the revert PR. The parameter can stay, since nothing else reads it.
- **An enterprise strategy omits the connection from `sub`.** The connection fails open (personal org). The runbook step that reads one real user id per connection before listing it catches this, and so does a smoke step.
- **A wrong connection name in the list.** Fails open in the same way. A typo that breaks the grammar fails closed at boot. That is loud and recoverable with `vars set` plus a restart.
- **A legitimate user is wrongly denied.** This only happens to someone with no membership who signs in through a listed connection, which is exactly the population being gated. An operator invites them, and Try again joins them. No data is touched.
- **Extra userinfo call.** It happens only on the deny path, once per refused request, under the provisioning lock. A user stuck on the not-invited page makes no repeated calls, because the page reads nothing.

## Files touched

- **API (edit):**
  - `apps/api/src/config/sso.config.ts`
  - `apps/api/src/index.ts`
  - `apps/api/src/services/application.service.ts`
  - `apps/api/src/environment.ts`
  - `apps/api/.env.example`
- **API tests (edit):**
  - `__tests__/config/sso.config.test.ts`
  - `__tests__/__integration__/services/ensure-provisioned.integration.test.ts`
  - `__tests__/middleware/metadata.middleware.test.ts`
  - `__tests__/subprocessor-egress-parity.test.ts`
- **Deploy (edit):** `packages/devops-cli/src/catalog.ts`, `infra/cloudformation/backend.yml`.
- **Web (new):** `views/NotInvited.view.tsx`, `routes/not-invited.tsx`, `__tests__/NotInvitedView.test.tsx`, `__tests__/NotInvitedPage.test.tsx`.
- **Web (edit):** `utils/auth-error.util.ts`, `client.ts`, `routes/__root.tsx`, `utils/routes.util.ts`, `routeTree.gen.ts` (generated), `__tests__/client.test.ts`.
- **Docs (edit):** `docs/ENTERPRISE_SSO.runbook.md`, `docs/PROD_PROVISIONING.runbook.md`, `docs/AUTH0_CLI_OPS.md`.
- **Amendment:**
  - **Core (new):** `packages/core/src/contracts/sso-discovery.contract.ts`, plus its export.
  - **API (new):** `routes/public-sso.router.ts`, `__tests__/__integration__/routes/public-sso.router.integration.test.ts`.
  - **API (edit):** `app.ts`, `middleware/public-rate-limit.middleware.ts`, `constants/api-codes.constants.ts`, `config/swagger.config.ts`, `__tests__/config/route-authorization.map.ts`, `config/sso.config.ts` (JSON grammar), `.env.example`, `environment.ts` comment.
  - **Web (new):** `components/SsoLoginForm.component.tsx`, `__tests__/SsoLoginFormView.test.tsx`.
  - **Web (edit):** `utils/api.util.ts`, `api/auth.api.ts`, `providers/Auth.provider.tsx`, `components/LoginForm.component.tsx`, `__tests__/LoginForm.test.tsx`.
  - **Docs (edit):** `CLAUDE.md` (the anonymous SDK helper) and the SSO glossary entry (`packages/core/src/content/glossary.util.ts`).

## Next step

`docs/ENTERPRISE_SSO_INVITE_GATING.plan.md` (`/plan 916`) sequences this into about five TDD slices on this branch:
1. `SsoConfig` grammar, matching and the boot parse, including the env and egress-parity rename.
2. The deny-path re-check, with unit and integration tests.
3. The catalog and `backend.yml` wiring.
4. The web `/not-invited` route, view and redirect.
5. The runbooks.

The SSM `none` values must be set in app-dev before merge.
