# View Layout — Implementation Plan

**Source:** [VIEW_LAYOUT.audit.md](./VIEW_LAYOUT.audit.md)
**Branch:** `feat/uiux-audit`
**Date:** 2026-03-31

---

## Phasing Strategy

The work is split into 6 phases ordered by dependency and impact. Each phase is independently shippable and must pass verification before moving to the next. Phases 1, 2, and 3 can be combined into a single pass per view. Phase 5 (ActionsMenu) is delivered automatically with Phase 1 (PageHeader).

| Phase | Focus | Depends On | Effort |
|-------|-------|------------|--------|
| 1 | PageHeader adoption (all content views) | — | Low |
| 2 | PageSection adoption (detail + settings views) | — | Low |
| 3 | PageEmptyState adoption (list + detail views) | — | Low |
| 4 | DetailCard + ActionsSuite (card component refactors) | Phases 1–3 | Medium |
| 5 | ActionsMenu (detail page headers) | Phase 1 (delivered with PageHeader) | Free |
| 6 | PageGrid layouts (dashboard + detail pages) | Phases 1–3 | Low–Medium |

---

## Breadcrumb & Icon Convention

Breadcrumbs are **text-only** — no icons in breadcrumb items. Instead, the `PageHeader` `icon` prop renders the current page's icon next to the title. This has already been applied: all `icon: IconName.Home` properties have been removed from breadcrumb items across all 17 views.

| Element | Icon source |
|---------|------------|
| Breadcrumb items | No icons — text labels only |
| PageHeader `icon` | Current page's icon (e.g. Home for Dashboard, Hub for Stations, Link for Connectors) |

---

## Imports Reference

All new widgets are exported from `@portalai/core`:

```tsx
import {
  PageHeader,
  PageSection,
  PageGrid,
  PageGridItem,
  PageEmptyState,
  DetailCard,
  ActionsSuite,
  ActionsMenu,
  Icon,
  IconName,
} from "@portalai/core";
import type { ActionMenuItem, ActionSuiteItem, BreadcrumbItem } from "@portalai/core";
```

---

## Phase 1 — PageHeader (19 views)

Replace manual breadcrumbs + h1 + action button patterns with `<PageHeader>`. For detail pages with 2+ header actions, the secondary actions automatically render via `<ActionsMenu>` (Phase 5).

### Pattern

**Before:**
```tsx
<Box>
  <Breadcrumbs items={[...]} onNavigate={...} />
  <Stack direction="row" justifyContent="space-between" alignItems="center">
    <Typography variant="h1">Title</Typography>
    <Stack direction="row" spacing={1}>
      <Button variant="outlined">Edit</Button>
      <Button variant="contained">Primary</Button>
    </Stack>
  </Stack>
</Box>
```

**After:**
```tsx
<PageHeader
  breadcrumbs={[...]}
  onNavigate={...}
  title="Title"
  icon={<Icon name={IconName.Hub} />}
  primaryAction={<Button variant="contained">Primary</Button>}
  secondaryActions={[{ label: "Edit", onClick: handleEdit }]}
/>
```

### Checklist

#### 1A — List Pages (no secondaryActions)

- [x] **1A.1** `views/Dashboard.view.tsx`
  - title="Dashboard", icon=Home, breadcrumbs=[Home], primaryAction=Launch New Portal button
  - Move HealthCheck component into PageHeader children

- [x] **1A.2** `views/Stations.view.tsx`
  - title="Stations", icon=Hub, breadcrumbs=[Home, Stations], primaryAction=New Station button

- [x] **1A.3** `views/Connector.view.tsx`
  - title="Connectors", icon=Link, breadcrumbs=[Home, Connectors]
  - No actions (tabs handle navigation)

- [x] **1A.4** `views/Entities.view.tsx`
  - title="Entities", icon=DataObject, breadcrumbs=[Home, Entities]

- [x] **1A.5** `views/EntityGroups.view.tsx`
  - title="Entity Groups", icon=DataObject, breadcrumbs=[Home, Entity Groups], primaryAction=Create Group button

- [x] **1A.6** `views/ColumnDefinitionList.view.tsx`
  - title="Column Definitions", icon=ViewColumn, breadcrumbs=[Home, Column Definitions]

- [x] **1A.7** `views/Tags.view.tsx`
  - title="Tags", icon=Label, breadcrumbs=[Home, Tags], primaryAction=Create Tag button

