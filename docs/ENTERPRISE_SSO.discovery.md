# Enterprise SSO — Discovery

**Issue:** [EnterpriseBT/portal-ai#577](https://github.com/EnterpriseBT/portal-ai/issues/577)

**Why this exists.** Enterprise customers expect to log in with their own IdP, and a self-contained residency install *requires* it — it can't route auth through our Auth0 without a runtime dependency on our infra. The token layer is already generic OIDC; the Auth0-specific parts are the *hardcoded* issuer/audience, the webhook-driven JIT provisioning, and the `google-oauth2`-pinned login. This ticket makes the validator config-driven, moves provisioning onto the request path so an IdP with no Auth0 Action can still onboard users, and splits provisioning behavior by deployment model. **This is the identity seam that lets one image authenticate against Auth0 (SaaS), a customer's own OIDC (self-hosted), or a bundled issuer (self-hosted fallback) — chosen by config, not a fork.**

Scope was fixed at the discovery gate (issue body → "Scope decisions"): **operator-configured, no in-app SSO UI**; **multi-tenant SaaS IdP→org auto-mapping deferred**; **split provisioning** — self-hosted JIT (first user → owner), SaaS invite-gated (unmatched → denied).

## The current shape

### Token validation (one hardcoded seam)

| Piece | Location | Note |
|---|---|---|
| Validator | `apps/api/src/middleware/auth.middleware.ts:12-16` | Single `express-oauth2-jwt-bearer` `auth()` → `jwtCheck`. `audience`, `issuerBaseURL` (from one `AUTH0_DOMAIN`), `tokenSigningAlg: "RS256"` all single-source/literal. |
| Env | `apps/api/src/environment.ts:9-10` · `apps/api/.env.example:40-41` | `AUTH0_AUDIENCE`, `AUTH0_DOMAIN`. Flat `process.env` reads, **no zod validation gate**. |
| Chain | `apps/api/src/routes/protected.router.ts:33,39-41` · `app.ts:58,87,91,96` | `jwtCheck` first on `/api`, then per-user rate limiter. Webhooks/SSE/public mount *before* `/api` to bypass `jwtCheck`. |

### Provisioning (the hook already exists)

Two entry points converge on one idempotent core — and the request-path one is already what this ticket wants:

| Path | Location | Role |
|---|---|---|
| Eager (Auth0 webhook) | `POST /api/webhooks/auth0/sync` → `webhook.router.ts:114-168` → `webhook.service.ts:15-97` | HMAC-verified; the **Auth0-specific dependency** to drop. |
| **Request-path self-heal** | `metadata.middleware.ts:49-75` | On missing user/membership, fetches the Auth0 profile from the request's *own* bearer token (`auth0.service.ts:42-78`) and calls `ensureProvisioned`. **This is "on first token, ensure this user exists."** |
| Idempotent core | `application.service.ts:151-252` | Advisory lock keyed by Auth0 `sub`; `findOrCreateByAuth0Id` (unique `users_auth0_id_unique`, `users.table.ts:27`); **tries `acceptPendingForEmail` (`:194-208`), else provisions a personal owner-org** (`provisionOrganizationInTx:391-434`, role `owner`). |

### Membership, roles, invitations

| Piece | Location | Note |
|---|---|---|
| Membership | `organization-users.table.ts` · `organization-users.repository.ts` | `role` enum owner/admin/member (CHECK), `lastLogin`. |
| RBAC (#576) | `permission.service.ts:65-77,85-94` | `check()` guard + `visibilityPredicate()`, driven by `PermissionContext {userId, organizationId, role}` — the same triple `getApplicationMetadata` attaches. |
| Active org | `application.service.ts:32-58` | Live memberships ordered `last_login DESC NULLS LAST`, limit 1. |
| Invitations (#584) | `invitations.table.ts` · `seat.service.ts` | `acceptByToken` (`:261-318`) and **`acceptPendingForEmail` (`:327-383`), already called from `ensureProvisioned`** — joins invited org(s) instead of a personal org. Seat-cap under an advisory lock. |

### Frontend login

| Piece | Location | Note |
|---|---|---|
| Provider | `apps/web/src/providers/Application.provider.tsx:57-67` | `Auth0Provider` from `VITE_AUTH0_*`. |
| The pin | `apps/web/src/api/auth.api.ts:19-27` | `withGoogle` hardcodes `connection: "google-oauth2"`. `withUniversal` (`:35-41`) pins nothing. |
| Affordance | `LoginForm.component.tsx:122-147` | Single "Sign in with Google" button + the `?e2e` dev-login (`:103-114`). No connection selector — consistent with "no in-app SSO UI". |

### What does *not* exist yet

**No deploy-mode seam (#579).** The survey grepped `DEPLOY_MODE`/`residency`/`selfHosted` — nothing. There is no `saas`-vs-`self_hosted` discriminator anywhere. The split-provisioning decision therefore has **nothing to branch on today**; one must be introduced here (Decision 3).

## The design space

### Decision 1 — Config-driven validator: single issuer vs issuer list

The validator must accept a configured issuer (self-hosted → customer OIDC) *and* support a **bundled-issuer fallback** alongside a primary — which one `auth()` instance can't do (it takes a single issuer/JWKS).

| | A · single env issuer | B · ordered issuer list |
|---|---|---|
| Shape | Replace the 3 literals with `AUTH0_*`/`SSO_*` env | `SSO_ISSUERS` list; try each JWKS in order |
| Bundled fallback + primary | ✗ can't hold two | ✓ primary + fallback both valid |
| No-regression default | issuer = today's Auth0 | list defaults to `[today's Auth0]` |
| Cost | trivial | a small multi-issuer resolver / chained `auth()` |

**Lean: B.** The bundled-issuer *fallback* is a deliverable, and "accept the current Auth0 issuer unchanged" is an acceptance criterion — only a list satisfies both. Default the list to today's single Auth0 issuer/audience so SaaS is byte-unchanged. `tokenSigningAlg` becomes per-issuer config (default `RS256`).

### Decision 2 — Drop the webhook, but re-home its per-login duties

The webhook (`webhook.service.ts:15-97`) does **two** jobs, and only one is redundant:

- **New user → provision.** Delegates to the *same* `ensureProvisioned` the request-path self-heal calls (the in-file comment at `:30-33` says so). Fully redundant — self-heal already provisions from the request's own bearer token, IdP-agnostically, for SaaS and self-hosted alike.
- **Returning user → per-login side-effects.** Refreshes the local profile (name/email/picture, `:59-74`) and emits the `auth.login` **audit** row (#575, `:81-94`). The self-heal fires *only* when the user/membership is missing (`metadata.middleware.ts:49`), so it does **not** replicate these for returning users. The webhook is currently the backend's **only "a login happened" signal** — the plain request path sees API calls, not logins.

So a clean drop loses per-login profile-sync and — since #575 is in this very epic — the per-login `auth.login` audit trail.

| | A · drop + re-home on request path | B · keep webhook for SaaS only | C · drop, accept the loss |
|---|---|---|---|
| Provisioning (both modes) | ✓ self-heal | ✓ | ✓ |
| Per-login audit/profile, SaaS | ✓ via login-session claim | ✓ via Auth0 Action | ✗ lost |
| Per-login audit/profile, self-hosted | ✓ same claim path | ✗ (no Auth0 Action there) | ✗ lost |
| Auth0-Action dependency | removed | stays (SaaS) | removed |

**Lean: A.** Drop the webhook, and re-home the per-login duties onto the request path by detecting a *new login session* from a token claim (`auth_time` / `iat` / `sid`) in `metadata.middleware.ts` — refresh the profile and emit `auth.login` when the session is newer than the last recorded login. This is the only option giving **both** modes per-login audit without an Auth0 Action (self-hosted can't have one), which is why B collapses into A the moment self-hosted needs the same thing. Remove the route, `syncUser`, and `AUTH0_WEBHOOK_SECRET` once the request-path login-detection lands; confirm no external caller hits `/api/webhooks/auth0/sync` first.

### Decision 3 — The deploy-mode discriminator (self-hosted JIT vs SaaS deny)

`ensureProvisioned` today does one thing when no invite matches: **provision a personal owner-org**. Self-hosted wants that (first user → owner of the single org tree); SaaS enterprise wants the opposite (**deny** — no silent personal org). We need a switch, and #579 doesn't exist.

| | A · minimal `DEPLOY_MODE` env here | B · block on #579 | C · infer from config |
|---|---|---|---|
| Unblocks wave 2 | ✓ | ✗ (#579 is unbuilt, in epic #569) | ✓ |
| Explicit / testable | ✓ `saas` \| `self_hosted` | — | ✗ fragile (issuer-sniffing) |
| Forward-compatible with #579 | ✓ #579 generalizes this field | ✓ | ✗ |

**Lean: A.** Introduce `DEPLOY_MODE` (`saas` default | `self_hosted`) in `environment.ts`, consumed only where provisioning branches. #577 is the concrete caller that justifies it (not speculative infra); #579 later absorbs it into the fuller seam. Behavior: `self_hosted` → JIT (first user, by `count == 0`, → owner; rest → member of the one org); `saas` → today's behavior, plus the enterprise-deny rule (Decision 4).

### Decision 4 — Distinguishing enterprise-federated from self-serve within SaaS

In `saas` mode both self-serve Google users (→ personal org, per #583) and enterprise-federated users (→ invite-or-deny) hit the same `ensureProvisioned`. Denying "unmatched" for *everyone* would break Google self-serve signup. The two must be told apart — by a token claim identifying the connection/IdP.

| | A · claim-gated deny (default off) | B · deny all unmatched in saas |
|---|---|---|
| Google self-serve unaffected | ✓ (no enterprise claim → personal org) | ✗ regresses signup |
| Needs | a configured enterprise-connection claim/prefix | nothing |

**Lean: A.** Gate the deny-unmatched rule on a configured enterprise-connection marker (e.g. an Auth0 connection/`sub` prefix or a namespaced claim); with none configured, SaaS behavior is unchanged. This keeps the deferred multi-tenant mapping *deferred* — invite-gating is the only binding #577 ships — while not regressing self-serve. This is the thinnest SaaS slice consistent with the gate decisions.

## Tradeoff comparison

| | D1 issuer list | D2 drop webhook | D3 `DEPLOY_MODE` | D4 claim-gated deny |
|---|---|---|---|---|
| Spreads to spec | Yes | Yes | Yes | Yes |
| New env contract | `SSO_ISSUERS` (+alg) | removes `AUTH0_WEBHOOK_SECRET` | `DEPLOY_MODE` | enterprise-claim marker |
| Touches web | no | no | no | drop the pin (D-independent) |

## Recommendation

1. Make the validator issuer/audience/alg config-driven as an **ordered issuer list** defaulting to today's Auth0 values (no regression); support a bundled-issuer fallback entry.
2. Make **request-path self-heal the sole provisioning path**; re-home the webhook's per-login profile-refresh + `auth.login` audit (#575) onto the request path via a login-session claim (`auth_time`/`iat`/`sid`), then remove the sync webhook + `AUTH0_WEBHOOK_SECRET`.
3. Introduce a minimal **`DEPLOY_MODE`** (`saas`|`self_hosted`) discriminator, consumed only at the provisioning branch; document it as the seed of #579.
4. `self_hosted`: JIT provision into the single org (first user → owner, rest → member).
5. `saas`: keep #583 self-serve behavior; add a **claim-gated deny** so an enterprise-federated identity with no pending #584 invite is denied, reusing `acceptPendingForEmail` as the bind.
6. Web: drop the `google-oauth2` pin in `withGoogle` (keep Google as the SaaS default connection); no new UI.
7. Emit provisioning/role events to the audit log (#575) so SSO onboarding is auditable.

## Open questions

1. **"First user → owner" detection (self-hosted).** By `users`/membership `count == 0` inside the provisioning advisory lock? **Lean: yes** — the lock (`application.service.ts` sub-keyed) already serializes; add the count check inside it so two simultaneous first-logins can't both become owner.
2. **Email-verification requirement for the invite bind.** `acceptPendingForEmail` matches on verified email. A customer IdP may not assert `email_verified`. **Lean:** require a verified email claim for the SaaS invite-bind; in `self_hosted` (one trusted IdP) treat the IdP's email as authoritative.
3. **Enterprise-connection marker shape (D4).** Auth0 `sub` connection prefix vs a namespaced custom claim. **Lean:** a configurable claim name + expected value, defaulting to unset (SaaS unchanged) — avoids hardcoding an Auth0-ism.
4. **Bundled issuer container.** Who ships it? **Lean:** the Helm chart (#566/#569) ships the issuer; #577 only defines the env contract + an `SsoConfig.isConfigured()` guard mirroring `StripeService.isConfigured()` (`stripe.service.ts:43-47`). Already in Out of scope.
5. **Signing algs beyond RS256.** Some IdPs use ES256/PS256. **Lean:** per-issuer `alg` config, default `RS256`; validate against an allowlist.
6. **Login-session claim for re-homing per-login audit (Decision 2).** `auth_time` (true login time, but not always present), `iat` (always present, but reissued on silent refresh), or `sid` (session id, IdP-dependent). **Lean:** prefer `auth_time`, fall back to `sid`, then `iat`; store the last-seen value on the membership/user and emit `auth.login` + profile-refresh only when it advances — so a token refresh mid-session doesn't spam audit rows.

## Enterprise-scale considerations

- **Concurrency & correctness** — provisioning already runs under a `sub`-keyed advisory lock (`application.service.ts`); the new first-user-owner check must live *inside* it (OQ1). `Lean: reuse the existing lock, no new lease.`
- **Accuracy & auditability** — SSO provisioning + role assignment must land in the #575 audit log, not just pino. `Lean: emit audit events at provision + role grant.`
- **Failure modes** — a customer IdP's JWKS being unreachable fails token validation → 401. `Lean: fail-closed on auth is correct (never fail-open a login); surface a clear 401, don't crash the validator.`
- **Multi-tenancy** — the SaaS deny-unmatched rule *is* the tenant-isolation guard: no federated identity silently lands in or creates an org. Deferring auto-mapping is a **conscious downgrade** — invite-gating is the only SaaS binding #577 ships, recorded in the issue.
- **Contract stability** — `DEPLOY_MODE` + `SSO_ISSUERS` are shaped so #579's fuller deploy-mode seam and a future enterprise-connection→org mapping plug in without re-plumbing `ensureProvisioned`. `Lean: env-additive, mode read at one branch point.`
- **Scale & unbounded growth** — `N/A because` per-login provisioning is idempotent and lock-bounded; no fan-out.
- **Data lifecycle** — `N/A because` no new periodic/retained data; identities reuse the existing `users`/`organization_users` lifecycle.

## What this doesn't decide

- **In-app SSO admin UI** — deferred (operator-configured). Follow-up ticket.
- **Multi-tenant SaaS IdP→org auto-mapping** (connection→org table, email-domain→org) — deferred; invite-gating stands in.
- **A SAML SP in the app** — SAML is brokered by Auth0 (SaaS) or is the customer's own OIDC (self-hosted); the app only validates the resulting OIDC token.
- **Helm chart / bundled-issuer packaging** — authored in #566/#569; #577 defines only the config contract.
- **Generalizing `DEPLOY_MODE`** into the full deploy-mode seam — that's #579; #577 introduces only the minimal field it needs.

## Next step

Write `docs/ENTERPRISE_SSO.spec.md` (the env contract: `SSO_ISSUERS`/alg list, `DEPLOY_MODE`, the enterprise-claim marker; the provisioning decision table by mode; the webhook removal; acceptance criteria) and `docs/ENTERPRISE_SSO.plan.md`. Rough slices: (1) config-driven issuer-list validator, default-preserving; (2) request-path login-session detection (profile-refresh + `auth.login` audit for returning users) then webhook + `AUTH0_WEBHOOK_SECRET` removal; (3) `DEPLOY_MODE` + the self-hosted JIT branch; (4) SaaS claim-gated deny reusing `acceptPendingForEmail`; (5) web pin drop. Each slice green-testable against the seeded org; self-hosted paths that need a real customer OIDC issuer defer their live walk to the #569 epic smoke (no local issuer — a mock is stood up there).
