# Enterprise SSO invite-gating (SaaS) — Plan

**TDD-sequenced implementation of invite-gating keyed on the Auth0 connection in `sub`. It covers the `SSO_ENTERPRISE_CONNECTIONS` parse and match, the deny-path invitation re-check, the SSM/CloudFormation wiring, the web `/not-invited` route, and the runbooks.**

Spec: `docs/ENTERPRISE_SSO_INVITE_GATING.spec.md`. Discovery: `docs/ENTERPRISE_SSO_INVITE_GATING.discovery.md`. Issue: #916. Builds on shipped #577/#584 (`SsoConfig`, `ensureProvisioned`, `SeatService.acceptPendingForEmail`) and #881 (the deny passes through, and `PublicLayout` is used for no-membership pages).

There are five slices. Each sits behind a green test suite and leaves the repo compilable. They land as **commits on `feat/916-enterprise-sso-invite-gating` / PR #926**: one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd apps/web && npm run test:unit
cd packages/devops-cli && npm run test:unit
```

Each slice follows the same loop:
1. Write the failing tests.
2. Make the smallest change that turns them green.
3. Run the focused tests.
4. Run `npm run lint && npm run type-check` at the boundary.
5. Move to the next slice.

Sequencing rationale. Deciding *who* is gated comes first, the *recovery* path second, deploy plumbing third, the user-facing screen fourth, and prose last:

- **Slice 1:** `SsoConfig` grammar, matching and the boot parse. It's pure config, and the old claim vars go in the same commit, so nothing references them afterwards.
- **Slice 2:** the deny-path re-check in `ensureProvisioned`. It depends only on the `deny` fallback, which already exists, so it can't break self-serve.
- **Slice 3:** the catalog plus `backend.yml`. It sits after the code that reads the var, so the parameter has a reader from the moment it lands. **This slice ends with the operator step (rebuild the CLI, `vars set … none` in app-dev).**
- **Slice 4:** the web `/not-invited` route, view and redirect. It's independent of slices 2–3, but it is only reachable end to end once slice 1 can produce the deny.
- **Slice 5:** the runbooks. They describe the finished mechanism.

No migration and no seed change.

---

## Slice 1 — `SsoConfig`: connection list, `sub` matching, boot parse

Replace the claim marker with `SSO_ENTERPRISE_CONNECTIONS` and `connectionOf(sub)`, and validate the list at boot.

**Files**

- Edit:
  - `apps/api/src/config/sso.config.ts`: remove `EnterpriseClaimConfig`, `enterpriseClaim` and `isEnterpriseFederated`. Add `enterpriseConnections()` and `connectionOf()`, rewrite `provisioningFallback` per the spec's truth table, and update the `ProvisioningFallback` doc.
  - `apps/api/src/index.ts`: call `SsoConfig.enterpriseConnections()` after `SsoConfig.issuers()` inside the guard `try`, plus the info log.
  - `apps/api/src/environment.ts`, `apps/api/.env.example`: replace the claim keys with `SSO_ENTERPRISE_CONNECTIONS` and its comment.
  - `apps/api/src/__tests__/subprocessor-egress-parity.test.ts`: swap the two claim keys for `SSO_ENTERPRISE_CONNECTIONS: CUSTOMER_IDP`.
- Tests:
  - `apps/api/src/__tests__/config/sso.config.test.ts`: replace the `enterpriseClaim` block and the claim cases in `provisioningFallback`.
  - `apps/api/src/__tests__/middleware/metadata.middleware.test.ts`: add the `samlp|acme-okta|…` → `deny` case.

**Steps**

1. **Tests:** the spec's `sso.config.test.ts` cases (`enterpriseConnections`, `connectionOf` and `provisioningFallback`, ≈22) and the middleware case (≈1). Run them; they fail (the symbols are missing, and the claim cases are gone).
2. **Implement** the three methods and the boot call, and rename the env var. A `grep -rn SSO_ENTERPRISE_CLAIM apps/` returns only the runbook, which slice 5 handles. Green.
3. Run `apps/api` `test:unit` (the sso.config, metadata.middleware and subprocessor-egress-parity suites), then lint and type-check.

**Done when:** the ≈23 cases pass, the egress-parity suite is green, and a local `SSO_ENTERPRISE_CONNECTIONS='a,,b' npm run dev` refuses to boot with `DEPLOY_MODE_CONFIG_INVALID`.

**Risk:** `index.ts` boot is untested by unit tests. The manual boot check above covers it, and the smoke repeats it.

---

## Slice 2 — Deny-path invitation re-check

A user who was denied before being invited joins on their next request.

**Files**

- Edit: `apps/api/src/services/application.service.ts`. In the `deny` branch, when `profile === null`, resolve the profile with errors swallowed, run `acceptPendingForEmail` on a verified email, return when an org is joined, and otherwise log and throw.
- Tests: `apps/api/src/__tests__/__integration__/services/ensure-provisioned.integration.test.ts`.

**Steps**

1. **Tests:** the spec's six new integration cases:
   - deny, then invite, then join;
   - deny with no invite leaves exactly one user row and no org or membership;
   - an unverified email isn't accepted;
   - a `resolveProfile` rejection gives `SSO_PROVISIONING_NOT_INVITED`, not 502;
   - a new user's profile is resolved exactly once;
   - with `personal_org`, an existing user is unchanged and `resolveProfile` is never called.

   Run; the first case fails (it is still denied), and the rest pin current behavior.
2. **Implement** the branch change. Green.
3. Run `apps/api` `test:integration` on the `ensure-provisioned` file, plus `application.service.integration.test.ts` as a neighbor check. Then lint and type-check.

**Done when:** all six cases pass and the existing `:347` and `:363` cases are unchanged.

**Risk:** the integration suite needs the local Postgres and Redis. Per memory, a full run also needs `STRIPE_*` exported, but a focused run of these files doesn't.

---

## Slice 3 — Deploy wiring: catalog + `backend.yml` (+ app-dev operator step)

`SSO_ENTERPRISE_CONNECTIONS` becomes an operator-managed SSM key that the API task reads.

**Files**

- Edit:
  - `packages/devops-cli/src/catalog.ts`: add `ssm("SSO_ENTERPRISE_CONNECTIONS", "sso-enterprise-connections")` in the SSM block, with a `#916` comment.
  - `infra/cloudformation/backend.yml`: add an unconditional `Secrets` entry with `Name: SSO_ENTERPRISE_CONNECTIONS` and `ValueFrom: …parameter/portalai/${Environment}/sso-enterprise-connections`, beside `AUTH0_DOMAIN` (`:678`).
