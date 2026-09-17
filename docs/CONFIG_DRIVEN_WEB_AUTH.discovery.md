# Config-driven web auth (runtime OIDC login) — Discovery

**Issue:** [EnterpriseBT/portal-ai#607](https://github.com/EnterpriseBT/portal-ai/issues/607)

**Why this exists.** A full client-owned residency install (#569) ships a **prebuilt** web SPA that must log in against the customer's own OIDC issuer — or a bundled fallback — with **no rebuild**. Today `apps/web/src/providers/Application.provider.tsx:41-63` hard-wires `@auth0/auth0-react` to build-time `VITE_AUTH0_*`, so the shipped image can only ever talk to our Auth0 tenant. The runtime plumbing that would let it do otherwise already exists: #566 landed `window.__RUNTIME_CONFIG__` (served from `/config.js`, rendered at container start), and #577/#579 made the **backend** validator config-driven (`residency` mode reads `OIDC_ISSUER`/`OIDC_AUDIENCE`). Both sides are wired; the SPA is the one consumer that still ignores the runtime config.

This is the frontend half that consumes the `config.js` contract and authenticates through a config-selected client: Auth0 for SaaS, a generic OIDC client for residency, behind one `useAuth()` seam.

## The current shape

### Auth0 frontend wiring & the `useAuth0` consumers

| Site | File | Uses |
|---|---|---|
| Provider mount | `providers/Application.provider.tsx:41-63` | `<Auth0Provider>` — `VITE_AUTH0_DOMAIN` (`:42`), `VITE_AUTH0_CLIENT_ID` (`:43`), `authorizationParams.audience`=`VITE_AUTH0_AUDIENCE` (`:46`), `redirect_uri=window.location.origin`, `cacheLocation="localstorage"`, `useRefreshTokens` |
| 401 logout register | `providers/Application.provider.tsx:12-22` | `useAuth0().logout` → `registerAuthLogout` |
| Token for fetch | `utils/api.util.ts:61-112` | `getAccessTokenSilently({authorizationParams:{audience: VITE_AUTH0_AUDIENCE}})` (`:68`), `Authorization: Bearer` (`:85`) |
| Token for SSE | `api/sse.api.ts:13-27` | `getAccessTokenSilently`; token passed as `?token=` query param (`:22-24`) because `EventSource` can't set headers |
| Session/login/logout facade | `api/auth.api.ts` | `user/isAuthenticated/isLoading/error` (`:9`); `loginWithRedirect` (`:14`, `withGoogle` pins `connection: google-oauth2`, `withUniversal` is the guarded dev/E2E path #304); `logout` (`:42`) |
| Map token | `modules/MapWidget/MapWidget.component.tsx:503,525` | `getAccessTokenSilently` + `VITE_AUTH0_AUDIENCE` |

`api/auth.api.ts` is the central `sdk.auth` facade — `SidebarNav`, `HeaderMenu`, `LoginForm`, `Authorized.component.tsx`, and `Settings.view.tsx` consume `sdk.auth.*`, not `useAuth0` directly. It is the natural home for a provider-agnostic seam.

### The 401→logout singleton

`utils/auth-error.util.ts` — module-level `registerAuthLogout(fn)` / `handleAuthError()`. Registered once in `Application.provider.tsx:16`; invoked by `api.util.ts` on token failure (`:74`) and by `Authorized.component.tsx:29` on session error. Provider-agnostic already.

### Route protection

`components/Authorized.component.tsx:40-52` reads `sdk.auth.session()` → `{isLoading,error,isAuthenticated}`; loading/error → `PublicLayout`+`LoadingView`; `!isAuthenticated` → `<Navigate to="/login" search>` (`:48`, search preserved for the #304 `?e2e=1` path). Applied at `routes/__root.tsx:28-32` and `routes/index.tsx:13-17`. `layouts/Authorized.layout.tsx` is pure chrome. **No explicit Auth0 callback route** — `Auth0Provider` processes the redirect at `window.location.origin` implicitly.

### The runtime-config contract (#566) — established, not yet consumed

`apps/web/index.html:12` loads `<script src="/config.js">` (blocking classic, before the module bundle) → `window.__RUNTIME_CONFIG__`. Dev/SaaS default `apps/web/public/config.js:1`: `{AUTH_PROVIDER:"auth0", OIDC_ISSUER:"", OIDC_CLIENT_ID:"", OIDC_AUDIENCE:"", DEPLOY_MODE:"saas"}`. Canonical key set in `apps/web/scripts/render-config.mjs:16-22` (`RUNTIME_KEYS`), emitted at container start by `apps/web/scripts/40-render-config.sh`, served via `apps/web/nginx.conf:14`. **No typed TS accessor exists yet** — #607 adds it. Header comment is explicit: only non-secret public values, never a client secret.

### Backend naming the frontend must match (#577/#579)

`apps/api/src/middleware/auth.middleware.ts:18-29` `resolveAuthConfig(mode,env)`: residency → `{audience: OIDC_AUDIENCE, issuerBaseURL: OIDC_ISSUER}`; saas → Auth0. `apps/api/src/config/deploy-mode.ts:78-105` fail-closed boot guard requires `OIDC_ISSUER`+`OIDC_AUDIENCE` in residency. Helm derives both from one source: `deploy/helm/portalai/templates/configmap.yaml:8-14` (`residency`→`AUTH_PROVIDER=oidc`), `values.yaml:66-73` `oidc:` block; bundled issuer is a stub flag (`values.yaml:182-186`, `bundledIssuer.enabled:false`, Keycloak). **Frontend keys are `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_CLIENT_ID`** (client_id is frontend-only).

### Auth mocking in tests / Storybook

Per-file mocks of `@auth0/auth0-react` (classic `jest.mock` in `__tests__/Authorized.layout.test.tsx:14-17`; ESM `jest.unstable_mockModule` in `__tests__/PortalSession.test.tsx:95-101`) plus mocks of `../api/sdk`. Shared `__tests__/test-utils.tsx` has **no** auth provider — auth is mocked per file. Storybook (`stories/Authorized.layout.stories.tsx:15-23`) wraps a real `<Auth0Provider>`. A seam concentrated in `api/auth.api.ts` lets tests mock **one internal module** instead of the vendor package.

## The design space

### Decision 1 — The abstraction seam

**A.** A normalized `useAuth()` hook + `AuthProvider` that mounts one concrete impl (Auth0 or OIDC) chosen by `AUTH_PROVIDER`; all consumers call `useAuth()`. **B.** Route everything through the `sdk.auth` facade + a token singleton (like `registerAuthLogout`). **C.** Leave consumers calling `useAuth0`, shim `useAuth0` itself.

| | A (`useAuth()` seam) | B (facade + singleton) | C (shim useAuth0) |
|---|---|---|---|
| Consumer churn | Moderate (5 sites → `useAuth()`) | Low | None |
| Vendor lock removed | Yes | Partial (token still hook) | No — keeps Auth0 hook shape |
| Test mock surface | One internal module | Two (facade + singleton) | Still the vendor pkg |

**Lean: A.** A single `useAuth()` returning `{session, getToken, login, logout}` normalizes both providers; the five hook consumers already listed all live in hook contexts, so no singleton is needed for tokens. The provider branches once on `AUTH_PROVIDER`.

### Decision 2 — Keep Auth0 for SaaS, or unify on generic OIDC?

**A. Dual-impl:** `<Auth0Provider>` for `saas`, a generic OIDC provider for `residency`, both behind `useAuth()`. **B. Unify:** drop `@auth0/auth0-react`, drive Auth0 as just another OIDC issuer.

| | A (dual-impl) | B (unify on OIDC) |
|---|---|---|
| SaaS regression risk | None — proven path untouched | High — re-validate Google login, silent refresh, #304 E2E on the revenue path |
| `connection: google-oauth2` pin | Native Auth0 param | Passed as `extraQueryParams` (works, unproven here) |
| Code paths to maintain | Two (behind one seam) | One |
| Matches AC wording | Yes — "identically on **both providers**" | Contradicts it |

**Lean: A.** The acceptance criteria explicitly say "both providers," and the SaaS Auth0/Google login is the live revenue path — keeping its SDK untouched is the low-risk choice. The seam is what makes the second impl cheap; unifying later is a follow-up if the dual path proves costly.

### Decision 3 — OIDC library for the residency impl

**react-oidc-context** (React context+hooks over `oidc-client-ts`) vs raw `oidc-client-ts` vs `@auth0/auth0-react` pointed at a generic issuer.

**Lean: react-oidc-context (+ oidc-client-ts).** Authorization-code + PKCE public client, silent refresh, and a hook shape that maps 1:1 onto `useAuth()`. It processes the redirect callback on mount (`onSigninCallback`), matching Auth0's implicit-at-origin behavior.

### Decision 4 — Runtime config accessor & dev fallback

A typed `utils/runtime-config.util.ts` reads `window.__RUNTIME_CONFIG__` (declared on `vite-env.d.ts`), returning `{authProvider, oidcIssuer, oidcClientId, oidcAudience, deployMode}`. When `AUTH_PROVIDER==="auth0"` and the OIDC fields are empty (dev), it falls back to `VITE_AUTH0_*`. `VITE_AUTH0_*` become **dev-only fallbacks**; the runtime path is authoritative in the built image.

**Lean: single typed accessor, one contract.** The key names must match `render-config.mjs`'s `RUNTIME_KEYS` and the backend's `OIDC_*` exactly — freeze this as the shared contract.

## Tradeoff comparison

|  | D1: `useAuth()` seam | D2: dual-impl | D3: react-oidc-context | D4: typed accessor |
|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes |
| Touches SaaS revenue path | No | No | No | No |

## Recommendation

1. Add `utils/runtime-config.util.ts` — typed reader of `window.__RUNTIME_CONFIG__` with `VITE_AUTH0_*` dev fallback; declare the global in `vite-env.d.ts`. Keys match `render-config.mjs` `RUNTIME_KEYS` and backend `OIDC_*`.
2. Introduce a normalized `useAuth()` hook + `AuthProvider` (`providers/Auth.provider.tsx`) that mounts `<Auth0Provider>` when `authProvider==="auth0"` and a react-oidc-context provider when `"oidc"`. `useAuth()` returns `{session:{isAuthenticated,isLoading,error,user}, getToken(), login(opts), logout()}`.
3. Migrate the five `useAuth0` consumers — `api.util.ts`, `sse.api.ts`, `api/auth.api.ts`, `Application.provider.tsx`, `MapWidget.component.tsx` — to `useAuth()`. Audience comes from runtime config, not `VITE_AUTH0_AUDIENCE`.
4. Keep `withGoogle` (the `google-oauth2` pin) and `withUniversal` (#304) inside the **Auth0 impl only**; residency login is IdP-hosted with no Google pin.
5. `VITE_AUTH0_*` become dev-only fallbacks; the built image is authoritative from `config.js`. No secret ever enters the bundle — PKCE public client, non-secret issuer/clientId/audience only.
6. Update auth test mocks to target the one internal `useAuth`/`sdk.auth` module; add a residency-mode render path.

## Open questions

1. **Redirect callback route.** Generic OIDC lands back at `redirect_uri` with `?code=&state=`. react-oidc-context strips it via `onSigninCallback` on mount, but the `Authorized` guard could bounce to `/login` before the exchange completes. **Lean: redirect to origin (`/`), no new route** (parity with Auth0), and gate the guard on the provider's `isLoading` so a `?code=` landing isn't treated as unauthenticated.
2. **SSE token off the hook.** `sse.api.ts` reads the token in a hook to build the `?token=` URL. react-oidc-context exposes `user.access_token` via context. **Lean: keep SSE a hook; `useAuth().getToken()` serves both fetch and SSE.**
3. **Bundled issuer for testing.** The Keycloak subchart is a stub today (#566's remit). #607 needs *a* standards issuer to verify against. **Lean: verify against a local Keycloak/Dex in dev; a mock customer OIDC issuer is stood up during the #569 epic smoke** (residency OIDC federation is deferred there — no local customer issuer exists yet).
4. **Silent-refresh parity.** Auth0 uses refresh-token rotation in localStorage; oidc-client-ts uses silent renew (hidden iframe or refresh token). **Lean: configure oidc-client-ts with `automaticSilentRenew` + refresh tokens** so the 401→logout path fires identically when renewal fails.

## Enterprise-scale considerations

- **Concurrency & correctness** — N/A because auth is client-side; the OIDC library single-flights token refresh.
- **Accuracy & auditability** — N/A because provisioning + audit are backend (#577 on-first-token, #575 audit log); this ticket only acquires the token.
- **Failure modes** — **fail-closed.** A missing/malformed `config.js`, an unreachable issuer, or a failed token exchange surfaces a clear "identity provider unavailable" state and blocks access. A residency build **must never** silently fall back to SaaS Auth0 or to anonymous access. **Lean: explicit error surface, no silent degrade.**
- **Scale & unbounded growth** — N/A because config is read once at load; no per-request fan-out.
- **Multi-tenancy** — residency is single-tenant (one install = one customer); SaaS multi-tenant is unchanged. Config is per-install, not per-request. **Lean: read config once, cache in module scope.**
- **Contract stability** — the runtime-config key set + `useAuth()` shape are the seam future IdP work plugs into. **Lean: freeze the key contract shared with `render-config.mjs` and the backend `OIDC_*` naming; a mismatch fails the SaaS/residency handshake silently.**
- **Data lifecycle** — N/A because token/refresh lifetime is owned by the IdP.
- **No-secret invariant (billing/compliance-adjacent)** — the web bundle and `config.js` carry only non-secret issuer/clientId/audience; PKCE means no client secret in the SPA. **Lean: enforce in the accessor (no secret-shaped key) and assert it in a test.**

## What this doesn't decide

- The web-image `config.js` generation + bundled-issuer subchart packaging — **#566** (this consumes the contract; the Keycloak subchart stays a stub here).
- In-app SSO configuration UI (Settings → SSO) — #577 out-of-scope; a later follow-up.
- A SAML SP in the app — customers federate via their own OIDC or an Auth0 Enterprise Connection (#577).
- The backend validator / provisioning — delivered in #577.
- Automated residency E2E login against a real customer IdP — deferred to the #569 epic smoke (no local customer issuer exists yet).

## Next step

Write `docs/CONFIG_DRIVEN_WEB_AUTH.spec.md` (the `useAuth()` contract + runtime-config key contract + acceptance) and `.plan.md` (slices). The plan will slice as: (1) typed `runtime-config.util` + `vite-env` global + no-secret test; (2) the `useAuth()` seam with the Auth0 impl only (pure refactor, SaaS-green, zero behavior change); (3) migrate the five consumers to `useAuth()`; (4) add the react-oidc-context residency impl + provider branch; (5) test/story mock migration + the fail-closed error surface. Each slice is independently green; SaaS parity is provable after slice 3, residency after slice 4.
