# Dashboard Redesign - Detailed Specification

## Overview

Restructure the dashboard to consolidate common tasks -- launching portals, viewing recent portals and pinned results, deleting portals -- into a single, focused surface. Remove the Default Station card. Add a Pinned Results section. Show associated entity names (station on portals, portal on pinned results) via new `include` join support on the backend.

---

## 1. Backend: `include=station` on Portal List

### 1.1 Contract: `packages/core/src/contracts/portal.contract.ts`

Add `include` to the list request query schema and `stationName` to the list response items.

**PortalListRequestQuerySchema** (line 12): Add `include` field.

```typescript
export const PortalListRequestQuerySchema =
  PaginationRequestQuerySchema.extend({
    stationId: z.string().optional(),
    include: z.string().optional(),
  });
```

**PortalListResponsePayloadSchema** (line 21): Change the `portals` array to accept an extended schema with an optional `stationName`.

```typescript
const PortalWithIncludesSchema = PortalSchema.extend({
  stationName: z.string().optional(),
});

export const PortalListResponsePayloadSchema =
  PaginatedResponsePayloadSchema.extend({
    portals: z.array(PortalWithIncludesSchema),
  });
```

### 1.2 Repository: `apps/api/src/db/repositories/portals.repository.ts`

Override `findMany` to dispatch to a LEFT JOIN query when `include` contains `"station"`. Follow the pattern in `connector-instances.repository.ts:87-96`.

**New imports:**

```typescript
import { eq, desc, asc, getTableColumns, type SQL } from "drizzle-orm";
import { portals, stations } from "../schema/index.js";
```

**Extended list options (optional -- `ListOptions` already has `include?: string[]`):**

No new interface needed; the base `ListOptions` already declares `include?: string[]`.

**Override `findMany`:**

```typescript
override async findMany(
  where?: SQL,
  opts: ListOptions = {},
  client: DbClient = db
): Promise<PortalSelect[]> {
  if (opts.include?.includes("station")) {
    return this.findManyWithStation(where, opts, client);
  }
  return super.findMany(where, opts, client);
}
```

**New private method `findManyWithStation`:**

```typescript
private async findManyWithStation(
  where: SQL | undefined,
  opts: ListOptions = {},
  client: DbClient = db
): Promise<(PortalSelect & { stationName: string | null })[]> {
  const conditions = this.withSoftDelete(where, opts.includeDeleted);

  let query = (client as typeof db)
    .select({
      portal: getTableColumns(portals),
      stationName: stations.name,
    })
    .from(portals)
    .leftJoin(stations, eq(portals.stationId, stations.id))
    .where(conditions)
    .$dynamic();

  if (opts.orderBy) {
    const orderFn = opts.orderBy.direction === "desc" ? desc : asc;
    query = query.orderBy(orderFn(opts.orderBy.column));
  }
  if (opts.limit !== undefined) query = query.limit(opts.limit);
  if (opts.offset !== undefined) query = query.offset(opts.offset);

  const rows = await query;

  return rows.map((row) => ({
    ...row.portal,
    stationName: row.stationName,
  }));
}
```

**Key details:**
- JOIN: `portals.stationId = stations.id` (both are `text NOT NULL`)
- LEFT JOIN to handle edge cases where station was deleted
- Returns `stationName: string | null` appended to each `PortalSelect`
- Soft-delete filter applied via `this.withSoftDelete()`
- Ordering, limit, offset applied identically to `findManyWithDefinition` pattern

### 1.3 Router: `apps/api/src/routes/portal.router.ts`

**GET `/api/portals` handler** (line 185): Parse `include` from validated query and pass to repository.

Current code (line 190-191):
```typescript
const { limit, offset, sortOrder, sortBy, stationId } =
  PortalListRequestQuerySchema.parse(req.query);
```

Change to:
```typescript
const { limit, offset, sortOrder, sortBy, stationId, include } =
  PortalListRequestQuerySchema.parse(req.query);
```

