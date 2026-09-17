# Config-driven web auth (runtime OIDC login) — Plan

**TDD-sequenced implementation of the `useAuth()` seam: the typed runtime-config accessor, the seam + Auth0 bridge + consumer migration (SaaS-green), the OIDC bridge + provider branch + fail-closed + login label, then docs/story sync.**

Spec: `docs/CONFIG_DRIVEN_WEB_AUTH.spec.md`. Discovery: `docs/CONFIG_DRIVEN_WEB_AUTH.discovery.md`. Issue: #607 (epic #569). Builds on **shipped #566** (`window.__RUNTIME_CONFIG__` / `config.js` contract) and **#577/#579** (backend config-driven OIDC validator + `OIDC_*` env) — both live on the epic branch.

Four slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/607-config-driven-web-auth`** (base `epic/enterprise-deployment`) — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from `apps/web` (never invoke jest directly — `feedback_use_npm_test_scripts`; ESM needs the script's `NODE_OPTIONS`):

```bash
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — the safe majority of the diff (the seam + SaaS parity) lands *before* any OIDC code exists, so a regression to the revenue login is caught with zero new provider risk in scope:

- **Slice 1** — the runtime-config accessor (pure functions), no consumer. Ships `resolveOidcSettings`'s fail-closed logic so slice 3 has no forward dep.
- **Slice 2** — the `useAuth()` seam with the **Auth0 bridge only**, all four consumers migrated, `sdk.auth` frozen, **and the existing test mocks migrated to the seam** so the suite stays green. SaaS behaves identically; no `react-oidc-context` dependency yet.
- **Slice 3** — add the OIDC library + bridge + the `AuthProvider` oidc branch + fail-closed mount + provider-aware login label. **Residency login goes live** after this slice.
- **Slice 4** — Storybook auth wrappers + README sync (doc-sync convention). No new behavior.

