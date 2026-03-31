# View Layout Audit & Migration Plan

This document inventories every `*.view.tsx` in `apps/web/src/views/` and proposes a migration plan to adopt the new `@portalai/core` layout widgets:

- **PageHeader** — breadcrumbs, title + icon, primary action, secondary actions menu, children
- **PageSection** — titled content block with divider/outlined variants, icon, actions menu
- **PageGrid / PageGridItem** — responsive CSS Grid layout
- **PageEmptyState** — consistent empty/no-results placeholder
- **DetailCard** — responsive card with title, icon, content, ActionsSuite
- **ActionsSuite** — horizontal button group for inline card actions
- **ActionsMenu** — overflow menu for secondary actions

---

## View Inventory

### Error / Utility Pages (no migration needed)

These views are minimal wrappers and don't use page layout patterns.

| View | Path | Type |
|------|------|------|
| BadRequest | `views/BadRequest.view.tsx` | Error (400) |
| Forbidden | `views/Forbidden.view.tsx` | Error (403) |
| NotFound | `views/NotFound.view.tsx` | Error (404) |
| ServerError | `views/ServerError.view.tsx` | Error (500) |
| Unauthorized | `views/Unauthorized.view.tsx` | Error (401) |
| Loading | `views/Loading.view.tsx` | Loading spinner |
| Login | `views/Login.view.tsx` | Auth form |

---

### Dashboard

**File:** `views/Dashboard.view.tsx`
**Type:** Home page

| Element | Current | Migration |
|---------|---------|-----------|
| Header | Manual breadcrumbs + h1 + Button in Stack | **PageHeader** — title="Dashboard", icon=Home, breadcrumbs=[Home], primaryAction=Launch New Portal button |
| Default Station | DefaultStationCardUI (custom) | **DetailCard** — title=station name, icon=Hub, children=description+chips, actions=[Open Portal], onClick=viewStation. Empty state → **PageEmptyState** |
| Pinned Results | h2 + PinnedResultsListConnected | **PageSection** title="Pinned Results", icon=PushPin |
| Recent Portals | h2 + RecentPortalsListConnected | **PageSection** title="Recent Portals", icon=RocketLaunch |
| Layout | Single column Stack | **PageGrid** columns={xs:1, md:2} for default station + pinned results side by side, recent portals full width below |

---

### Stations

**File:** `views/Stations.view.tsx`
**Type:** List page

| Element | Current | Migration |
|---------|---------|-----------|
| Header | Manual breadcrumbs + h1 + "New Station" Button | **PageHeader** — title="Stations", icon=Hub, breadcrumbs=[Home, Stations], primaryAction=New Station button |
| Station list | StationListConnected | Refactor station cards → **DetailCard** with title=name, icon=Hub, children=description+chips, actions=[Open Portal, Delete], onClick=navigate |
| Empty state | Handled by connected component | **PageEmptyState** icon=Hub, title="No stations found", action=New Station button |
| Pagination | PaginationToolbar | Keep as-is inside **PageSection** |

---

### StationDetail

**File:** `views/StationDetail.view.tsx`
**Type:** Detail page

| Element | Current | Migration |
|---------|---------|-----------|
| Header | Manual breadcrumbs + h1 + 3 Buttons (Edit, Delete, Open Portal) | **PageHeader** — title=station.name, icon=Hub, breadcrumbs=[Home, Stations, name], primaryAction=Open Portal button, secondaryActions=[Edit, Delete (color:error)] via **ActionsMenu** |
| Metadata | Description + chip groups in manual Stack | **PageHeader** children — description Typography + chip rows for tool packs and connector instances |
| Portals section | h2 "Portals" + PaginationToolbar + PortalCardUI stack | **PageSection** title="Portals", icon=RocketLaunch. Refactor PortalCardUI → **DetailCard** with title=name, children=created date, actions=[Delete], onClick=navigate |
| Empty state | "No portals yet" Typography | **PageEmptyState** icon=RocketLaunch, title="No portals yet" |

