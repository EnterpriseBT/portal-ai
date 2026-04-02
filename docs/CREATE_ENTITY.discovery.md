# Create Entity — Discovery & Implementation Plan

## Goal

Add a "Create Entity" dialog reachable from two locations:

1. **Entities view** (`/entities`) — "Create Entity" button in the page header. Connector instance is selectable (filtered to writable instances only).
2. **Connector Instance view** (`/connectors/:connectorInstanceId`) — "Create Entity" button in the Entities section. Connector instance is **locked** to the current instance (pre-filled and disabled).

The form validates against the `ConnectorEntitySchema` and only shows **writable** connector instances via a new server-side capability filter.

---

## Existing Infrastructure

| Layer | What exists | Location |
|-------|-------------|----------|
| Zod model | `ConnectorEntitySchema` — `organizationId`, `connectorInstanceId`, `key` (regex `^[a-z][a-z0-9_]*$`), `label` | `packages/core/src/models/connector-entity.model.ts` |
| Drizzle table | `connector_entities` with soft-delete unique index on `(connectorInstanceId, key)` | `apps/api/src/db/schema/connector-entities.table.ts` |
| Contract | `ConnectorEntityCreateRequestBody` (`connectorInstanceId`, `key`, `label`) and response types | `packages/core/src/contracts/connector-entity.contract.ts` |
| API endpoint | `POST /api/connector-entities` — validates payload, verifies instance exists, creates entity | `apps/api/src/routes/connector-entity.router.ts` |
| Repository | `ConnectorEntitiesRepository` with full CRUD + `upsertByKey` | `apps/api/src/db/repositories/connector-entities.repository.ts` |
| Frontend SDK | `list`, `get`, `impact`, `update`, `delete` — **missing `create`** | `apps/web/src/api/connector-entities.api.ts` |
| Entities view | `EntitiesView` with pagination, filters, delete dialog — **no create dialog** | `apps/web/src/views/Entities.view.tsx` |
| Connector Instance view | `ConnectorInstanceView` with entities `PageSection`, pagination, entity cards — **no create button in entities section** | `apps/web/src/views/ConnectorInstance.view.tsx` |
| Reference dialog | `CreateStationDialog` — full pattern with Modal form, Zod validation, `FormAlert`, `useDialogAutoFocus` | `apps/web/src/components/CreateStationDialog.component.tsx` |

### Connector Instance Capability Model

`ConnectorInstanceSchema.enabledCapabilityFlags` is `{ read?, write?, sync? }` stored as a `jsonb` column (`enabled_capability_flags`). The list endpoint (`GET /api/connector-instances`) currently has **no server-side filter for capabilities**.

---

## Implementation Plan

### 1. Contract — add `capability` query param

**File**: `packages/core/src/contracts/connector-instance.contract.ts`

- Add `capability: z.string().optional()` to `ConnectorInstanceListRequestQuerySchema`
- Accepts comma-separated values (e.g. `?capability=write`)

### 2. API Router — server-side capability filter

**File**: `apps/api/src/routes/connector-instance.router.ts`

- Destructure `capability` from parsed query
- For each capability in the comma-separated list, add a SQL condition:
  ```sql
  enabled_capability_flags->>'write' = 'true'
  ```
- Uses Drizzle's `sql` template literal — JSONB text extraction is index-friendly
- Update OpenAPI docs to document the new parameter

### 3. Frontend SDK — add `create` mutation

**File**: `apps/web/src/api/connector-entities.api.ts`

- Add `create` method: `useAuthMutation<ConnectorEntityCreateResponsePayload, ConnectorEntityCreateRequestBody>` with `POST /api/connector-entities`

### 4. Create Entity Dialog

**File**: `apps/web/src/components/CreateConnectorEntityDialog.component.tsx` *(new)*

**Props:**

