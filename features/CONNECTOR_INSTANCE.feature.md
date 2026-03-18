# Feature: ConnectorInstance List (Connected Tab)

## Context

The ConnectorView has two tabs: "Connected" (tab 0) and "Catalog" (tab 1). Tab 1 already displays a paginated list of ConnectorDefinitions. Tab 0 is a placeholder. This feature fills tab 0 with a paginated, filterable, sortable list of ConnectorInstance cards that show metadata + the associated ConnectorDefinition icon, and navigate to a detail page on click.

## Requirements

- Paginated list of ConnectorInstanceCards showing important metadata and the icon of the associated ConnectorDefinition
- Clicking a card navigates to `/connectors/:id` (ConnectorInstanceView)

## Design Decision: ConnectorDefinition Icon Resolution

The ConnectorInstance list API returns `connectorDefinitionId` but not icon/display info. **Approach: bulk-fetch all definitions once, build a `Map<id, ConnectorDefinition>` lookup.** The catalog is small (tens of items), already fetched on the Catalog tab, and requires no API changes. Can retrofit an API join later if needed.

---

## Implementation Steps

### 1. SDK Layer

- [ ] **Create** `apps/web/src/api/connector-instances.api.ts`
  - [ ] Mirror `connector-definitions.api.ts` pattern
  - [ ] Export `connectorInstances` object with `list(params?, options?)` and `get(id, options?)`
  - [ ] Use `useAuthQuery`, `buildUrl`, `queryKeys`
- [ ] **Modify** `apps/web/src/api/keys.ts`
  - [ ] Add `connectorInstances` key namespace (`root`, `list`, `get`)
- [ ] **Modify** `apps/web/src/api/sdk.ts`
  - [ ] Import and register `connectorInstances`

### 2. ConnectorInstance Component

- [ ] **Create** `apps/web/src/components/ConnectorInstance.component.tsx`
  - [ ] Mirror `ConnectorDefinition.component.tsx` structure
- [ ] **`ConnectorInstanceDataList`** — render-prop wrapper calling `sdk.connectorInstances.list(query)`
  - [ ] Props: `query: ConnectorInstanceListRequestQuery`, `children: (data) => ReactNode`
  - [ ] Calls SDK and passes result to children
- [ ] **`ConnectorInstanceCardUI`** — pure UI card
  - [ ] Props: `connectorInstance: ConnectorInstanceApi`, `connectorDefinition?: ConnectorDefinition`, `onClick?`
  - [ ] Avatar with `connectorDefinition?.iconUrl`, fallback to first letter of name
  - [ ] Name + status Chip (color-coded: active=success, error=error, pending=warning, inactive=default)
  - [ ] Definition display name + lastSyncAt (formatted as relative time or "Never synced")
  - [ ] Conditional error message when status=error and lastErrorMessage exists
  - [ ] Entire card clickable (`onClick`, `cursor: pointer`)

### 3. Routing

- [ ] **Modify** `apps/web/src/utils/routes.util.ts`
  - [ ] Add `ConnectorInstance = "/connectors/$connectorInstanceId"` to enum
- [ ] **Modify** `apps/web/src/routes/connectors.tsx`
  - [ ] Convert to layout route rendering `<Outlet />` (mirror `jobs.tsx` pattern)
- [ ] **Create** `apps/web/src/routes/connectors.index.tsx`
  - [ ] Index route rendering `ConnectorView`
- [ ] **Create** `apps/web/src/routes/connectors.$connectorInstanceId.tsx`
  - [ ] Detail route rendering `ConnectorInstanceView` with `Route.useParams()`
- [ ] **Create** `apps/web/src/views/ConnectorInstanceView.tsx`
  - [ ] Placeholder detail view using `sdk.connectorInstances.get(id)` + `DataResult`

### 4. Wire ConnectorView Tab 0

- [ ] **Modify** `apps/web/src/views/ConnectorView.tsx`
  - [ ] Add second `usePagination` for instances
    - [ ] Sort fields: name, status, created (default: created desc)
    - [ ] Filter: status select (active/inactive/error/pending)
    - [ ] Limit: 10
  - [ ] Fetch all definitions for lookup: `sdk.connectorDefinitions.list({ limit: 1000 })`
  - [ ] Build `definitionMap` via `useMemo`
  - [ ] Add `useNavigate` + `handleInstanceClick` → navigates to `/connectors/${ci.id}`
  - [ ] Replace tab 0 placeholder with: `PaginationToolbar` → `ConnectorInstanceDataList` → `SyncTotal` → `DataResult` → `ConnectorInstanceCardUI` cards (or `EmptyResults`)

---

## Files Summary

| Action | File |
|--------|------|
| Create | `apps/web/src/api/connector-instances.api.ts` |
| Modify | `apps/web/src/api/keys.ts` |
| Modify | `apps/web/src/api/sdk.ts` |
| Create | `apps/web/src/components/ConnectorInstance.component.tsx` |
| Modify | `apps/web/src/utils/routes.util.ts` |
| Modify | `apps/web/src/routes/connectors.tsx` |
| Create | `apps/web/src/routes/connectors.index.tsx` |
| Create | `apps/web/src/routes/connectors.$connectorInstanceId.tsx` |
| Create | `apps/web/src/views/ConnectorInstanceView.tsx` |
| Modify | `apps/web/src/views/ConnectorView.tsx` |

## Key Reference Files

- `apps/web/src/components/ConnectorDefinition.component.tsx` — component pattern to mirror
- `apps/web/src/api/connector-definitions.api.ts` — SDK pattern to mirror
- `apps/web/src/routes/jobs.tsx` + `jobs.$jobId.tsx` — routing pattern to mirror
- `packages/core/src/contracts/connector-instance.contract.ts` — types (no changes needed)

## Verification

- [ ] `npm run type-check` — all types align
- [ ] `npm run lint` — no lint errors
- [ ] `npm run dev` — navigate to /connectors, tab 0 shows paginated list, filters/sort work, clicking a card navigates to /connectors/:id