---

### Connector (Tabbed)

**File:** `views/Connector.view.tsx`
**Type:** Tabbed list page

| Element | Current | Migration |
|---------|---------|-----------|
| Header | Manual breadcrumbs + h1 | **PageHeader** — title="Connectors", icon=Link, breadcrumbs=[Home, Connectors] |
| Connected tab | PaginationToolbar + ConnectorInstanceCardUI stack | Keep tab structure. Refactor ConnectorInstanceCardUI → **DetailCard** with title=name, icon=avatar, children=status chip + definition name + sync date, actions=[Delete], onClick=navigate |
| Catalog tab | PaginationToolbar + ConnectorDefinitionCardUI stack | Refactor ConnectorDefinitionCardUI → **DetailCard** with title=displayName, icon=avatar, children=category+capabilities chips, actions=[Connect (variant:contained)] |
| Empty state | EmptyResults component | **PageEmptyState** icon=Link, title="No connectors found" |

---

### ConnectorInstance

**File:** `views/ConnectorInstance.view.tsx`
**Type:** Detail page

| Element | Current | Migration |
|---------|---------|-----------|
| Header | Manual breadcrumbs + h1 + Edit/Delete buttons | **PageHeader** — title=instance.name, icon=Link, breadcrumbs=[Home, Connectors, name], primaryAction=Edit button, secondaryActions=[Delete (color:error)] via **ActionsMenu** |
| Metadata | Status chip + definition name + config + dates | **PageHeader** children — status chip, definition name, config details, created date |
| Entities section | h2 "Entities" + PaginationToolbar + ConnectorEntityCardUI stack | **PageSection** title="Entities", icon=DataObject |
| Empty state | "No entities found" Typography | **PageEmptyState** icon=DataObject, title="No entities found" |

---

### Entities

**File:** `views/Entities.view.tsx`
**Type:** List page

| Element | Current | Migration |
|---------|---------|-----------|
| Header | Manual breadcrumbs + h1 | **PageHeader** — title="Entities", icon=DataObject, breadcrumbs=[Home, Entities] |
| Entity list | Stack of manual Card > CardActionArea > CardContent | Refactor → **DetailCard** with title=entity.label, children=connector name + key chip + tag chips, onClick=navigate |
| Empty state | "No entities found" Typography | **PageEmptyState** icon=DataObject, title="No entities found" |

---

### EntityDetail

**File:** `views/EntityDetail.view.tsx`
**Type:** Detail page

| Element | Current | Migration |
|---------|---------|-----------|
| Header | Manual breadcrumbs + h1 + Sync button | **PageHeader** — title=entity.label, icon=DataObject, breadcrumbs=[Home, Entities, label], primaryAction=Sync button (conditional) |
| Metadata | Key chip + connector name + access mode + record count + last sync | **PageHeader** children — metadata chips and typography |
| Tags section | Tag chips + AsyncSearchableSelect | **PageSection** title="Tags", icon=Label |
| Data table section | PaginationToolbar + EntityRecordDataTable | **PageSection** title="Records", icon=ViewColumn |
| Empty state | Handled by DataTable | Keep as-is (DataTable internal) |

---

### EntityGroups

**File:** `views/EntityGroups.view.tsx`
**Type:** List page

| Element | Current | Migration |
|---------|---------|-----------|
| Header | Manual breadcrumbs + h1 + "Create Group" button | **PageHeader** — title="Entity Groups", icon=DataObject, breadcrumbs=[Home, Entity Groups], primaryAction=Create Group button |
| Group list | Stack of Card > CardActionArea > CardContent | Refactor → **DetailCard** with title=group.name, children=description + member count + created date, onClick=navigate |
| Empty state | "No entity groups found" Typography | **PageEmptyState** icon=DataObject, title="No entity groups found" |

---

### EntityGroupDetail

**File:** `views/EntityGroupDetail.view.tsx`
**Type:** Detail page

