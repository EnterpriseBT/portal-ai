# Feature: Delete & Rename Connector Instances

## Overview

Add the ability to delete connector instances (from both the list view and the detail view), rename connector instances from the detail view, and display a warning dialog explaining the cascade of data that will be removed.

---

## Deletion Cascade Chain

When a connector instance is deleted, all dependent records must be soft-deleted in a single transaction:

```
connector_instance (soft-delete)
 +-- station_instances (hard-delete join rows — unlinks from stations)
 +-- connector_entities (soft-delete all)
      +-- entity_records (soft-delete all)
      +-- field_mappings (soft-delete all)
      +-- entity_tag_assignments (soft-delete all)
      +-- entity_group_members (soft-delete all)
```

> **Note:** `station_instances` is a join table (`stationId`, `connectorInstanceId`) with `ON DELETE no action` foreign keys. Rows must be explicitly hard-deleted to unlink the connector instance from any stations before soft-deleting the instance itself.

---

## Step 1: Add API Error Codes

**File:** `apps/api/src/constants/api-codes.constants.ts`

- Add `CONNECTOR_INSTANCE_DELETE_FAILED` to the `ApiCode` enum
- Add `CONNECTOR_INSTANCE_UPDATE_FAILED` to the `ApiCode` enum

### Checklist

- [x] Add `CONNECTOR_INSTANCE_DELETE_FAILED` to `ApiCode` enum
- [x] Add `CONNECTOR_INSTANCE_UPDATE_FAILED` to `ApiCode` enum
- [x] Verify: `npm run type-check` passes
- [x] Verify: `npm run lint` passes

---

## Step 2: Add DELETE Endpoint to Connector Instance Router

**File:** `apps/api/src/routes/connector-instance.router.ts`

Add `DELETE /api/connector-instances/:id` following the station delete pattern (`station.router.ts:496-595`):

1. Extract `id` from route params, `userId` from application metadata
2. Fetch the connector instance by ID; return 404 (`CONNECTOR_INSTANCE_NOT_FOUND`) if missing
3. Open a **transaction** and cascade deletes in order:
   a. Hard-delete `station_instances` rows for this connector instance (unlink from stations)
   b. Find all `connector_entities` for this instance via `connectorEntitiesRepo.findByConnectorInstanceId(id)`
   c. Collect all entity IDs
   d. Soft-delete `entity_group_members` for those entity IDs via `entityGroupMembersRepo.softDeleteMany(...)` (or a `deleteByConnectorEntityIds` helper)
   e. Soft-delete `entity_tag_assignments` for those entity IDs via `entityTagAssignmentsRepo.softDeleteMany(...)` (or a `deleteByConnectorEntityIds` helper)
   f. Soft-delete `field_mappings` for those entity IDs
   g. Soft-delete `entity_records` for those entity IDs
   h. Soft-delete all `connector_entities` for this instance
   i. Soft-delete the `connector_instance` itself
4. Return `{ id }` on success (200)
5. Wrap in try/catch, return 500 (`CONNECTOR_INSTANCE_DELETE_FAILED`) on failure

**Reference:** Station delete at `apps/api/src/routes/station.router.ts:496-595`, tag delete at `apps/api/src/routes/entity-tag.router.ts:492-529`.

### Repository Helpers Needed

Some repositories may need new batch-delete-by-entity-id methods. Check each repository for existing support; add where missing:

- **`entity-records.repository.ts`** -- add `softDeleteByConnectorEntityIds(entityIds, deletedBy, client)` if not present
- **`field-mappings.repository.ts`** -- add `softDeleteByConnectorEntityIds(entityIds, deletedBy, client)` if not present
- **`entity-tag-assignments.repository.ts`** -- add `softDeleteByConnectorEntityIds(entityIds, deletedBy, client)` if not present
- **`entity-group-members.repository.ts`** -- add `softDeleteByConnectorEntityIds(entityIds, deletedBy, client)` if not present
- **`connector-entities.repository.ts`** -- add `softDeleteByConnectorInstanceId(instanceId, deletedBy, client)` if not present
- **`station-instances.repository.ts`** -- add `hardDeleteByConnectorInstanceId(connectorInstanceId, client)` if not present (this is a join table, so hard-delete is appropriate)

