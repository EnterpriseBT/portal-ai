# Integrate the security epic onto main — Spec

The contract for reconciling the two auth designs and landing the security epic (#578) on `main` alongside the deployment epic (#569). Pins the unified deploy-mode + issuer model, the merged file resolutions, and the drizzle renumber. **Discovery:** `docs/INTEGRATE_SECURITY_EPIC.discovery.md` · **Issue:** [#616](https://github.com/EnterpriseBT/portal-ai/issues/616).

## Key decisions (flag for review)

1. **`DEPLOY_MODE: "saas" | "residency"`** — deployment's live vocab (`config/deploy-mode.ts`) wins; #577's `self_hosted` is renamed `residency` everywhere.
2. **`config/deploy-mode.ts` is the single mode authority** — `SsoConfig` drops its own `DeployMode`/`deployMode()` and imports `isResidency()`/`deployMode` from it.
3. **`SsoConfig.issuers()` is the single issuer source, mode-gated** — residency → one issuer `{OIDC_ISSUER, OIDC_AUDIENCE}`; saas → `SSO_ISSUERS` (or the Auth0 default).
4. **Multi-issuer validator (from #577), made lazy + a boot-time issuer check** — keep the `Map<issuer, auth()>` + route-by-`iss`, but build it on first request (main's ordering) so the boot guard reports first; and call `SsoConfig.issuers()` once in `index.ts start()` (after `assertDeployModeConsistency`) to restore #577's fail-fast on a malformed `SSO_ISSUERS` without eager validator construction.
5. **Frontend runtime seam (#607) wins**; #577's build-time switch folds in.
6. **On-first-token provisioning replaces the Auth0 login-sync webhook; marketplace webhook kept.**
7. **Drizzle: renumber security's `0094–0098 → 0096–0100`** after deployment's applied `0094/0095`; SQL preserved; journal + snapshots rebuilt.

## Scope

### In scope
The 16 conflict resolutions to the reconciled design; `SsoConfig`↔`deploy-mode.ts` composition; the lazy multi-issuer validator; the drizzle renumber; a `stripe_events`→`commercial_events` code sweep; landing to `main`.

### Out of scope
New auth capabilities; the remaining #578 children (#397/#598/#599/#613); retiring `epic/security-readiness` beyond deleting it post-merge; prod deploy.

## Surface

### `apps/api/src/config/deploy-mode.ts` (from main, kept; the mode authority)
Unchanged shape: `type DeployMode = "saas" | "residency"`, `parseDeployMode`, `isResidency()`/`isSaas()`, `deployMode`, `assertDeployModeConsistency(env)` (fail-closed boot guard; residency forbids `STRIPE_*`, requires `OIDC_ISSUER`+`OIDC_AUDIENCE`). **Extension:** the guard's `DeployModeEnv` is unchanged; residency simply never reads `SSO_ISSUERS` (enforced by `SsoConfig`, not the guard).

### `apps/api/src/config/sso.config.ts` (reconciled)
- **Remove** the local `export type DeployMode` (`:16`) and `SsoConfig.deployMode()` (`:44-46`). Import `isResidency` + `deployMode` from `./deploy-mode.js`.
- `issuers(): IssuerConfig[]` — **mode-gated**:
  - `isResidency()` → `[{ issuer: environment.OIDC_ISSUER, audience: environment.OIDC_AUDIENCE, alg: "RS256" }]` (throws if either empty — but the boot guard already guarantees them, so this is defense-in-depth).
  - saas → today's logic (`:54-98`): parse `SSO_ISSUERS` if set, else derive the Auth0 default from `AUTH0_DOMAIN`+`AUTH0_AUDIENCE`.
- `provisioningFallback(payload)` (`:135-142`) — replace `deployMode() === "self_hosted"` with `isResidency()` → `join_single_org`; saas + enterprise claim present → `deny`; else `personal_org`. `enterpriseClaim()`/`isEnterpriseFederated` unchanged.
- `IssuerConfig`/`EnterpriseClaimConfig`/`isConfigured()` unchanged.

### `apps/api/src/middleware/auth.middleware.ts` (reconciled — lazy multi-issuer)
Keep #577's shape (`buildValidators()` → `Map<issuer, RequestHandler>` via `express-oauth2-jwt-bearer` `auth()`; `unverifiedIssuer()`; `jwtCheck` routes by `iss`; `SSO_UNKNOWN_ISSUER` / `AUTH_UNAUTHORIZED`). **Change:** replace the module-load `const validators = buildValidators()` (`:40`) with a **lazy singleton** — `let validators: Map<…> | null`; `getValidators()` builds on first `jwtCheck` call. This preserves main's invariant that `assertDeployModeConsistency` (in `index.ts start()`) runs before any `auth()` construction, so a bad config exits cleanly instead of crashing at import.

### `apps/api/src/index.ts` (boot-time issuer fail-fast)
After `assertDeployModeConsistency(...)` in `start()`, call `SsoConfig.issuers()` once (discard the result) so a malformed `SSO_ISSUERS` throws at boot — restoring #577's fail-fast that the lazy validator would otherwise defer to the first request. Wrap it in the same fatal-exit path as the deploy-mode guard.

### `apps/api/src/environment.ts` (union)
Carry all: `DEPLOY_MODE: process.env.DEPLOY_MODE ?? "saas"` (a plain string; `parseDeployMode` validates), `SSO_ISSUERS`, `SSO_ENTERPRISE_CLAIM`, `SSO_ENTERPRISE_CLAIM_VALUE` (from #577), `OIDC_ISSUER: process.env.OIDC_ISSUER ?? ""`, `OIDC_AUDIENCE: process.env.OIDC_AUDIENCE ?? ""` (from #579). Drop #577's `"saas" | "self_hosted"` inline union type on `DEPLOY_MODE` (typing lives in `deploy-mode.ts`).

### `apps/api/src/constants/api-codes.constants.ts` (union)
Keep both sides' additions: `SSO_UNKNOWN_ISSUER`, `SSO_PROVISIONING_NOT_INVITED`, `API_RATE_LIMITED` (#577/#574) **and** `DEPLOY_MODE_CONFIG_INVALID`, `MARKETPLACE_*`, `ORG_ENTITLEMENT_EXPIRED`, `CONNECTOR_CONFIG_FETCH_FAILED`, `HEALTH_NOT_READY` (main). No code is dropped by the merge.

### `apps/api/src/services/sync-lock.service.ts` (union)
Keep all three namespaces + their errors: `PROVISION_LOCK_NAMESPACE` (#583), `SEAT_LOCK_NAMESPACE` (#584), `UPGRADE_LOCK_NAMESPACE` (#581). They key distinct operations; a namespace-distinctness assertion is cheap insurance.

### `apps/api/src/routes/protected.router.ts` (union)
Mount both: `authenticatedRateLimit` (#574) **and** `requireOrgWritable` (#568) + `connectorConfigRouter`. Preserve the ordering (rate-limit before writable-guard before routers).

### `apps/api/src/routes/webhook.router.ts` (reconciled)
Auth0 login-sync route **stays removed** (on-first-token provisioning via `metadata.middleware.ts:67-98` → `application.service.ts ensureProvisioned` is the provisioning path). Keep main's marketplace webhook (`verifyWebhookSignature`, AWS SNS `MessageValidator`, `TierGrantService`). Result: no Auth0 sync endpoint + the marketplace endpoint present.

### Frontend (main's runtime seam wins)
- Keep `apps/web/src/providers/Auth.provider.tsx`, `utils/runtime-config.util.ts`, `api/auth.api.ts` (`useAuth()` delegation), `providers/Application.provider.tsx` (`<AuthProvider>`) from main. Re-add #585's `onRedirectCallback` returnTo behavior inside `Application.provider.tsx`.
- `components/LoginForm.component.tsx`: keep main's `getRuntimeConfig()`-driven generic copy + `showProviderIcon`; drop #577's build-time `selfHosted`/`deploy-mode.util` branch.
- `api/keys.ts`: keep members/invitations/auditLog keys (#585/#575) **and** `connectorConfig` (main).

### Code sweep — `stripe_events` → `commercial_events`
Main's `0094` renamed the table and **deleted** `stripe-events.repository/table`, adding `commercial-events.*`. Any security-epic code/test referencing `stripe_events`/`stripe-events`/`StripeEvent*` must move to the `commercial_events` equivalents. A repo grep for `stripe.?events` (case-insensitive) must return only historical-migration hits after the merge.

## Migration

**No new migration; a renumber + rebuild.** Keep deployment's applied `0094_rename_stripe_events_to_commercial_events` + `0095_add_org_marketplace_entitlement_columns` at idx 94/95 (SQL untouched → hashes match app-dev's `__drizzle_migrations` → skipped there). `git mv` security's five migrations:
`0094_add-audit-log-table→0096`, `0095_add_organization_user_role→0097`, `0096_add_users_auth0_id_unique_index→0098`, `0097_add_org_seats→0099`, `0098_add-user-last-login-session→0100` (SQL untouched). Rebuild `meta/_journal.json` (idx 0–100 in order: base 0–93, deployment 94/95, security 96–100; each entry keeps its original `when`+`tag`, tags renumbered). Keep deployment's `0094/0095` snapshots; rebuild security's renumbered snapshots so the **latest (0100)** reflects the full merged schema (verified by a `db:generate` no-op). Tables are disjoint (audit_log/roles/invitations/users/tiers vs commercial_events/organizations), so ordering is safe.

## Seed
No seed change.

## TDD test plan

Run via npm scripts (`feedback_use_npm_test_scripts`): `cd apps/api && npm run test:unit && npm run test:integration`; `cd apps/web && npm run test:unit`; root `npm run type-check`.

### Layer 1 — `SsoConfig` + `deploy-mode` (api unit)
`apps/api/src/__tests__/config/sso.config.test.ts` (reconcile the existing suite) + `deploy-mode.test.ts` (from main, kept):
1. saas + unset `SSO_ISSUERS` → Auth0 default issuer (unchanged).
2. saas + `SSO_ISSUERS` set → parsed issuers; malformed → throws.
3. **residency → `issuers()` returns the single `OIDC_ISSUER`/`OIDC_AUDIENCE`** (not SSO_ISSUERS/Auth0).
4. `provisioningFallback`: residency → `join_single_org`; saas+enterprise-claim → `deny`; else `personal_org`.
5. `assertDeployModeConsistency`: residency w/ Stripe → throws; residency w/o OIDC → throws; saas → ok (unchanged).

### Layer 2 — auth middleware (api integration)
`apps/api/src/__tests__/middleware/auth.middleware.test.ts` (reconcile):
6. A token from the Auth0 issuer validates (saas default).
7. A token from a configured `SSO_ISSUERS` issuer validates; routed by `iss`.
8. residency: a token from `OIDC_ISSUER` validates.
9. Unknown `iss` → 401 `SSO_UNKNOWN_ISSUER`; missing/malformed bearer → 401 `AUTH_UNAUTHORIZED`.
10. **Lazy build + boot fail-fast:** validators are not constructed at import (a spy/one-shot proves first-request construction), so the boot guard runs first; and a malformed `SSO_ISSUERS` throws from the `index.ts` boot check (`SsoConfig.issuers()`), not deferred to the first request.

### Layer 3 — provisioning (api integration)
11. On-first-token: saas self-serve → personal org; residency → joins the single org (first user owner); saas enterprise-claim no-invite → 403 `SSO_PROVISIONING_NOT_INVITED`. (Reuses #577's provisioning tests, `self_hosted`→residency.)

### Layer 4 — drizzle (api integration)
12. Fresh DB: `db:migrate` applies 0–100 in order cleanly (rename → `commercial_events`, then security tables, marketplace cols).
13. Deployment-migrated DB: migrations 94/95 skip by hash; 96–100 apply. (Reset the local dev DB or use a seeded fixture.)
14. `db:generate` is a **no-op** on the merged tree (snapshots correct).

### Layer 5 — web (unit)
15. `LoginForm` renders generic copy / hides Google icon under an OIDC runtime config; Auth0 default otherwise.
16. `auth.api`/`AuthProvider` delegate to `useAuth()` (main's seam), unchanged by the merge.

### Layer 6 — sweep guard
17. Repo grep: no live-code `stripe_events`/`stripe-events` references remain (only historical migrations); `type-check` clean across packages.

**Totals:** ~5 config + ~5 middleware + ~1 provisioning + ~3 drizzle + ~2 web + ~1 sweep ≈ **17 cases** (most are reconciliations of existing #577/#579 suites, not net-new).

## Acceptance criteria

- Both epics on `main`; `epic/security-readiness` retired; `chore/616` PR closes #616 + the 11 merged children (not #578).
- Sign-in validates in saas (Auth0 + `SSO_ISSUERS`) and residency (`OIDC_ISSUER`); `assertDeployModeConsistency` passes for saas at boot.
- `db:generate` no-op; `db:migrate` clean on a fresh DB and correct (skip-then-apply) on a deployment-migrated DB; rename preserved.
- No live `stripe_events` references; full unit+integration suites green; `type-check`/`lint` clean.
- app-dev deploy green post-merge.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Eager validator build crashes import before the boot guard reports. | Lazy `getValidators()` (case 10) — build on first request, after `assertDeployModeConsistency`. |
| Renumbering changes a migration hash → app-dev re-applies/errors. | SQL content is byte-preserved on `git mv`; hashes match; case 13 proves skip-on-applied. |
| Regenerating snapshots turns the rename into a destructive drop/create. | **No regenerate** — renumber + hand-rebuild snapshots; case 14 (`db:generate` no-op) proves correctness. |
| A missed `stripe_events` reference in security-epic code fails at runtime. | Case 17 grep + `type-check` (the table/repository are deleted on main → compile error surfaces it). |
| Auth is **fail-closed**: a bad reconciled config could lock everyone out. | The boot guard + the multi-issuer suite (cases 6–9) exercise every path; app-dev deploy is the live gate. |

## Files touched

**`apps/api`** — edit: `config/sso.config.ts`, `config/deploy-mode.ts` (keep), `middleware/auth.middleware.ts`, `index.ts` (boot issuer check), `environment.ts`, `constants/api-codes.constants.ts`, `services/sync-lock.service.ts`, `routes/{protected,webhook}.router.ts`, `.env.example`, tests under `__tests__/{config,middleware}`; `drizzle/` (renumber 5 `.sql` + `meta/_journal.json` + snapshots); any `stripe_events` references.
**`apps/web`** — resolve to main's seam: `providers/{Auth,Application}.provider.tsx`, `api/{auth.api,keys}.ts`, `components/LoginForm.component.tsx`, `__tests__/LoginForm.test.tsx`.
**docs** — this spec + the plan.

No new dependency; no new env var beyond the union of both sides'.

## Next step

`docs/INTEGRATE_SECURITY_EPIC.plan.md` — TDD slices: (1) the mechanical merge (combine-conflicts: api-codes, sync-lock, protected.router, .env.example, keys.ts) + drizzle renumber, verify migrate/generate; (2) the API auth reconciliation (`SsoConfig`↔`deploy-mode.ts`, lazy multi-issuer validator, provisioning/webhook) + its suites; (3) the frontend seam reconciliation; (4) `stripe_events`→`commercial_events` sweep + full-suite green; (5) land to `main` + app-dev verify. Each slice green before the next; the merge is the first commit on `chore/616-integrate-security-epic`.