| Element | Current | Migration |
|---------|---------|-----------|
| Header | Manual breadcrumbs + h1 + Edit/Delete buttons | **PageHeader** — title=group.name, icon=DataObject, breadcrumbs=[Home, Entity Groups, name], primaryAction=Edit button, secondaryActions=[Delete (color:error)] via **ActionsMenu** |
| Metadata | Description + member count | **PageHeader** children — description text |
| Members section | h2 "Members" + DataTable + Add Member button | **PageSection** title="Members", icon=Person, primaryAction=Add Member button |
| Empty state | DataTable emptyMessage | Keep as-is (DataTable internal) |

---

### EntityRecordDetail

**File:** `views/EntityRecordDetail.view.tsx`
**Type:** Detail page (record viewer)

| Element | Current | Migration |
|---------|---------|-----------|
| Header | Manual breadcrumbs + h1 | **PageHeader** — title="Record Details", breadcrumbs=[Home, Entities, entity.label, Record sourceId] |
| Metadata section | Manual Stack of key-value pairs | **PageSection** title="Metadata", variant="outlined" |
| Fields section | Manual Stack of field labels + values | **PageSection** title="Fields", variant="outlined" |
| Related Records | Accordion per entity group | **PageSection** title="Related Records", icon=Link. Keep accordion content as-is |
| Empty state | "No matching records" in accordion | Keep as-is |

---

### ColumnDefinitionList

**File:** `views/ColumnDefinitionList.view.tsx`
**Type:** List page

| Element | Current | Migration |
|---------|---------|-----------|
| Header | Manual breadcrumbs + h1 | **PageHeader** — title="Column Definitions", icon=ViewColumn, breadcrumbs=[Home, Column Definitions] |
| Definition list | Stack of ColumnDefinitionCardUI | Refactor → **DetailCard** with title=label, children=key (monospace) + type chip + required chip, onClick=navigate |
| Empty state | "No column definitions found" Typography | **PageEmptyState** icon=ViewColumn, title="No column definitions found" |

---

### ColumnDefinitionDetail

**File:** `views/ColumnDefinitionDetail.view.tsx`
**Type:** Detail page

| Element | Current | Migration |
|---------|---------|-----------|
| Header | Manual breadcrumbs + h1 | **PageHeader** — title=column.label, icon=ViewColumn, breadcrumbs=[Home, Column Definitions, label] |
| Metadata | Key + type chip + description + format + defaults + enums | **PageSection** title="Details", variant="outlined". Metadata as children |
| Field Mappings section | h2 + PaginationToolbar + Table | **PageSection** title="Field Mappings", icon=Link |
| Empty state | "No field mappings reference this column definition" | **PageEmptyState** icon=Link, title="No field mappings found" |

---

### Tags

**File:** `views/Tags.view.tsx`
**Type:** List page

| Element | Current | Migration |
|---------|---------|-----------|
| Header | Manual breadcrumbs + h1 + "Create Tag" button | **PageHeader** — title="Tags", icon=Label, breadcrumbs=[Home, Tags], primaryAction=Create Tag button |
| Tag list | Stack of TagCardUI | Refactor TagCardUI → **DetailCard** with title=tag.name, icon=color dot, actions=[Edit, Delete (color:error)] via **ActionsSuite** |
| Empty state | "No tags found" Typography | **PageEmptyState** icon=Label, title="No tags found" |

---

### Jobs

**File:** `views/Jobs.view.tsx`
**Type:** List page

| Element | Current | Migration |
|---------|---------|-----------|
| Header | Manual breadcrumbs + h1 | **PageHeader** — title="Jobs", icon=Work, breadcrumbs=[Home, Jobs] |
| Job list | Stack of JobCard (streaming component) | Keep JobCard as-is (streaming behavior is specialized). Wrap in **PageSection** if adding a section header later |
| Empty state | EmptyResults component | **PageEmptyState** icon=Work, title="No jobs found" |

---

### JobDetail

**File:** `views/JobDetail.view.tsx`
**Type:** Detail page (streaming)