Each helper should use `update(...).set({ deleted: now, deletedBy }).where(inArray(connectorEntityId, entityIds))` within the passed transaction client. The `station-instances` helper uses `delete().where(eq(connectorInstanceId, id))` since it is a join table with no soft-delete columns.

### Checklist

- [x] Add `softDeleteByConnectorEntityIds` to `entity-records.repository.ts`
- [x] Add `softDeleteByConnectorEntityIds` to `field-mappings.repository.ts`
- [x] Add `softDeleteByConnectorEntityIds` to `entity-tag-assignments.repository.ts`
- [x] Add `softDeleteByConnectorEntityIds` to `entity-group-members.repository.ts`
- [x] Add `softDeleteByConnectorInstanceId` to `connector-entities.repository.ts`
- [x] Add `hardDeleteByConnectorInstanceId` to `station-instances.repository.ts`
- [x] Implement `DELETE /api/connector-instances/:id` route handler with transaction and cascade
- [x] Write integration tests for DELETE endpoint:
  - [x] Test: returns 200 with `{ id }` on successful delete
  - [x] Test: returns 404 for non-existent connector instance
  - [x] Test: returns 404 for already-deleted connector instance
  - [x] Test: cascades soft-delete to connector entities
  - [x] Test: cascades soft-delete to entity records
  - [x] Test: cascades soft-delete to field mappings
  - [x] Test: cascades soft-delete to entity tag assignments
  - [x] Test: cascades soft-delete to entity group members
  - [x] Test: hard-deletes station_instances join rows (unlinks from stations)
  - [x] Test: deleted instance no longer appears in GET list
- [x] Verify: `npm run test` passes (all new and existing tests)
- [x] Verify: `npm run type-check` passes
- [x] Verify: `npm run lint` passes
- [x] Verify: `npm run build` passes

---

## Step 3: Add PATCH Endpoint for Renaming Connector Instances

**File:** `apps/api/src/routes/connector-instance.router.ts`

Add `PATCH /api/connector-instances/:id` to support renaming (and future partial updates):

1. Extract `id` from route params, `userId` from application metadata
2. Parse and validate request body (accept `{ name: string }` via a Zod schema)
3. Fetch the connector instance by ID; return 404 if missing
4. Call `connectorInstancesRepo.update(id, { name, updatedBy: userId })`
5. Return the updated connector instance (200)
6. Wrap in try/catch, return 500 (`CONNECTOR_INSTANCE_UPDATE_FAILED`) on failure

### Checklist

- [x] Define Zod request body schema for PATCH (e.g., `ConnectorInstancePatchBodySchema`)
- [x] Implement `PATCH /api/connector-instances/:id` route handler
- [x] Write integration tests for PATCH endpoint:
  - [x] Test: returns 200 with updated record on successful rename
  - [x] Test: returns 404 for non-existent connector instance
  - [x] Test: returns 400 for empty or missing name
  - [x] Test: `updatedBy` field is set to the requesting user
- [x] Verify: `npm run test` passes (all new and existing tests)
- [x] Verify: `npm run type-check` passes
- [x] Verify: `npm run lint` passes
- [x] Verify: `npm run build` passes

---

## Step 4: Add Pre-Flight Impact Check Endpoint

**File:** `apps/api/src/routes/connector-instance.router.ts`

Add `GET /api/connector-instances/:id/impact` that returns counts of all associated objects that would be affected by deletion. The frontend will call this when the delete dialog opens to show the user exactly what will be removed.

### Response Shape