Current code (line 203-207):
```typescript
const listOpts = {
  limit,
  offset,
  orderBy: { column: sortColumn, direction: sortOrder },
};
```

Change to:
```typescript
const include_ = include?.split(",").map((s) => s.trim()).filter(Boolean);
const listOpts = {
  limit,
  offset,
  orderBy: { column: sortColumn, direction: sortOrder },
  include: include_,
};
```

No other changes needed -- the repository dispatches internally based on `opts.include`.

---

## 2. Backend: `include=portal` on Portal Results List

### 2.1 Contract: `packages/core/src/contracts/portal.contract.ts`

**PortalResultListRequestQuerySchema** (line 109): Add `include` field.

```typescript
export const PortalResultListRequestQuerySchema =
  PortalListRequestQuerySchema.extend({
    portalId: z.string().optional(),
    include: z.string().optional(),
  });
```

Note: Since `PortalResultListRequestQuerySchema` extends `PortalListRequestQuerySchema`, if `include` was added there in step 1.1, it is already inherited. Verify no duplication. If `PortalListRequestQuerySchema` already has `include`, this step is a no-op.

**Response items**: Add optional `portalName`. No dedicated response schema exists for the list -- the router returns raw data. Define an extended type for documentation/frontend use:

```typescript
const PortalResultWithIncludesSchema = PortalResultSchema.extend({
  portalName: z.string().nullable().optional(),
});
```

### 2.2 Repository: `apps/api/src/db/repositories/portal-results.repository.ts`

Override `findMany` to dispatch to a LEFT JOIN query when `include` contains `"portal"`.

**New imports:**

```typescript
import { eq, desc, asc, getTableColumns, type SQL } from "drizzle-orm";
import { portalResults, portals } from "../schema/index.js";
```

**Override `findMany`:**

```typescript
override async findMany(
  where?: SQL,
  opts: ListOptions = {},
  client: DbClient = db
): Promise<PortalResultSelect[]> {
  if (opts.include?.includes("portal")) {
    return this.findManyWithPortal(where, opts, client);
  }
  return super.findMany(where, opts, client);
}
```

**New private method `findManyWithPortal`:**

```typescript
private async findManyWithPortal(
  where: SQL | undefined,
  opts: ListOptions = {},
  client: DbClient = db
): Promise<(PortalResultSelect & { portalName: string | null })[]> {
  const conditions = this.withSoftDelete(where, opts.includeDeleted);

  let query = (client as typeof db)
    .select({
      result: getTableColumns(portalResults),
      portalName: portals.name,
    })
    .from(portalResults)
    .leftJoin(portals, eq(portalResults.portalId, portals.id))
    .where(conditions)
    .$dynamic();

  if (opts.orderBy) {
    const orderFn = opts.orderBy.direction === "desc" ? desc : asc;
    query = query.orderBy(orderFn(opts.orderBy.column));
  }
  if (opts.limit !== undefined) query = query.limit(opts.limit);
  if (opts.offset !== undefined) query = query.offset(opts.offset);

  const rows = await query;

  return rows.map((row) => ({
    ...row.result,
    portalName: row.portalName,
  }));
}
```

**Key details:**
- JOIN: `portal_results.portalId = portals.id` (`portalId` is `text NULLABLE` so LEFT JOIN is essential)
- Returns `portalName: string | null` appended to each `PortalResultSelect`
- When `portalId` is null (orphaned result), `portalName` will be null

### 2.3 Router: `apps/api/src/routes/portal-results.router.ts`

**GET `/api/portal-results` handler** (line 250): Parse `include` from validated query and pass to repository.

Current code (line 255):
```typescript
const { limit, offset, sortOrder, search, stationId, portalId } =
  PortalResultListRequestQuerySchema.parse(req.query);
```

Change to:
```typescript
const { limit, offset, sortOrder, search, stationId, portalId, include } =
  PortalResultListRequestQuerySchema.parse(req.query);
```

