# Pinned Portal Results Feature

## Overview

Display the 5 most recent pinned portal results on the Dashboard above the "Recent Portals" section, and add a dedicated list/detail page for managing all pinned results.

## Existing Infrastructure

| Layer | Asset | Status |
|-------|-------|--------|
| Model | `PortalResult` (core) — `name`, `type`, `content`, `portalId`, `stationId` | Exists |
| Table | `portal_results` (api) | Exists |
| Repository | `PortalResultsRepository` — `findMany`, `findByStation`, CRUD | Exists |
| API | `GET /api/portal-results`, `PATCH /:id`, `DELETE /:id` | Exists |
| SDK | `sdk.portalResults.list()`, `.rename(id)`, `.remove(id)` | Exists |

No new backend work is required. This is a frontend-only feature.

---

## Deliverables

### 1. Dashboard — Pinned Results Section

**Location**: Between `DefaultStationCard` and `RecentPortalsList` in `Dashboard.view.tsx`

#### Components

- [x] **`PinnedResultCard.component.tsx`** — Single card for a pinned result
  - Shows: `name`, result `type` icon (text vs vega-lite), relative `created` timestamp
  - Click navigates to pinned result detail page (`/portal-results/$portalResultId`)
  - Inline unpin (delete) button with confirmation

- [x] **`PinnedResultsList.component.tsx`** — List of up to 5 pinned result cards
  - Three-layer pattern: `PinnedResultsListUI` (pure) → `PinnedResultsData` (fetcher) → `PinnedResultsListConnected` (wired)
  - Calls `sdk.portalResults.list({ limit: 5, sortOrder: "desc" })`
  - Empty state: placeholder encouraging user to pin results from a portal session
  - "View All" link navigates to `/portal-results`

- [ ] **Wire into `Dashboard.view.tsx`**
  - Add `PinnedResultsListConnected` between `DefaultStationCardConnected` and `RecentPortalsListConnected`
  - Add `onViewAllPinnedResults` and `onPinnedResultClick` callbacks
  - Invalidate `queryKeys.portalResults.root` after unpin mutation

#### Tests

- [x] **`PinnedResultCard.component.test.tsx`** — Unit tests for card component
  - Renders name, type icon, and relative timestamp
  - Calls `onPinnedResultClick` on card click
  - Calls unpin handler on unpin button click
  - Shows confirmation before unpin

- [x] **`PinnedResultsList.component.test.tsx`** — Unit tests for list component
  - Renders up to 5 pinned result cards
  - Renders empty-state placeholder when no results
  - "View All" link renders and navigates to `/portal-results`

- [ ] **`Dashboard.view.test.tsx`** — Integration test additions
  - Pinned results section renders between default station and recent portals

---

### 2. Pinned Results List Page (`/portal-results`)

**Pattern**: Follow `Stations.view.tsx` / `Jobs.view.tsx` list page pattern

#### Routes

- [ ] **`routes/_authorized/portal-results.tsx`** — Layout route wrapper
- [ ] **`routes/_authorized/portal-results.index.tsx`** — List page route

#### Components

- [ ] **`PinnedResultsListView.view.tsx`** — Full list page
  - Breadcrumbs: Dashboard > Pinned Results
  - `PaginationToolbar` with sort (by `created`), search by name
  - Paginated list of `PinnedResultCard` items
  - Each card supports: click to detail, inline rename, inline unpin/delete
  - Empty state when no results exist

#### Tests

- [ ] **`PinnedResultsListView.view.test.tsx`** — Unit tests for list page
  - Renders breadcrumbs (Dashboard > Pinned Results)
  - Renders pagination toolbar with sort and search
  - Renders paginated pinned result cards
  - Inline rename triggers mutation and refreshes list
  - Inline delete shows confirmation and triggers soft-delete mutation
  - Renders empty state when no results exist

---

### 3. Pinned Result Detail Page (`/portal-results/$portalResultId`)

#### Routes

- [ ] **`routes/_authorized/portal-results.$portalResultId.tsx`** — Detail page route

#### Components

