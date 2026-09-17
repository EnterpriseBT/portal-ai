# Config-driven web auth (runtime OIDC login) — Spec

**Issue:** [EnterpriseBT/portal-ai#607](https://github.com/EnterpriseBT/portal-ai/issues/607) · **Epic:** #569 · **Discovery:** `docs/CONFIG_DRIVEN_WEB_AUTH.discovery.md`

This spec pins the frontend auth seam that lets a **prebuilt** web image log in against Auth0 (SaaS) *or* a generic OIDC issuer (residency), selected at runtime from `window.__RUNTIME_CONFIG__` (#566's contract) with **no rebuild**. It introduces a normalized `useAuth()` hook + `AuthProvider` with two bridge impls, a typed runtime-config accessor, and migrates the four direct `@auth0/auth0-react` consumers — while keeping the `sdk.auth` public surface (and therefore every `sdk.auth.*` consumer) unchanged.

## Key decisions (flag for review)

1. **D1 — one `useAuth()` seam over a React context.** Two bridge components (Auth0, OIDC) each call their own vendor provider hook unconditionally and publish a *normalized* value into `AuthContext`; `useAuth()` reads that context. Only one bridge mounts per deploy, so rules-of-hooks hold.
2. **D2 — dual-impl, Auth0 untouched for SaaS.** `@auth0/auth0-react` stays the SaaS path; `react-oidc-context` (+ `oidc-client-ts`) is the residency path. Confirmed direction (discovery Decision 2A) — no unification, no regression to the revenue login.
3. **D3 — library: `react-oidc-context` + `oidc-client-ts`.** Auth-code + PKCE public client, `automaticSilentRenew`, callback processed on mount.
4. **D4 — provider config sources split by kind.** Auth0 config = build-time `VITE_AUTH0_*` (as today; the SaaS image bakes our Auth0 values). OIDC config = runtime `OIDC_ISSUER`/`OIDC_CLIENT_ID`/`OIDC_AUDIENCE` from `config.js`. `AUTH_PROVIDER`/`DEPLOY_MODE` select the path.
5. **D5 — fail-closed.** `AUTH_PROVIDER=oidc` with any of `OIDC_ISSUER`/`OIDC_CLIENT_ID`/`OIDC_AUDIENCE` blank throws at provider mount (mirrors the backend `assertDeployModeConsistency`); a residency build never silently falls back to Auth0 or anonymous.
6. **D6 — no new route; callback lands at origin.** `redirect_uri = window.location.origin`; `oidc-client-ts` strips `?code=&state=` via `onSigninCallback`. The `Authorized` guard already shows `LoadingView` while `isLoading`, so the code-exchange landing is never treated as unauthenticated.
7. **No secret in the bundle.** PKCE public client; the runtime contract carries only public issuer/clientId/audience. A unit test asserts the accessor exposes no secret-shaped field.

## Scope

### In scope

1. `utils/runtime-config.util.ts` (new) — typed reader of `window.__RUNTIME_CONFIG__` + `VITE_AUTH0_*` fallback.
2. `providers/Auth.provider.tsx` (new) — `AuthProvider`, `AuthContext`, `useAuth()`, and the two bridges (`Auth0AuthBridge`, `OidcAuthBridge`).
3. Migrate the four direct `useAuth0` consumers — `utils/api.util.ts`, `api/sse.api.ts`, `providers/Application.provider.tsx`, `modules/MapWidget/MapWidget.component.tsx` — to `useAuth()`.
4. Reimplement `api/auth.api.ts` (`sdk.auth`) internals over `useAuth()`; **public surface unchanged** (`session()`, `login().withGoogle/withUniversal`, `logout().logout`, `profile()`).
5. Provider-aware login label in `LoginForm` — generic "Sign in" when `authProvider==="oidc"` (residency must not show a misleading "Google" button).
6. `react-oidc-context` + `oidc-client-ts` added to `apps/web/package.json`.
7. `VITE_AUTH0_*` become **dev-only fallbacks**; `vite-env.d.ts` keeps the decls and gains the `window.__RUNTIME_CONFIG__` global type.
8. Test + Storybook mock migration to the internal seam; docs sync (`apps/web/README.md`).

### Out of scope

- The web-image `config.js` generation + bundled-issuer subchart — **#566** (this consumes the contract; the Keycloak subchart stays a stub).
- In-app SSO configuration UI (Settings → SSO) — later follow-up.
- A SAML SP — customers federate via their own OIDC / Auth0 Enterprise Connection (#577).
- Backend validator / provisioning — **#577** (delivered).
- Automated residency E2E login against a real customer IdP — deferred to the #569 epic smoke (no local customer issuer exists yet).

## Surface

### `utils/runtime-config.util.ts` (new)

```ts
export type AuthProviderKind = "auth0" | "oidc";
export type DeployMode = "saas" | "residency";

/** Non-secret runtime identity config. Mirrors render-config.mjs RUNTIME_KEYS. */
export interface RuntimeConfig {
  authProvider: AuthProviderKind;   // AUTH_PROVIDER (default "auth0")
  deployMode: DeployMode;           // DEPLOY_MODE   (default "saas")
  oidcIssuer: string;               // OIDC_ISSUER    ("" in SaaS)
  oidcClientId: string;             // OIDC_CLIENT_ID ("" in SaaS)
  oidcAudience: string;             // OIDC_AUDIENCE  ("" in SaaS)
}

/** Read window.__RUNTIME_CONFIG__ once, tolerating a missing/partial object. */
export function getRuntimeConfig(): RuntimeConfig;

/** Auth0 provider config — build-time VITE_AUTH0_* (SaaS/dev authority). */
export interface Auth0Settings { domain: string; clientId: string; audience: string; }
export function resolveAuth0Settings(): Auth0Settings;

/** OIDC provider config — runtime OIDC_* (residency authority).
 *  Throws RuntimeConfigError when authProvider==="oidc" and any field is blank (D5). */
export interface OidcSettings { issuer: string; clientId: string; audience: string; }
export function resolveOidcSettings(cfg: RuntimeConfig): OidcSettings;

export class RuntimeConfigError extends Error {}
```

- `getRuntimeConfig()` reads only the five known keys; unknown keys (incl. any secret-shaped one) are ignored. `authProvider` other than `"oidc"` normalizes to `"auth0"`; `deployMode` other than `"residency"` normalizes to `"saas"`.
- `resolveAuth0Settings()` reads `VITE_AUTH0_DOMAIN`/`VITE_AUTH0_CLIENT_ID`/`VITE_AUTH0_AUDIENCE` — the audience the token is minted for stays the SaaS build value.

### `providers/Auth.provider.tsx` (new)

The normalized contract every consumer reads:

```ts
export interface AuthSession {
  user: unknown;              // provider-native profile (unchanged shape for sdk.auth.session)
  isAuthenticated: boolean;
  isLoading: boolean;
  error?: Error;
}
export interface NormalizedAuth {
  session: AuthSession;
  getToken: () => Promise<string>;               // access token, audience baked in; renews as needed
  login: { withGoogle: () => void; withUniversal: () => void };
  logout: () => void;
}

export const AuthContext = React.createContext<NormalizedAuth | null>(null);

/** Reads AuthContext; throws if used outside AuthProvider. */
export function useAuth(): NormalizedAuth;

/** Mounts the provider selected by AUTH_PROVIDER and its bridge. */
export const AuthProvider: React.FC<{ children: React.ReactNode }>;
```

- **`Auth0AuthBridge`** — calls `useAuth0()`; maps to `NormalizedAuth`:
  - `getToken` = `() => getAccessTokenSilently({ authorizationParams: { audience: resolveAuth0Settings().audience } })`.
  - `login.withGoogle` = `loginWithRedirect({ openUrl: replace, authorizationParams: { connection: "google-oauth2", redirect_uri: origin } })` (the current pin; Auth0-only).
  - `login.withUniversal` = `loginWithRedirect({ openUrl: replace, authorizationParams: { redirect_uri: origin } })` (the #304 dev/E2E path).
  - `logout` = `logout({ logoutParams: { returnTo: origin }, openUrl: replace })`.
- **`OidcAuthBridge`** — calls `react-oidc-context` `useAuth()`; maps:
  - `session` from `{ user, isAuthenticated, isLoading, error }`.
  - `getToken` = returns `user?.access_token`; if absent/expired, `await signinSilent()` then return its token (rejects if still absent).
  - `login.withGoogle` = `login.withUniversal` = `signinRedirect()` (the customer IdP renders its own login; no Google pin).
  - `logout` = `signoutRedirect()` (RP-initiated logout via `end_session_endpoint`).
- **`AuthProvider`** renders, by `getRuntimeConfig().authProvider`:
  - `auth0` → `<Auth0Provider domain clientId authorizationParams={{ redirect_uri: origin, audience }} cacheLocation="localstorage" useRefreshTokens><Auth0AuthBridge>{children}</Auth0AuthBridge></Auth0Provider>` (config from `resolveAuth0Settings()`).
  - `oidc` → `<OidcAuthProvider authority={issuer} client_id redirect_uri={origin} scope="openid profile email" extraQueryParams={{ audience }} automaticSilentRenew onSigninCallback={stripQuery}><OidcAuthBridge>{children}</OidcAuthBridge></OidcAuthProvider>` (config from `resolveOidcSettings()` — throws on blank, D5). `stripQuery = () => window.history.replaceState({}, "", window.location.pathname)`.

### `api/auth.api.ts` (edit) — internals swap, surface frozen

```ts
export const auth = {
  session: () => useAuth().session,                              // { user, isAuthenticated, isLoading, error }
  login: () => useAuth().login,                                  // { withGoogle, withUniversal }
  logout: () => ({ logout: useAuth().logout }),                  // { logout }
  profile: (options?) => useAuthQuery<Auth0UserProfileGetResponse>(queryKeys.auth.profile(), "/api/profile", undefined, options),
};
```

No `@auth0/auth0-react` import remains here. `SidebarNav`, `HeaderMenu`, `LoginForm`, `Authorized.component.tsx`, `Settings.view.tsx` consume `sdk.auth.*` and need **no change**.

### `utils/api.util.ts` (edit)

`useAuthFetch`: replace `const { getAccessTokenSilently } = useAuth0()` with `const { getToken } = useAuth()`; `token = await getToken()` (audience now inside `getToken`); on throw, `handleAuthError()` + rethrow (unchanged). Drop the `VITE_AUTH0_AUDIENCE` read here. `useCallback` dep becomes `[getToken]`.

### `api/sse.api.ts` (edit)

`useCreate`: `const { getToken } = useAuth()`; `const token = await getToken()`; URL/`?token=` construction unchanged (the `EventSource`-can't-set-headers rationale stands).

### `providers/Application.provider.tsx` (edit)

Replace `<Auth0Provider …>` with `<AuthProvider>`; `AuthErrorHandler` registers logout via `useAuth().logout` and mounts **inside** `AuthProvider` (so the context is available). Everything else (theme/layout/query/toast nesting) unchanged.

### `modules/MapWidget/MapWidget.component.tsx` (edit)

Replace `useAuth0().getAccessTokenSilently` + `VITE_AUTH0_AUDIENCE` with `useAuth().getToken()`.

### `views`/`components` login label (edit)

`LoginForm.component.tsx` (or `Login.view.tsx`): when `getRuntimeConfig().authProvider === "oidc"`, the primary button reads "Sign in" and calls `sdk.auth.login().withGoogle()` (→ `signinRedirect`); the `#304` dev affordance stays guarded/Auth0-only.

### `vite-env.d.ts` (edit)

Keep `VITE_AUTH0_*` (dev-only fallbacks). Add the runtime global:

```ts
interface Window { __RUNTIME_CONFIG__?: Record<string, string>; }
```

### `apps/web/package.json` (edit)

Add `react-oidc-context` + `oidc-client-ts` to `dependencies`.

## Migration

None — no DB schema change. (Frontend-only ticket.)

## Seed

None.

## TDD test plan

Run via `cd apps/web && npm run test:unit` (`feedback_use_npm_test_scripts`; never raw jest — ESM needs the script's `NODE_OPTIONS`). Existing auth-mock style is `jest.unstable_mockModule` (`__tests__/PortalSession.test.tsx`) / classic `jest.mock` (`__tests__/Authorized.layout.test.tsx`); new tests mock the **internal** `providers/Auth.provider` seam, not the vendor package.

### Layer 1 — `runtime-config.util` (`__tests__/runtime-config.util.test.ts`, new)

1. Missing `window.__RUNTIME_CONFIG__` → defaults `{ authProvider:"auth0", deployMode:"saas", oidc*:"" }`.
2. Full residency object → `{ authProvider:"oidc", deployMode:"residency", oidcIssuer/ClientId/Audience }` read through.
3. Unknown/garbage `authProvider` or `deployMode` normalize to `auth0`/`saas`.
4. `resolveAuth0Settings()` reads `VITE_AUTH0_*`.
5. `resolveOidcSettings()` with `authProvider==="oidc"` and a blank field **throws `RuntimeConfigError`** (D5, fail-closed).
6. **No-secret:** an injected `window.__RUNTIME_CONFIG__` carrying an extra `OIDC_CLIENT_SECRET` is ignored — the returned object has no secret field and none of the resolvers surface it.

### Layer 2 — the `useAuth()` seam (`__tests__/Auth.provider.test.tsx`, new)

7. `AuthProvider` with `authProvider==="auth0"` mounts the Auth0 bridge (vendor `Auth0Provider` mocked) and `useAuth().session` reflects the mocked `useAuth0` values.
8. Auth0 `getToken()` returns the mocked `getAccessTokenSilently` token with the resolved audience.
9. Auth0 `login.withGoogle()` calls `loginWithRedirect` with `connection: "google-oauth2"`; `withUniversal()` calls it **without** a connection.
10. Auth0 `logout()` calls vendor `logout` with `returnTo: origin`.
11. `AuthProvider` with `authProvider==="oidc"` mounts the OIDC bridge (`react-oidc-context` mocked); `session`/`getToken` map from the mocked user; `login.withGoogle`/`withUniversal` both call `signinRedirect`; `logout` calls `signoutRedirect`.
12. OIDC provider config with a blank `OIDC_ISSUER` throws at mount (D5) — the error surfaces, no silent Auth0 fallback.
13. `useAuth()` outside `AuthProvider` throws.

### Layer 3 — consumer wiring

14. `useAuthFetch` (`__tests__/…` mocking `Auth.provider.useAuth`) attaches `Authorization: Bearer <getToken()>` and, on a `getToken` rejection, calls `handleAuthError()` and rethrows.
15. `sse.api` `create()` builds `…?token=<encoded getToken()>` and constructs an `EventSource` with it.
16. `Application.provider` renders `AuthProvider` and registers `handleAuthError`'s logout (spy on `registerAuthLogout`).
17. `MapWidget` acquires its token via `useAuth().getToken()` (no `VITE_AUTH0_AUDIENCE` read).

### Layer 4 — `sdk.auth` surface parity + login label

18. `sdk.auth.session()` returns `{ user, isAuthenticated, isLoading, error }`; `Authorized` renders children when authenticated and `<Navigate to="/login">` when not (existing behavior, now over the seam).
19. `sdk.auth.login()` exposes `withGoogle`/`withUniversal`; `logout()` exposes `logout` — shapes unchanged (guards the frozen surface).
20. `LoginForm` shows "Sign in with Google" in `auth0` mode and a generic "Sign in" in `oidc` mode (mocked `getRuntimeConfig`).

### Layer 5 — existing mock migration

21. `Authorized.layout.test.tsx` + `PortalSession.test.tsx` pass against the seam mock (not `@auth0/auth0-react`); add a residency-mode (`oidc`) render assertion so both paths are covered.

**Totals:** ~6 config, ~7 seam, ~4 wiring, ~3 surface/label, ~1 migration ≈ **21 cases**.

## Acceptance criteria

- [ ] All new cases pass; existing `apps/web` suite green; `npm run lint && npm run type-check` clean at repo root.
- [ ] **SaaS unchanged:** with `AUTH_PROVIDER=auth0` (the default `config.js`), Auth0 Google login, token acquisition, silent refresh, and the 401→logout path behave exactly as before — no consumer of `sdk.auth.*` changed.
- [ ] **Residency:** with `config.js` set to `{AUTH_PROVIDER:"oidc", OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_AUDIENCE, DEPLOY_MODE:"residency"}`, a user logs in against that issuer, acquires a token, and reaches a protected route — **no rebuild**, config supplied at container start (verified against a local Keycloak/Dex in dev).
- [ ] Token acquisition + silent refresh + the `handleAuthError` 401→logout path behave identically on both providers.
- [ ] **Fail-closed:** `AUTH_PROVIDER=oidc` with a blank OIDC field surfaces a clear error at load; never a silent Auth0/anonymous fallback.
- [ ] **No secret** in the web bundle or `config.js` — only issuer/clientId/audience; PKCE public client. Asserted by test 6.
- [ ] `VITE_AUTH0_*` are dev-only fallbacks; the built image is authoritative from `config.js`.
- [ ] Residency login button copy is provider-appropriate (no "Google" label under `oidc`).

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Swapping `Application.provider` breaks SaaS login for all paying users. | `sdk.auth` surface frozen; the Auth0 bridge reproduces every current `loginWithRedirect`/`logout`/`getAccessTokenSilently` call verbatim; tests 7–10, 18–19 pin parity. Slice order lands the Auth0-only seam first (SaaS-green) before the OIDC impl. |
| Residency install silently runs against our Auth0 (data-exfil / lock-in). | **Fail-closed** at provider mount (D5, test 12); a residency build with blank OIDC config refuses to load rather than defaulting. |
| `?code=&state=` callback landing bounces to `/login` before the exchange finishes. | `redirect_uri=origin`; `Authorized` shows `LoadingView` while `isLoading` (already true during OIDC code exchange); `onSigninCallback` strips the query. |
| `oidc-client-ts` silent-renew (iframe) blocked by third-party-cookie policy → sessions drop. | Configure `automaticSilentRenew` **with refresh tokens** (offline_access scope) so renewal doesn't depend on IdP session cookies; `getToken` awaits `signinSilent` on expiry and routes failure through `handleAuthError`. |
| A secret leaks into `config.js`. | Contract carries only public keys; `render-config.mjs` already forbids it in-comment; test 6 asserts the accessor never surfaces a secret. |
| `MapWidget` token path missed. | Explicitly in the consumer inventory (test 17); a repo-wide `useAuth0` grep in the smoke confirms zero direct imports remain outside `Auth.provider`. |

**Rollback:** `git revert` the branch — frontend-only, no schema/infra. The default `config.js` keeps `AUTH_PROVIDER=auth0`, so a revert restores the exact prior SaaS wiring.

## Files touched

**`apps/web`** — new: `src/utils/runtime-config.util.ts`, `src/providers/Auth.provider.tsx`, and their tests. Edit: `src/api/auth.api.ts`, `src/utils/api.util.ts`, `src/api/sse.api.ts`, `src/providers/Application.provider.tsx`, `src/modules/MapWidget/MapWidget.component.tsx`, `src/components/LoginForm.component.tsx` (login label), `src/vite-env.d.ts`, `package.json`, `src/__tests__/Authorized.layout.test.tsx`, `src/__tests__/PortalSession.test.tsx`, relevant `stories/*` auth wrappers, `README.md`. No backend, core, migration, seed, env-var, or infra change (the `config.js` contract + `OIDC_*` env are #566's, already present).

## Next step

`docs/CONFIG_DRIVEN_WEB_AUTH.plan.md` — TDD slices on this branch: (1) `runtime-config.util` + `vite-env` global + no-secret test; (2) `useAuth()` seam + **Auth0 bridge only** + migrate the four consumers + freeze `sdk.auth` (SaaS-green, zero behavior change — the safe majority of the diff); (3) add `react-oidc-context`/`oidc-client-ts` + the OIDC bridge + provider branch + fail-closed + login label; (4) migrate existing test/story mocks + README sync. SaaS parity is provable after slice 2, residency after slice 3; each slice is an independently green commit.
