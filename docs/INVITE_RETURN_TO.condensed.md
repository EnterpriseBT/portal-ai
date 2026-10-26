# Invite link lost on sign-in — Condensed design (#884)

**Issue:** [EnterpriseBT/portal-ai#884](https://github.com/EnterpriseBT/portal-ai/issues/884) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** A logged-out invitee who opens `/invitations/accept?token=…` and signs in lands on the dashboard instead of the accept page (#585's return-to). The dashboard's requests then self-provision a personal org, and the invitation stays pending. Found in #881's smoke walk. Package: `apps/web`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Pre-login stash | `components/Authorized.component.tsx:53-57` | an effect on `[isLoading, isAuthenticated, href]` stashes `href`, and re-runs during `<Navigate to="/login">` with the **login** href, so the stash ends up `/login?token=…` |
| Login → Auth0 | `providers/Auth.provider.tsx:34-37` (`auth0ReturnToAppState`) | takes the pre-login stash into `appState.returnTo` |
| Callback | `providers/Auth.provider.tsx:29-33` (`auth0OnRedirectCallback`) | re-stashes it under the post-login key; auth0-react calls it **before** `INITIALISED` (`isLoading` false) |
| Post-login consume | `utils/post-login-return-to.util.ts:47-67`, `routes/__root.tsx:26` | reads the key **once on mount** (`[]` deps), and the router mounts with the provider, so it reads before the callback stashed anything |
| Effect order | React | a child's effects run before its parent's, so even a working root hook lets the route at `/` (the dashboard) mount and fire its self-provisioning requests first |

## Decision — the callback returns, and auth holds until it lands

Options:
- **A.** Keep the root hook, re-run it on auth settle. That still lets the dashboard mount and fire its requests for one commit (the effect-order row), which is the harm.
- **B.** Navigate from `onRedirectCallback`. auth0-react calls it before it settles, so no route has rendered signed-in content yet. But routes are code-split: the navigation is **async**, Auth0 settles right after the callback returns, and the old `/` route renders the dashboard in the gap. That was measured in the smoke walk: the dashboard's requests ran before the accept.
- **C.** `Authorized` peeks a post-login key on settle and holds every route instance back until the router is idle on the target. This was the first implementation. Code review found it fragile:
  - a normalized pathname spins forever;
  - `?code=&state=` stays in the URL when the target is the landing path;
  - search values come back as strings and the hash is dropped;
  - a stale key can hijack a later login.

**Chosen: B, plus holding auth until the navigation lands.** `AuthProvider` takes an `onLoginReturn(href)` and calls it from the redirect callback with `appState.returnTo` (or `/`; never a `//host`). `Application.tsx` wires it to `router.navigate({ href, replace: true })`, and the Auth0 bridge reports `isLoading` until that promise settles. No route renders signed-in content during the return. The router parses the full href, so search types and the hash survive and the callback params go. The post-login key, its store and `usePostLoginReturnTo` are removed.

The pre-login stash is fixed at its source: `Authorized` doesn't stash while it is on `/login`. `stashReturnTo` also refuses a protocol-relative `//host`.

## Plan — 1 slice (+ the review rework)

**Files**
- Edit: `apps/web/src/providers/Auth.provider.tsx`. `onLoginReturn` prop (`LoginReturn`), a `returning` state while it's in flight, and `isLoading: isLoading || returning`.
- Edit: `apps/web/src/providers/Application.provider.tsx` (forwards `onLoginReturn`) and `apps/web/src/Application.tsx` (passes `router.navigate`).
- Edit: `apps/web/src/components/Authorized.component.tsx`. No pre-login stash on `/login`.
- Edit: `apps/web/src/utils/post-login-return-to.util.ts`. Only the pre-login key remains; refuse `//host`.
- Edit: `apps/web/src/routes/__root.tsx`. Drop the hook.

**Tests** (`cd apps/web && npm run test:unit -- --testPathPattern "Authorized|Auth.provider|post-login-return-to"`):
- `Auth.provider.test.tsx`:
  - the callback hands `returnTo` to `onLoginReturn`;
  - no or unsafe `returnTo` → `/`;
  - the session stays loading until the returned promise resolves.
- `Authorized.return-to.test.tsx`. The accept link survives the redirect to `/login` as the pre-login target.
- `post-login-return-to.util.test.ts`. Single-use; `https://` and `//host` refused.

## Smoke (manual, against your dev stack)

1. Sign out. Open an invite link for a user who has no live membership and isn't auto-joined (an unverified email). Sign in. You land on **the accept page**, the invitation is accepted, and the user is in only the invited org: no personal org, and the dashboard never flashes.
2. Sign out, open a deep link (e.g. `/stations`), sign in. You return to `/stations`.
3. Sign in from `/login` directly. You land on the dashboard as before.

## Out of scope

- Residency OIDC login. Its return-to is IdP-hosted and was never covered (`Auth.provider.tsx` comment, #585).
- Changing Auth0's `redirect_uri` (stays the origin).