```typescript
interface ConnectorInstanceImpact {
  connectorEntities: number;
  entityRecords: number;
  fieldMappings: number;
  entityTagAssignments: number;
  entityGroupMembers: number;
  stations: number; // count of stations linked via station_instances
}
```

### Implementation

1. Extract `id` from route params
2. Fetch the connector instance by ID; return 404 (`CONNECTOR_INSTANCE_NOT_FOUND`) if missing
3. Find all `connector_entities` for this instance, collect entity IDs
4. Run count queries in parallel (no transaction needed -- read-only):
   a. `connectorEntities` -- count of entities for this instance
   b. `entityRecords` -- count of records across those entity IDs
   c. `fieldMappings` -- count of field mappings across those entity IDs
   d. `entityTagAssignments` -- count of tag assignments across those entity IDs
   e. `entityGroupMembers` -- count of group members across those entity IDs
   f. `stations` -- count of `station_instances` rows for this connector instance (distinct station count)
5. Return the impact object (200)

### Repository Helpers Needed

Add `count`-by-entity-ID helpers where not already present:

- **`entity-records.repository.ts`** -- add `countByConnectorEntityIds(entityIds)` if not present
- **`field-mappings.repository.ts`** -- add `countByConnectorEntityIds(entityIds)` if not present
- **`entity-tag-assignments.repository.ts`** -- add `countByConnectorEntityIds(entityIds)` if not present
- **`entity-group-members.repository.ts`** -- add `countByConnectorEntityIds(entityIds)` if not present
- **`station-instances.repository.ts`** -- add `countByConnectorInstanceId(connectorInstanceId)` if not present

### Checklist

- [x] Add `countByConnectorEntityIds` to `entity-records.repository.ts`
- [x] Add `countByConnectorEntityIds` to `field-mappings.repository.ts`
- [x] Add `countByConnectorEntityIds` to `entity-tag-assignments.repository.ts`
- [x] Add `countByConnectorEntityIds` to `entity-group-members.repository.ts`
- [x] Add `countByConnectorInstanceId` to `station-instances.repository.ts`
- [x] Implement `GET /api/connector-instances/:id/impact` route handler
- [x] Write integration tests for impact endpoint:
  - [x] Test: returns correct counts for an instance with entities, records, mappings, tags, groups, and station links
  - [x] Test: returns all zeros for an instance with no associated data
  - [x] Test: returns 404 for non-existent connector instance
- [x] Verify: `npm run test` passes (all new and existing tests)
- [x] Verify: `npm run type-check` passes
- [x] Verify: `npm run lint` passes
- [x] Verify: `npm run build` passes

---

## Step 5: Add Frontend API Hooks

**File:** `apps/web/src/api/connector-instances.api.ts`

Add mutation hooks and an impact query hook:

```typescript
delete: (id: string) =>
  useAuthMutation<void, void>({
    url: `/api/connector-instances/${encodeURIComponent(id)}`,
    method: "DELETE",
  }),

rename: (id: string) =>
  useAuthMutation<{ name: string }, ConnectorInstanceApi>({
    url: `/api/connector-instances/${encodeURIComponent(id)}`,
    method: "PATCH",
  }),

impact: (id: string, options?) =>
  useAuthQuery<ConnectorInstanceImpact>({
    queryKey: queryKeys.connectorInstances.impact(id),
    url: `/api/connector-instances/${encodeURIComponent(id)}/impact`,
    ...options,
  }),
```

The `impact` query should use `enabled: open` (only fetch when the delete dialog is open) to avoid unnecessary requests.

### Checklist

- [x] Add `delete` mutation hook to `connectorInstances` API object
- [x] Add `rename` mutation hook to `connectorInstances` API object
- [x] Add `impact` query hook to `connectorInstances` API object
- [x] Add `impact` key to `queryKeys.connectorInstances`
- [x] Verify: `npm run type-check` passes
- [x] Verify: `npm run lint` passes
- [x] Verify: `npm run build` passes

---