- [x] **1A.8** `views/Jobs.view.tsx`
  - title="Jobs", icon=Work, breadcrumbs=[Home, Jobs]

- [x] **1A.9** `views/PinnedResultsListView.view.tsx`
  - title="Pinned Results", icon=PushPin, breadcrumbs=[Home, Pinned Results]

- [x] **1A.10** `views/Settings.view.tsx`
  - title="Settings", icon=Settings
  - No breadcrumbs, no actions

#### 1B — Detail Pages (with secondaryActions → ActionsMenu)

- [x] **1B.1** `views/StationDetail.view.tsx`
  - title=station.name, icon=Hub, breadcrumbs=[Home, Stations, name]
  - primaryAction=Open Portal button (contained)
  - secondaryActions=[{label:"Edit", onClick:handleEdit}, {label:"Delete", onClick:handleDelete, color:"error"}]
  - children: description Typography + tool pack chips + connector instance chips + created date

- [x] **1B.2** `views/ConnectorInstance.view.tsx`
  - title=instance.name, icon=Link, breadcrumbs=[Home, Connectors, name]
  - primaryAction=Edit button (outlined)
  - secondaryActions=[{label:"Delete", onClick:handleDelete, color:"error"}]
  - children: status chip + definition name + config details + error message + created date

- [x] **1B.3** `views/EntityDetail.view.tsx`
  - title=entity.label, icon=DataObject, breadcrumbs=[Home, Entities, label]
  - primaryAction=Sync button (conditional on access mode)
  - children: key chip + connector name + access mode + record count + last sync date

- [x] **1B.4** `views/EntityGroupDetail.view.tsx`
  - title=group.name, icon=DataObject, breadcrumbs=[Home, Entity Groups, name]
  - primaryAction=Edit button (outlined)
  - secondaryActions=[{label:"Delete", onClick:handleDelete, color:"error"}]
  - children: description text

- [x] **1B.5** `views/EntityRecordDetail.view.tsx`
  - title="Record Details", breadcrumbs=[Home, Entities, entity.label, Record sourceId]
  - No actions

- [x] **1B.6** `views/ColumnDefinitionDetail.view.tsx`
  - title=column.label, icon=ViewColumn, breadcrumbs=[Home, Column Definitions, label]
  - No actions

- [x] **1B.7** `views/PinnedResultDetail.view.tsx`
  - title=result.name, icon=PushPin, breadcrumbs=[Home, Pinned Results, name]
  - primaryAction=Unpin button (contained)
  - secondaryActions=[{label:"Rename", onClick:handleRename}, {label:"Open Source Portal", onClick:handleOpen}, {label:"Delete", onClick:handleDelete, color:"error"}]
  - children: type chip + created date

- [x] **1B.8** `views/Portal.view.tsx`
  - title=portal.name (no breadcrumbs — full-screen context)
  - primaryAction=Rename button (outlined)
  - secondaryActions=[{label:"Delete", onClick:handleDelete, color:"error"}]

- [x] **1B.9** `views/JobDetail.view.tsx`
  - title=job.type, icon=Work, breadcrumbs=[Home, Jobs, type]
  - No actions (cancel is inside JobDetailContent)

### Phase 1 — Verification

```bash
# After each view migration:
npm run type-check
npm run lint
npm run test -- --filter=web
npm run build
```

---

## Phase 2 — PageSection (10 views)

Wrap titled content blocks in `<PageSection>` to replace manual h2 + spacing patterns.

### Pattern

**Before:**
```tsx
<Box>
  <Typography variant="h2" sx={{ mb: 2 }}>Portals</Typography>
  <PaginationToolbar {...toolbarProps} />
  <Box sx={{ mt: 2 }}>
    <Stack spacing={1}>{items.map(...)}</Stack>
  </Box>
</Box>
```

**After:**
```tsx
<PageSection title="Portals" icon={<Icon name={IconName.RocketLaunch} />}>
  <PaginationToolbar {...toolbarProps} />
  <Box sx={{ mt: 2 }}>
    <Stack spacing={1}>{items.map(...)}</Stack>
  </Box>
</PageSection>
```

### Checklist

