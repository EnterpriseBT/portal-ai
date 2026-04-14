# Dashboard Redesign Audit

## Current State

### Dashboard Layout (`apps/web/src/views/Dashboard.view.tsx`)

The dashboard currently has three distinct areas:

1. **PageHeader** - Contains breadcrumb ("Home"), title ("Dashboard"), health check indicator, and a **"Launch New Portal"** button as the primary action
2. **Recent Portals** section (full-width) - Shows the 5 most recently opened portals as clickable cards (name + relative timestamp). No delete action.
3. **Default Station** card (half-width) - Shows the org's default station with an **"Open Portal"** button that bypasses the dialog and immediately creates a portal on that station

### Portal Launch Entry Points (Currently Scattered)

| Entry Point | Location | Behavior |
|---|---|---|
| "Launch New Portal" button | Dashboard PageHeader | Opens `CreatePortalDialog` with station picker (prefilled with default station) |
| "Open Portal" button | Default Station card on dashboard | Immediately creates portal on the default station (no dialog) |
| "Open Portal" button | Station detail view (`/stations/:id`) | Creates portal on that specific station |

The user has **two different buttons on the same page** that both create portals but with different UX flows -- one opens a dialog with a station picker, the other skips the dialog entirely. This is inconsistent.

### Portal Deletion (Currently Not Available from Dashboard)

Portal deletion exists in two places, neither on the dashboard:

1. **Portal detail view** (`/portals/:id`) - Delete button in the page header secondary actions
2. **Station detail view** (`/stations/:id`) - Delete icon on each PortalCard in the station's portal list

There is **no way to delete a portal** from the Recent Portals list on the dashboard.

### Pinned Results (Not on Dashboard)

A `PinnedResultsListConnected` component already exists (`apps/web/src/components/PinnedResultsList.component.tsx`). It fetches the 5 most recent pinned results via `sdk.portalResults.list({ limit: 5, offset: 0 })` and renders each as a `DetailCard` with:
- Result name, type icon (chart/table/text), relative timestamp
- Unpin action button
- "View All" link at the bottom

This component is **not currently used on the dashboard** -- it's only available through the dedicated Pinned Results page (`/portal-results`).

### Default Station Card (Occupies Significant Space)

The Default Station card currently takes up half the grid on desktop. Its purposes:
- Show which station is the default (name, description, tool packs)
- Provide a quick "Open Portal" shortcut for the default station
- Link to change the default station