## Step 6: Create DeleteConnectorInstanceDialog Component

**File:** `apps/web/src/components/DeleteConnectorInstanceDialog.component.tsx`

Follow the `DeleteStationDialog` pattern (`apps/web/src/components/DeleteStationDialog.component.tsx`):

### Props

```typescript
interface DeleteConnectorInstanceDialogProps {
  open: boolean;
  onClose: () => void;
  connectorInstanceName: string;
  onConfirm: () => void;
  isPending?: boolean;
  impact?: ConnectorInstanceImpact | null; // from the pre-flight query
  isLoadingImpact?: boolean;
}
```

### UI

- MUI `Dialog` with title: **"Delete Connector Instance"**
- Body text: *"Are you sure you want to delete **{name}**?"*
- **Impact summary** (displayed when `impact` is loaded, loading spinner while `isLoadingImpact`):
  - Itemized list showing non-zero counts, e.g.:
    - "3 connector entities"
    - "47 entity records"
    - "12 field mappings"
    - "5 tag assignments"
    - "2 group memberships"
    - "1 station will be unlinked"
  - Omit items with zero count to keep the list concise
  - If all counts are zero, show: *"No associated data found."*
- Warning text (use MUI `Alert` severity="warning"): *"This action will permanently delete all associated data listed above. This cannot be undone."*
- Actions: **Cancel** button (secondary) and **Delete** button (error color, disabled while `isPending` or `isLoadingImpact`)

### Checklist

- [x] Create `DeleteConnectorInstanceDialog.component.tsx` with props interface
- [x] Implement dialog UI with title, confirmation text, impact summary, warning alert, and action buttons
- [x] Show loading state while impact data is being fetched
- [x] Display itemized impact counts, omitting zero-count items
- [x] Write unit tests for `DeleteConnectorInstanceDialog`:
  - [x] Test: renders dialog when `open` is true
  - [x] Test: displays connector instance name in confirmation text
  - [x] Test: displays impact counts when `impact` data is provided
  - [x] Test: omits items with zero count from impact summary
  - [x] Test: shows loading indicator when `isLoadingImpact` is true
  - [x] Test: shows "No associated data found" when all counts are zero
  - [x] Test: calls `onConfirm` when Delete button is clicked
  - [x] Test: calls `onClose` when Cancel button is clicked
  - [x] Test: Delete button is disabled when `isPending` is true
  - [x] Test: Delete button is disabled when `isLoadingImpact` is true
- [x] Verify: `npm run test` passes
- [x] Verify: `npm run type-check` passes
- [x] Verify: `npm run lint` passes
- [x] Verify: `npm run build` passes

---

## Step 7: Create EditConnectorInstanceDialog Component

**File:** `apps/web/src/components/EditConnectorInstanceDialog.component.tsx`

### Props

```typescript
interface EditConnectorInstanceDialogProps {
  open: boolean;
  onClose: () => void;
  currentName: string;
  onConfirm: (newName: string) => void;
  isPending?: boolean;
}
```

### UI

- MUI `Dialog` with title: **"Rename Connector Instance"**
- MUI `TextField` pre-filled with `currentName`, required, with label "Name"
- Actions: **Cancel** button (secondary) and **Save** button (primary, disabled while `isPending` or name unchanged/empty)

### Checklist

- [x] Create `EditConnectorInstanceDialog.component.tsx` with props interface
- [x] Implement dialog UI with title, text field, and action buttons
- [x] Write unit tests for `EditConnectorInstanceDialog`:
  - [x] Test: renders dialog when `open` is true
  - [x] Test: text field is pre-filled with `currentName`
  - [x] Test: Save button is disabled when name is unchanged
  - [x] Test: Save button is disabled when name is empty
  - [x] Test: Save button is disabled when `isPending` is true
  - [x] Test: calls `onConfirm` with new name when Save is clicked
  - [x] Test: calls `onClose` when Cancel button is clicked
