# Feature: Delete & Rename Connector Instances

## Overview

Add the ability to delete connector instances (from both the list view and the detail view), rename connector instances from the detail view, and display a warning dialog explaining the cascade of data that will be removed.

---

## Deletion Cascade Chain

When a connector instance is deleted, all dependent records must be soft-deleted in a single transaction:

```
connector_instance (soft-delete)
 +-- connector_entities (soft-delete all)
      +-- entity_records (soft-delete all)
      +-- field_mappings (soft-delete all)
      +-- entity_tag_assignments (soft-delete all)
      +-- entity_group_members (soft-delete all)
```

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
3. Open a **transaction** and cascade soft-deletes in order:
   a. Find all `connector_entities` for this instance via `connectorEntitiesRepo.findByConnectorInstanceId(id)`
   b. Collect all entity IDs
   c. Soft-delete `entity_group_members` for those entity IDs via `entityGroupMembersRepo.softDeleteMany(...)` (or a `deleteByConnectorEntityIds` helper)
   d. Soft-delete `entity_tag_assignments` for those entity IDs via `entityTagAssignmentsRepo.softDeleteMany(...)` (or a `deleteByConnectorEntityIds` helper)
   e. Soft-delete `field_mappings` for those entity IDs
   f. Soft-delete `entity_records` for those entity IDs
   g. Soft-delete all `connector_entities` for this instance
   h. Soft-delete the `connector_instance` itself
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

Each helper should use `update(...).set({ deleted: now, deletedBy }).where(inArray(connectorEntityId, entityIds))` within the passed transaction client.

### Checklist

- [ ] Add `softDeleteByConnectorEntityIds` to `entity-records.repository.ts`
- [ ] Add `softDeleteByConnectorEntityIds` to `field-mappings.repository.ts`
- [ ] Add `softDeleteByConnectorEntityIds` to `entity-tag-assignments.repository.ts`
- [ ] Add `softDeleteByConnectorEntityIds` to `entity-group-members.repository.ts`
- [ ] Add `softDeleteByConnectorInstanceId` to `connector-entities.repository.ts`
- [ ] Implement `DELETE /api/connector-instances/:id` route handler with transaction and cascade
- [ ] Write integration tests for DELETE endpoint:
  - [ ] Test: returns 200 with `{ id }` on successful delete
  - [ ] Test: returns 404 for non-existent connector instance
  - [ ] Test: returns 404 for already-deleted connector instance
  - [ ] Test: cascades soft-delete to connector entities
  - [ ] Test: cascades soft-delete to entity records
  - [ ] Test: cascades soft-delete to field mappings
  - [ ] Test: cascades soft-delete to entity tag assignments
  - [ ] Test: cascades soft-delete to entity group members
  - [ ] Test: deleted instance no longer appears in GET list
- [ ] Verify: `npm run test` passes (all new and existing tests)
- [ ] Verify: `npm run type-check` passes
- [ ] Verify: `npm run lint` passes
- [ ] Verify: `npm run build` passes

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

- [ ] Define Zod request body schema for PATCH (e.g., `ConnectorInstancePatchBodySchema`)
- [ ] Implement `PATCH /api/connector-instances/:id` route handler
- [ ] Write integration tests for PATCH endpoint:
  - [ ] Test: returns 200 with updated record on successful rename
  - [ ] Test: returns 404 for non-existent connector instance
  - [ ] Test: returns 400 for empty or missing name
  - [ ] Test: `updatedBy` field is set to the requesting user
- [ ] Verify: `npm run test` passes (all new and existing tests)
- [ ] Verify: `npm run type-check` passes
- [ ] Verify: `npm run lint` passes
- [ ] Verify: `npm run build` passes

---

## Step 4: Add Frontend API Hooks

**File:** `apps/web/src/api/connector-instances.api.ts`

Add two mutation hooks following the station delete pattern (`apps/web/src/api/stations.api.ts:54-58`):

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
```

### Checklist

- [ ] Add `delete` mutation hook to `connectorInstances` API object
- [ ] Add `rename` mutation hook to `connectorInstances` API object
- [ ] Verify: `npm run type-check` passes
- [ ] Verify: `npm run lint` passes
- [ ] Verify: `npm run build` passes

---

## Step 5: Create DeleteConnectorInstanceDialog Component

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
}
```

### UI

- MUI `Dialog` with title: **"Delete Connector Instance"**
- Body text: *"Are you sure you want to delete **{name}**?"*
- Warning text (use MUI `Alert` severity="warning"): *"This action will permanently delete all associated data including connector entities, entity records, field mappings, tag assignments, and group memberships. This cannot be undone."*
- Actions: **Cancel** button (secondary) and **Delete** button (error color, disabled while `isPending`)

### Checklist

- [ ] Create `DeleteConnectorInstanceDialog.component.tsx` with props interface
- [ ] Implement dialog UI with title, confirmation text, warning alert, and action buttons
- [ ] Write unit tests for `DeleteConnectorInstanceDialog`:
  - [ ] Test: renders dialog when `open` is true
  - [ ] Test: displays connector instance name in confirmation text
  - [ ] Test: calls `onConfirm` when Delete button is clicked
  - [ ] Test: calls `onClose` when Cancel button is clicked
  - [ ] Test: Delete button is disabled when `isPending` is true
- [ ] Verify: `npm run test` passes
- [ ] Verify: `npm run type-check` passes
- [ ] Verify: `npm run lint` passes
- [ ] Verify: `npm run build` passes

---

## Step 6: Create RenameConnectorInstanceDialog Component

**File:** `apps/web/src/components/RenameConnectorInstanceDialog.component.tsx`