- [ ] **2.1** `views/Dashboard.view.tsx`
  - Wrap Pinned Results list in PageSection title="Pinned Results", icon=PushPin
  - Wrap Recent Portals list in PageSection title="Recent Portals", icon=RocketLaunch

- [ ] **2.2** `views/StationDetail.view.tsx`
  - Wrap Portals list in PageSection title="Portals", icon=RocketLaunch

- [ ] **2.3** `views/ConnectorInstance.view.tsx`
  - Wrap Entities list in PageSection title="Entities", icon=DataObject

- [ ] **2.4** `views/EntityDetail.view.tsx`
  - Wrap Tags section in PageSection title="Tags", icon=Label
  - Wrap Records table in PageSection title="Records", icon=ViewColumn

- [ ] **2.5** `views/EntityGroupDetail.view.tsx`
  - Wrap Members table in PageSection title="Members", icon=Person, primaryAction=Add Member button

- [ ] **2.6** `views/EntityRecordDetail.view.tsx`
  - Wrap Metadata block in PageSection title="Metadata", variant="outlined"
  - Wrap Fields block in PageSection title="Fields", variant="outlined"
  - Wrap Related Records in PageSection title="Related Records", icon=Link

- [ ] **2.7** `views/ColumnDefinitionDetail.view.tsx`
  - Wrap Details block in PageSection title="Details", variant="outlined"
  - Wrap Field Mappings table in PageSection title="Field Mappings", icon=Link

- [ ] **2.8** `views/PinnedResultDetail.view.tsx`
  - Wrap ContentBlockRenderer in PageSection variant="outlined" (no title)

- [ ] **2.9** `views/Settings.view.tsx`
  - Wrap Profile tab content in PageSection title="Profile", variant="outlined"
  - Wrap Organization tab content in PageSection title="Organization", variant="outlined"

### Phase 2 — Verification

```bash
npm run type-check
npm run lint
npm run test -- --filter=web
npm run build
```

---

## Phase 3 — PageEmptyState (12 views)

Replace ad-hoc empty state Typography and `EmptyResults` components with `<PageEmptyState>`.

### Pattern

**Before:**
```tsx
{total === 0 && (
  <Typography color="text.secondary" textAlign="center" sx={{ py: 4 }}>
    No stations found
  </Typography>
)}
```

**After:**
```tsx
{total === 0 && (
  <PageEmptyState
    icon={<Icon name={IconName.Hub} />}
    title="No stations found"
    description="Create your first station to get started."
    action={<Button variant="contained" onClick={handleCreate}>New Station</Button>}
  />
)}
```

### Checklist

- [ ] **3.1** `views/Stations.view.tsx` — icon=Hub, title="No stations found", action=New Station button

- [ ] **3.2** `views/StationDetail.view.tsx` — icon=RocketLaunch, title="No portals yet"

- [ ] **3.3** `views/Connector.view.tsx` (Connected tab) — icon=Link, title="No connectors found"

- [ ] **3.4** `views/Connector.view.tsx` (Catalog tab) — icon=Link, title="No connector definitions found"

- [ ] **3.5** `views/ConnectorInstance.view.tsx` — icon=DataObject, title="No entities found"

- [ ] **3.6** `views/Entities.view.tsx` — icon=DataObject, title="No entities found"

- [ ] **3.7** `views/EntityGroups.view.tsx` — icon=DataObject, title="No entity groups found", action=Create Group button

- [ ] **3.8** `views/ColumnDefinitionList.view.tsx` — icon=ViewColumn, title="No column definitions found"

- [ ] **3.9** `views/ColumnDefinitionDetail.view.tsx` — icon=Link, title="No field mappings found"

- [ ] **3.10** `views/Tags.view.tsx` — icon=Label, title="No tags found", action=Create Tag button

- [ ] **3.11** `views/Jobs.view.tsx` — icon=Work, title="No jobs found"

- [ ] **3.12** `views/PinnedResultsListView.view.tsx` — icon=PushPin, title="No pinned results"

- [ ] **3.13** `views/Dashboard.view.tsx` — DefaultStationCardUI empty state → icon=Hub, title="No default station", action=Go to Stations button

### Phase 3 — Verification

```bash
npm run type-check
npm run lint
npm run test -- --filter=web
npm run build
```

---

## Phase 4 — DetailCard + ActionsSuite (8 card components)