- Tests: `packages/devops-cli/src/__tests__/catalog.test.ts` and `deploy-parity.test.ts` get no new cases; the existing subset assertions now cover the key.

**Steps**

1. **Tests.** Add the `backend.yml` entry first and run `packages/devops-cli` `test:unit`. `deploy-parity` fails because the task consumes a key the catalog lacks. That failure proves the guard sees the new entry.
2. **Implement:** add the catalog entry. Green.
3. Lint and type-check.
4. **Operator step (pre-merge gate, the user runs it):**
   - `npm run build --workspace @portalai/devops-cli`. `npx portalops` runs `dist/`, per memory.
   - `! portalops vars set SSO_ENTERPRISE_CONNECTIONS none --env app-dev --yes`.
   - `portalops vars describe --env app-dev` shows the key as set.

   The prod equivalent (`--env prod --yes --confirm-prod`) is recorded for the next release and is **not** run now.

**Done when:** the devops-cli suites are green and app-dev holds the parameter. The PR's `## Test plan` carries an explicit unchecked row: "app-dev `sso-enterprise-connections` = `none` set before merge".

**Risk:** if this slice merged without the app-dev parameter, the next app-dev deploy's task would fail to start. The merge-gate row exists to prevent that.

---

## Slice 4 — Web `/not-invited` route, view and redirect

A refused user sees "You need an invitation" with Try again and Sign out, instead of a generic error.

**Files**

- New:
  - `apps/web/src/views/NotInvited.view.tsx`: `NotInvitedViewUI` (pure) and `NotInvitedView` (container: `sdk.auth.logout()`, plus Try again, which invalidates `queryKeys.organizations.root` and navigates to `/`).
  - `apps/web/src/routes/not-invited.tsx`: `createFileRoute("/not-invited")` → `<Authorized><PublicLayout><NotInvitedView/></PublicLayout></Authorized>`.
  - `apps/web/src/__tests__/NotInvitedView.test.tsx`.
  - `apps/web/src/__tests__/NotInvitedPage.test.tsx`.
