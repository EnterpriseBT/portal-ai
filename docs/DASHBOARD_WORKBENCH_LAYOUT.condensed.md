# Dashboard workbench layout — Condensed design (#1078)

**Issue:** [EnterpriseBT/portal-ai#1078](https://github.com/EnterpriseBT/portal-ai/issues/1078) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc). Child of the Dashboard redesign epic (#1085); branch `feat/1078-dashboard-workbench-layout` → `epic/dashboard-redesign`.

**Why.** #1123 built the workbench and every section as pure UI, mounted nowhere. This ticket puts the live dashboard on that layout. It wires the two parts that need no new data (the header and Recent portals) and keeps the launch button and Pinned Results until #1079 and #1081 replace them, so each later child adds one section without reshaping the page. Web, plus one small core addition (a row action on `LinkList`). No API or contract change.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Dashboard | `views/Dashboard.view.tsx:35` (`DashboardViewUI`), `:84` (`DashboardView`) | `PageHeader` (Open Portal, `HealthCheck showLabel`) + Recent Portals and Pinned Results `PageSection`s; the container owns the create, delete-portal and unpin flows |
| Recent Portals today | `components/RecentPortalsList.component.tsx:100` | `sdk.portals.list({ limit: 5, sortBy: "lastOpened", sortOrder: "desc", include: "station" })`; a card per portal with a Delete gated on `capabilities.delete` (`:56`). Used only by the dashboard |
| Workbench | `components/DashboardWorkbench.component.tsx` (#1123) | `headerAction`, `headerContent` and optional section slots; an omitted slot isn't rendered |
| Recent portals UI | `components/DashboardRecentPortals.component.tsx` (#1123) | At most 5 one-line rows through core `LinkList`; no row actions yet |
| Delete elsewhere | `views/Portal.view.tsx:189`, `views/StationDetail.view.tsx:441` | Delete also lives on the portal and station pages |
| Tests | `__tests__/DashboardView.test.tsx`, `RecentPortalsList.test.tsx`, `DashboardRecentPortals.test.tsx` | The view test asserts the sections, the Open Portal button and no default-station section |

## Decision — keep Delete on each Recent portals row

The acceptance says no regression to the delete-portal flow, and the compact rows dropped Delete. Options: drop it from the dashboard (it stays on the portal and station pages), or give the one-line rows a trailing action. **Chosen: a row action.** Core `LinkList` items take an optional `action` node, rendered as the row's secondary action beside (not inside) its link. `DashboardRecentPortalsUI` takes `onDeletePortal` and each portal's `deleteGate`, and renders a `GatedIconButton` named "Delete {name}" (row actions name their row, CLAUDE.md #794). The gate comes from `decideActionGate({ allowed: portal.capabilities.delete })`, as today, so a caller who can't delete sees no button.

## Decision — Pinned Results stays below the workbench until #1081

The workbench's `pins` slot is titled "Favorite pins" with a see-all to the pins list, which would mislabel today's every-pin list. Options: put it in that slot anyway, add a temporary slot to the workbench, or render it after the workbench. **Chosen: after the workbench**, as its own "Pinned Results" section in `DashboardViewUI`, unchanged (unpin included). #1081 deletes it when the favorite pin tiles take the `pins` slot. Likewise the Open Portal button goes in `headerAction` until #1079's start box takes the `start` slot.

The "see all with the Favorites filter on" deliverable has no section to apply to yet: favorite stations and pins are #1080 and #1081, and the workbench already links each section's see-all when its slot is filled.

## Plan — 1 slice

**Files:**
- `packages/core/src/ui/LinkList.tsx`: an optional `action` per item, via `ListItem`'s `secondaryAction`.
- `components/DashboardRecentPortals.component.tsx`: rows carry Delete through `onDeletePortal` and a per-portal `deleteGate`. Add its container `DashboardRecentPortals` (the same query as today, through `DataResult`, mapping `capabilities.delete` to the gate).
- `views/Dashboard.view.tsx`: `DashboardViewUI` renders `DashboardWorkbenchUI` (Open Portal → `headerAction`, `HealthCheck showLabel` → `headerContent`, `DashboardRecentPortals` → `recent`), then the Pinned Results section. The container's flows are unchanged.
- Remove `components/RecentPortalsList.component.tsx` and its test, replaced and otherwise unused.
- Stories: a Recent portals story with Delete, and one with it hidden.

**Tests:**
- `packages/core/src/__tests__/ui/LinkList.test.tsx`: a row action sits beside the link, not inside it, with axe.
- `apps/web/src/__tests__/DashboardRecentPortals.test.tsx`: Delete names its row, calls `onDeletePortal(id, name)`, and is absent when hidden; axe.
- `apps/web/src/__tests__/DashboardView.test.tsx`: one `h1`; Recent portals (h2) inside the workbench; Pinned Results after it; Open Portal and the health check in the header.

Run: `npm run test:unit -- --testPathPattern '(LinkList|DashboardRecentPortals|DashboardView)'` in core and web, then `npm run lint`, `npm run type-check` and `npm run build`.

## Smoke (manual, against your dev stack)

1. Open `/` at :3000. There is one "Dashboard" heading with the API health check under it, and Open Portal at the top right. Open Portal opens its dialog, and creating a portal lands in it.
2. Recent portals shows at most 5 one-line rows, newest first, each with its station and time, and no "see all". A row opens its portal.
3. Delete on a row opens "Delete Portal", and confirming removes it from the list. As a member who can't delete someone else's portal, that row has no Delete.
4. Pinned Results sits below Recent portals, and unpinning a result removes it.
5. At phone width the page stacks with no sideways scroll. In Brand Dark everything reads. Tab reaches every link and button, with the focus ring.
6. With no portals yet, Recent portals shows its teaching empty state.

## Out of scope

- The start box (#1079), favorite stations (#1080), favorite pin tiles and removing Pinned Results (#1081), Browse by tag (#1082) and Needs attention (#1083).
- A portals list page or a "see all" for Recent portals (decided against on 2026-11-19).