Refactor presentational card components to use `<DetailCard>` with `actions` prop (renders `<ActionsSuite>` internally). Group work by card component since each affects multiple views.

### Migration Pattern

**Before (typical card):**
```tsx
<Card variant="outlined">
  <CardActionArea onClick={onClick}>
    <CardContent>
      <Stack direction="row" justifyContent="space-between">
        <Typography variant="subtitle1">{name}</Typography>
        <IconButton onClick={onDelete}><DeleteIcon /></IconButton>
      </Stack>
      <Typography variant="body2">{description}</Typography>
    </CardContent>
  </CardActionArea>
</Card>
```

**After:**
```tsx
<DetailCard
  title={name}
  icon={<Icon name={IconName.Hub} />}
  onClick={onClick}
  actions={[
    { label: "Delete", onClick: onDelete, color: "error" },
  ]}
>
  <Typography variant="body2">{description}</Typography>
</DetailCard>
```

### Checklist

#### 4.1 — TagCardUI

- [ ] **4.1.1** Refactor `components/TagCard.component.tsx`
  - title=tag.name, icon=color dot Box, actions=[Edit, Delete (color:error)]
  - Remove manual IconButton layout
- [ ] **4.1.2** Update `__tests__/TagCard.test.tsx` — query buttons by role+name instead of icon
- [ ] **4.1.3** Update `stories/TagCard.stories.tsx`
- [ ] **4.1.4** Verify `views/Tags.view.tsx` passes correct props

#### 4.2 — PortalCardUI

- [ ] **4.2.1** Refactor `components/PortalCard.component.tsx`
  - title=name, children=relative created date, actions=[Delete (color:error)], onClick
  - Remove manual CardActionArea + IconButton layout
- [ ] **4.2.2** Update `__tests__/PortalCard.test.tsx`
- [ ] **4.2.3** Update `stories/PortalCard.stories.tsx`
- [ ] **4.2.4** Verify `views/StationDetail.view.tsx` passes correct props

#### 4.3 — Entity cards (inline in Entities.view)

- [ ] **4.3.1** Extract inline Card JSX from `views/Entities.view.tsx` into a `DetailCard`
  - title=entity.label, children=connector name + key chip + tag chips, onClick=navigate
  - Remove inline Card/CardActionArea/CardContent
- [ ] **4.3.2** Update any related tests

#### 4.4 — EntityGroup cards (inline in EntityGroups.view)

- [ ] **4.4.1** Replace inline Card JSX in `views/EntityGroups.view.tsx` with `DetailCard`
  - title=group.name, children=description + member count + created date, onClick=navigate
- [ ] **4.4.2** Update any related tests

#### 4.5 — ConnectorInstanceCardUI

- [ ] **4.5.1** Refactor `components/ConnectorInstance.component.tsx`
  - title=name, icon=avatar, children=status chip + definition name + sync date + error message, actions=[Delete (color:error)], onClick
  - Remove manual Avatar + CardActionArea + IconButton layout
- [ ] **4.5.2** Update `__tests__/ConnectorInstance.test.tsx`
- [ ] **4.5.3** Update `stories/ConnectorInstance.stories.tsx`
- [ ] **4.5.4** Verify `views/Connector.view.tsx` passes correct props

#### 4.6 — ConnectorDefinitionCardUI

- [ ] **4.6.1** Refactor `components/ConnectorDefinition.component.tsx`
  - title=displayName, icon=avatar, children=category + auth type + version + capability chips, actions=[Connect (variant:contained)]
  - Remove manual Avatar + Button layout
- [ ] **4.6.2** Update `__tests__/ConnectorDefinition.test.tsx`
- [ ] **4.6.3** Update `stories/ConnectorDefinition.stories.tsx`
- [ ] **4.6.4** Verify `views/Connector.view.tsx` passes correct props

#### 4.7 — ColumnDefinitionCardUI

- [ ] **4.7.1** Refactor column definition card in `views/ColumnDefinitionList.view.tsx`
  - title=label, children=key (monospace) + type chip + required chip, onClick=navigate
- [ ] **4.7.2** Update any related tests

#### 4.8 — PinnedResultCardUI

- [ ] **4.8.1** Refactor `components/PinnedResultCard.component.tsx` (or inline in PinnedResultsList)
  - title=result.name, children=type chip + relative date, actions=[Unpin], onClick=navigate
