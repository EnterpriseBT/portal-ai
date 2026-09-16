# Enterprise SSO — Plan

**Seven TDD slices that turn the SSO identity seam config-driven: parse config → multi-issuer validation → issuer-agnostic profile → provisioning split → durable login-session column → webhook removal + per-login re-home → frontend deploy-mode.**

Spec: `docs/ENTERPRISE_SSO.spec.md`. Discovery: `docs/ENTERPRISE_SSO.discovery.md`. Issue: #577 (epic #578). Builds on #576 (RBAC roles), #583 (first-login provisioning), #584 (seats/invitations) — all merged into the epic.

Seven slices, each behind a green suite and each leaving the repo compilable. They land as **commits on `feat/577-enterprise-sso`** — one feature, one PR (#605) (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd packages/core && npm run test:unit
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

**Sequencing rationale** — 1 is pure config (leaf, unblocks 2 + 4). 2 makes the validator multi-issuer (needs 1's issuer list). 3 makes the profile fetch issuer-agnostic (needed by 4 and 6). 4 splits provisioning by mode (needs 1's mode/claim + 3's profile + 2's validator accepting the customer issuer for its integration test). 5 is the mechanical schema prep (leaf) for 6. 6 is the atomic webhook-removal + per-login re-home (needs 5's column + 3's profile) — coupled so returning-user audit is never doubled or dropped across the boundary. 7 is the independent frontend swap, last.

---

## Slice 1 — `SsoConfig` + env

Parse the new SSO env into a typed config authority, defaulting to today's Auth0 so nothing changes yet.

**Files**
- New: `apps/api/src/config/sso.config.ts`, `apps/api/src/config/__tests__/sso.config.test.ts`.
- Edit: `apps/api/src/environment.ts` (add `DEPLOY_MODE`, `SSO_ISSUERS`, `SSO_ENTERPRISE_CLAIM`, `SSO_ENTERPRISE_CLAIM_VALUE`), `apps/api/.env.example`.

**Steps**
1. **Tests (spec: `sso.config.test.ts` ~9).** Default-from-AUTH0 when `SSO_ISSUERS` unset; parse a 2-issuer JSON; malformed JSON throws; missing `audience` throws; `alg` defaults RS256; `isConfigured` true/false; `enterpriseClaim` present/absent; `deployMode` defaults `saas`. Run; fail.
2. **Implement** `SsoConfig` (`issuers()`, `isConfigured()`, `deployMode()`, `enterpriseClaim()`) reading `environment`. Green.
3. Lint + type-check.

**Done when:** `SsoConfig` resolves the default Auth0 issuer with no env set; the 9 cases pass. Nothing consumes it yet.

**Risk:** none — additive, no call sites.

---

## Slice 2 — Multi-issuer validator

Replace the single `auth()` with an issuer-dispatching `jwtCheck`; default config keeps Auth0 behavior byte-identical.

**Files**
- Edit: `apps/api/src/middleware/auth.middleware.ts`, `apps/api/src/constants/api-codes.constants.ts` (add `SSO_UNKNOWN_ISSUER`).

**Steps**
1. **Tests (spec: `auth.middleware.test.ts` ~3).** A token whose `iss` matches a configured issuer routes to that validator (accepted); an unknown `iss` → 401 `SSO_UNKNOWN_ISSUER`; an unparseable token → 401. Run; fail.
2. **Implement** one `auth({ issuerBaseURL, audience, tokenSigningAlg })` per `SsoConfig.issuers()` entry, keyed by issuer; `jwtCheck` decodes `iss` unverified, dispatches, else `ApiError(401, SSO_UNKNOWN_ISSUER)`. Green.
3. Lint + type-check.

**Done when:** existing auth-dependent suites stay green (default issuer unchanged) + the 3 new cases pass.

**Risk:** **highest-blast-radius slice** — gates every authed request. Keep the default-issuer path a literal equivalent of today's `auth()` config; lean on the existing integration suite as the regression net.

---

## Slice 3 — Issuer-agnostic profile resolution

Generalize the userinfo fetch off the hardcoded `AUTH0_DOMAIN` so any issuer's profile resolves.

**Files**
- Edit: `apps/api/src/services/auth0.service.ts` (`getAuth0UserProfile` → `resolveProfile(accessToken, issuer)`; per-issuer OIDC-discovery cache).

**Steps**
1. **Tests (spec: `auth0.service.test.ts` ~3).** `resolveProfile` fetches the issuer's discovered `userinfo` (mock fetch); the default Auth0 issuer resolves `https://${AUTH0_DOMAIN}/userinfo` unchanged; the discovery doc is cached (two calls → one discovery fetch). Run; fail.
2. **Implement** discovery-doc resolution + cache keyed by issuer; keep the return shape (`Auth0UserProfile`). Update the one caller in `metadata.middleware.ts` to pass the token's `iss`. Green.
3. Lint + type-check.

**Done when:** the 3 cases pass; the request-path provisioning profile fetch is issuer-driven; Auth0 default unchanged.

**Risk:** a customer issuer without a discovery doc fails the fetch → 500 (fail-closed, intended).

---

## Slice 4 — `DEPLOY_MODE` + provisioning-fallback split

Branch `ensureProvisioned` by mode: self-hosted JIT into the single org, SaaS enterprise-federated deny-unless-invited, SaaS self-serve unchanged.

**Files**
- Edit: `apps/api/src/services/application.service.ts` (`ProvisioningFallback` type; new `fallback` param, default `"personal_org"`; `getSingletonOrganization()`; branch after the invite/existing-membership checks), `apps/api/src/middleware/metadata.middleware.ts` (compute `fallback` from `SsoConfig` + the token's enterprise claim), `apps/api/src/constants/api-codes.constants.ts` (add `SSO_PROVISIONING_NOT_INVITED`).
- New: `apps/api/src/**/__tests__/provisioning-fallback.test.ts`, `apps/api/**/sso-provisioning.integration.test.ts`.

**Steps**
1. **Tests.** Unit (spec: `provisioning-fallback.test.ts` ~3): resolver maps saas+no-claim→`personal_org`, saas+claim→`deny`, self_hosted→`join_single_org`. Integration (spec: `sso-provisioning.integration.test.ts`, provisioning cases ~5): self_hosted first customer-issuer token → owner of the singleton org; second distinct token → member; saas+enterprise-claim, no invite → 403 `SSO_PROVISIONING_NOT_INVITED`; with a pending invite → joins with the invited role; saas Google token (no marker) → personal org (no regression). Run; fail.
2. **Implement** the fallback param + branch (`personal_org` = today; `join_single_org` = provision-if-first-else-attach-member, inside `withProvisioningLock`; `deny` = throw 403) and the middleware's fallback computation. Green.
3. Lint + type-check.

**Done when:** all provisioning cases pass; the default `"personal_org"` keeps every existing caller (incl. the still-present webhook) unchanged.

**Risk:** `getSingletonOrganization` must run inside the provisioning lock so two first-logins can't both provision (OQ1); assert the second self-hosted user lands as `member`, not a second org.

---

## Slice 5 — `users.last_login_session` (dual-schema + migration)

Add the durable per-login session marker column. Mechanical, no behavior yet.

**Files**
- Edit: `apps/api/src/db/schema/users.table.ts`, `packages/core/src/models/user.model.ts` (+ `packages/core/src/**/user.model.test.ts`), `apps/api/src/db/schema/zod.ts`, `apps/api/src/db/schema/type-checks.ts`.
- New: the `add-user-last-login-session` migration (`.sql` + `meta/_journal.json` + `<n>_snapshot.json`).

**Steps**
1. **Tests (spec: `user.model.test.ts` ~2).** `lastLoginSession` accepted as string + null and round-trips through `toJSON()`/`validate()`. Run; fail.
2. **Implement** the nullable `text` column both sides; regenerate drizzle-zod; add the `IsAssignable` guards; `npm run db:generate -- --name add-user-last-login-session`. Green (type guards + model test).
3. Lint + type-check.

**Done when:** build passes (dual-schema guards satisfied), model test green, migration committed with journal + snapshot. Column unused so far.

**Risk:** forgetting the journal/snapshot → green-local/red-CI (`project_drizzle_journal_must_be_committed`). Commit all three files.

---

## Slice 6 — Webhook removal + re-homed per-login audit/profile

Atomically move per-login duties to the request path and delete the Auth0 sync webhook — one commit, so returning-user `auth.login` audit is never doubled or dropped.

**Files**
- Edit: `apps/api/src/middleware/metadata.middleware.ts` (returning-user branch: derive marker `auth_time`→`sid`→`iat`; on change vs `user.lastLoginSession` → emit `auth.login`, refresh profile via `resolveProfile`, bump `lastLogin`, persist marker), `apps/api/src/routes/webhook.router.ts` (delete the `/auth0/sync` route + `@openapi`), `apps/api/src/services/webhook.service.ts` (delete `syncUser`), `apps/api/src/environment.ts` + `.env.example` (remove `AUTH0_WEBHOOK_SECRET`), `packages/core/src/contracts/webhook.contract.ts` (+ swagger).
- New: `apps/api/**/webhook-removed.integration.test.ts`; **`docs/ENTERPRISE_SSO.runbook.md`** — the durable (unsuffixed-family, survives the phase-doc sweep) SSO deploy/teardown runbook (see below).

**Steps**
1. **Tests.** Integration (spec: `webhook-removed.integration.test.ts` ~1; `sso-provisioning.integration.test.ts` per-login ~2): `POST /api/webhooks/auth0/sync` → 404; a returning user with a **new** session marker → one `auth.login` audit row + `users.lastLoginSession` persisted; a **repeat** marker → no second `auth.login`. Core (spec: `webhook.contract.test.ts` ~2): the Auth0 webhook schemas are gone; audit-log model still declares `auth.login`. Run; fail.
2. **Implement** the request-path re-home, then delete the route/service/secret/contract. **Confirm `verifyWebhookSignature` is not shared with the Stripe webhook before removing it.** Green.
3. **Author `docs/ENTERPRISE_SSO.runbook.md`** — the operator/deploy teardown + config (see cross-slice note). Removing the webhook is only half the change; the other half is vendor-side and must be documented so a deploy doesn't leave dead Auth0 config or an orphaned secret.
4. Lint + type-check.

**Done when:** the webhook is gone, returning-user logins audit + refresh from the request path, dedup holds, core contract tests green, and the runbook documents the Auth0 teardown.

**Risk:** double-audit if removal and re-home split across commits — keep them in this one. Verify no external Auth0 Action still POSTs the route before deleting.

---

## Slice 7 — Frontend deploy-mode login

Pick the login connection by deploy mode without new UI.

**Files**
- Edit: `apps/web/src/components/LoginForm.component.tsx` (container reads `import.meta.env.VITE_DEPLOY_MODE`, default `saas` → `withGoogle`; `self_hosted` → `withUniversal`), `apps/web/.env.example` (add `VITE_DEPLOY_MODE`).

**Steps**
1. **Tests (spec: `LoginForm.test.tsx` ~3).** `VITE_DEPLOY_MODE=saas` → Google action; `self_hosted` → universal action; `LoginFormUI` renders from props unchanged. Run; fail.
2. **Implement** the mode-conditional action in the container; `LoginFormUI` prop surface unchanged. Green.
3. Lint + type-check.

**Done when:** the 3 cases pass; SaaS login UX is byte-identical; self-hosted uses Universal Login.

**Risk:** none material — the pin stays for `saas`.

---

## Sequence summary

| # | Lands | Gating check |
|---|---|---|
| 1 | `SsoConfig` + env | `sso.config.test.ts` (~9) |
| 2 | multi-issuer `jwtCheck` + `SSO_UNKNOWN_ISSUER` | `auth.middleware.test.ts` (~3) + existing auth suite green |
| 3 | issuer-agnostic `resolveProfile` | `auth0.service.test.ts` (~3) |
| 4 | `DEPLOY_MODE` + provisioning split + `SSO_PROVISIONING_NOT_INVITED` | `provisioning-fallback` (~3) + `sso-provisioning` provisioning cases (~5) |
| 5 | `users.last_login_session` dual-schema + migration | `user.model.test.ts` (~2) + build guards |
| 6 | webhook removal + per-login re-home | `webhook-removed` (~1) + `sso-provisioning` per-login (~2) + `webhook.contract.test.ts` (~2) |
| 7 | frontend deploy-mode login | `LoginForm.test.tsx` (~3) |

**Totals ≈ 35 cases.**

## Cross-slice notes

- **Migration ordering:** slice 5's column must land (and its journal/snapshot commit) before slice 6 reads/writes `lastLoginSession`.
- **`ensureProvisioned` back-compat default** (`"personal_org"`) is what keeps slices 4–5 green while the webhook still exists; slice 6 removes the webhook, not the default.
- **Doc-sync (same PR):** `apps/api/.env.example` + `apps/web/.env.example` change (new SSO/deploy env, removed webhook secret); `apps/api/README.md` if it documents the Auth0 webhook or auth env; the `@openapi` spec loses the webhook route. No Help/glossary/tool surfaces are touched (per `CLAUDE.md` → "Keeping Documentation in Sync").
- **Auth0 vendor teardown (durable runbook — `docs/ENTERPRISE_SSO.runbook.md`, slice 6):** dropping the webhook has a **vendor side** that the code change alone doesn't cover, and each env is a **separate Auth0 tenant** (`project_envs_separate_per_vendor`). The runbook documents, per env (local · app-dev · prod):
  1. **The post-login Action/Trigger** in the Auth0 dashboard that POSTs to `/api/webhooks/auth0/sync` — becomes dead after this deploy (it will 404). Remove it from each tenant's Login flow. **Deploy ordering:** ship the app first (request-path self-heal + re-home already provision + audit), *then* remove the Action, so provisioning never has a gap.
  2. **`AUTH0_WEBHOOK_SECRET`** — held in each env's secret store (local `.env`; app-dev/prod via AWS Secrets Manager / SSM, managed by `portalops vars`). Remove it *after* the app no longer reads it (post-deploy), following the guard rules (prod = `--yes --confirm-prod`).
  3. **The new operator config** the same runbook covers for completeness: `SSO_ISSUERS` / `DEPLOY_MODE` / `SSO_ENTERPRISE_CLAIM*` per env, plus the SaaS enterprise-connection setup (Auth0 Enterprise Connection, operator-side) and the self-hosted issuer/bundled-issuer wiring (the chart contract, #566/#569). This is the "operator-configured, no in-app UI" surface the discovery committed to.

  The runbook is **durable** (not a phase doc) because the teardown outlives this ticket — it's executed at epic deploy time, not at merge.
- **Smoke deferral:** self-hosted live paths (customer OIDC + bundled issuer) have no local issuer — their walk defers to the #569 epic smoke (a mock issuer is stood up there, per `project_residency_oidc_epic_smoke_deferral`). SaaS paths (Google no-regression, enterprise deny/invite) are smoke-walkable on the seeded org.

## Next step

After discovery + spec + plan are confirmed, implementation begins on this branch — slice 1 first, tests-first, one commit per slice into PR #605.