No DB migration, seed, backend, or core change — frontend-only (the `config.js` contract + `OIDC_*` env are #566's, already present).

---

## Slice 1 — `runtime-config.util` + `vite-env` global

Pure, dependency-free config reading. Nothing consumes it yet.

**Files**

- New: `apps/web/src/utils/runtime-config.util.ts` — `getRuntimeConfig()`, `resolveAuth0Settings()`, `resolveOidcSettings()`, `RuntimeConfigError`, the `AuthProviderKind`/`DeployMode`/`RuntimeConfig`/`Auth0Settings`/`OidcSettings` types.
- New: `apps/web/src/__tests__/runtime-config.util.test.ts` — cases 1–6.
- Edit: `apps/web/src/vite-env.d.ts` — add `interface Window { __RUNTIME_CONFIG__?: Record<string, string>; }`.

**Steps**

1. **Tests (spec cases 1–6).** Missing `__RUNTIME_CONFIG__` → SaaS defaults; full residency object read through; garbage `authProvider`/`deployMode` normalize to `auth0`/`saas`; `resolveAuth0Settings` reads `VITE_AUTH0_*`; `resolveOidcSettings` throws `RuntimeConfigError` on a blank OIDC field under `authProvider==="oidc"`; a stray `OIDC_CLIENT_SECRET` key is ignored (no-secret). Run; fail.
2. **Implement** the accessor + resolvers per the spec Surface. `getRuntimeConfig` reads only the five known keys with defaults; the resolvers derive provider config. Green.
3. Lint + type-check.

**Done when:** cases 1–6 pass; nothing else references the util yet.

**Risk:** none — pure code. Tests stub `window.__RUNTIME_CONFIG__` and `import.meta.env` per case.

---

## Slice 2 — `useAuth()` seam + Auth0 bridge + consumer migration (SaaS-green)

The whole refactor, Auth0-only. SaaS behavior is byte-for-byte the prior wiring; the existing suite is kept green by migrating its mocks to the seam.

**Files**

- New: `apps/web/src/providers/Auth.provider.tsx` — `AuthContext`, `useAuth()`, `Auth0AuthBridge`, and `AuthProvider` (auth0 branch implemented; the `oidc` branch throws `RuntimeConfigError` as a slice-3 placeholder — **no `react-oidc-context` import yet**).
- New: `apps/web/src/__tests__/Auth.provider.test.tsx` — cases 7–10, 13.
- Edit: `apps/web/src/api/auth.api.ts` — `session/login/logout` delegate to `useAuth()`; drop the `@auth0/auth0-react` import; `profile` unchanged.
- Edit: `apps/web/src/utils/api.util.ts` — `useAuthFetch` uses `useAuth().getToken()`; drop the `VITE_AUTH0_AUDIENCE` read; dep `[getToken]`.
- Edit: `apps/web/src/api/sse.api.ts` — `useCreate` uses `useAuth().getToken()`.
- Edit: `apps/web/src/providers/Application.provider.tsx` — `<Auth0Provider>` → `<AuthProvider>`; `AuthErrorHandler` registers `useAuth().logout`, mounted inside `AuthProvider`.
- Edit: `apps/web/src/modules/MapWidget/MapWidget.component.tsx` — `useAuth().getToken()`; drop the `VITE_AUTH0_AUDIENCE` read.
- Edit (keep-green): `apps/web/src/__tests__/Authorized.layout.test.tsx`, `apps/web/src/__tests__/PortalSession.test.tsx` — mock the internal `providers/Auth.provider` seam instead of `@auth0/auth0-react` (the Auth0 side of case 21).
- Edit: consumer-wiring tests (cases 14–17) + `sdk.auth` surface-parity tests (cases 18–19) — new or extended under `__tests__/`.

**Steps**

1. **Tests (spec cases 7–10, 13).** `AuthProvider` in `auth0` mode (vendor `Auth0Provider`/`useAuth0` mocked) → `useAuth().session` reflects the mock; `getToken()` returns the mocked token with the resolved audience; `login.withGoogle` sends `connection:"google-oauth2"`, `withUniversal` sends none; `logout()` calls vendor logout with `returnTo:origin`; `useAuth()` outside `AuthProvider` throws. Run; fail.
2. **Tests (cases 14–19).** `useAuthFetch` attaches `Bearer <getToken()>` and calls `handleAuthError` on a `getToken` rejection; `sse.create` builds `?token=<encoded>`; `Application.provider` registers `handleAuthError`'s logout; `MapWidget` tokens via `getToken`; `sdk.auth.session()/login()/logout()` keep their exact shapes and `Authorized` still redirects/renders correctly. Run; fail.
3. **Implement** `Auth.provider.tsx` (auth0 branch + bridge) and migrate the four consumers + `auth.api.ts` per the spec Surface. Green.
4. **Migrate the two existing auth-mocking tests** to the seam so they pass unchanged in behavior (this is what keeps the boundary green). Run the full `apps/web` unit suite.
5. Lint + type-check. **Grep guard:** `git grep -n "@auth0/auth0-react" apps/web/src` returns only `providers/Auth.provider.tsx`.

**Done when:** cases 7–10, 13, 14–19 pass; the full existing suite is green; SaaS login/token/refresh/logout are unchanged; the only `@auth0/auth0-react` importer is the bridge.

**Risk:** an existing test renders a token/session consumer without wrapping it in an `AuthProvider`, so `useAuth()` throws. Mitigation: step 4 migrates those tests to mock the seam (as they already mock `../api/sdk`); the shared `__tests__/test-utils.tsx` gains an optional seam mock if a wrapper is cleaner than per-file mocks.

---

## Slice 3 — OIDC bridge + provider branch + fail-closed + login label

Residency login goes live. The OIDC library enters the tree here.

**Files**

- Edit: `apps/web/package.json` — add `react-oidc-context` + `oidc-client-ts` to `dependencies` (`npm install` in `apps/web`).
- Edit: `apps/web/src/providers/Auth.provider.tsx` — add `OidcAuthBridge` (maps `react-oidc-context` `useAuth`), replace the placeholder `oidc` branch in `AuthProvider` with the real `OidcAuthProvider` mount (config from `resolveOidcSettings`, `automaticSilentRenew` + refresh tokens, `onSigninCallback` query-strip), fail-closed on blank config.
- Edit: `apps/web/src/components/LoginForm.component.tsx` — provider-aware primary-button label (generic "Sign in" under `authProvider==="oidc"`).
- Edit: `apps/web/src/__tests__/Auth.provider.test.tsx` — cases 11, 12.
- New/extend: login-label test (case 20); residency-mode render assertion (the OIDC side of case 21).

**Steps**

1. **Tests (spec cases 11, 12, 20).** `AuthProvider` in `oidc` mode (`react-oidc-context` mocked) → `session`/`getToken` map from the mocked user; `login.withGoogle`/`withUniversal` both call `signinRedirect`; `logout` calls `signoutRedirect`. A blank `OIDC_ISSUER` under `oidc` throws at mount (fail-closed) — no silent Auth0 fallback. `LoginForm` shows "Sign in with Google" in `auth0` and "Sign in" in `oidc`. Run; fail.
2. **Implement** the OIDC bridge + the real `oidc` branch + the label per the spec Surface. Add the deps. Green.
3. **Residency render assertion (case 21, OIDC side).** A view renders under `AuthProvider` in `oidc` mode without crashing (protected content shows once the mocked session is authenticated).
4. Lint + type-check.

**Done when:** cases 11, 12, 20, 21 pass; a residency `config.js` drives login against a generic OIDC issuer; a misconfigured residency build fails closed; the OIDC label is provider-appropriate.

**Risk:** the `oidc-client-ts` `UserManager` settings shape (authority/client_id/redirect_uri/scope/extraQueryParams/automaticSilentRenew) must match the library version installed. Mitigation: pin the settings in the bridge against the mocked `react-oidc-context` in tests; the live audience/scope mechanism against a real IdP is an epic-smoke concern (spec risk table + discovery Open Q3), not a unit-test one.

---

## Slice 4 — Storybook wrappers + README sync

Non-behavioral: keep the stories rendering over the seam and document the runtime-auth wiring (doc-sync convention — stale docs are a bug in this PR).

**Files**

- Edit: `apps/web/src/stories/Authorized.layout.stories.tsx` and the `LoginForm`/`Login.view` stories — wrap in the seam (mock `AuthProvider` value) instead of a real `<Auth0Provider>`.
- Edit: `apps/web/README.md` — the auth section: runtime `config.js` selects Auth0 (SaaS) vs generic OIDC (residency); `VITE_AUTH0_*` are dev-only fallbacks; the `useAuth()` seam is the only auth surface consumers touch.

**Steps**

1. Update the story wrappers so Storybook renders without a real vendor provider; confirm the stories build (`npm run build-storybook` or the story render test if present).
2. Update `apps/web/README.md`.
3. Lint + type-check.

**Done when:** stories render over the seam; the README describes the shipped runtime-auth behavior; no story imports a real `<Auth0Provider>`.

**Risk:** none (stories + docs).

---

## Sequence summary

| Slice | Lands | Spec cases | Tests |
|---|---|---|---|
| 1 | `runtime-config.util` + `vite-env` global | 1–6 | web unit |
| 2 | `useAuth()` seam + Auth0 bridge + 4 consumers + `sdk.auth` frozen + existing-mock migration | 7–10, 13, 14–19, 21 (Auth0 side) | web unit |
| 3 | OIDC bridge + provider branch + fail-closed + login label | 11, 12, 20, 21 (OIDC side) | web unit |
| 4 | Storybook wrappers + README sync | — | storybook build / render |

Total ≈ **21 cases**, no migration. Commits on `feat/607-config-driven-web-auth`; the PR grows commit-by-commit.

---

## Cross-slice notes

- **SaaS parity is the invariant, provable after slice 2.** The Auth0 bridge reproduces every current `loginWithRedirect`/`logout`/`getAccessTokenSilently` call verbatim, and `sdk.auth`'s public surface is frozen, so no `sdk.auth.*` consumer (`SidebarNav`, `HeaderMenu`, `LoginForm` primary path, `Authorized`, `Settings`) changes. A regression here is a slice-2 bug, isolated from any OIDC code.
- **No forward dep on the OIDC library.** Slice 2's `Auth.provider.tsx` imports only `@auth0/auth0-react`; the `oidc` branch throws a placeholder until slice 3 adds the dependency and the bridge. Type-check is green at every boundary.
- **Fail-closed is split correctly:** `resolveOidcSettings`'s throw-on-blank *logic* + its unit test land in slice 1 (case 5); the *provider-mount* fail-closed behavior (case 12) lands in slice 3 where `AuthProvider` actually wires it.
- **Callback handling needs no route** (discovery D6): `redirect_uri=origin`, `onSigninCallback` strips `?code=&state=`, and `Authorized` already gates on `isLoading` during the exchange. Watch that the `oidc` provider reports `isLoading` true until the code exchange resolves — asserted via the mocked `react-oidc-context` in slice 3.
- **Existing-mock migration is a slice-2 obligation, not a slice-4 afterthought** — deferring it would leave the suite red across the slice-2 boundary. Only the *residency-mode assertion* defers to slice 3 (it needs the OIDC path to exist).
- **Doc-sync surfaces (per `CLAUDE.md` → "Keeping Documentation in Sync"):** `apps/web/README.md` (slice 4); the `Dockerfile:19` comment already flags `config.js` overrides #607, and `.env`/`.env.example` keep `VITE_AUTH0_*` as documented dev fallbacks — no change needed there. `render-config.mjs`'s consumption-deferred comment becomes accurate once slice 3 lands.
- **CLAUDE.md compliance:** file suffixes (`*.util.ts`, `*.provider.tsx`, `*.component.tsx`), SDK-only API access (unchanged — `sdk.auth` stays the facade), no direct `fetch`/`useAuth0` outside the seam (grep guard, slice 2). No env-var, migration, or infra change.

## Next step

Implement slice 1 on this branch, tests-first, one commit per slice — only after discovery + spec + plan are reviewed and confirmed. Before coding, re-read the spec's *Surface* skeletons; they're faithful to the real `sdk.auth`/`useAuthFetch`/`Application.provider` shapes and the `render-config.mjs` `RUNTIME_KEYS` contract — lift, don't reinvent.
