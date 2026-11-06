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

- **A. Move `PortalSession` inside `DataResult`'s children.** This was tried first and reverted after code review. `DataResult` checks `isError` before anything else, and React Query v5 sets `isError` on a failed **refetch** even while the cached data is still there. A transient refetch error (a 429 or 5xx after a focus refetch or the touch's invalidation) would then unmount a live chat, along with its stream and draft. It also turned the view's and the session's two parallel `GET /api/portals/:id` requests into a sequential pair.
- **B. Keep the session outside `DataResult` and gate it on the view's query.** This is the chosen option.

**Decision: B.** `showSession = data !== undefined && !(error is a 404 ApiError)`:
- No data means no chat. That covers loading, and a deleted or unreadable portal's first-load 404.
- A 404 on a later refetch means the portal is gone, so the chat unmounts. `usePortalStream` closes its EventSource when it unmounts.
- Any other refetch error keeps the cached portal and the live chat.

The view's queries also use the session's own params (`{ include: "pinnedResults" }`), so the view and the session share one cache entry and one request. A cold load then makes one request, not two in sequence.

## Plan — one slice

**Files**
- Edit: `apps/web/src/views/Portal.view.tsx`:
  - add `PORTAL_QUERY_PARAMS`;
  - compute `portalGone` / `showSession` from the view's query;
  - render `{showSession && <PortalSession …/>}` outside `DataResult`.

**Tests** (test first)
- Edit: `apps/web/src/__tests__/PortalView.gates.test.tsx`. Five cases:
  - a 404 `ApiError` on first load shows no session;
  - while loading, no session;
  - once loaded, the session shows;
  - a refetch that fails with a 429 while data is cached keeps the session;
  - a refetch that fails with a 404 while data is cached removes it.
- Run `npm run test:unit -- --testPathPattern PortalView` (web), then `type-check` and `lint`.

## Smoke (manual, against your dev stack)

1. Open a portal, send a prompt → the chat and composer work as before, and the header shows Rename/Delete.
2. Delete the portal from **More actions** → you land on the Dashboard.
3. Press **Back** to the portal URL → "Portal not found" shows, with **no** "Ready when you are" empty state, **no** composer, and no Exit/Cancel/Reset/Submit buttons. Focus is not in a textarea (`document.activeElement` is not the "Message" field).
4. Visit `/portals/<random-uuid>` directly → the same not-found state, with no chat.
5. (Optional, as the e2e member) open another user's private portal URL → not-found, with no chat.
6. Hard-reload an existing portal → during the brief load, no composer flashes before the portal resolves; after it resolves the chat appears and the composer auto-focuses as before. In devtools' Network tab, the load makes **one** `GET /api/portals/<id>?include=pinnedResults`, not two.
7. With a portal open, delete it from a second tab, then refocus the first tab → the refetch 404s, and the not-found state replaces the page with no chat left behind.

## Out of scope

- The not-found page's `h1` "Portal" and document title "Portal · Portals AI". These are the generic route chrome, and making them read "not found" is a separate copy change that isn't the reported harm.
- Backend changes. The API already 404s a deleted or unreadable portal; the bug is only the client rendering past it.
