# Integrate the security epic onto main — Discovery

**Issue:** [EnterpriseBT/portal-ai#616](https://github.com/EnterpriseBT/portal-ai/issues/616)

**Why this exists.** Two epics ran in parallel and both rewrote auth. The **deployment epic (#569)** landed on `main` (live on app-dev) with a *residency* single-OIDC model (#579 deploy-mode seam + #607 runtime OIDC login). The **security epic (#578)**, 13 commits on `epic/security-readiness`, carries an *Enterprise SSO* multi-issuer model (#577) plus audit log/RBAC/seats. Merging them yields **16 conflicts**, and the load-bearing ones are a genuine design collision on `DEPLOY_MODE` + customer-OIDC, not textual noise. This is the ticket that decides how the two auth models reconcile, resolves the merge (including a drizzle migration-number collision where deployment's migrations are already applied to app-dev), and lands the security epic on `main` so both epics sit on `main` for the combined smoke.

## The current shape

### The two auth designs

| | #577 Enterprise SSO (`HEAD`, security) | #579+#607 residency (`origin/main`, **live**) |
|---|---|---|
| `DEPLOY_MODE` | `"saas" \| "self_hosted"` (`environment.ts:11-24`) | `"saas" \| "residency"` (`environment.ts:11-18`) |
| Customer OIDC config | `SSO_ISSUERS` (JSON array, `:19`) + `SSO_ENTERPRISE_CLAIM(_VALUE)` (`:23-24`) | `OIDC_ISSUER` / `OIDC_AUDIENCE` (single) |
| Config authority | `apps/api/src/config/sso.config.ts` (`SsoConfig`: `issuers()` `:53-101`, `provisioningFallback()` `:135-142`) | `apps/api/src/config/deploy-mode.ts` (`parseDeployMode`, `assertDeployModeConsistency` boot guard) |
| Validator | **Multi-issuer**: `buildValidators()` (`auth.middleware.ts:22-36`) → `Map<issuer, auth()>`, route by unverified `iss` (`:42-54`, `:56-81`); unknown → 401 `SSO_UNKNOWN_ISSUER` | **Single-issuer, mode-selected**: `resolveAuthConfig(mode)` (`auth.middleware.ts:18-29`) → residency OIDC or Auth0, **lazy** build (`:47-53`) |
| Provisioning | On-first-token (`metadata.middleware.ts:67-98` → `application.service.ts:153-245 ensureProvisioned`); **removes** the Auth0 post-login sync webhook | unchanged (Auth0 post-login sync webhook still present) |
| Frontend | build-time `selfHosted` switch in `LoginForm` | **runtime** `AuthProvider`/`useAuth()` seam (`providers/Auth.provider.tsx`, `utils/runtime-config.util.ts`, `api/auth.api.ts`) — #607 |

Both validators use `express-oauth2-jwt-bearer`'s `auth()` (JWKS-per-issuer, no custom crypto). The difference is purely **issuer selection**: HEAD's `Map`/route-by-`iss` is the *general* case; main's single-issuer is a *special* case of it.

### The other conflicts (13 more)

| File | Kind | Note |
|---|---|---|
| `constants/api-codes.constants.ts` | combine | HEAD adds `SSO_UNKNOWN_ISSUER`/`SSO_PROVISIONING_NOT_INVITED`; main adds `DEPLOY_MODE_CONFIG_INVALID`/`MARKETPLACE_*`/`ORG_ENTITLEMENT_EXPIRED`/`CONNECTOR_CONFIG_FETCH_FAILED`/`HEALTH_NOT_READY`. Keep all. |
| `services/sync-lock.service.ts` | combine | HEAD `PROVISION_LOCK_NAMESPACE` (#583) + `SEAT_LOCK_NAMESPACE` (#584); main `UPGRADE_LOCK_NAMESPACE` (#581). **Keep all three.** |
| `routes/protected.router.ts` | overlap | HEAD mounts `authenticatedRateLimit` (#574); main mounts `requireOrgWritable` (#568) + `connectorConfigRouter`. Keep both. |
| `routes/webhook.router.ts` | overlap | HEAD removes the Auth0 login-sync route (on-first-token replaces it); main adds the marketplace SNS + `TierGrantService` webhook (#568). Reconcile: **no Auth0 login-sync + keep marketplace**. |
| `.env.example`, `api/keys.ts` | combine | disjoint keys; textual. |
| `web/api/auth.api.ts`, `providers/Application.provider.tsx`, `components/LoginForm.component.tsx` | overlap | Auth0-direct/build-time (HEAD) vs `useAuth()`/runtime (main). |
| `auth.middleware.test.ts`, `LoginForm.test.tsx` | overlap | rewritten per each side. |

### The drizzle collision

Merge-base `275c52da`. Both added migrations at idx 94/95 on **disjoint tables**:

- **main (applied to app-dev):** `0094_rename_stripe_events_to_commercial_events` (a *rename*, preserves data — not drop/create) + `0095_add_org_marketplace_entitlement_columns`.
- **HEAD (not applied live):** `0094_add-audit-log-table`, `0095_add_organization_user_role`, `0096_add_users_auth0_id_unique_index`, `0097_add_org_seats`, `0098_add-user-last-login-session`.

The `.sql` files coexist (distinct names); the real add/add conflicts are `meta/_journal.json`, `meta/0094_snapshot.json`, `meta/0095_snapshot.json`. Also: main **deletes** `stripe-events.repository/table` and adds `commercial-events.*`, so any HEAD code referencing `stripe_events` needs updating post-merge.

## The design space

### Decision 1 — The mode vocabulary

**Options:** (A) `residency` wins (drop `self_hosted`); (B) `self_hosted` wins; (C) keep both as synonyms.

**Decided: A — `DEPLOY_MODE: "saas" | "residency"`.** Deployment's term is **live on main**, on app-dev, in `config/deploy-mode.ts`, and in #607's frontend runtime config. `self_hosted` becomes `residency` throughout #577's code. One term, no synonyms (C invites drift).

### Decision 2 — The auth validator architecture

**Options:** (A) keep HEAD's multi-issuer `Map`/route-by-`iss`, feed it a unified issuer list; (B) keep main's single-issuer mode-select; (C) a new validator.

| | A (multi-issuer Map) | B (single-issuer) |
|---|---|---|
| Handles N SaaS enterprise issuers (#577) | Yes (native) | No (would need rework) |
| Handles residency single OIDC (#579) | Yes (list of one) | Yes |
| JWKS-per-issuer | Yes | One only |

**Decided: A.** HEAD's `Map`/route-by-`iss` is the general case; main's single-issuer is a list-of-one. `SsoConfig.issuers()` becomes the one issuer source: **saas** → Auth0 (derived from `AUTH0_*`) + `SSO_ISSUERS`; **residency** → the single `OIDC_ISSUER`/`OIDC_AUDIENCE`. Preserve main's **lazy build + boot-guard ordering** (`assertDeployModeConsistency` runs before any `auth()` construction) so a bad config reports cleanly rather than crashing at import.

### Decision 3 — Config surface + boot guard

**Decided: keep both var sets, mode-gated, and merge the two config authorities.** `environment.ts` carries `DEPLOY_MODE` (saas|residency) + `SSO_ISSUERS`/`SSO_ENTERPRISE_CLAIM(_VALUE)` (saas enterprise) + `OIDC_ISSUER`/`OIDC_AUDIENCE` (residency). `config/deploy-mode.ts`'s `assertDeployModeConsistency` guard stays (residency requires OIDC_*, forbids Stripe) and gains: residency ⇒ ignore `SSO_ISSUERS`. `SsoConfig` consumes `deploy-mode.ts` for the mode and builds the issuer list accordingly (the two config files compose; `SsoConfig` is the issuer authority, `deploy-mode.ts` the mode + guard authority).

### Decision 4 — Frontend seam

**Decided: main's runtime `AuthProvider`/`useAuth()` seam (#607) wins; fold #577's needs into it.** Main's runtime-configured seam is live and strictly more capable than HEAD's build-time `selfHosted` switch. `LoginForm` reads `getRuntimeConfig()` (main) for generic sign-in copy / provider icon; #577's build-time branch is dropped. `Application.provider.tsx` keeps main's `<AuthProvider>` and re-adds #585's `onRedirectCallback` returnTo behavior.

### Decision 5 — Provisioning + webhook

**Decided: #577's on-first-token provisioning wins; the Auth0 login-sync webhook stays removed; keep main's marketplace webhook.** These are different webhooks — the Auth0 post-login sync (superseded by `ensureProvisioned`, `application.service.ts:153-245`) vs the marketplace SNS/`TierGrantService` webhook (#568). Reconciled `webhook.router.ts` = no Auth0 login-sync + the marketplace routes.

### Decision 6 — Drizzle renumber direction

**Options:** (A) renumber **security's** 0094-0098 → 0096-0100 (after deployment's applied 0094/0095); (B) renumber deployment's → 0099/0100 (keep security's 0094-0098).

**Decided: A.** Deployment's 0094/0095 are **applied to app-dev**; keeping them at their original lower idx means the new (security) migrations are strictly higher idx, so drizzle applies everything in natural ascending order (applied-first) — no reliance on applying a lower-idx migration after a higher-idx one (B's hazard). SQL content is preserved on both sides (hashes unchanged → app-dev skips deployment's by hash). Rebuild `_journal.json` (0-100: base 0-93, deployment 0094/0095, security 0096-0100) + the security snapshots (now cumulative on deployment's 0095). Keep deployment's 0094/0095 snapshots as-is.

## Tradeoff comparison

| | D1 residency | D2 multi-issuer | D4 runtime FE | D6 renumber security |
|---|---|---|---|---|
| Preserves live app-dev behavior | Yes | Yes (superset) | Yes (it's live) | Yes (applied migrations untouched) |
| Spread to spec | Yes | Yes | Yes | Yes |

## Recommendation

1. Unify `DEPLOY_MODE` to `"saas" | "residency"`; rename #577's `self_hosted` → `residency` everywhere.
2. Keep HEAD's multi-issuer validator; make `SsoConfig.issuers()` the single issuer source: saas → Auth0 + `SSO_ISSUERS`; residency → `OIDC_ISSUER`/`OIDC_AUDIENCE`. Preserve main's lazy-build + boot-guard ordering.
3. `environment.ts` carries all three var sets; `config/deploy-mode.ts` guard stays and is extended (residency ignores `SSO_ISSUERS`); `SsoConfig` composes with `deploy-mode.ts`.
4. Frontend: main's `AuthProvider`/`useAuth()`/`runtime-config.util` seam wins; fold `LoginForm`'s generic-copy need into it; drop #577's build-time switch.
5. `webhook.router.ts`: on-first-token provisioning stays; Auth0 login-sync removed; marketplace webhook kept. `api-codes`, `sync-lock` (three namespaces), `protected.router`, `.env.example`, `keys.ts`: combine both sides' additions.
6. Renumber security's migrations 0094-0098 → 0096-0100 after deployment's 0094/0095; rebuild journal + security snapshots; preserve all SQL. Update any HEAD code referencing `stripe_events` → `commercial_events`.
7. Verify: `db:generate` no-op; `db:migrate` clean on a fresh DB **and** correct (skip-then-apply) on a DB holding deployment's migrations; full unit+integration suites; then land via `chore/616-integrate-security-epic → main` (Closes #578 + children + #616), app-dev deploy green.

## Open questions

1. **Does the residency OIDC issuer flow through `SsoConfig.issuers()` or stay a separate path?** Folding it into `issuers()` (as a list-of-one in residency) unifies the validator. **Lean: fold in** — one validator, one issuer source; `deploy-mode.ts` decides which set feeds it.
2. **`SSO_ENTERPRISE_CLAIM` gating in residency?** Residency is single-tenant; enterprise-claim invite-gating is a saas concept. **Lean: residency ignores it** (guard-enforced, D3).
3. **Any HEAD `stripe_events` references beyond migrations?** The security epic predates the rename; code/tests referencing `stripe_events` must move to `commercial_events`. **Lean: sweep for `stripe_events`/`stripe-events` post-merge and update; a grep + type-check catches them.**
4. **Local dev DB verification** — it currently holds deployment's migrations (I ran `db:upgrade`) and possibly stale security ones. **Lean: the fresh integration-test DB is the authoritative apply-order check; reset the local dev DB before the skip-then-apply check.**

## Enterprise-scale considerations

- **Concurrency & correctness.** All three advisory-lock namespaces (provision/seat/upgrade) must survive the merge — they key distinct operations. **Lean: keep all three; a namespace-collision test would be cheap insurance.**
- **Accuracy & auditability.** #575 audit log + #577 SSO events must remain intact through the merge; the reconciled auth path still records provisioning. **Lean: preserve; integration tests assert provisioning + audit still fire.**
- **Failure modes.** The boot guard (`assertDeployModeConsistency`) is **fail-closed** (bad config → exit non-zero) — keep it, and keep the lazy `auth()` build so the guard reports before any validator constructs. **Lean: fail-closed boot, lazy validator.**
- **Multi-tenancy.** saas multi-issuer (many enterprises federating in) vs residency single-tenant — the mode gate keeps them from bleeding. **Lean: mode-gated issuer list.**
- **Contract stability.** After this, `SsoConfig.issuers()` is the single seam any future identity source plugs into. **Lean: that seam is the contract.**
- **Data lifecycle.** The `stripe_events`→`commercial_events` rename preserves data; renumbering preserves applied-migration hashes. **N/A beyond that.**

## What this doesn't decide

- **New auth capabilities** — this reconciles #577 + #579/#607 only; no new SSO/OIDC features.
- **The remaining #578 children** (#397, #598, #599, #613) — they proceed off `main` after this lands.
- **Retiring `epic/security-readiness`** mechanics beyond deleting it post-merge.
- **Prod deploy** — this lands on `main` (→ app-dev); prod is a later manual release.

## Next step

`docs/INTEGRATE_SECURITY_EPIC.spec.md` pins the reconciled `SsoConfig`/`environment.ts`/`auth.middleware.ts` contract (the unified issuer list + mode gate), the exact drizzle renumber + journal shape, and the per-file resolution; `.plan.md` slices it as: (1) resolve the merge's combine-conflicts + drizzle renumber (verify migrate/generate), (2) reconcile the API auth validator + `SsoConfig`/`deploy-mode.ts` + provisioning/webhook, (3) reconcile the frontend seam, (4) `stripe_events`→`commercial_events` sweep + full-suite green, (5) land to main + app-dev verify. Each slice green before the next; the merge itself is the first commit on `chore/616-integrate-security-epic`.
