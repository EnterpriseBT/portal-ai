# OIDC profile issuer — Condensed design (#950)

**Issue:** [EnterpriseBT/portal-ai#950](https://github.com/EnterpriseBT/portal-ai/issues/950) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** On an OIDC install (any issuer but Auth0) the Profile tab answers `500 PROFILE_FETCH_FAILED`, and a brand-new invitee's first invite acceptance would fail the same way. Both callers fetch the userinfo profile without the token's issuer, so `getAuth0UserProfile` treats them as Auth0 and fetches `https://${AUTH0_DOMAIN}/userinfo`. With no `AUTH0_DOMAIN` set, that URL is `https://undefined/userinfo`, and the fetch fails. Sign-in works because the metadata middleware passes the issuer. Found on #946's local Helm install (Keycloak). `apps/api` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Profile fetch | `apps/api/src/services/auth0.service.ts:89` | `issuer?` optional; omitted or the Auth0 issuer → `https://${AUTH0_DOMAIN}/userinfo`, otherwise OIDC discovery (#577) |
| Metadata middleware | `apps/api/src/middleware/metadata.middleware.ts:73,116` | passes `req.auth?.payload.iss` (inline `typeof … === "string"`, twice) |
| Profile route | `apps/api/src/routes/profile.router.ts:84` | **omits the issuer** |
| Invite accept | `apps/api/src/routes/organization.router.ts:983` → `SeatService.acceptByToken` (`services/seat.service.ts:359`) → `resolveCaller` (`:781`, fetch at `:787`) | threads only the authorization header; **omits the issuer** |
| Tests | `__tests__/__integration__/routes/profile.router.integration.test.ts`, `__tests__/__integration__/services/seat.service.integration.test.ts` | Auth0Service mocked; `jwtCheck` mocked to `next()`, so no `req.auth` |

## Decision — the issuer is a required argument

Three options:
- **(a) Pass it at the two call sites.** This fixes today's bug, but the next caller can forget it the same way.
- **(b) Default to Auth0 only when `AUTH_PROVIDER` is `auth0`.** This hides the omission rather than fixing it, and still loses a non-Auth0 issuer in SaaS once #577 federation lands.
- **(c) Make `issuer` required (`issuer: string | undefined`)**, with one helper that reads it from the request.

Chosen: **(c)**. The helper is `tokenIssuer(req)` in its own module, `utils/token-issuer.util.ts`, not a static on `Auth0Service`, so tests that mock that service wholesale still read a real claim. The metadata middleware's two inline reads share it. tsc then fails any caller that doesn't pass an issuer. `undefined` still means "the default Auth0 issuer", the behavior unchanged for SaaS.

`acceptByToken` gains an `issuer` parameter, which the route passes from `tokenIssuer(req)` and `resolveCaller` forwards. No response or contract changes.

## Plan — 1 slice

**Files:**
- `services/auth0.service.ts`: the required `issuer` parameter.
- `utils/token-issuer.util.ts` (new): `tokenIssuer`.
- `routes/profile.router.ts`
- `middleware/metadata.middleware.ts`
- `services/seat.service.ts`
- `routes/organization.router.ts`

**Tests (first, red on today's tree):**
- `profile.router.integration.test.ts`: the mocked `jwtCheck` sets `req.auth.payload.iss`, and the test asserts that `getAuth0UserProfile` is called with that issuer.
- `seat.service.integration.test.ts`: `acceptByToken` for a brand-new invitee forwards its issuer to `getAuth0UserProfile`.
- `organization.router.invitations.integration.test.ts`: `POST /api/organization/invitations/accept` for a new invitee passes the token's issuer through (added in code review).
- Run with `npm run test:integration -- --testPathPattern 'profile.router|seat.service'`, then `npm run test:unit -- --testPathPattern 'auth0|metadata'`, `npm run type-check` and `npm run lint` in `apps/api`.

## Smoke (manual, against your dev stack)

1. **Auth0, no regression.** With `npm run dev`, sign in at http://localhost:3000 and open the Profile tab. It loads your name and email, and `GET /api/profile` answers 200.
2. **OIDC, the fix.** Rebuild the API image from this branch: `docker build -f apps/api/Dockerfile --build-arg BUILD_VERSION=950 -t portalai-api:950 .`. Then run `helm upgrade portalai deploy/helm/portalai -n portalai -f <your install's values file> --set image.api.tag=950`.
   - Sign in at http://portalai.localhost as `walk946` and open the Profile tab.
   - It loads, `GET /api/profile` answers 200, and `kubectl logs -n portalai deploy/portalai-api` shows no `PROFILE_FETCH_FAILED`.

Invite acceptance's new-invitee path isn't smoked: signing in runs the metadata middleware, which creates the user before an accept, so a manual walk never reaches it. The service and route integration tests cover it.

## Out of scope

- The Swagger UI's authorize URL (`config/swagger.config.ts:744`), the API's only other `AUTH0_DOMAIN` use. It's a developer surface, not a user path, and it reads Auth0 even on an OIDC install.
- Rebuilding the local Helm install's web image. Nothing here touches `apps/web`.
