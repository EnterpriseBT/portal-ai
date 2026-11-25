# Launch a portal from the header — Condensed design (#1075)

**Issue:** [EnterpriseBT/portal-ai#1075](https://github.com/EnterpriseBT/portal-ai/issues/1075) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc). Epic [#1084](https://github.com/EnterpriseBT/portal-ai/issues/1084), branch `feat/1075-header-portal-launcher` → `epic/launcher`.

**Why.** A portal starts only from the dashboard's "Launch New Portal" or a station page's "Open Portal". This mounts #1122's `NewPortalButtonUI` in the app header through a container, so any authorized page can start one. Web only, plus Help copy in core.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Header | `apps/web/src/layouts/Authorized.layout.tsx:59-62` | Right `ButtonGroup`: `ThemeSwitcher`, `HeaderMenu`; `useLayout()` at :23 gives `isMobile` (`utils/layout.util.ts:34`) |
| Pure UI | `components/NewPortalButton.component.tsx` | From #1122; `station: null` makes the main click choose |
| Create flow | `views/Dashboard.view.tsx:92-113, 175-184` | `sdk.portals.create()` → `mutate({ stationId }, { invalidate: [portals.root], onSuccess: navigate(/portals/:id) })`; dialog's `onClose` resets the mutation |
| Chooser | `components/CreatePortalDialog.component.tsx:90-170` | Presentational: `{open, onClose, onSubmit, isPending, serverError}`, own station picker, `FormAlert` |
| Page station | `routes/stations.$stationId.tsx:5-11` | Only station pages have one; portal sessions use `FullScreenLayout` (no header) |
| Favorites | `sdk.stations.list({ favorite: "true" })` (`core/contracts/favorite.contract.ts:24`) | Readable only (server-filtered); `favoriteKeys` (`utils/favorite-invalidation.util.ts:11`) refreshes every stations list, so a star elsewhere updates the menu |
| Recent portals | `components/RecentPortalsList.component.tsx:100` | `sdk.portals.list({ sortBy: "lastOpened", sortOrder: "desc", include: "station" })` → `stationId`, `stationName` |
| Gate | `utils/use-create-gate.util.ts:13` | `useCreateGate("portal", hint)` |
| No default station | #1114 / #1119 | `organizations.default_station_id` is gone; #1114 named favorites its per-user replacement |

## Decision — which station the main click uses

The ticket's "the org's default station" no longer exists. Chosen with the user: **the page's station, else the station of the caller's last-opened portal, else the first favorite station (by name), else none** (the button reads "New portal" and the main click opens "Choose station…"). The last-used station is read from one `portals.list` row (`limit: 1`, `lastOpened desc`, `include: "station"`) and confirmed with `sdk.stations.get(id)`; a deleted or now-unreadable station (404) falls through to the next source, with no error shown. The issue's criterion "if the default station is deleted or unreadable" becomes "if the last-used station is deleted or unreadable".

## Decision — wiring

- **Container `NewPortalButton`** in the same file as `NewPortalButtonUI` (Component File Policy's container pair). It renders the UI and, for "Choose station…", `CreatePortalDialog` with its own mutation (reset on close, `serverError` from `toServerError`, `FormAlert`), as the dashboard does.
- **`usePortalLauncher()`** (`utils/use-portal-launcher.util.ts`) holds the data and actions:
  - `pageStation`: from `useParams({ strict: false }).stationId` and `sdk.stations.get`, which shares the page's cache;
  - `station`: the fallback order above;
  - `favoriteStations` (`favorite: "true"`, `sortBy: "name"`, `limit: 20`);
  - `gate = useCreateGate("portal", "Ask for access to start portals")`;
  - `launch(stationId)`: `sdk.portals.create().mutate({ stationId }, { invalidate: [queryKeys.portals.root], toast: { error: "Couldn't start the portal." } })`, then navigate to `/portals/{id}` in `onSuccess`;
  - `pending`.
- A failure from the main click or a favorite is a toast through `serverErrorMessage` (the `toast` option), and one from "Choose station…" shows in the dialog's `FormAlert`. `portals.create` gains `onPermissionDenied: { invalidate: () => [queryKeys.portals.root] }`.
- **Layout:** the container goes before `ThemeSwitcher` with `layout={isMobile ? "icon" : "full"}`.
- **Docs:** Getting Started's "Open a portal" step and the FAQ "How do I start asking questions about my data?" say the header's New portal button (in the station you're on, the one you used last, or a favorite) and Choose station…. Favorites' FAQ and glossary entries mention that starring a station adds it to that menu.

## Plan — 1 slice

**Files**
- New: `apps/web/src/utils/use-portal-launcher.util.ts`.
- Edit: `components/NewPortalButton.component.tsx` (the container), `layouts/Authorized.layout.tsx`, `api/portals.api.ts` (`onPermissionDenied`), `utils/getting-started.util.ts`, and in core `packages/core/src/content/faq.util.ts` and `glossary.util.ts`.

**Tests** (`cd apps/web && npm run test:unit -- --testPathPattern <names>`; core: `cd packages/core && npm run test:unit -- --testPathPattern 'faq|glossary|help'`)
- New `__tests__/use-portal-launcher.util.test.tsx`:
  - the station order: page, last-used, a 404'd last-used falling through, favorite, none;
  - `launch` invalidates, toasts on failure and navigates.
- New `__tests__/NewPortalButton.container.test.tsx`:
  - the main click creates in the named station; a favorite creates in its own;
  - "Choose station…" opens the dialog, and a create error shows in its `FormAlert`;
  - a `disable` gate blocks every launch; a refreshed favorites list updates the menu;
  - axe with the menu open.
- Edit `Authorized.layout.test.tsx`, `AuthorizedUI.test.tsx`, `Authorized.return-to.test.tsx`: the sdk mocks gain `stations.list`/`get` and `portals.list`/`create`; the button shows in the header (icon only on mobile).

## Smoke (manual, against your dev stack)

1. As the owner, open the Smoke Sales station's page. The header shows "New portal in Smoke Sales". Click it: a new portal in Smoke Sales opens.
2. Go to /views. The button names the station of the portal you just opened. Click it: a portal there opens.
3. Open the arrow's menu: "Favorite stations" lists your starred stations with stars, then "Choose station…". Star another station on its page and reopen the menu: it's listed, with no reload.
4. Pick a favorite: a portal in that station opens. Choose station… opens the dialog; pick a station and start: it opens.
5. Delete the last-used station (or, as a member, use one shared and then unshared). The button falls back to a favorite or "New portal" with no error.
6. As a member who may not create portals: the main action is focusable, reads "Ask for access to start portals", and does nothing; so do the menu's launches.
7. Narrow the window to phone width: the button is an icon whose tooltip and name read "New portal in …".
8. Stop the API and click the main action: a toast reads "Couldn't start the portal. The server couldn't be reached. …".
9. Help → FAQ "How do I start asking questions about my data?" and Getting Started's portal step mention the header button.

## Out of scope

- The command palette (#1076) and sidebar Favorites (#1077); the dashboard's own launch button (the Dashboard redesign replaces it); the station page's "Open Portal".
- A per-user default-station setting: last-used plus favorites cover it.