Current code (line 273-277):
```typescript
const listOpts = {
  limit,
  offset,
  orderBy: { column: portalResults.created, direction: sortOrder },
};
```

Change to:
```typescript
const include_ = include?.split(",").map((s) => s.trim()).filter(Boolean);
const listOpts = {
  limit,
  offset,
  orderBy: { column: portalResults.created, direction: sortOrder },
  include: include_,
};
```

---

## 3. Frontend: Recent Portals List with Delete + Station Name

### 3.1 Component: `apps/web/src/components/RecentPortalsList.component.tsx`

#### Props changes

**`RecentPortalsListUIProps`** (line 16): Add `onDeletePortal` callback. Extend the portal type to include `stationName`.

```typescript
export interface RecentPortalsListUIProps {
  portals: (Portal & { stationName?: string | null })[];
  onPortalClick: (portalId: string) => void;
  onDeletePortal: (portalId: string, portalName: string) => void;
}
```

**`RecentPortalsListConnectedProps`** (line 91): Add `onDeletePortal`.

```typescript
export interface RecentPortalsListConnectedProps {
  onPortalClick: (portalId: string) => void;
  onDeletePortal: (portalId: string, portalName: string) => void;
}
```

#### Data component changes

**`RecentPortalData`** (line 79): Add `include: "station"` to the query params.

```typescript
const RecentPortalData: React.FC<PortalDataProps> = ({ children }) => {
  const res = sdk.portals.list({
    limit: 5,
    offset: 0,
    sortBy: "lastOpened",
    sortOrder: "desc",
    include: "station",
  });
  return <>{children(res)}</>;
};
```

This requires adding `include` to the frontend API params type (see section 3.3).

#### UI rendering changes

**`RecentPortalsListUI`** (line 21): Replace the current card layout. Each card row becomes:

```tsx
<Card key={portal.id} variant="outlined">
  <CardActionArea
    onClick={() => onPortalClick(portal.id)}
    data-testid={`portal-row-${portal.id}`}
  >
    <CardContent sx={{ "&:last-child": { pb: 2 } }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="subtitle2" noWrap>
            {portal.name}
          </Typography>
          {portal.stationName && (
            <Typography variant="caption" color="text.secondary" noWrap>
              {portal.stationName}
            </Typography>
          )}
        </Box>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ flexShrink: 0 }}>
          <Typography variant="caption" color="text.secondary">
            {DateFactory.relativeTime(portal.lastOpened ?? portal.created)}
          </Typography>
          <IconButton
            size="small"
            color="error"
            aria-label="Delete portal"
            onClick={(e) => {
              e.stopPropagation();
              onDeletePortal(portal.id, portal.name);
            }}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Stack>
    </CardContent>
  </CardActionArea>
</Card>
```

**New imports needed:**

```typescript
import IconButton from "@mui/material/IconButton";
import DeleteIcon from "@mui/icons-material/Delete";
```

#### Connected component changes

Pass `onDeletePortal` through to the UI component:

```typescript
export const RecentPortalsListConnected: React.FC<
  RecentPortalsListConnectedProps
> = ({ onPortalClick, onDeletePortal }) => (
  <RecentPortalData>
    {(result) => (
      <DataResult results={{ portals: result }}>
        {(data) => {
          const payload = data.portals as unknown as PortalListResponsePayload;
          return (
            <RecentPortalsListUI
              portals={payload.portals}
              onPortalClick={onPortalClick}
              onDeletePortal={onDeletePortal}
            />
          );
        }}
      </DataResult>
    )}
  </RecentPortalData>
);
```

### 3.2 Component: `apps/web/src/api/portals.api.ts`

Add `include` to the params type accepted by the `list` hook. Currently the hook accepts `PortalListRequestQuery` which will include `include` after the contract change in 1.1. If the frontend uses a separate params type, ensure it includes `include?: string`.

### 3.3 Frontend API params