| Element | Current | Migration |
|---------|---------|-----------|
| Header | Manual breadcrumbs only | **PageHeader** — title=job.type, icon=Work, breadcrumbs=[Home, Jobs, type] |
| Content | JobDataStream + JobDetailContent | Keep as-is (streaming component). No section/card migration needed |

---

### PinnedResultsListView

**File:** `views/PinnedResultsListView.view.tsx`
**Type:** List page

| Element | Current | Migration |
|---------|---------|-----------|
| Header | Manual breadcrumbs + h1 | **PageHeader** — title="Pinned Results", icon=PushPin, breadcrumbs=[Home, Pinned Results] |
| Result list | Stack of PinnedResultCardUI | Refactor → **DetailCard** with title=result.name, children=type chip + created date, actions=[Unpin], onClick=navigate |
| Empty state | EmptyResults component | **PageEmptyState** icon=PushPin, title="No pinned results" |

---

### PinnedResultDetail

**File:** `views/PinnedResultDetail.view.tsx`
**Type:** Detail page

| Element | Current | Migration |
|---------|---------|-----------|
| Header | Manual breadcrumbs + h1 + 4 buttons | **PageHeader** — title=result.name, icon=PushPin, breadcrumbs=[Home, Pinned Results, name], primaryAction=Unpin button, secondaryActions=[Rename, Open Source Portal, Delete (color:error)] via **ActionsMenu** |
| Metadata | Type chip + created date | **PageHeader** children — type chip, relative date |
| Content | ContentBlockRenderer | **PageSection** variant="outlined" (no title, just the content block) |

---

### Portal

**File:** `views/Portal.view.tsx`
**Type:** Full-screen portal viewer

| Element | Current | Migration |
|---------|---------|-----------|
| Header | Custom header bar (h6 + buttons) | **PageHeader** — title=portal.name, primaryAction=Rename button, secondaryActions=[Delete (color:error)] via **ActionsMenu**. No breadcrumbs (full-screen context) |
| Content | PortalSession (full screen) | Keep as-is. No section/card migration needed |

---

### Settings

**File:** `views/Settings.view.tsx`
**Type:** Settings page (tabbed)

| Element | Current | Migration |
|---------|---------|-----------|
| Header | h1 "Settings" only | **PageHeader** — title="Settings", icon=Settings |
| Profile tab | Card > CardContent with Avatar + info | **PageSection** title="Profile", variant="outlined". Keep card content as children |
| Organization tab | Card > CardContent with Avatar + info | **PageSection** title="Organization", variant="outlined". Keep card content as children |

---

## Migration Phases

### Phase 1: PageHeader (all views)

**Scope:** Replace manual breadcrumbs + h1 + action button patterns with `<PageHeader>`.

**Views (18):**
1. Dashboard
2. Stations
3. StationDetail
4. Connector
5. ConnectorInstance
6. Entities
7. EntityDetail
8. EntityGroups
9. EntityGroupDetail
10. EntityRecordDetail
11. ColumnDefinitionList
12. ColumnDefinitionDetail
13. Tags
14. Jobs
15. JobDetail
16. PinnedResultsListView
17. PinnedResultDetail
18. Portal
19. Settings

**Effort:** Low — direct prop mapping from existing elements. No logic changes.

### Phase 2: PageSection (detail pages)

**Scope:** Wrap titled content blocks in `<PageSection>` to replace manual h2 + divider patterns.

**Views (10):**
1. Dashboard — Pinned Results, Recent Portals sections
2. StationDetail — Portals section
3. ConnectorInstance — Entities section
4. EntityDetail — Tags, Records sections
5. EntityGroupDetail — Members section
6. EntityRecordDetail — Metadata, Fields, Related Records sections
7. ColumnDefinitionDetail — Details, Field Mappings sections
8. PinnedResultDetail — Content section
9. Settings — Profile, Organization tabs

**Effort:** Low — wrap existing content blocks, add title/icon props.

