# Create Field Mapping — Feature Specification

## Overview

Allow users to manually create a field mapping from the Column Definition detail view (`/column-definitions/:id`). A "Create" button on the Field Mappings section opens a dialog with validated form fields, async searchable selects for entity lookups, and standard error handling.

---

## Scope

### In Scope

- "Create" button in the Field Mappings `PageSection` header
- `CreateFieldMappingDialog` component with form validation
- `AsyncSearchableSelect` for Connector Entity lookup
- SDK `create` mutation for `POST /api/field-mappings`
- Cache invalidation on success
- Full test coverage per dialog checklist

### Out of Scope

- Bulk creation

---

## UI Design

### 1. Create Button Placement

Add a "Create" button to the `PageSection` header for "Field Mappings" on the `ColumnDefinitionDetailView`. Follows the same pattern as other list views with create actions (e.g., Stations, Portals).

```
┌─ Field Mappings ──────────────────────── [+ Create] ─┐
│  PaginationToolbar                                    │
│  FieldMappingTable                                    │
└───────────────────────────────────────────────────────┘
```

### 2. CreateFieldMappingDialog

Modal dialog with the following fields:

| Field | Control | Required | Notes |
|-------|---------|----------|-------|
| Column Definition | `TextField` (read-only) | — | Locked to the current column definition; displayed as a disabled field showing the column definition label so the user has full context, but not editable |
| Connector Entity | `AsyncSearchableSelect` | Yes | Searches `GET /api/connector-entities?search=<query>&limit=20`, displays `label` |
| Source Field | `TextField` | Yes | Free-text, min 1 char, auto-focused |
| Is Primary Key | `Switch` | No | Default: `false` |
| Ref Column Definition | `AsyncSearchableSelect` | No | Optional. Searches `GET /api/column-definitions?search=<query>&limit=20`, displays `label`. For reference/reference-array type mappings — specifies the target column definition |
| Ref Entity Key | `AsyncSearchableSelect` | No | Optional. Searches `GET /api/connector-entities?search=<query>&limit=20`, selects `key` (displayed as `label (key)`). For reference types — specifies the target entity key |
| Ref Bidirectional Field Mapping | `AsyncSearchableSelect` | No | Optional. Searches `GET /api/field-mappings?search=<query>&limit=20`, displays `sourceField` with connector entity context. For reference-array types — links to the inverse mapping |

**Layout:** Fields stacked vertically in a `Stack spacing={2.5}`, consistent with `CreateStationDialog` and `EditFieldMappingDialog`.

---

## Component API

### `CreateFieldMappingDialog`

```tsx
interface CreateFieldMappingDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (body: FieldMappingCreateRequestBody) => void;
  onSearchConnectorEntities: (query: string) => Promise<SelectOption[]>;
  onSearchColumnDefinitions: (query: string) => Promise<SelectOption[]>;
  onSearchFieldMappings: (query: string) => Promise<SelectOption[]>;
  isPending: boolean;
  serverError: ServerError | null;
  /** Locked to the current column definition — not user-editable */
  columnDefinitionId: string;
  /** Displayed in the read-only Column Definition field */
  columnDefinitionLabel: string;
}
```

**Key behaviors:**

- `columnDefinitionId` is passed from the parent view and is **locked** — it is rendered as a disabled `TextField` displaying the column definition's label so the user has context, but cannot be changed. The actual ID is sent in the request body
- `connectorEntityId` is selected via async searchable select
- `refColumnDefinitionId`, `refEntityKey`, and `refBidirectionalFieldMappingId` are optional fields with their own async searchable selects
- Form resets when `open` transitions to `true`
- First interactive field (`connectorEntityId` select) receives auto-focus via `useDialogAutoFocus(open)`

---

## Form Validation

Uses `validateWithSchema` with a local Zod schema derived from `FieldMappingCreateRequestBodySchema`:

```tsx
const CreateFieldMappingFormSchema = z.object({
  connectorEntityId: z.string().min(1, "Connector entity is required"),
  sourceField: z.string().trim().min(1, "Source field is required"),
  isPrimaryKey: z.boolean(),
  refColumnDefinitionId: z.string().nullable(),
  refEntityKey: z.string().nullable(),
  refBidirectionalFieldMappingId: z.string().nullable(),
});
```

**Validation behavior:**
- Field errors shown only after blur or submit attempt (`touched` state pattern)
- On invalid submit: `focusFirstInvalidField()` called via `requestAnimationFrame`
- `aria-invalid` set on all validated fields
- `required` attribute on required fields

---

## Async Searchable Selects

All entity lookups use `AsyncSearchableSelect` with search callbacks passed from the parent view. Each follows the same pattern as `handleSearchColumnDefinitions` already in `ColumnDefinitionDetailView`.

### Connector Entity (required)

```tsx
const handleSearchConnectorEntities = useCallback(
  async (query: string) => {
    const res = await fetchWithAuth<{
      payload: { connectorEntities: Array<{ id: string; key: string; label: string }> };
    }>(`/api/connector-entities?search=${encodeURIComponent(query)}&limit=20`);
    return res.payload.connectorEntities.map((ce) => ({
      value: ce.id,
      label: ce.label,
    }));
  },
  [fetchWithAuth]
);
```

### Ref Column Definition (optional)

Reuses the existing `handleSearchColumnDefinitions` already defined in the view.

### Ref Entity Key (optional)

Searches connector entities but selects the `key` field (not `id`) since `refEntityKey` stores an entity key string:

```tsx
const handleSearchConnectorEntitiesForRefKey = useCallback(
  async (query: string) => {
    const res = await fetchWithAuth<{
      payload: { connectorEntities: Array<{ id: string; key: string; label: string }> };
    }>(`/api/connector-entities?search=${encodeURIComponent(query)}&limit=20`);
    return res.payload.connectorEntities.map((ce) => ({
      value: ce.key,
      label: `${ce.label} (${ce.key})`,
    }));
  },
  [fetchWithAuth]
);
```

### Ref Bidirectional Field Mapping (optional)

Searches field mappings and displays source field with connector entity context:

```tsx
const handleSearchFieldMappings = useCallback(
  async (query: string) => {
    const res = await fetchWithAuth<{
      payload: {
        fieldMappings: Array<{
          id: string;
          sourceField: string;
          connectorEntity: { label: string } | null;
        }>;
      };
    }>(`/api/field-mappings?search=${encodeURIComponent(query)}&include=connectorEntity&limit=20`);
    return res.payload.fieldMappings.map((fm) => ({
      value: fm.id,
      label: fm.connectorEntity
        ? `${fm.sourceField} (${fm.connectorEntity.label})`
        : fm.sourceField,
    }));
  },
  [fetchWithAuth]
);
```

---

## SDK & API Integration

### New SDK Method

Add `create` to `fieldMappings` in `apps/web/src/api/field-mappings.api.ts`:

```tsx
create: () =>
  useAuthMutation<FieldMappingCreateResponsePayload, FieldMappingCreateRequestBody>({
    url: "/api/field-mappings",
    method: "POST",
  }),
```

### Request Body

```json
{
  "connectorEntityId": "<selected-entity-id>",
  "columnDefinitionId": "<from-parent-view>",
  "sourceField": "<user-input>",
  "isPrimaryKey": false,
  "refColumnDefinitionId": "<selected-column-def-id> | null",
  "refEntityKey": "<selected-entity-key> | null",
  "refBidirectionalFieldMappingId": "<selected-field-mapping-id> | null"
}
```

The API already handles validation of the composite unique constraint `(connectorEntityId, columnDefinitionId)` and returns an appropriate error if a mapping already exists for that pair.

---

## Cache Invalidation

On successful creation, invalidate:

```tsx
queryClient.invalidateQueries({ queryKey: queryKeys.fieldMappings.root });
queryClient.invalidateQueries({ queryKey: queryKeys.columnDefinitions.root });
```

This ensures the field mappings table refreshes and any column definition counts are updated.

---

## View Integration

In `ColumnDefinitionDetailView`:

1. Add `createDialogOpen` state
2. Initialize `fmCreateMutation` via `sdk.fieldMappings.create()`
3. Add `handleFieldMappingCreate` callback that calls `fmCreateMutation.mutate` with `columnDefinitionId` injected
4. Add "Create" button to the Field Mappings `PageSection` header
5. Render `CreateFieldMappingDialog` alongside existing dialogs

```tsx
const [createDialogOpen, setCreateDialogOpen] = useState(false);
const fmCreateMutation = sdk.fieldMappings.create();

const handleFieldMappingCreate = useCallback(
  (body: FieldMappingCreateRequestBody) => {
    fmCreateMutation.mutate(body, {
      onSuccess: () => {
        setCreateDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: queryKeys.fieldMappings.root });
        queryClient.invalidateQueries({ queryKey: queryKeys.columnDefinitions.root });
      },
    });
  },
  [fmCreateMutation, queryClient]
);
```

---

## File Changes

| File | Change |
|------|--------|
| `apps/web/src/components/CreateFieldMappingDialog.component.tsx` | **New** — Dialog component |
| `apps/web/src/views/ColumnDefinitionDetail.view.tsx` | Add create button, state, mutation, dialog render |
| `apps/web/src/api/field-mappings.api.ts` | Add `create` method |
| `apps/web/src/__tests__/CreateFieldMappingDialog.test.tsx` | **New** — Dialog test suite |
| `apps/web/src/__tests__/ColumnDefinitionDetailView.test.tsx` | Add tests for create button and integration |

---

## Test Plan

### CreateFieldMappingDialog Tests

Per the Dialog & Form Test Checklist:

- [ ] Renders title and form fields when `open={true}`
- [ ] Does not render when `open={false}`
- [ ] Calls `onSubmit` with correct body (including `columnDefinitionId`) on button click
- [ ] Supports Enter key submission (form submit event)
- [ ] Calls `onClose` on Cancel click
- [ ] Shows loading state when `isPending={true}` (button text "Creating...")
- [ ] Renders `<FormAlert>` when `serverError` is provided
- [ ] Does not render `<FormAlert>` when `serverError` is null
- [ ] Displays field-level validation errors on invalid submit (empty `connectorEntityId`, empty `sourceField`)
- [ ] `aria-invalid="true"` is set on invalid fields
- [ ] `required` attribute is present on required fields
- [ ] Calls `onSearchConnectorEntities` when typing in the connector entity select
- [ ] Calls `onSearchColumnDefinitions` when typing in the ref column definition select
- [ ] Calls `onSearchFieldMappings` when typing in the ref bidirectional field mapping select
- [ ] Form resets when dialog reopens
- [ ] `isPrimaryKey` defaults to `false`
- [ ] Optional reference fields (`refColumnDefinitionId`, `refEntityKey`, `refBidirectionalFieldMappingId`) default to `null`
- [ ] Optional reference fields submit as `null` when not selected

### ColumnDefinitionDetailView Integration Tests

- [ ] "Create" button is visible in the Field Mappings section
- [ ] Clicking "Create" opens the dialog
- [ ] Successful creation closes dialog and refreshes field mappings list

---

## Accessibility

- `AsyncSearchableSelect` for connector entity accepts `inputRef` for auto-focus via `useDialogAutoFocus`
- All validated fields include `aria-invalid` and `aria-describedby` (via MUI `helperText`)
- Form is wrapped via `slotProps.paper.component="form"` on `Modal` for Enter key submission
- Action buttons use `type="button"` to prevent double-firing with form submission