Most of this information is low-frequency (users don't change their default station often), yet it occupies prime dashboard real estate.

---

## Problems Identified

1. **Portal launch is split across two places** with inconsistent behavior (dialog vs. immediate). A user who wants to pick a non-default station must use the header button; a user who wants the default station can use either.

2. **No delete from Recent Portals.** Users must navigate into a portal or its station just to delete it, then navigate back to the dashboard.

3. **Default Station card is heavyweight for a dashboard.** It duplicates navigation available from the sidebar (Stations) and its primary action ("Open Portal") is a variant of the header's "Launch New Portal."

4. **Pinned results are buried.** They're only accessible via the sidebar nav to `/portal-results`. There's no at-a-glance view of recent pinned results on the dashboard, even though `PinnedResultsListConnected` already exists and is ready to use.

---

## Proposed Solution

### 1. Unified "Launch Portal" in the Header

Replace the current "Launch New Portal" button with a **split button** or **button with dropdown** in the PageHeader:

- **Primary click**: Opens the `CreatePortalDialog` (same as today -- station picker prefilled with default station)
- **Optional enhancement**: The button label could show the default station name (e.g., "Launch Portal on Research Station") so users know what the quick path will use

This consolidates both entry points into one location. Remove the "Open Portal" button from the Default Station card.

### 2. Add Delete Action to Recent Portals List

Add a delete icon button to each portal row in the Recent Portals list:

- Show a small `IconButton` with a delete icon on the right side of each portal card (on hover for desktop, always visible on mobile)
- Clicking opens the existing `DeletePortalDialog` for confirmation
- On success, invalidate `queryKeys.portals.root` and `queryKeys.portalResults.root` to refresh the list

**Component changes:**
- `RecentPortalsListUI` / `RecentPortalsListConnected`: Add `onDeletePortal(portalId: string, portalName: string)` callback prop
- `Dashboard.view.tsx`: Wire up delete mutation and `DeletePortalDialog` state

### 2b. Show Station Name on Recent Portal Cards

Each portal card should display the station name it belongs to. Currently the `Portal` model only has `stationId` -- there's no station name in the list response.

**Backend: add `include=station` support to `GET /api/portals`**

Follow the existing `include` convention (see `connector-instance.router.ts` for reference):

1. `apps/api/src/routes/portal.router.ts` -- Parse `include` from query string in the list endpoint, pass to repository
2. `apps/api/src/db/repositories/portals.repository.ts` -- Override `findMany` to LEFT JOIN `stations` table when `include` contains `"station"`, appending `stationName` to each result
3. `packages/core/src/contracts/portal.contract.ts` -- Add optional `stationName` to `PortalListResponsePayloadSchema` items (or return as a separate shape with the joined field)

**Frontend:**

4. `apps/web/src/components/RecentPortalsList.component.tsx` -- Pass `include=station` in the list query params, render `stationName` as a secondary line or chip on each card

### 3. Add Recent Pinned Results Section (with Portal Name)

Add `PinnedResultsListConnected` to the dashboard below the Recent Portals section:

- Reuse the existing component -- it already fetches 5 most recent, renders cards with type icons, and has "View All"
- Wire callbacks in `Dashboard.view.tsx`: `onResultClick` navigates to `/portal-results/:id`, `onUnpin` calls `sdk.portalResults.remove()` with cache invalidation, `onViewAll` navigates to `/portal-results`
- Wraps in a `PageSection` with title "Pinned Results" and a push-pin icon

**Show the source portal name on each pinned result card.** Currently `PortalResult` only has `portalId` (nullable) -- no portal name.

**Backend: add `include=portal` support to `GET /api/portal-results`**

1. `apps/api/src/routes/portal-results.router.ts` -- Parse `include` from query string in the list endpoint, pass to repository
2. `apps/api/src/db/repositories/portal-results.repository.ts` -- Override `findMany` to LEFT JOIN `portals` table when `include` contains `"portal"`, appending `portalName` to each result
3. `packages/core/src/contracts/portal.contract.ts` -- Add optional `portalName` to `PortalResultsListPayload` items

**Frontend:**

4. `apps/web/src/components/PinnedResultsList.component.tsx` -- Pass `include=portal` in the list query params, render `portalName` as secondary text on each card (e.g., "from Research Portal")

### 4. Remove Default Station Card from Dashboard

Remove the `DefaultStationCard` section entirely from the dashboard grid. The station picker in the `CreatePortalDialog` already prefills with the default station, so users get the same convenience without a dedicated card.

**Rationale:** The Default Station card's three jobs are all handled elsewhere after this redesign:
- "Open Portal" on default station --> handled by the unified Launch Portal dialog (prefilled)
- View station details --> Stations page via sidebar
- Change default station --> Stations page via sidebar

### 5. Resulting Dashboard Layout

```
+-------------------------------------------------------------------+
| PageHeader                                                         |
|   Home > Dashboard                  [ Launch New Portal ]          |
|   Health Check: OK                                                 |
+-------------------------------------------------------------------+
|                                                                     |
|  Recent Portals                                                     |
|  +---------------------------------------------------------------+ |
|  | Portal Name                                                    | |
|  | Research Station                       2 hours ago        [x]  | |
|  +---------------------------------------------------------------+ |
|  | Another Portal                                                 | |
|  | Sales Station                          yesterday          [x]  | |
|  +---------------------------------------------------------------+ |
|  | Third Portal                                                   | |
|  | Research Station                       3 days ago         [x]  | |
|  +---------------------------------------------------------------+ |
|                                                                     |
|  Pinned Results                                                     |
|  +---------------------------------------------------------------+ |
|  | [chart] Revenue by Region                                      | |
|  |   from Research Portal                 3 hours ago    [unpin] | |
|  +---------------------------------------------------------------+ |
|  | [table] Top Customers Q1                                       | |
|  |   from Sales Portal                    yesterday      [unpin] | |
|  +---------------------------------------------------------------+ |
|  |                                              View All -->     | |
|  +---------------------------------------------------------------+ |
|                                                                     |
+-------------------------------------------------------------------+
```

The dashboard becomes a focused surface: recent portals (viewable, openable, deletable), recent pinned results (viewable, unpinnable), and one clear action to launch a new portal.

---

## Implementation Plan

### Files to Modify

| File | Change |
|---|---|
| File | Change |
|---|---|
| **API (backend)** | |
| `apps/api/src/routes/portal.router.ts` | Parse `include` query param on GET list endpoint, pass to repository |
| `apps/api/src/db/repositories/portals.repository.ts` | Override `findMany` to LEFT JOIN `stations` when `include` contains `"station"` |
| `apps/api/src/routes/portal-results.router.ts` | Parse `include` query param on GET list endpoint, pass to repository |
| `apps/api/src/db/repositories/portal-results.repository.ts` | Override `findMany` to LEFT JOIN `portals` when `include` contains `"portal"` |
| `packages/core/src/contracts/portal.contract.ts` | Add optional `stationName` to portal list items, optional `portalName` to portal-result list items |
| **Frontend** | |
| `apps/web/src/views/Dashboard.view.tsx` | Remove `DefaultStationCardConnected`, add `PinnedResultsListConnected`, add delete/unpin mutations + dialog state, simplify grid to single full-width column |
| `apps/web/src/components/RecentPortalsList.component.tsx` | Add `onDeletePortal` callback, render delete `IconButton`, pass `include=station`, display station name |
| `apps/web/src/components/PinnedResultsList.component.tsx` | Pass `include=portal`, display portal name as secondary text on each card |

### Files Unchanged

| File | Reason |
|---|---|
| `CreatePortalDialog.component.tsx` | Already has station picker with default prefill -- works as-is |
| `DeletePortalDialog.component.tsx` | Already exists and handles confirmation -- reuse as-is |
| `DefaultStationCard.component.tsx` | Keep for potential use elsewhere, just remove from dashboard |
| `Authorized.layout.tsx` | Header/layout unchanged |

### Step-by-Step

**Phase 1: Backend -- add `include` support for joined names**

1. **Add `include=station` to portal list endpoint**
   - `portals.repository.ts`: Override `findMany` to LEFT JOIN `stations` on `stationId` when `include` contains `"station"`, select `stations.name AS stationName`
   - `portal.router.ts`: Parse `include` from query string in GET list handler, pass to `findMany`
   - `portal.contract.ts`: Add optional `stationName: z.string().optional()` to portal list item schema

2. **Add `include=portal` to portal-results list endpoint**
   - `portal-results.repository.ts`: Override `findMany` to LEFT JOIN `portals` on `portalId` when `include` contains `"portal"`, select `portals.name AS portalName`
   - `portal-results.router.ts`: Parse `include` from query string in GET list handler, pass to `findMany`
   - `portal.contract.ts`: Add optional `portalName: z.string().optional()` to portal-result list item schema

**Phase 2: Frontend -- dashboard redesign**

3. **Update `RecentPortalsList.component.tsx`**
   - Add `onDeletePortal: (portalId: string, portalName: string) => void` to both UI and Connected props
   - Add a delete `IconButton` (error color, `aria-label="Delete portal"`) to each portal card row
   - Use `e.stopPropagation()` on the delete button to prevent triggering the card's `onClick`
   - Pass `include: "station"` in the list query params
   - Render station name as secondary text below the portal name

4. **Update `PinnedResultsList.component.tsx`**
   - Pass `include: "portal"` in the list query params
   - Render portal name as secondary text on each card (e.g., "from Research Portal")

5. **Update `Dashboard.view.tsx`**
   - Remove `DefaultStationCardConnected` import and usage
   - Remove `onLaunchPortal`, `onChangeDefault`, `onViewStation` from `DashboardViewUIProps`
   - Add `PinnedResultsListConnected` import and usage in a new `PageSection`
   - Simplify the `PageGrid` to full-width sections: Recent Portals, then Pinned Results
   - Add delete portal state: `deleteTarget: { id: string; name: string } | null`
   - Add delete mutation: `sdk.portals.remove(id)`
   - Wire `DeletePortalDialog` with proper cache invalidation (`portals.root`, `portalResults.root`)
   - Pass `onDeletePortal` callback to `RecentPortalsListConnected`
   - Wire `PinnedResultsListConnected` callbacks: `onResultClick` (navigate), `onUnpin` (remove mutation + invalidate `portalResults.root`), `onViewAll` (navigate to `/portal-results`)

**Phase 3: Verify**

6. **Test**
   - Type-check: `npm run type-check`
   - Lint: `npm run lint`
   - Run existing tests: `npm run test`
   - Manual test in browser: station name on portal cards, portal name on pinned result cards, launch portal flow, delete from recent list, unpin from dashboard, empty states