- [ ] **`PinnedResultDetail.view.tsx`** — Detail page
  - Breadcrumbs: Dashboard > Pinned Results > {name}
  - Header: result name (editable inline or via edit button), type chip, created date
  - Content display:
    - `type: "text"` — render text content
    - `type: "vega-lite"` — render Vega-Lite chart from spec
  - Actions toolbar: Rename, Delete (with confirmation), "Open Source Portal" link (if `portalId` exists)

#### Tests

- [ ] **`PinnedResultDetail.view.test.tsx`** — Unit tests for detail page
  - Renders breadcrumbs (Dashboard > Pinned Results > {name})
  - Renders result name, type chip, and created date
  - Renders text content for `type: "text"` results
  - Renders vega-lite chart for `type: "vega-lite"` results
  - Rename action updates name and invalidates queries
  - Delete action shows confirmation, soft-deletes, and navigates back to list
  - "Open Source Portal" link renders when `portalId` is present and hidden when null

#### API Addition

- [ ] **`sdk.portalResults.get(id)`** — Add single-result fetch to SDK (`GET /api/portal-results/:id`)
- [ ] **`GET /api/portal-results/:id`** — Add detail endpoint to API router (if not already present)
- [ ] **Query key**: Add `queryKeys.portalResults.get(id)` entry

#### API Tests

- [ ] **`portal-results.router.test.ts`** — Integration test for `GET /api/portal-results/:id`
  - Returns portal result by ID with correct shape
  - Returns 404 for non-existent ID
  - Returns 404 for soft-deleted result

---

## Implementation Order

### Phase 1 — API & SDK groundwork
1. [ ] Add `GET /api/portal-results/:id` endpoint to `portal-results.router.ts`
2. [ ] Add `sdk.portalResults.get(id)` method to `portal-results.api.ts`
3. [ ] Add `queryKeys.portalResults.get(id)` to `keys.ts`
4. [ ] Write integration tests for `GET /api/portal-results/:id` endpoint

### Phase 2 — Dashboard pinned results section
5. [x] Create `PinnedResultCard.component.tsx`
6. [x] Create `PinnedResultsList.component.tsx` (UI + Data + Connected)
7. [ ] Wire `PinnedResultsListConnected` into `Dashboard.view.tsx`
8. [x] Write unit tests for `PinnedResultCard` and `PinnedResultsList`
9. [ ] Add dashboard integration test coverage for pinned results section

### Phase 3 — List page
10. [ ] Create route files: `portal-results.tsx`, `portal-results.index.tsx`
11. [ ] Create `PinnedResultsListView.view.tsx` with pagination, search, sort
12. [ ] Add "View All" link from dashboard section to list page
13. [ ] Write unit tests for `PinnedResultsListView`

### Phase 4 — Detail page
14. [ ] Create route file: `portal-results.$portalResultId.tsx`
15. [ ] Create `PinnedResultDetail.view.tsx` with content rendering
16. [ ] Wire rename and delete mutations with query invalidation
17. [ ] Add "Open Source Portal" navigation (when `portalId` is present)
18. [ ] Write unit tests for `PinnedResultDetail`

---

## Component Hierarchy

```
Dashboard.view.tsx
├── DefaultStationCardConnected
├── PinnedResultsListConnected        ← NEW
│   └── PinnedResultCard (×5 max)
│       ├── name + type icon + timestamp
│       └── unpin button
│   └── "View All" link → /portal-results
└── RecentPortalsListConnected

/portal-results (list page)
└── PinnedResultsListView.view.tsx
    ├── Breadcrumbs
    ├── PaginationToolbar
    └── PinnedResultCard (paginated)
        ├── click → /portal-results/:id
        ├── rename (inline)
        └── delete (confirm)

/portal-results/:id (detail page)
└── PinnedResultDetail.view.tsx
    ├── Breadcrumbs
    ├── Header (name, type chip, date)
    ├── Content (text or vega-lite render)
    └── Actions (rename, delete, open portal)
```

## Notes

- All mutations invalidate `queryKeys.portalResults.root` to keep dashboard and list page in sync
- Soft-delete is used for unpin/delete (consistent with existing repository pattern)
- Follow three-layer component pattern: UI → Data → Connected
- Follow file naming conventions: `*.component.tsx`, `*.view.tsx`
