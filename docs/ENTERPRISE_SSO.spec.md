# Enterprise SSO — Spec

Pins the contract for making the OIDC identity seam config-driven: a multi-issuer validator, issuer-agnostic profile resolution, on-first-token provisioning (webhook removed, per-login duties re-homed), a `DEPLOY_MODE` discriminator, and split provisioning (self-hosted JIT / SaaS invite-gated). Builds on [`ENTERPRISE_SSO.discovery.md`](./ENTERPRISE_SSO.discovery.md) · [#577](https://github.com/EnterpriseBT/portal-ai/issues/577).

## Key decisions (flag for review)

1. **Durable `users.last_login_session` column.** Per-login re-emission dedups by comparing the token's session marker — `auth_time` → `sid` → `iat` (first present wins, OQ6) — against `users.last_login_session` (text). On change → new login → emit `auth.login` + refresh profile + store the new marker. A string column (not `lastLogin` bigint) so `sid` markers work, giving correct per-login granularity for IdPs regardless of which marker they assert. Adds one nullable column + a migration (no backfill — null means "no login seen yet", set on the next login).
2. **Profile is fetched from the token's own issuer**, resolving the `userinfo` endpoint via that issuer's `/.well-known/openid-configuration` (cached per issuer), replacing the hardcoded `AUTH0_DOMAIN/userinfo`.
3. **`DEPLOY_MODE`** is a new env (`saas` default | `self_hosted`), the minimal discriminator this ticket introduces; #579 later generalizes it.
4. **Frontend deploy-mode via `VITE_DEPLOY_MODE`** (default `saas`): `saas` → the existing one-click Google button (`withGoogle`); `self_hosted` → `withUniversal` (the configured customer issuer). The `google-oauth2` pin is retained only for `saas`, no longer applied unconditionally.
5. **Denied SSO logins are not audit-log rows** (the audit log is org-scoped; a denied enterprise login has no org). They log via pino only. No new `AuditAction`.

## Scope

### In scope
- Config-driven, multi-issuer JWT validation (`auth.middleware.ts` + a new `sso.config.ts`).
- Issuer-agnostic profile resolution (generalize `Auth0Service.getAuth0UserProfile`).
- `DEPLOY_MODE` + provisioning-fallback split in `ensureProvisioned`.
- Remove the Auth0 sync webhook + `AUTH0_WEBHOOK_SECRET`; re-home per-login profile-refresh + `auth.login` audit onto `metadata.middleware.ts`.
- Frontend: deploy-mode-aware login connection.
- Two new `ApiCode`s.

### Out of scope
- In-app SSO admin UI; multi-tenant SaaS IdP→org auto-mapping; a SAML SP in the app; the Helm chart / bundled-issuer container (#566/#569); generalizing `DEPLOY_MODE` into the full #579 seam. (Per discovery.)

## Surface

### `apps/api/src/config/sso.config.ts` (new) — `SsoConfig`

```ts
interface IssuerConfig { issuer: string; audience: string; alg: string } // alg default "RS256"
class SsoConfig {
  static issuers(): IssuerConfig[];        // parse SSO_ISSUERS (JSON array); if unset,
                                           // derive [{ issuer:`https://${AUTH0_DOMAIN}/`,
                                           // audience:AUTH0_AUDIENCE, alg:"RS256" }].
                                           // Throws at boot on malformed JSON / missing fields.
  static isConfigured(): boolean;          // ≥1 resolvable issuer (mirrors StripeService.isConfigured)
  static deployMode(): "saas" | "self_hosted";           // from environment.DEPLOY_MODE
  static enterpriseClaim(): { name: string; value?: string } | null;  // SSO_ENTERPRISE_CLAIM[_VALUE]
}
```

### `apps/api/src/environment.ts`
- **Add:** `DEPLOY_MODE: (process.env.DEPLOY_MODE || "saas")`, `SSO_ISSUERS: process.env.SSO_ISSUERS` (raw; parsed by `SsoConfig`), `SSO_ENTERPRISE_CLAIM`, `SSO_ENTERPRISE_CLAIM_VALUE`.
- **Remove:** `AUTH0_WEBHOOK_SECRET` (line 32). Keep `AUTH0_AUDIENCE`/`AUTH0_DOMAIN` (the default-issuer source).
- Mirror in `apps/api/.env.example` (add the four, remove the webhook secret + its doc).

### `apps/api/src/middleware/auth.middleware.ts` — multi-issuer dispatcher
Replace the single `auth()` with one `auth({ issuerBaseURL: issuer, audience, tokenSigningAlg: alg })` **per** `SsoConfig.issuers()` entry, keyed by issuer URL. Exported `jwtCheck: RequestHandler`:
- Decode the JWT's `iss` **unverified** (header/payload only); select the matching per-issuer validator, which then does the real signature/audience/expiry verification.
- Unknown/absent `iss` → `next(new ApiError(401, ApiCode.SSO_UNKNOWN_ISSUER, …))`. Missing token → unchanged 401.
- Default config = today's single Auth0 issuer, so behavior is byte-identical when `SSO_ISSUERS` is unset.

### `apps/api/src/services/auth0.service.ts` — issuer-agnostic profile
Generalize `getAuth0UserProfile(accessToken)` → `resolveProfile(accessToken, issuer)`: resolve the `userinfo` endpoint from the issuer's cached `/.well-known/openid-configuration` (Auth0's is `https://${AUTH0_DOMAIN}/userinfo`, unchanged for the default issuer). Return shape unchanged (`Auth0UserProfile`). Discovery-doc cache keyed by issuer.

### `apps/api/src/services/application.service.ts` — provisioning fallback
```ts
type ProvisioningFallback = "personal_org" | "join_single_org" | "deny";
static async ensureProvisioned(
  auth0Sub, resolveProfile, auditCtx,
  fallback: ProvisioningFallback = "personal_org",   // back-compat default
): Promise<{ user; organization; organizationUser; created }>
```
After the existing invite-accept (`:194-208`) and existing-membership (`:211-219`) checks, branch on `fallback` instead of always provisioning a personal org:
- `personal_org` → `provisionOrganizationInTx` (unchanged; today's path).
- `join_single_org` → new `getSingletonOrganization()`: if none, this is the first user → `provisionOrganizationInTx` (owner); else `SeatService.attachMembership(user.id, org.id, "member", now)`. All inside the existing `withProvisioningLock`.
- `deny` → `throw new ApiError(403, ApiCode.SSO_PROVISIONING_NOT_INVITED, …)`.

### `apps/api/src/middleware/metadata.middleware.ts`
- Compute `fallback` from `SsoConfig`: `self_hosted` → `join_single_org`; `saas` + token matches `enterpriseClaim()` → `deny`; else `personal_org`. Pass to `ensureProvisioned` (`:50`). Profile resolver uses `resolveProfile(token, iss)`.
- **Re-homed per-login duties (returning users, the `else` at `:77`):** derive the session marker (`auth_time` → `sid` → `iat`, first present). When it differs from `user.lastLoginSession`, treat as a new login → `void AuditService.record({..., action: "auth.login"})`, refresh the user profile (name/email/picture) via `resolveProfile(token, iss)`, bump `organization_users.lastLogin`, and persist the new marker to `users.lastLoginSession`. No marker at all → skip (logged once).

### `apps/api/src/constants/api-codes.constants.ts`
Add: `SSO_UNKNOWN_ISSUER = "SSO_UNKNOWN_ISSUER"` (401), `SSO_PROVISIONING_NOT_INVITED = "SSO_PROVISIONING_NOT_INVITED"` (403).

### `users` table + model — `last_login_session` (dual-schema)
Add a nullable `lastLoginSession: text("last_login_session")` following the dual-schema workflow (both sides or the build fails):
- `apps/api/src/db/schema/users.table.ts` — the Drizzle column.
- `packages/core/src/models/user.model.ts` — the Zod field (`lastLoginSession: z.string().nullable()` / optional), model class + factory unchanged otherwise.
- `apps/api/src/db/schema/zod.ts` — regenerate `createSelectSchema`/`createInsertSchema`.
- `apps/api/src/db/schema/type-checks.ts` — the bidirectional `IsAssignable` guards.
- Migration: `npm run db:generate -- --name add-user-last-login-session` → commit the `.sql` + `meta/_journal.json` + `<n>_snapshot.json` together. Nullable, no backfill.

### Webhook removal
- `apps/api/src/routes/webhook.router.ts:114-168` — delete the `POST /api/webhooks/auth0/sync` route + its `@openapi`. **Confirm `verifyWebhookSignature` is not shared with the Stripe webhook before touching it.**
- `apps/api/src/services/webhook.service.ts` — delete `WebhookService.syncUser` (whole file if nothing else lives there).
- `packages/core/src/contracts/webhook.contract.ts` — remove `Auth0PostLoginWebhookPayload` / `…SyncResponse` (+ their swagger registration).

### `apps/web`
- `src/api/auth.api.ts` — keep both `withGoogle`/`withUniversal` (no change).
- `src/components/LoginForm.component.tsx` — the container picks the login action from `import.meta.env.VITE_DEPLOY_MODE` (default `saas`): `saas` → `withGoogle`; `self_hosted` → `withUniversal`. The `LoginFormUI` prop surface is unchanged (still `onClickGoogleLogin`); its label/copy may generalize under self-hosted (flag). Add `VITE_DEPLOY_MODE` to `apps/web/.env.example`.

## Migration
`npm run db:generate -- --name add-user-last-login-session` — one nullable `text` column on `users`. No backfill (null = "no login seen yet"; set on the next login). Commit `.sql` + `meta/_journal.json` + `<n>_snapshot.json` together (else CI's fresh DB skips it). Its own migration test is not required — the dual-schema type guards + the dedup integration test cover it.

## Seed
**None.**

## TDD test plan

Run via `npm run test:unit` / `npm run test:integration` per package — never raw jest.

### `apps/api` unit (`npm run test:unit`)
- `sso.config.test.ts` — default-from-AUTH0 when unset; parse a 2-issuer `SSO_ISSUERS`; malformed JSON throws; missing `audience` throws; `alg` default RS256; `isConfigured` true/false; `enterpriseClaim` present/absent; `deployMode` default saas. **~9**
- `auth.middleware.test.ts` — known `iss` routes to its validator; unknown `iss` → 401 `SSO_UNKNOWN_ISSUER`; unparseable token → 401. **~3**
- `provisioning-fallback.test.ts` — resolver: saas+no-claim→`personal_org`; saas+claim→`deny`; self_hosted→`join_single_org`. **~3**
- `auth0.service.test.ts` — `resolveProfile` uses the issuer's discovered userinfo (mock fetch); default Auth0 issuer unchanged; discovery cached (one fetch for two calls). **~3**

### `apps/api` integration (`npm run test:integration`)
- `sso-provisioning.integration.test.ts` — self_hosted: first customer-issuer token → owner of the singleton org; second distinct token → member. saas + enterprise-claim token, no invite → 403 `SSO_PROVISIONING_NOT_INVITED`; with a pending invite → joins that org with the invited role. saas Google token (no marker) → personal org (no regression). Returning user with a **new** session marker → an `auth.login` audit row appears + `users.lastLoginSession` is persisted; a **repeat** marker → no second `auth.login`. **~8**
- `webhook-removed.integration.test.ts` — `POST /api/webhooks/auth0/sync` → 404. **~1**

### `packages/core` unit (`npm run test:unit`)
- `webhook.contract.test.ts` — remove/adjust assertions for the deleted Auth0 webhook schemas; audit-log model unchanged (`auth.login` still declared). **~2**
- `user.model.test.ts` — `lastLoginSession` accepted (string + null); round-trips through `toJSON()`/`validate()`. **~2**

### `apps/web` unit (`npm run test:unit`)
- `LoginForm.test.tsx` — render the container with `VITE_DEPLOY_MODE=saas` → Google action; `self_hosted` → universal action; `LoginFormUI` renders from props unchanged. **~3**

**Totals ≈ 35 cases.**

## Acceptance criteria

- Self-hosted: a user from the customer's OIDC (or bundled) issuer logs in and is provisioned on first token into the single org — first user owner, subsequent members.
- SaaS enterprise: a claim-marked federated user with a pending invite lands in the inviting org with the invited role; without one → 403 `SSO_PROVISIONING_NOT_INVITED`, no org created.
- No regression: SaaS Google login provisions a personal org as today; the token validator accepts the current Auth0 issuer unchanged when `SSO_ISSUERS` is unset.
- `POST /api/webhooks/auth0/sync` no longer exists; returning-user logins still produce an `auth.login` audit row and a refreshed profile (when the IdP asserts `auth_time`).
- A token from an unconfigured issuer is rejected 401 `SSO_UNKNOWN_ISSUER`.

## Risks & rollback

- **Validator regression** is the highest risk — it gates every authed request. Mitigation: default-issuer config is byte-identical to today; the multi-issuer dispatcher falls through to the same `auth()` for the Auth0 issuer. Rollback: unset `SSO_ISSUERS`/`DEPLOY_MODE` reverts to SaaS-Auth0 behavior without a redeploy.
- **Fail-closed on auth** is correct and intended: an unreachable customer JWKS/userinfo fails the login (401/500), never fails open. A denied enterprise login (403) is the designed outcome, not an error.
- **Webhook removal**: the request-path self-heal already covers provisioning; the only loss (per-login profile-sync + audit for returning users) is explicitly re-homed. Verify no external Auth0 Action still POSTs to the route before deleting.
- **Multi-tenancy**: the SaaS deny-unless-invited rule is the isolation guard — no federated identity silently creates or joins an org. Deferring auto-mapping is the recorded conscious downgrade.

## Files touched

- **New:** `apps/api/src/config/sso.config.ts`; `apps/api/src/config/__tests__/sso.config.test.ts`; integration tests above; the `add-user-last-login-session` migration (`.sql` + journal + snapshot).
- **Edit (api):** `environment.ts`, `middleware/auth.middleware.ts`, `middleware/metadata.middleware.ts`, `services/auth0.service.ts`, `services/application.service.ts`, `constants/api-codes.constants.ts`, `routes/webhook.router.ts`, `services/webhook.service.ts`, `db/schema/users.table.ts`, `db/schema/zod.ts`, `db/schema/type-checks.ts`, `.env.example`.
- **Edit (core):** `models/user.model.ts` (+ its test), `contracts/webhook.contract.ts` (+ swagger registration), its test.
- **Edit (web):** `components/LoginForm.component.tsx`, `.env.example`, `LoginForm.test.tsx`.

## Next step

`/plan 577` carves this into ~6 TDD slices on this same branch, each a testable commit: (1) `sso.config.ts` + env; (2) multi-issuer validator + `SSO_UNKNOWN_ISSUER`; (3) issuer-agnostic `resolveProfile`; (4) `DEPLOY_MODE` + `ensureProvisioned` fallback split (+ `SSO_PROVISIONING_NOT_INVITED`); (5) `users.last_login_session` (dual-schema + migration) + webhook removal + re-homed per-login audit/profile; (6) frontend deploy-mode login. Slice 4 depends on 1; 5 depends on 3; the rest are independent.