The `sdk.portals.list()` hook forwards params to `buildUrl()` as query string params. Since `include` is a string, it will serialize naturally as `?include=station`. No changes to `buildUrl` or `useAuthQuery` needed.

Similarly for `sdk.portalResults.list()` -- the `PortalResultsListParams` type in `apps/web/src/api/portal-results.api.ts` (line 8) needs `include` added:

```typescript
export type PortalResultsListParams = {
  stationId?: string;
  portalId?: string;
  search?: string;
  limit?: number;
  offset?: number;
  include?: string;
};
```

---

## 4. Frontend: Pinned Results List with Portal Name

### 4.1 Component: `apps/web/src/components/PinnedResultsList.component.tsx`

#### Data component changes

**`PinnedResultsData`** (line 120): Add `include: "portal"` to the query params.

```typescript
const PinnedResultsData: React.FC<PinnedResultsDataProps> = ({ children }) => {
  const res = sdk.portalResults.list({ limit: 5, offset: 0, include: "portal" });
  return <>{children(res)}</>;
};
```

#### Card UI changes

**`PinnedResultCardUI`** (line 36): Display `portalName` as secondary text below the result name. The `PortalResult` type won't have `portalName` natively, so use an extended type:

```typescript
export interface PinnedResultCardUIProps {
  result: PortalResult & { portalName?: string | null };
  onResultClick: (id: string) => void;
  onUnpin: (id: string) => void;
}
```

Add portal name rendering inside the `DetailCard` children:

```tsx
<DetailCard
  title={result.name}
  icon={<ResultTypeIcon type={result.type} />}
  onClick={() => onResultClick(result.id)}
  actions={actions}
  data-testid={`pinned-result-row-${result.id}`}
>
  <Stack spacing={0.25}>
    {result.portalName && (
      <Typography variant="caption" color="text.secondary">
        from {result.portalName}
      </Typography>
    )}
    <Typography variant="caption" color="text.secondary">
      {DateFactory.relativeTime(result.created)}
    </Typography>
  </Stack>
</DetailCard>
```

#### List UI changes

**`PinnedResultsListUIProps`** (line 68): Extend the result type.

```typescript
export interface PinnedResultsListUIProps {
  results: (PortalResult & { portalName?: string | null })[];
  onResultClick: (id: string) => void;
  onUnpin: (id: string) => void;
  onViewAll: () => void;
}
```

No other changes to list rendering -- it maps over `results` and passes each to `PinnedResultCardUI`.

---

## 5. Frontend: Dashboard View

### 5.1 Component: `apps/web/src/views/Dashboard.view.tsx`

#### Removals

- Remove import: `DefaultStationCardConnected`
- Remove from `DashboardViewUIProps`: `onLaunchPortal`, `onChangeDefault`, `onViewStation`
- Remove from `DashboardViewUI` JSX: The entire `<PageGridItem>` containing `<PageSection title="Default Station">` and `<DefaultStationCardConnected>`
- Remove from container: `handleLaunchPortal`, `handleChangeDefault`, `handleViewStation` callbacks
- Remove corresponding props from the `<DashboardViewUI>` render call

#### Additions

**New imports:**

```typescript
import { PinnedResultsListConnected } from "../components/PinnedResultsList.component";
import { DeletePortalDialog } from "../components/DeletePortalDialog.component";
import { Icon, IconName } from "@portalai/core/ui";
```

(`Icon` and `IconName` are already imported.)

**New props on `DashboardViewUIProps`:**

```typescript
export interface DashboardViewUIProps {
  onNewPortal: () => void;
  onPortalClick: (portalId: string) => void;
  onDeletePortal: (portalId: string, portalName: string) => void;
  onResultClick: (resultId: string) => void;
  onUnpin: (resultId: string) => void;
  onViewAllResults: () => void;
}
```

**New JSX in `DashboardViewUI`:**

Replace the 2-column `PageGrid` with a single-column stack of full-width sections:

```tsx
<PageGrid columns={{ xs: 1 }}>
  <PageGridItem>
    <PageSection title="Recent Portals" icon={<Icon name={IconName.Portal} />}>
      <RecentPortalsListConnected
        onPortalClick={onPortalClick}
        onDeletePortal={onDeletePortal}
      />
    </PageSection>
  </PageGridItem>

  <PageGridItem>
    <PageSection title="Pinned Results" icon={<Icon name={IconName.PushPin} />}>
      <PinnedResultsListConnected
        onResultClick={onResultClick}
        onUnpin={onUnpin}
        onViewAll={onViewAllResults}
      />
    </PageSection>
  </PageGridItem>
</PageGrid>
```

**New state and mutations in the container:**

```typescript
// Delete portal state
const [deleteTarget, setDeleteTarget] = useState<{
  id: string;
  name: string;
} | null>(null);

// Unpin result state (uses dynamic id, so we need a ref or state for the mutation)
const [unpinId, setUnpinId] = useState<string | null>(null);
```

**Delete portal handler:**

```typescript
const handleDeletePortal = useCallback(
  (portalId: string, portalName: string) => {
    setDeleteTarget({ id: portalId, name: portalName });
  },
  []
);

const handleDeleteClose = useCallback(() => {
  setDeleteTarget(null);
}, []);

const handleDeleteConfirm = useCallback(() => {
  if (!deleteTarget) return;
  deleteMutation.mutate(undefined, {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.portals.root });
      queryClient.invalidateQueries({ queryKey: queryKeys.portalResults.root });
      setDeleteTarget(null);
    },
  });
}, [deleteTarget, deleteMutation, queryClient]);
```

Note: `sdk.portals.remove(id)` requires the `id` at hook call time. Since the delete target is dynamic (user picks from a list), use `useAuthMutation` with a dynamic URL or `fetchWithAuth` directly. Follow the pattern from `StationDetail.view.tsx` which deletes portals from a list context. The simplest approach: use `fetchWithAuth` in the confirm handler.

```typescript
const { fetchWithAuth } = useAuthFetch();

const handleDeleteConfirm = useCallback(async () => {
  if (!deleteTarget) return;
  try {
    await fetchWithAuth(`/api/portals/${deleteTarget.id}`, { method: "DELETE" });
    queryClient.invalidateQueries({ queryKey: queryKeys.portals.root });
    queryClient.invalidateQueries({ queryKey: queryKeys.portalResults.root });
    setDeleteTarget(null);
  } catch {
    // serverError state handled via FormAlert in dialog
  }
}, [deleteTarget, fetchWithAuth, queryClient]);
```

**Unpin result handler:**

Same pattern -- dynamic ID, use `fetchWithAuth`:

```typescript
const handleUnpin = useCallback(
  async (resultId: string) => {
    try {
      await fetchWithAuth(`/api/portal-results/${resultId}`, { method: "DELETE" });
      queryClient.invalidateQueries({ queryKey: queryKeys.portalResults.root });
    } catch {
      // silent -- unpin is a lightweight action
    }
  },
  [fetchWithAuth, queryClient]
);
```

**Navigation handlers:**

```typescript
const handleResultClick = useCallback(
  (resultId: string) => {
    navigate({ to: `/portal-results/${resultId}` });
  },
  [navigate]
);

const handleViewAllResults = useCallback(() => {
  navigate({ to: "/portal-results" });
}, [navigate]);
```

**DeletePortalDialog in JSX:**

```tsx
<DeletePortalDialog
  open={deleteTarget !== null}
  onClose={handleDeleteClose}
  portalName={deleteTarget?.name ?? ""}
  onConfirm={handleDeleteConfirm}
  isPending={false}
  serverError={null}
/>
```

For proper pending/error tracking with `fetchWithAuth`, add local state:

```typescript
const [deletePending, setDeletePending] = useState(false);
const [deleteError, setDeleteError] = useState<ServerError | null>(null);
```

And update `handleDeleteConfirm` to set these accordingly.

