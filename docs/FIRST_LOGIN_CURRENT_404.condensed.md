# First login bounced by `/organization/current` — Condensed design (#881)

**Issue:** [EnterpriseBT/portal-ai#881](https://github.com/EnterpriseBT/portal-ai/issues/881) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** A brand-new user's first sign-in logs them straight back out. Since #873 retired the Auth0 post-login webhook, the user and their personal org are created on the first request that runs `getApplicationMetadata` (the #583 self-heal). `GET /api/organization/current` doesn't run it. It looks the user up directly and answers `404 ORGANIZATION_USER_NOT_FOUND` when it loses the race against the SPA's other first-load requests. The web client treats that code as an auth failure and calls `logout()`. Found by #489's e2e login spec on a fresh database. Package: `apps/api`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Self-heal | `apps/api/src/middleware/metadata.middleware.ts:53-95` | no user row or no membership → `ApplicationService.ensureProvisioned` (advisory-locked, idempotent) |
| `GET /current` | `apps/api/src/routes/organization.router.ts:949` | no `getApplicationMetadata`; `findByAuth0Id` → 404 `ORGANIZATION_USER_NOT_FOUND`, or `ORGANIZATION_NOT_FOUND` with no membership |
| `GET /memberships` | `apps/api/src/routes/organization.router.ts:1041` | same direct lookup → 404 |
| Logout on that code | `apps/web/src/client.ts:56` (`onAuthError`) | `ORGANIZATION_USER_NOT_FOUND` → `handleAuthError()` → `logout()` |
| Tests pinning the 404 | `apps/api/src/__tests__/__integration__/routes/organization.router.integration.test.ts:92,102,300,550` | the first three assert the bug, and case 16 asserts `/current` 404s after an org delete |

## Decision — run the self-heal on the caller's own-org reads

Options:
- **A.** Put `getApplicationMetadata` on `GET /current` and `GET /memberships`, so any first request provisions.
- **B.** Have the web retry `/current` after a 404.
- **C.** Mount `getApplicationMetadata` router-wide.

**Chosen: A.** It's the existing invariant ("an authenticated user always resolves to a membership", #583) applied to the reads the SPA can make on a first load: `/current` and `/memberships` (every page), plus `GET /usage` (Settings and portal pages) and `GET /billing/tiers` (the Billing tab) for a deep-linked first load, found in code review. B papers over a server gap and keeps the logout trap. C would break `/invitations/accept`, which deliberately runs without it (`organization.router.ts:851`).

`POST /switch` and billing's checkout/portal POSTs (`billing.router.ts:33` `resolveCallerOrg`) keep their direct lookups. Switching needs a membership the caller already picked from `/memberships`, and checkout/portal are clicks made after the page has loaded (and provisioned).

Behaviour changes, all consistent with every other self-healing route:
- **Unknown subject:** `/current` and `/memberships` answer 200 with a freshly provisioned personal org.
- **Last org deleted:** `/current` provisions a new personal org (case 16). The web already logs out on delete, and the next login's other requests provisioned one anyway.
- **Un-invited enterprise-federated subject:** now gets `403 SSO_PROVISIONING_NOT_INVITED` from `/current` too, instead of a 404 that logged them out silently.

`getApplicationMetadata`'s catch now passes an `ApiError` through unchanged instead of wrapping it as `500 METADATA_FETCH_FAILED`, so that 403 actually reaches the client. The same goes for 401 `PROFILE_MISSING_TOKEN` and 502 `AUTH_UPSTREAM_ERROR` on every self-healing route. All still fail closed; an unexpected error is still a 500.

Concurrency: `ensureProvisioned` is advisory-locked, so parallel first requests converge on one user and one org.

## Plan — 1 slice

**Files**
- Edit: `apps/api/src/routes/organization.router.ts`. `GET /current` and `GET /memberships` gain `getApplicationMetadata` and read `req.application.metadata.userId`; `GET /usage` gains it too. `/current` keeps the `ORGANIZATION_NOT_FOUND` guard as a defence.
- Edit: `apps/api/src/routes/billing.router.ts`. `GET /tiers` gains `getApplicationMetadata`.
- Edit: `apps/api/src/middleware/metadata.middleware.ts`. The catch passes an `ApiError` through (unit test in `__tests__/middleware/metadata.middleware.test.ts`).
- Edit: `apps/api/src/__tests__/__integration__/routes/organization.router.integration.test.ts`. The tests:
  - an unknown subject's `/current` → 200 + a personal org;
  - a user row with no membership → 200 + a personal org;
  - an unknown subject's `/memberships` → 200, exactly one;
  - concurrent first `/current` + `/memberships` → both 200, and exactly one user row and one membership row;
  - an unknown subject's `/usage` and `/billing/tiers` → 200;
  - case 16 → after delete, `/current` is 200 with a **different** org id.
  `Auth0Service.getAuth0UserProfile` is mocked to return a profile.
- Edit: the `@openapi` blocks for all four routes. A missing user no longer 404s; the 401/403/404/500 the middleware and handler can return are documented.

**Tests:** `cd apps/api && npm run test:integration -- --testPathPattern organization.router.integration`.

## Smoke (manual, against your dev stack)

1. Delete your local user row (or use a never-seen Database-connection user), then sign in at `http://localhost:3000`. The dashboard loads on the **first** attempt with no bounce to `/login`. The API log shows `GET /api/organization/current 200`, with no `ORGANIZATION_USER_NOT_FOUND`.
2. Sign out and back in as an existing user. Same org as before; nothing new provisioned.
3. Re-run #489's `login` spec against a freshly dropped `portal_ai_e2e` database (`e2e-stack.sh up`). It passes on the first run.

## Out of scope

- Confirming the impact on app-dev/prod. That's checked after deploy via #489's `verify-login`, or by a human's first signup.
- The web's logout-on-`ORGANIZATION_USER_NOT_FOUND` policy (`client.ts:56`). It stays correct for a genuinely deleted user.
- `/switch` and billing's checkout/portal lookups, for the reasons above.
