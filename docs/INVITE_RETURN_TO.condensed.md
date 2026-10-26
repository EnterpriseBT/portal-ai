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

## Decision — the auth gate owns the return

Options:
- **A.** Keep the root hook, re-run it on auth settle. That still lets the dashboard mount and fire its requests for one commit (the effect-order row), which is the harm.
- **B.** Navigate from `onRedirectCallback` through the router singleton. That's an import cycle (`Auth.provider` → `router` → routes → providers), and the route at `/` still renders while the callback runs.
- **C.** `Authorized`, which every authorized route renders and which already owns the pre-login stash, owns the post-login one too. Once auth has settled (`!isLoading && isAuthenticated`) it **peeks** the post-login key during render. While a target is pending it renders the loading state, not `children`, so the landing route's data never fetches. An effect then takes the key and `navigate`s there (`replace`).

**Chosen: C.** It's the only option where the landing route never mounts. `usePostLoginReturnTo` and its root call are removed; no compat alias.

The pre-login stash gets fixed at its one write point: `stashReturnTo` ignores a `/login` href, so the stash always names the page the user was actually headed to.

## Plan — 1 slice

**Files**
- Edit: `apps/web/src/utils/post-login-return-to.util.ts`. Add `peekReturnTo(key)`. `stashReturnTo` refuses a value whose path is `/login`. Delete `usePostLoginReturnTo`.
- Edit: `apps/web/src/components/Authorized.component.tsx`. Peek on settle; render `AuthorizedUI` loading while a target is pending; an effect takes it, then `navigate({ to, search, replace: true })`, or re-renders if it's the current location.
- Edit: `apps/web/src/routes/__root.tsx`. Drop the hook.
- Edit: the `Auth.provider.tsx` comment that names the hook.

**Tests** (`cd apps/web && npm run test:unit -- --testPathPattern "Authorized|post-login-return-to"`):
- New: `apps/web/src/__tests__/post-login-return-to.util.test.ts`. A `/login…` value isn't stashed, and other paths are; `peekReturnTo` doesn't consume; `takeReturnTo` does.
- New: `apps/web/src/__tests__/Authorized.return-to.test.tsx`, driving the real order: a mocked session that starts loading, then settles authenticated with the post-login key set.
  - The children never render while the target is pending.
  - The router lands on the stashed path + search.
  - The key is consumed.
  - With no key, children render immediately.
  - Unauthenticated at `/invitations/accept?token=t`, then the route changes to `/login`: the stash is still the accept href.

## Smoke (manual, against your dev stack)

1. Sign out. Open an invite link for a user who has no live membership and isn't auto-joined (an unverified email). Sign in. You land on **the accept page**, the invitation is accepted, and the user is in only the invited org: no personal org, and the dashboard never flashes.
2. Sign out, open a deep link (e.g. `/stations`), sign in. You return to `/stations`.
3. Sign in from `/login` directly. You land on the dashboard as before.

## Out of scope

- Residency OIDC login. Its return-to is IdP-hosted and was never covered (`Auth.provider.tsx` comment, #585).
- Changing Auth0's `redirect_uri` (stays the origin).