- Edit:
  - `apps/web/src/utils/auth-error.util.ts`: the `SSO_PROVISIONING_NOT_INVITED` const, plus `registerNotInvitedHandler` and `handleNotInvited`.
  - `apps/web/src/client.ts`: `onAuthError` routes that code to `handleNotInvited()`.
  - `apps/web/src/routes/__root.tsx`: `RootComponent` registers the handler with `navigate({ to: "/not-invited", replace: true })`.
  - `apps/web/src/utils/routes.util.ts`: `ApplicationRoute.NotInvited`.
  - `apps/web/src/routeTree.gen.ts`: regenerated by the build and committed.
  - `apps/web/src/__tests__/client.test.ts`.

**Steps**

1. **Tests:** the spec's web cases (≈7):
   - The UI renders the title and body, and its two buttons fire their callbacks.
   - In `client.test.ts`, the code calls the not-invited handler and not logout, and a plain 403 calls neither.
   - The page renders under `PublicLayout` and mounts no `organizations.current` query.

   Run; they fail.
2. **Implement** the util, client hook, view, route and root registration. Run `npm run build` in `apps/web` to regenerate the route tree. Green.
3. Run `apps/web` `test:unit` on the new files plus `client.test.ts` and `permission-copy.guard.test.ts`. Then lint and type-check.

**Done when:** the ≈7 cases and the permission-copy guard pass, and `routeTree.gen.ts` is committed with the route.

**Risk:** registering in `__root.tsx` means the redirect works only inside the router. Every authorized page is inside it, and the handler is a no-op before registration, the same as `handleAuthError`.

---

## Slice 5 — Runbooks

The docs describe gating with no Auth0 Action.

**Files**

- Edit:
  - `docs/ENTERPRISE_SSO.runbook.md`: rewrite `:29-36`, covering the connection list, how to read a real user id first to confirm the `strategy|connection|id` shape, `none` meaning off, the restart after `vars set`, and manual cleanup of a pre-existing personal org. Also update the `:62` env table row and the verification section (`:54`).
  - `docs/PROD_PROVISIONING.runbook.md`: next to the no-Action rule (`:83`), add the `vars set SSO_ENTERPRISE_CONNECTIONS none --env prod --yes --confirm-prod` pre-release step.
  - `docs/AUTH0_CLI_OPS.md`: next to `:103`/`:112`, a note that enterprise ids carry the connection name and that gating needs no Action.

**Steps**

1. **Tests:** `npm run lint:doc-pointers` (durable docs) and the API `permission-copy.guard.test.ts`, which scans durable `docs/`. Run both after editing.
2. Green, then lint.

**Done when:** no durable doc mentions `SSO_ENTERPRISE_CLAIM`, and both guards pass.

---

## Amendment (2026-10-29) — enterprise sign-in entry point

Slices 1–5 and the review fixes have landed. These slices add the entry point that discovery Decision 5 and spec decisions 9–11 describe. Same loop: tests first, the smallest change, a focused run, then lint and type-check.

## Slice 6 — `SsoConfig`: JSON grammar + `connectionForEmail`

`SSO_ENTERPRISE_CONNECTIONS` becomes `[{connection, domains}]`, still gated by `sub`, and now also routed by email domain.

**Files**

- Edit:
  - `apps/api/src/config/sso.config.ts`: rework `enterpriseConnections()` to parse JSON, and add `enterpriseDomains()` and `connectionForEmail()`.
  - `apps/api/src/environment.ts`, `apps/api/.env.example`: comments and an example.
- Tests:
  - `apps/api/src/__tests__/config/sso.config.test.ts`: replace the comma-list cases with the spec's JSON-grammar cases.
  - `metadata.middleware.test.ts`: switch the env value to JSON.

**Steps**

1. **Tests** (spec "Amendment tests", the sso.config bullet, ≈16). Run; they fail.
2. **Implement** the parser and lookup. Keep `none`, unset and blank as off. Green.
3. Boot check by hand: a malformed JSON value refuses to boot, and a valid value logs its connections.
4. Lint and type-check.

**Done when:** the sso.config and middleware suites are green, and app-dev's stored `none` is still valid (no operator action).

## Slice 7 — `POST /api/public/sso-discovery`

**Files**

- New:
  - `packages/core/src/contracts/sso-discovery.contract.ts`, plus its export;
  - `apps/api/src/routes/public-sso.router.ts`;
  - `apps/api/src/__tests__/__integration__/routes/public-sso.router.integration.test.ts`.
- Edit:
  - `app.ts` (the mount);
  - `middleware/public-rate-limit.middleware.ts` (`code` and `bucket` parameters);
  - `constants/api-codes.constants.ts`;
  - `config/swagger.config.ts`;
  - `__tests__/config/route-authorization.map.ts`.

**Steps**