### Phase 3: PageEmptyState (list + detail pages)

**Scope:** Replace ad-hoc empty state Typography and `EmptyResults` component with `<PageEmptyState>`.

**Views (12):**
1. Stations
2. StationDetail (portals list)
3. Connector (both tabs)
4. ConnectorInstance (entities list)
5. Entities
6. EntityGroups
7. ColumnDefinitionList
8. ColumnDefinitionDetail (field mappings)
9. Tags
10. Jobs
11. PinnedResultsListView
12. Dashboard (default station)

**Effort:** Low — replace Typography/EmptyResults with PageEmptyState, add icon + title + optional action.

### Phase 4: DetailCard + ActionsSuite (list pages)

**Scope:** Refactor individual card components to use `<DetailCard>` with `<ActionsSuite>` for consistent card rendering.

**Card components to refactor:**
1. `TagCardUI` → DetailCard with title=name, icon=color dot, actions=[Edit, Delete]
2. `PortalCardUI` → DetailCard with title=name, children=created date, actions=[Delete], onClick
3. Entity cards (inline in Entities.view) → DetailCard with title=label, children=connector+chips, onClick
4. EntityGroup cards (inline in EntityGroups.view) → DetailCard with title=name, children=description+count, onClick
5. `ConnectorInstanceCardUI` → DetailCard with title=name, icon=avatar, children=status+definition+sync date, actions=[Delete], onClick
6. `ConnectorDefinitionCardUI` → DetailCard with title=displayName, icon=avatar, children=category+capability chips, actions=[Connect]
7. `ColumnDefinitionCardUI` → DetailCard with title=label, children=key+type chip, onClick
8. `PinnedResultCardUI` → DetailCard with title=name, children=type chip+date, actions=[Unpin], onClick

**Effort:** Medium — requires updating card component props and internal structure. ActionsSuite replaces ad-hoc icon buttons. Test updates needed.

### Phase 5: ActionsMenu (detail page headers)

**Scope:** Already integrated into PageHeader via `secondaryActions` prop. This phase ensures all multi-action detail pages use the menu pattern.

**Views with 2+ header actions:**
1. StationDetail — Edit, Delete → ActionsMenu; Open Portal → primaryAction
2. ConnectorInstance — Delete → ActionsMenu; Edit → primaryAction
3. EntityGroupDetail — Delete → ActionsMenu; Edit → primaryAction
4. PinnedResultDetail — Rename, Open Source Portal, Delete → ActionsMenu; Unpin → primaryAction
5. Portal — Delete → ActionsMenu; Rename → primaryAction

**Effort:** Low — already handled by PageHeader's secondaryActions prop.

### Phase 6: PageGrid (dashboard + detail pages)

**Scope:** Introduce responsive grid layouts where views currently use single-column stacks but could benefit from multi-column arrangements.

**Candidates:**
1. Dashboard — default station + pinned results side by side (md: 2 cols)
2. EntityRecordDetail — metadata + fields side by side (md: 2 cols)
3. ColumnDefinitionDetail — details + field mappings side by side (lg: 2 cols)
4. Settings — could use grid for profile/org sections (md: 2 cols)
5. ConnectorInstance — metadata + entities (potential, assess during implementation)

**Effort:** Low-Medium — layout restructuring only, no logic changes.

---

## Recommended Execution Order

```
Phase 1 (PageHeader)        ← highest impact, lowest risk, do first
  ↓
Phase 3 (PageEmptyState)    ← simple replacements, can parallel with Phase 2
  ↓
Phase 2 (PageSection)       ← wraps existing content, low risk
  ↓
Phase 5 (ActionsMenu)       ← comes free with PageHeader adoption
  ↓
Phase 4 (DetailCard)        ← most work, refactors card components
  ↓
Phase 6 (PageGrid)          ← layout enhancement, do last
```

Phases 1–3 can be done view-by-view in a single pass. Phase 4 requires card component refactors that affect multiple views per card, so group by card component.