- [ ] **4.8.2** Update related tests
- [ ] **4.8.3** Verify `views/PinnedResultsListView.view.tsx` passes correct props

### Phase 4 — Verification

```bash
# After each card component migration:
npm run type-check
npm run lint
npm run test -- --filter=web
npm run test -- --filter=core   # ensure core DetailCard/ActionsSuite tests still pass
npm run build
```

---

## Phase 5 — ActionsMenu (delivered with Phase 1)

No separate work required. When Phase 1 adopts `<PageHeader>` with `secondaryActions` prop, the `<ActionsMenu>` renders automatically. This phase is a verification checkpoint.

### Verification Checklist

- [ ] **5.1** `views/StationDetail.view.tsx` — Edit and Delete appear in overflow menu; Open Portal is primary button
- [ ] **5.2** `views/ConnectorInstance.view.tsx` — Delete appears in overflow menu; Edit is primary button
- [ ] **5.3** `views/EntityGroupDetail.view.tsx` — Delete appears in overflow menu; Edit is primary button
- [ ] **5.4** `views/PinnedResultDetail.view.tsx` — Rename, Open Source Portal, Delete appear in overflow menu; Unpin is primary button
- [ ] **5.5** `views/Portal.view.tsx` — Delete appears in overflow menu; Rename is primary button

### Phase 5 — Verification

```bash
# Manual: open each detail page, click the ⋮ menu, confirm items appear and fire correctly
npm run type-check
npm run lint
npm run test -- --filter=web
npm run build
```

---

## Phase 6 — PageGrid (5 views)

Introduce responsive grid layouts where views currently use single-column stacks.

### Checklist

- [ ] **6.1** `views/Dashboard.view.tsx`
  - PageGrid columns={xs:1, md:2}
  - PageGridItem: Default Station card (1 col)
  - PageGridItem: Pinned Results section (1 col)
  - PageGridItem span={xs:1, md:2}: Recent Portals section (full width)

- [ ] **6.2** `views/EntityRecordDetail.view.tsx`
  - PageGrid columns={xs:1, md:2}
  - PageGridItem: Metadata section
  - PageGridItem: Entity Groups metadata
  - PageGridItem span={xs:1, md:2}: Fields section (full width)
  - PageGridItem span={xs:1, md:2}: Related Records section (full width)

- [ ] **6.3** `views/ColumnDefinitionDetail.view.tsx`
  - PageGrid columns={xs:1, lg:2}
  - PageGridItem: Details section (outlined)
  - PageGridItem: Field Mappings section
  - Assess whether content width is sufficient at lg breakpoint; fall back to single column if not

- [ ] **6.4** `views/Settings.view.tsx`
  - PageGrid columns={xs:1, md:2}
  - PageGridItem: Profile section (outlined)
  - PageGridItem: Organization section (outlined)
  - Only applies if tabs are removed in favor of side-by-side; otherwise skip

- [ ] **6.5** `views/ConnectorInstance.view.tsx`
  - Assess whether metadata and entities section benefit from side-by-side layout
  - If metadata is short enough: PageGrid columns={xs:1, lg:2}, metadata + entities side by side
  - If not: skip — single column is fine

### Phase 6 — Verification

```bash
npm run type-check
npm run lint
npm run test -- --filter=web
npm run build
```

---

## Full Verification (Post All Phases)

Run the complete suite from the monorepo root after all phases are complete:

```bash
npm run type-check          # TypeScript across all packages
npm run lint                # ESLint across monorepo
npm run test                # Jest tests across monorepo (web, api, core)
npm run build               # Production build all packages
```

### Manual Smoke Tests

- [ ] Open each list page → confirm PageHeader renders breadcrumbs, title, icon, and primary action correctly
- [ ] Open each detail page → click ⋮ overflow menu → confirm secondary actions appear and fire
- [ ] Resize browser from mobile → desktop → confirm responsive stacking on PageHeader, PageSection, DetailCard, and PageGrid
- [ ] Navigate to an empty list → confirm PageEmptyState renders icon, title, description, and action button
- [ ] Click a DetailCard → confirm navigation fires; click an action button on a clickable card → confirm only the action fires (not the card click)
- [ ] Verify no console warnings about nested `<button>` elements or hydration mismatches
- [ ] Run Lighthouse accessibility audit on at least 3 views → confirm no new a11y violations