- [x] Verify: `npm run test` passes
- [x] Verify: `npm run type-check` passes
- [x] Verify: `npm run lint` passes
- [x] Verify: `npm run build` passes

---

## Step 8: Integrate Delete & Rename into Connector Instance Detail View

**File:** `apps/web/src/views/ConnectorInstance.view.tsx`

1. Add state: `deleteDialogOpen` (boolean), `renameDialogOpen` (boolean)
2. Wire up the `connectorInstances.delete(id)` mutation hook
3. Wire up the `connectorInstances.rename(id)` mutation hook
4. Wire up the `connectorInstances.impact(id, { enabled: deleteDialogOpen })` query hook — only fetches when the delete dialog is open
5. Add a **Delete** button (red/error, in the header area or actions section) that opens the delete dialog
6. Add a **Rename** option (edit icon button next to the instance name, or a menu action) that opens the rename dialog
7. On delete confirm: call mutation, on success invalidate `queryKeys.connectorInstances.root` and navigate to `/connectors`
8. On rename confirm: call mutation with new name, on success invalidate queries to refresh the view
9. Render `<DeleteConnectorInstanceDialog>` with `impact` and `isLoadingImpact` props from the impact query
10. Render `<EditConnectorInstanceDialog>` at the bottom of the component

**Reference:** Station detail view delete integration at `apps/web/src/views/StationDetail.view.tsx`.

### Checklist

- [x] Add `deleteDialogOpen` and `renameDialogOpen` state variables
- [x] Wire up `connectorInstances.delete(id)` mutation with `onSuccess` callback (invalidate queries, navigate to `/connectors`)
- [x] Wire up `connectorInstances.rename(id)` mutation with `onSuccess` callback (invalidate queries)
- [x] Wire up `connectorInstances.impact(id)` query with `enabled: deleteDialogOpen`
- [x] Add Delete button (error color) to view header/actions area
- [x] Add Rename button/icon next to instance name
- [x] Render `<DeleteConnectorInstanceDialog>` with `impact` data and `isLoadingImpact` props
- [x] Render `<EditConnectorInstanceDialog>` with correct props
- [x] Verify: `npm run type-check` passes
- [x] Verify: `npm run lint` passes
- [x] Verify: `npm run build` passes

---

## Step 9: Integrate Delete into Connector Instance List View (Cards)

**File:** `apps/web/src/views/Connector.view.tsx` and `apps/web/src/components/ConnectorInstance.component.tsx`

Two approaches (choose based on existing card patterns):

### Option A: Add a menu to ConnectorInstanceCardUI

1. Add an `onDelete` callback prop to `ConnectorInstanceCardUI`
2. Add a three-dot (`MoreVert`) icon button in the card header that opens a MUI `Menu`
3. Menu item: **Delete** -- calls `onDelete`

### Option B: Add a delete icon button directly on the card

1. Add an `onDelete` callback prop to `ConnectorInstanceCardUI`
2. Render a small `IconButton` (e.g., `DeleteOutline`) in the card's action area

### In Connector.view.tsx

1. Add state: `deleteDialogOpen` (boolean), `deleteTarget` (instance name + id)
2. Wire up the `connectorInstances.delete(id)` mutation hook
3. Wire up the `connectorInstances.impact(deleteTarget?.id, { enabled: deleteDialogOpen })` query hook
4. Pass `onDelete` handler to each `ConnectorInstanceCardUI` that sets `deleteTarget` and opens the dialog
5. On confirm: call mutation, on success invalidate queries to refresh the list
6. Render `<DeleteConnectorInstanceDialog>` with `impact` data at the bottom of the view

### Checklist

