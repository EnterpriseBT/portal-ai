# Deleted portal's not-found page renders a chat composer — Condensed design (#971)

**Issue:** [EnterpriseBT/portal-ai#971](https://github.com/EnterpriseBT/portal-ai/issues/971) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Revisiting a deleted portal (or opening one the caller can't read, which answers 404 by the unreadable-equals-absent rule) shows "Portal not found". Below it, the full chat renders with an enabled, auto-focused composer, so a user can type into a portal that doesn't exist. The session mounts no matter what the portal query returns. This is an `apps/web`-only change.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Portal query + states | `apps/web/src/views/Portal.view.tsx:109-186` | `PortalDataItem` → `DataResult` renders header + dialogs only on success; error/loading render a `StatusMessage` |
| Chat session | `apps/web/src/views/Portal.view.tsx:188` | `<PortalSession portalId={portalId} />` is a **sibling** of `PortalDataItem`, outside `DataResult`, so it mounts on loading, error and success alike |
| Error/loading branching | `apps/web/src/components/DataResult.component.tsx:47-80` | error wins over loading; children run only when every result is settled |
| View test | `apps/web/src/__tests__/PortalView.gates.test.tsx` | mocks `sdk.portals.get` and stubs `PortalSession` as `data-testid="portal-session"`, which is the seam for the new assertions |

## Decision — where the session mounts

- **A. Move `PortalSession` inside `DataResult`'s children** (after the dialogs, in the same fragment). The fragment's children already sit directly in the outer flex column, so the layout (`flex: 1; minHeight: 0`) is unchanged.
- **B. Keep it outside and gate it on `sdk.portals.get(portalId).isSuccess`.** This is a second copy of DataResult's state logic, and it can drift from what the header shows.

**Decision: A.** There is one source of truth for "the portal exists and is readable". The session also no longer mounts during the initial load, which is correct: it has nothing to show before the portal resolves. The view-level `canWrite`/touch effect is unaffected, because it already reads `data?.` and is false on error.

## Plan — one slice

**Files**
- Edit: `apps/web/src/views/Portal.view.tsx`. Move `<PortalSession portalId={portalId} />` into the `DataResult` children fragment, and add a one-line `#971` comment on why it lives there.

**Tests** (test first)
- Edit: `apps/web/src/__tests__/PortalView.gates.test.tsx`, or add a sibling `PortalView.states.test.tsx` if that reads cleaner. Three cases:
  - Portal query **errored** (404 `ApiError`): the not-found message renders and `portal-session` is **absent**.
  - Portal query **loading**: `portal-session` is absent.
  - Portal query **succeeded**: `portal-session` is present (a regression guard on the happy path).
- Run `npm run test:unit -- --testPathPattern PortalView` (web), then `npm run type-check` and `npm run lint`.

## Smoke (manual, against your dev stack)

1. Open a portal, send a prompt → the chat and composer work as before, and the header shows Rename/Delete.
2. Delete the portal from **More actions** → you land on the Dashboard.
3. Press **Back** to the portal URL → "Portal not found" shows, with **no** "Ready when you are" empty state, **no** composer, and no Exit/Cancel/Reset/Submit buttons. Focus is not in a textarea (`document.activeElement` is not the "Message" field).
4. Visit `/portals/<random-uuid>` directly → the same not-found state, with no chat.
5. (Optional, as the e2e member) open another user's private portal URL → not-found, with no chat.
6. Hard-reload an existing portal → during the brief load, no composer flashes before the portal resolves; after it resolves the chat appears and the composer auto-focuses as before.

## Out of scope

- The not-found page's `h1` "Portal" and document title "Portal · Portals AI". These are the generic route chrome, and making them read "not found" is a separate copy change that isn't the reported harm.
- Backend changes. The API already 404s a deleted or unreadable portal; the bug is only the client rendering past it.
