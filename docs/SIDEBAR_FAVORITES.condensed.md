# Sidebar Favorites — Condensed design (#1077)

**Issue:** [EnterpriseBT/portal-ai#1077](https://github.com/EnterpriseBT/portal-ai/issues/1077) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc). Child of the launcher epic (#1084); branch `feat/1077-sidebar-favorites` off `epic/launcher`.

**Why.** Favorites (#1072) only surface in list filters and, since #1076, the command palette. A Favorites group in the sidebar keeps them one click away on every page. This mounts #1122's `SidebarFavoritesUI` through a container. Web only (plus the UI component's own story and test); no API or contract change.

## Current shape

| Piece | Location | Note |
|---|---|---|
| `SidebarFavoritesUI` | `apps/web/src/components/SidebarFavorites.component.tsx` | #1122's pure UI: disclosure, `limit` (8) then "Show all (n)" in place, icons only when the sidebar is collapsed, empty hint. Mounted nowhere. |
| `SidebarNavItemUI` | `apps/web/src/components/SidebarNavItem.component.tsx` | The favorites nav item #1122 extended: disclosure (`open`/`onToggle` → `aria-expanded`, `Collapse`), `nested` entries, `iconColor="favorite"`, truncated names, `onClick`. `SidebarFavoritesUI` renders through it. Nothing new is built: no fork, no second item. |
| Sidebar | `apps/web/src/components/SidebarNav.component.tsx` (`SidebarNav`, `SidebarNavUI`) | Main items scroll in one `overflowY: auto` box; footer holds Settings/Help/Logout. `handleClick` closes the mobile drawer on navigation. |
| Favorite lists | `favorite=true` on the station, pin, curated view and connector instance list routes (`packages/core/src/contracts/favorite.contract.ts`) | Readable rows only, so lost access and deleted objects drop out server-side. `limit` clamps at 100 (`pagination.contract.ts`). |
| Freshness | `favoriteKeys` (`apps/web/src/utils/favorite-invalidation.util.ts`) | A star or unstar invalidates its type's `…, "list"` prefix, so the four `favorite=true` queries refetch with no extra wiring. |
| Item shape | `toLauncherItem`, `LAUNCHER_TYPE_ICON` (`apps/web/src/utils/launcher-items.util.ts`) | Already maps a result to its route and icon. |
| Persisted UI state | `useStorage` (`apps/web/src/utils/storage.util.ts`), used by `Layout.provider.tsx` for the sidebar | Constant key, read once, which is enough here. |

## Decision — data source

- **A. Search's favorites mode** (`GET /api/search`, one request). It caps at 10 per type, so "Show all (n)" would undercount. It's also outside `favoriteKeys`, so a star elsewhere wouldn't refresh it without new invalidation plumbing.
- **B. The four `favorite=true` lists** (four requests, `limit: 100`). They're covered by `favoriteKeys` today, and the station list shares its cache entry with the launcher's favorite stations when the params match.

**Chosen: B.** "Updates without a reload" falls out of existing invalidation. Four small reads are fine for the sidebar, which is mounted once per shell.

## Decision — order and count

Merged across types and sorted by **name** (case-insensitive, `localeCompare`; ties by type, then id). Time-favorited order would need a new `sortBy` on four contracts, which isn't a condensed change. "Show all (n)" counts what the group can expand to (at most 100 per type), so it never promises rows it won't show.

## Decision — states

- **Collapsed sidebar:** the UI's existing behaviour, the first 8 as icons named by their tooltips and nothing when empty.
- **Group open/closed:** remembered in localStorage under `portalai-sidebar-favorites-open`, default open.
- **Loading:** the group renders closed-safe with no items until the four lists answer.
- **Failure:** a failed list contributes nothing. The rest still show, and nothing toasts, because the sidebar isn't an action surface.
- **Mobile:** picking a favorite closes the drawer like any sidebar link, through a new `onNavigate` prop on the UI. That's a change to #1122's component and its story, per the PRD.

## Plan — 2 slices

1. **UI prop + container.**
   - **Files:**
     - `SidebarFavorites.component.tsx`: `onNavigate?` on the UI, passed to each link and to Show all's sibling links; the container `SidebarFavorites` with the four queries, merge/sort, `useStorage`, and the active href from `useRouterState`.
     - `SidebarNav.component.tsx`: mount it below the main items, with `collapsed` and `onNavigate={handleClick}`.
     - The `SidebarFavorites` story takes `onNavigate`.
   - **Tests:** `src/__tests__/SidebarFavorites.test.tsx` (UI: `onNavigate` fires on a link click). New `src/__tests__/SidebarFavorites.container.test.tsx`:
     - merges four types sorted by name;
     - a star (invalidating `favoriteKeys`) updates the list;
     - a failed type still shows the others;
     - open state persists across remounts;
     - `aria-current` on the active favorite;
     - axe.

     Also `Authorized.layout.test.tsx`/`SidebarNav` (the group mounts under the main nav). Run with `npm run test:unit -- --testPathPattern 'SidebarFavorites|SidebarNav|Authorized.layout'`.
2. **Docs.**
   - Help: the Favorite glossary entry and the favorites FAQ mention the sidebar group (`packages/core/src/content/glossary.util.ts`, `faq.util.ts`).
   - The ACR: check rows 2.4.3 and 4.1.2 for the new disclosure.
   - Tests: `glossary.util.test.ts`, `faq.util.test.ts`, help findability.

## Smoke (manual, against your dev stack)

1. As the e2e owner with no favorites: the sidebar shows **Favorites** with "Star a station, pinned result, view or connector to keep it here."
2. Star a station, a pinned result, a view and a connector from their pages. Each appears in the group at once (no reload), sorted by name, with its type icon.
3. Star 9+ items: 8 show, then "Show all (n)". Activating it lists all in place, and "Show fewer" collapses back. The main nav and footer stay reachable (the sidebar scrolls as one region).
4. Open a favorite: it navigates, and its row carries `aria-current="page"`. Unstar it on that page: it leaves the group at once.
5. Collapse the group, reload: it stays collapsed. Expand, reload: it stays expanded.
6. Collapse the sidebar to icons: up to 8 favorites show as icons with their names as tooltips. With no favorites, nothing shows.
7. At phone width, open the drawer and pick a favorite: it navigates and the drawer closes.
8. As the member, favorite an object shared with you. Unshare it as the owner, then refocus the member's window: it disappears. Reshare it: it returns.
9. Delete a favorited object: it never appears in the group.
10. Keyboard and screen reader: Tab reaches the Favorites disclosure, which is announced as a collapsible button with its expanded state. Enter toggles it. — manual (screen reader)

## Out of scope

- Reordering favorites by drag, and time-favorited order (needs a list-contract change).
- Tag groups in the sidebar.
- Pins/views/connectors in the launcher's favorite stations menu (stations only, #1075).