- [ ] Add `onDelete` optional callback prop to `ConnectorInstanceCardUI`
- [ ] Add menu or icon button to card UI that triggers `onDelete`
- [ ] Add `deleteDialogOpen` and `deleteTarget` state to `Connector.view.tsx`
- [ ] Wire up `connectorInstances.delete(id)` mutation with `onSuccess` callback (invalidate queries)
- [ ] Wire up `connectorInstances.impact(deleteTarget?.id)` query with `enabled: deleteDialogOpen`
- [ ] Pass `onDelete` handler to each card that sets target and opens dialog
- [ ] Render `<DeleteConnectorInstanceDialog>` with `impact` and `isLoadingImpact` props in the list view
- [ ] Verify: `npm run type-check` passes
- [ ] Verify: `npm run lint` passes
- [ ] Verify: `npm run build` passes

---

## Step 10: Final Verification

Run all checks across the full monorepo to confirm nothing is broken.

### Checklist

- [ ] Verify: `npm run test` passes (all unit and integration tests across monorepo)
- [ ] Verify: `npm run type-check` passes (all packages)
- [ ] Verify: `npm run lint` passes (all packages)
- [ ] Verify: `npm run build` passes (all packages)
- [ ] Manual smoke test: delete connector instance from detail view triggers dialog with warning, completes successfully, navigates to list
- [ ] Manual smoke test: delete connector instance from list view card triggers dialog with warning, completes successfully, list refreshes
- [ ] Manual smoke test: rename connector instance from detail view triggers dialog, saves successfully, name updates in view
- [ ] Manual smoke test: delete dialog shows correct impact counts (entities, records, mappings, tags, groups, stations) before confirming
- [ ] Manual smoke test: verify cascaded data (entities, records, mappings, tags, groups) is no longer returned by API after delete
- [ ] Manual smoke test: verify station_instances join rows are removed (station no longer lists the deleted connector instance)

---

## File Change Summary

| File | Action | Description |
|------|--------|-------------|
| `apps/api/src/constants/api-codes.constants.ts` | Edit | Add `CONNECTOR_INSTANCE_DELETE_FAILED`, `CONNECTOR_INSTANCE_UPDATE_FAILED` |
| `apps/api/src/db/repositories/entity-records.repository.ts` | Edit | Add `softDeleteByConnectorEntityIds` helper |
| `apps/api/src/db/repositories/field-mappings.repository.ts` | Edit | Add `softDeleteByConnectorEntityIds` helper |
| `apps/api/src/db/repositories/entity-tag-assignments.repository.ts` | Edit | Add `softDeleteByConnectorEntityIds` helper |
| `apps/api/src/db/repositories/entity-group-members.repository.ts` | Edit | Add `softDeleteByConnectorEntityIds` helper |
| `apps/api/src/db/repositories/connector-entities.repository.ts` | Edit | Add `softDeleteByConnectorInstanceId` helper |
| `apps/api/src/db/repositories/station-instances.repository.ts` | Edit | Add `hardDeleteByConnectorInstanceId` and `countByConnectorInstanceId` helpers |
| `apps/api/src/routes/connector-instance.router.ts` | Edit | Add `DELETE /:id`, `PATCH /:id`, and `GET /:id/impact` endpoints |
| `apps/web/src/api/connector-instances.api.ts` | Edit | Add `delete` and `rename` mutation hooks |
| `apps/web/src/components/DeleteConnectorInstanceDialog.component.tsx` | Create | Delete confirmation dialog with cascade warning |
| `apps/web/src/components/EditConnectorInstanceDialog.component.tsx` | Create | Edit dialog with text field |
| `apps/web/src/components/ConnectorInstance.component.tsx` | Edit | Add `onDelete` prop to `ConnectorInstanceCardUI` |
| `apps/web/src/views/ConnectorInstance.view.tsx` | Edit | Integrate delete + rename dialogs and mutations |
| `apps/web/src/views/Connector.view.tsx` | Edit | Integrate delete from card menu/button |
| `apps/api/src/__tests__/__integration__/routes/connector-instance.router.integration.test.ts` | Edit | Add DELETE and PATCH test cases |

**Estimated new files:** 2
**Estimated modified files:** 13