---

## 6. Query Cache Invalidation Summary

| Action | Keys invalidated |
|---|---|
| Delete portal from dashboard | `queryKeys.portals.root`, `queryKeys.portalResults.root` |
| Unpin result from dashboard | `queryKeys.portalResults.root` |
| Create portal (existing) | `queryKeys.portals.root` |

---

## 7. Files Changed - Complete List

### Backend

| File | Change |
|---|---|
| `packages/core/src/contracts/portal.contract.ts` | Add `include` to `PortalListRequestQuerySchema`. Add `PortalWithIncludesSchema` with optional `stationName`. Add optional `portalName` for result list items. |
| `apps/api/src/db/repositories/portals.repository.ts` | Override `findMany` to dispatch to `findManyWithStation` when `include` contains `"station"`. New LEFT JOIN method. |
| `apps/api/src/db/repositories/portal-results.repository.ts` | Override `findMany` to dispatch to `findManyWithPortal` when `include` contains `"portal"`. New LEFT JOIN method. |
| `apps/api/src/routes/portal.router.ts` | Destructure `include` from parsed query. Parse into array. Pass in `listOpts`. |
| `apps/api/src/routes/portal-results.router.ts` | Destructure `include` from parsed query. Parse into array. Pass in `listOpts`. |

### Frontend

| File | Change |
|---|---|
| `apps/web/src/api/portal-results.api.ts` | Add `include?: string` to `PortalResultsListParams` |
| `apps/web/src/components/RecentPortalsList.component.tsx` | Add `onDeletePortal` prop. Add `include: "station"` to query. Render station name + delete button on each card. |
| `apps/web/src/components/PinnedResultsList.component.tsx` | Add `include: "portal"` to query. Render portal name on each card. |
| `apps/web/src/views/Dashboard.view.tsx` | Remove Default Station section. Add Pinned Results section. Add delete portal + unpin result handlers. Wire `DeletePortalDialog`. |

### Files Unchanged

| File | Reason |
|---|---|
| `CreatePortalDialog.component.tsx` | Already has station picker with default prefill |
| `DeletePortalDialog.component.tsx` | Reused as-is for dashboard portal deletion |
| `DefaultStationCard.component.tsx` | Kept in codebase, just removed from dashboard |
| `Authorized.layout.tsx` | No header changes |
| `SidebarNav.component.tsx` | No navigation changes |

---

## 8. Testing

### Backend

- **Portal list with `include=station`**: Verify `GET /api/portals?include=station` returns `stationName` on each portal. Verify without `include` the field is absent.
- **Portal results list with `include=portal`**: Verify `GET /api/portal-results?include=portal` returns `portalName`. Verify results with null `portalId` return `portalName: null`.

### Frontend

- **Recent Portals list**: Station name renders below portal name. Delete button visible. Clicking delete opens `DeletePortalDialog`. Confirming delete removes portal from list. `e.stopPropagation()` prevents card navigation when clicking delete.
- **Pinned Results list**: Portal name renders as "from {name}" on each card. Unpin removes result from list. "View All" navigates to `/portal-results`. Empty state displays when no results.
- **Dashboard layout**: Single-column layout with Recent Portals and Pinned Results. No Default Station card. "Launch New Portal" button in header still opens `CreatePortalDialog`.
- **Dialog checklist** (per CLAUDE.md): `DeletePortalDialog` already passes all dialog tests. No new dialog introduced.

### Manual verification

1. Open dashboard -- see recent portals with station names, pinned results with portal names
2. Click a portal card -- navigates to `/portals/:id`
3. Click delete on a portal -- confirmation dialog -- confirm -- portal disappears from list
4. Click a pinned result -- navigates to `/portal-results/:id`
5. Click unpin on a result -- result disappears from list
6. Click "View All" -- navigates to `/portal-results`
7. Click "Launch New Portal" -- dialog opens with station picker prefilled to default station
8. Empty states render correctly when no portals / no pinned results