1. **Tests** (spec "Amendment tests", the router bullet, ≈6), plus the route-authorization guard and core's `strict-request-bodies`. Run; they fail.
2. **Implement** the contract, router, mount, rate-limit parameters, codes and swagger components. Rebuild core (`npm run build --workspace @portalai/core`) before running the API tests. Green.
3. Run the existing `public-site.router.integration.test.ts` to confirm `site-config` keeps its own window. Then lint and type-check.

**Done when:** the new and guard suites are green, and `/api/docs` shows the route.

## Slice 8 — Web "Sign in with SSO"

**Files**

- New: `components/SsoLoginForm.component.tsx`, `__tests__/SsoLoginFormView.test.tsx`.
- Edit:
  - `utils/api.util.ts` (`usePublicMutation`);
  - `api/auth.api.ts` (`ssoDiscovery`);
  - `providers/Auth.provider.tsx` (`withEnterpriseConnection`, plus the OIDC no-op);
  - `components/LoginForm.component.tsx` (link and mode);
  - `__tests__/LoginForm.test.tsx`;
  - a `usePublicMutation` test.

**Steps**

1. **Tests** (spec "Amendment tests", the web bullet, ≈12). Run; they fail.
2. **Implement.** Green.
3. Run the web guard suites (`guard|route`, `auth-consumers` and anything else that mocks `auth-error.util` or `Auth.provider`). Then lint, type-check, and a full root `npm run build`.

**Done when:** the web suites and guards are green, and in local dev the SSO link sends a listed domain to Auth0 with `connection=<name>`.

**Risk:** a test that mocks `useAuth().login` with a fixed object needs the new method; search for `withUniversal:` in the test and story mocks.

## Slice 9 — Docs

- `docs/ENTERPRISE_SSO.runbook.md`: the JSON grammar, domains, the sign-in flow, and the accepted exposure.
- `docs/PROD_PROVISIONING.runbook.md`: `none` is unchanged; add a pointer to the JSON format.
- `CLAUDE.md` → "API Calls & SDK Helpers": `usePublicMutation` as the only anonymous path.
- `packages/core/src/content/glossary.util.ts` SSO entry: say how to sign in ("Sign in with SSO" and your work email). Then run core's `glossary.util.test.ts`.
- Guards: `lint:doc-pointers`, plus the permission-copy guards for api and web.

## Sequence summary

| # | Lands | Gate |
|---|---|---|
| 1 | `SsoConfig` connection list + `sub` match + boot parse; old claim vars removed | api unit ≈23, egress parity |
| 2 | Deny-path invitation re-check | api integration ≈6 |
| 3 | Catalog + `backend.yml`; **app-dev `none` set by the operator** | devops-cli parity; `vars describe` |
| 4 | Web `/not-invited` route, view and redirect | web unit ≈7, permission-copy guard |
| 5 | Runbooks | doc-pointers, permission-copy guard |
| 6 | JSON grammar + `connectionForEmail` | api unit ≈16 |
| 7 | `POST /api/public/sso-discovery` | api integration ≈6, route-auth + strict-body guards |
| 8 | Web "Sign in with SSO" | web unit ≈12, guards, root build |
| 9 | Runbook, CLAUDE.md, glossary | doc-pointers, glossary, permission-copy |

## Cross-slice notes

- **Pre-merge operator gate.** App-dev must hold `sso-enterprise-connections` (slice 3, step 4) before PR #926 merges. Prod must hold it before the next prod release. Both go on the PR's test plan as unchecked rows for the human.
- **Full build before the push after slice 4.** Web adds a route, so run root `npm run build` to catch route-tree drift (Static Checks fails on an uncommitted tree change). Run `npm run format` before each commit; `--no-verify` skips prettier, and CI's `format:check` catches it.
- **Doc sync** (CLAUDE.md → "Keeping Documentation in Sync"):
  - The glossary's SSO entry (`packages/core/src/content/glossary.util.ts:515`, "members still need an invitation to join") stays accurate; re-read it in slice 5.
  - `DEPLOYMENT_SECURITY_REVIEW.md` is untouched: there is no new egress, since `userinfo` was already called.
  - `CLAUDE.md` needs no change.
- **Smoke** needs a real Auth0 Enterprise Connection in the app-dev tenant, so it is mostly manual; `/smoke 916` scaffolds it after slice 5. The unit and integration suites carry the logic.

## Next step

Implementation starts on this branch with slice 1, tests first, one commit per slice, once discovery, spec and plan are confirmed.