| Prop | Type | Purpose |
|------|------|---------|
| `open` | `boolean` | Controls dialog visibility |
| `onClose` | `() => void` | Close handler |
| `onSubmit` | `(body: ConnectorEntityCreateRequestBody) => void` | Submit handler |
| `isPending` | `boolean` | Loading state |
| `serverError` | `ServerError \| null` | Server error display |
| `lockedConnectorInstance` | `{ id: string; name: string } \| null` | Optional — when provided, the connector instance field is pre-filled and **disabled** |

**Fields:**

| Field | Control | Validation | Error message |
|-------|---------|------------|---------------|
| Label | `TextField`, auto-focused | Non-empty string | "Label is required" |
| Key | `TextField` | Regex `^[a-z][a-z0-9_]*$` | "Key must start with a lowercase letter and contain only lowercase letters, numbers, and underscores" |
| Connector Instance | Single-select `Autocomplete` | Non-empty string | "Connector instance is required" |

**Connector instance behavior:**
- When `lockedConnectorInstance` is `null` (opened from Entities view): fetches writable instances via `sdk.connectorInstances.list({ capability: "write" })`, user selects one
- When `lockedConnectorInstance` is provided (opened from Connector Instance view): field displays the instance name and is **disabled** — the `connectorInstanceId` is used directly on submit

**Patterns followed:**
- `Modal` with `slotProps.paper.component="form"` for Enter key submission
- `useDialogAutoFocus(open)` on the Label field
- `touched` / `errors` state with `validateWithSchema` + `focusFirstInvalidField`
- `FormAlert` for server errors
- Form reset on `open` change (respects `lockedConnectorInstance` for initial state)
- `type="button"` on action buttons

### 5. Wire into Entities view

**File**: `apps/web/src/views/Entities.view.tsx`

- Add `createOpen` state + `sdk.connectorEntities.create()` mutation
- Add "Create Entity" button to `PageHeader`
- Pass `onCreate` callback through `EntitiesViewUIProps`
- Render `<CreateConnectorEntityDialog>` with `lockedConnectorInstance={null}` (connector instance is selectable)
- On success: close dialog, invalidate `queryKeys.connectorEntities.root`

### 6. Wire into Connector Instance view

**File**: `apps/web/src/views/ConnectorInstance.view.tsx`

- Add `createEntityOpen` state + `sdk.connectorEntities.create()` mutation
- Add "Create Entity" button to the Entities `PageSection` header
- Render `<CreateConnectorEntityDialog>` with `lockedConnectorInstance={{ id: connectorInstanceId, name: ci.name }}` — connector instance field is locked
- On success: close dialog, invalidate `queryKeys.connectorEntities.root`

### 7. Tests

**File**: `apps/web/src/__tests__/CreateConnectorEntityDialog.component.test.tsx` *(new)*

Per the Dialog & Form Test Checklist:
- Renders when `open={true}`, hidden when `open={false}`
- Calls `onSubmit` on button click and Enter key
- Calls `onClose` on Cancel
- Shows loading state when `isPending={true}`
- Renders `FormAlert` when `serverError` provided
- Field-level validation errors on invalid submit
- `aria-invalid="true"` on invalid fields
- `required` attribute on required fields
- Connector instance field is disabled when `lockedConnectorInstance` is provided
- Connector instance field is selectable when `lockedConnectorInstance` is null

---

## Files Changed Summary

| File | Action |
|------|--------|
| `packages/core/src/contracts/connector-instance.contract.ts` | Add `capability` to list query schema |
| `apps/api/src/routes/connector-instance.router.ts` | Parse `capability` param, add JSONB filter |
| `apps/web/src/api/connector-entities.api.ts` | Add `create` mutation |
| `apps/web/src/components/CreateConnectorEntityDialog.component.tsx` | New dialog component |
| `apps/web/src/views/Entities.view.tsx` | Wire create button + dialog (`lockedConnectorInstance={null}`) |
| `apps/web/src/views/ConnectorInstance.view.tsx` | Wire create button in Entities section (`lockedConnectorInstance` set) |
| `apps/web/src/__tests__/CreateConnectorEntityDialog.component.test.tsx` | New test file |