### Props

```typescript
interface RenameConnectorInstanceDialogProps {
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

- [ ] Create `RenameConnectorInstanceDialog.component.tsx` with props interface
- [ ] Implement dialog UI with title, text field, and action buttons
- [ ] Write unit tests for `RenameConnectorInstanceDialog`:
  - [ ] Test: renders dialog when `open` is true
  - [ ] Test: text field is pre-filled with `currentName`
  - [ ] Test: Save button is disabled when name is unchanged
  - [ ] Test: Save button is disabled when name is empty
  - [ ] Test: Save button is disabled when `isPending` is true
  - [ ] Test: calls `onConfirm` with new name when Save is clicked
  - [ ] Test: calls `onClose` when Cancel button is clicked
- [ ] Verify: `npm run test` passes
- [ ] Verify: `npm run type-check` passes
- [ ] Verify: `npm run lint` passes
- [ ] Verify: `npm run build` passes

---

## Step 7: Integrate Delete & Rename into Connector Instance Detail View

**File:** `apps/web/src/views/ConnectorInstance.view.tsx`

1. Add state: `deleteDialogOpen` (boolean), `renameDialogOpen` (boolean)
2. Wire up the `connectorInstances.delete(id)` mutation hook
3. Wire up the `connectorInstances.rename(id)` mutation hook
4. Add a **Delete** button (red/error, in the header area or actions section) that opens the delete dialog
5. Add a **Rename** option (edit icon button next to the instance name, or a menu action) that opens the rename dialog
6. On delete confirm: call mutation, on success invalidate `queryKeys.connectorInstances.root` and navigate to `/connectors`
7. On rename confirm: call mutation with new name, on success invalidate queries to refresh the view
8. Render `<DeleteConnectorInstanceDialog>` and `<RenameConnectorInstanceDialog>` at the bottom of the component

**Reference:** Station detail view delete integration at `apps/web/src/views/StationDetail.view.tsx`.

### Checklist

- [ ] Add `deleteDialogOpen` and `renameDialogOpen` state variables
- [ ] Wire up `connectorInstances.delete(id)` mutation with `onSuccess` callback (invalidate queries, navigate to `/connectors`)
- [ ] Wire up `connectorInstances.rename(id)` mutation with `onSuccess` callback (invalidate queries)
- [ ] Add Delete button (error color) to view header/actions area
- [ ] Add Rename button/icon next to instance name
- [ ] Render `<DeleteConnectorInstanceDialog>` with correct props
- [ ] Render `<RenameConnectorInstanceDialog>` with correct props
- [ ] Verify: `npm run type-check` passes
- [ ] Verify: `npm run lint` passes
- [ ] Verify: `npm run build` passes

---

## Step 8: Integrate Delete into Connector Instance List View (Cards)

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
3. Pass `onDelete` handler to each `ConnectorInstanceCardUI` that sets `deleteTarget` and opens the dialog
4. On confirm: call mutation, on success invalidate queries to refresh the list
5. Render `<DeleteConnectorInstanceDialog>` at the bottom of the view

### Checklist

- [ ] Add `onDelete` optional callback prop to `ConnectorInstanceCardUI`
- [ ] Add menu or icon button to card UI that triggers `onDelete`
- [ ] Add `deleteDialogOpen` and `deleteTarget` state to `Connector.view.tsx`
- [ ] Wire up `connectorInstances.delete(id)` mutation with `onSuccess` callback (invalidate queries)
- [ ] Pass `onDelete` handler to each card that sets target and opens dialog
- [ ] Render `<DeleteConnectorInstanceDialog>` in the list view
- [ ] Verify: `npm run type-check` passes
- [ ] Verify: `npm run lint` passes
- [ ] Verify: `npm run build` passes

---

## Step 9: Final Verification

Run all checks across the full monorepo to confirm nothing is broken.

### Checklist

- [ ] Verify: `npm run test` passes (all unit and integration tests across monorepo)
- [ ] Verify: `npm run type-check` passes (all packages)
- [ ] Verify: `npm run lint` passes (all packages)
- [ ] Verify: `npm run build` passes (all packages)
- [ ] Manual smoke test: delete connector instance from detail view triggers dialog with warning, completes successfully, navigates to list
- [ ] Manual smoke test: delete connector instance from list view card triggers dialog with warning, completes successfully, list refreshes
- [ ] Manual smoke test: rename connector instance from detail view triggers dialog, saves successfully, name updates in view
- [ ] Manual smoke test: verify cascaded data (entities, records, mappings, tags, groups) is no longer returned by API after delete

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
| `apps/api/src/routes/connector-instance.router.ts` | Edit | Add `DELETE /:id` and `PATCH /:id` endpoints |
| `apps/web/src/api/connector-instances.api.ts` | Edit | Add `delete` and `rename` mutation hooks |
| `apps/web/src/components/DeleteConnectorInstanceDialog.component.tsx` | Create | Delete confirmation dialog with cascade warning |
| `apps/web/src/components/RenameConnectorInstanceDialog.component.tsx` | Create | Rename dialog with text field |
| `apps/web/src/components/ConnectorInstance.component.tsx` | Edit | Add `onDelete` prop to `ConnectorInstanceCardUI` |
| `apps/web/src/views/ConnectorInstance.view.tsx` | Edit | Integrate delete + rename dialogs and mutations |
| `apps/web/src/views/Connector.view.tsx` | Edit | Integrate delete from card menu/button |
| `apps/api/src/__tests__/__integration__/routes/connector-instance.router.integration.test.ts` | Edit | Add DELETE and PATCH test cases |

**Estimated new files:** 2
**Estimated modified files:** 12
